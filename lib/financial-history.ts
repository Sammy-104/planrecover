import type {MoneyEvent,State,Item} from './model.ts';
import {BackendError,conflict} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import {planCurrency} from './money.ts';

const sorted=(values:Record<string,number>)=>Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
export function financialEventFacts(event:MoneyEvent){return JSON.stringify({id:event.id,itemId:event.itemId,
 kind:event.kind,amount:event.amount,shares:sorted(event.shares),contributions:sorted(event.contributions),
 mode:event.mode,providerId:event.providerId??null,from:event.from??null,to:event.to??null});}
export function approvedItemSnapshot(item:Item){return JSON.stringify({id:item.id,revision:item.revision,
 name:item.name,category:item.category,start:item.start,duration:item.duration,price:item.price,
 participants:[...item.participants].sort(),shares:sorted(item.shares),allocation:item.allocation,
 values:sorted(item.values),required:[...(item.required??item.participants)].sort(),policy:item.policy,
 expires:item.expires,deadline:item.deadline,source:item.source,...(item.funding?{funding:item.funding}:{})});}
export async function sha256(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}

/** Facts and approval snapshots cannot be overwritten; status changes append history. */
export async function financialSnapshotWrites(database:D1Database,owner:string,states:State[]){
 const commands:D1PreparedStatement[]=[],now=new Date().toISOString();
 for(const state of states){
  const planId=state.plan.id;if(!planId)continue;
  for(const event of state.events){
   const facts=financialEventFacts(event),body=JSON.stringify(event),fingerprint=await sha256(body),guard=crypto.randomUUID();
   if(event.kind==='expense'&&event.mode==='manual'){
    const fundingGuard=crypto.randomUUID();
    commands.push(database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN
      EXISTS(SELECT 1 FROM financial_events WHERE owner=? AND plan_id=? AND event_id=?) OR
      NOT EXISTS(SELECT 1 FROM payment_funding_claims WHERE owner=? AND plan_id=? AND item_id=?) THEN 1 ELSE 0 END)`)
      .bind(fundingGuard,owner,planId,event.id,owner,planId,event.itemId));
    commands.push(database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(fundingGuard));
   }
   commands.push(database.prepare(`INSERT OR IGNORE INTO financial_events
    (owner,plan_id,event_id,facts,body,currency,provider,provider_id,kind,created) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(owner,planId,event.id,facts,body,planCurrency(state.plan),event.mode==='sandbox'&&event.providerId?'paypal-sandbox':null,event.mode==='sandbox'?event.providerId??null:null,event.kind,event.created??now));
   commands.push(database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS
    (SELECT 1 FROM financial_events WHERE owner=? AND plan_id=? AND event_id=? AND facts=? AND currency=?) THEN 1 ELSE 0 END)`)
    .bind(guard,owner,planId,event.id,facts,planCurrency(state.plan)));
   commands.push(database.prepare(`INSERT OR IGNORE INTO financial_event_history
    (id,owner,plan_id,event_id,fingerprint,status,body,recorded) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),owner,planId,event.id,fingerprint,event.status,body,now));
   commands.push(database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard));
  }
  for(const item of state.items.filter(item=>item.approvals.length&&item.price!==null)){
   const snapshot=approvedItemSnapshot(item),guard=crypto.randomUUID();
   commands.push(database.prepare('INSERT OR IGNORE INTO approval_revisions(owner,plan_id,item_id,revision,snapshot,created) VALUES (?,?,?,?,?,?)')
    .bind(owner,planId,item.id,item.revision,snapshot,now));
   commands.push(database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS
    (SELECT 1 FROM approval_revisions WHERE owner=? AND plan_id=? AND item_id=? AND revision=? AND snapshot=?) THEN 1 ELSE 0 END)`)
    .bind(guard,owner,planId,item.id,item.revision,snapshot));
   for(const memberId of item.approvals)commands.push(database.prepare('INSERT OR IGNORE INTO approval_members(owner,plan_id,item_id,revision,member_id,approved_at) VALUES (?,?,?,?,?,?)')
    .bind(owner,planId,item.id,item.revision,memberId,now));
   commands.push(database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard));
  }
 }
 return commands;
}
export type FundingClaim={owner:string;planId:string;itemId:string;revision:number;memberId:string;channel:'order'|'invoice';referenceId:string};
export async function claimPaymentFunding(database:D1Database,input:FundingClaim){
 const expense=await database.prepare(`SELECT 1 AS paid FROM financial_events e WHERE owner=? AND plan_id=? AND kind='expense'
  AND json_extract(facts,'$.itemId')=? AND EXISTS(SELECT 1 FROM json_each(json_extract(e.facts,'$.shares')) WHERE key=? AND value>0)
  AND EXISTS(SELECT 1 FROM financial_event_history h WHERE h.owner=e.owner AND h.plan_id=e.plan_id AND h.event_id=e.event_id AND h.status='confirmed') LIMIT 1`)
  .bind(input.owner,input.planId,input.itemId,input.memberId).first();
 const prior=await database.prepare('SELECT channel,reference_id FROM payment_funding_claims WHERE owner=? AND plan_id=? AND item_id=? AND revision=? AND member_id=?')
  .bind(input.owner,input.planId,input.itemId,input.revision,input.memberId).first<{channel:string;reference_id:string}>();
 if(expense&&!prior)throw new BackendError('PAYMENT_ALREADY_RECORDED','A payment is already recorded for this purchase. Review its balance before collecting again.',409);
 await database.prepare('INSERT OR IGNORE INTO payment_funding_claims(owner,plan_id,item_id,revision,member_id,channel,reference_id,created) VALUES (?,?,?,?,?,?,?,?)')
  .bind(input.owner,input.planId,input.itemId,input.revision,input.memberId,input.channel,input.referenceId,new Date().toISOString()).run();
 const saved=await database.prepare('SELECT channel,reference_id FROM payment_funding_claims WHERE owner=? AND plan_id=? AND item_id=? AND revision=? AND member_id=?')
  .bind(input.owner,input.planId,input.itemId,input.revision,input.memberId).first<{channel:string;reference_id:string}>();
 if(saved?.channel!==input.channel||saved.reference_id!==input.referenceId)throw new BackendError('PAYMENT_CHANNEL_CONFLICT','This approved share already has a different checkout or invoice. Resolve it before collecting again.',409);
}
export type FinancialEffectInput={owner:string;planId:string;event:MoneyEvent;statements?:D1PreparedStatement[];
 operation?:{id:string;status:string;payload:string;providerId?:string};
 markPaid?:{memberId:string;revision:number;amount:number}};
/** Atomic plan projection, immutable history and provider/domain transitions. */
export async function commitFinancialEffect(database:D1Database,input:FinancialEffectInput):Promise<{duplicate:boolean;state:State}>{
 const repository=new PlanRepository(database),event=input.event;
 if(!Number.isSafeInteger(event.amount)||!event.id||!input.planId)throw new BackendError('INVALID_FINANCIAL_EFFECT','The financial effect is invalid.');
 for(let attempt=0;attempt<4;attempt++){
  const root=await repository.loadWorkspace(input.owner);if(!root)throw new BackendError('FINANCIAL_PLAN_MISSING','The financial workspace is unavailable.',404);
  let trip=[root,...(root.archives??[]).map(a=>a.workspace as State),...(root.deletedTrips??[]).map(a=>a.workspace as State)]
   .find(state=>state.plan.id===input.planId);
  let retained:{body:string;version:number}|null=null;
  if(!trip){retained=await database.prepare("SELECT body,version FROM plans WHERE owner=? AND id=? AND status='deleted'").bind(input.owner,input.planId).first();if(retained)trip=JSON.parse(retained.body);}
  if(!trip||!trip.items.some(item=>item.id===event.itemId)&&event.kind!=='settlement')throw new BackendError('FINANCIAL_PLAN_MISSING','The financial item is unavailable.',404);
  const existing=trip.events.find(value=>value.id===event.id||event.providerId&&value.providerId===event.providerId&&value.kind===event.kind);
  if(existing&&financialEventFacts(existing)!==financialEventFacts(event))throw new BackendError('FINANCIAL_EFFECT_CONFLICT','This provider effect already has different financial evidence.',409);
  let changed=false;
  if(!existing){trip.events.push(event);changed=true;}
  else if(existing.status!==event.status){
   if(existing.status==='confirmed'||event.status!=='confirmed')throw new BackendError('FINANCIAL_STATUS_CONFLICT','A confirmed financial effect cannot become pending.',409);
   existing.status='confirmed';existing.evidence=event.evidence;changed=true;
  }
  if(input.markPaid&&event.status==='confirmed'){
   const paid=input.markPaid,item=trip.items.find(i=>i.id===event.itemId);
   if(item&&item.revision===paid.revision&&item.participants.includes(paid.memberId)&&item.shares[paid.memberId]===paid.amount){
    const contributed=trip.events.filter(e=>e.itemId===item.id&&e.kind==='expense'&&e.status==='confirmed').reduce((sum,e)=>sum+(e.shares[paid.memberId]??0),0);
    if(contributed>=paid.amount&&!item.paid.includes(paid.memberId)){item.paid.push(paid.memberId);changed=true;}
    if(item.status==='awaiting-payment'&&item.participants.every(id=>item.paid.includes(id))){item.status='scheduled';changed=true;}
   }
  }
  const extra=[...(input.statements??[])];
  if(input.operation){const operation=input.operation;
   extra.push(database.prepare('UPDATE provider_operations SET status=?,payload=?,provider_id=COALESCE(?,provider_id) WHERE id=? AND owner=?')
    .bind(operation.status,operation.payload,operation.providerId??null,operation.id,input.owner));
  }
  try{
   if(retained){const token=crypto.randomUUID();
    await database.batch([
     database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans WHERE owner=? AND id=? AND status='deleted' AND version=?) THEN 1 ELSE 0 END)").bind(token,input.owner,input.planId,retained.version),
     ...(changed?[database.prepare("UPDATE plans SET body=?,version=version+1,updated=? WHERE owner=? AND id=? AND status='deleted'").bind(JSON.stringify(trip),new Date().toISOString(),input.owner,input.planId)]:[]),
     ...await financialSnapshotWrites(database,input.owner,[trip]),...extra,database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token),
    ]);
   }else if(changed)await repository.saveWorkspace(input.owner,root,root.version,undefined,undefined,extra);
   else {const token=crypto.randomUUID();await database.batch([
    database.prepare('INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND version=?) THEN 1 ELSE 0 END)').bind(token,input.owner,root.version),
    ...await financialSnapshotWrites(database,input.owner,[trip]),...extra,database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)]);}
   return {duplicate:!!existing,state:(await repository.loadWorkspace(input.owner))!};
  }catch(error){if(error instanceof BackendError&&error.code==='VERSION_CONFLICT'||String(error).includes('CHECK constraint failed')){if(attempt<3)continue;throw conflict();}throw error;}
 }
 throw conflict();
}

export async function saveProviderRequestIntent(database:D1Database,input:{operationId:string;owner:string;planId:string;path:string;body:unknown;requestKey:string},now=new Date()){
 const body=JSON.stringify(input.body),fingerprint=await sha256(JSON.stringify({path:input.path,body:input.body,requestKey:input.requestKey}));
 await database.prepare(`INSERT OR IGNORE INTO provider_request_intents(operation_id,owner,plan_id,path,method,request_body,request_key,fingerprint,created,replay_before) VALUES (?,?,?,?,'POST',?,?,?,?,?)`)
  .bind(input.operationId,input.owner,input.planId,input.path,body,input.requestKey,fingerprint,now.toISOString(),new Date(now.getTime()+5*60*60_000).toISOString()).run();
 const saved=await database.prepare('SELECT fingerprint FROM provider_request_intents WHERE operation_id=? AND owner=?').bind(input.operationId,input.owner).first<{fingerprint:string}>();
 if(saved?.fingerprint!==fingerprint)throw new BackendError('PAYMENT_INTENT_CHANGED','The saved provider request differs from this approved operation.',409);
}
