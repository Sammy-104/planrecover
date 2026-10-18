import {z} from 'zod';
import {allocate,type State,type Item,type Shares} from './model.ts';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import {sharedTripView,mergeSharedTrip} from './trip-sharing.ts';
import {planCurrency} from './money.ts';
import {parseWorkspaceMutation} from './action-contracts.ts';
import type {Identity} from './people.ts';
import {reviewPlanning} from './planning-review.ts';
import {syncChangeWorkflow,replacementId} from './change-workflow.ts';
import {hasMerchantCheckout} from './merchant-scope.ts';
import {assertPaymentChangeReady,paymentChangeGuard} from './payment-change-fence.ts';
import {assertDependenciesReviewed} from './dependencies.ts';
import {purchaseEvents,accountingItemIds,hasFinalizedReceiptPurchase} from './receipt-accounting.ts';

const id=z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(v=>!['__proto__','prototype','constructor'].includes(v));
const version=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ids=z.array(id).min(1).max(20).refine(v=>new Set(v).size===v.length);
const addition=z.object({name:z.string().trim().min(1).max(180),category:z.enum(['Activity','Meal','Accommodation','Transport','Preparation','Free stop','Practical stop']),
 start:z.string().datetime({offset:true}),duration:z.number().int().min(1).max(1440),price:z.number().int().min(0).max(1e12).nullable(),
 participants:z.array(id).min(1).max(100),location:z.string().max(300),taskOwner:id.optional(),depends:z.array(id).max(30).optional(),dependencySource:z.string().trim().min(3).max(1000).optional(),dependencyConfirm:z.literal(true).optional()}).strict();
export const changeRequest=z.discriminatedUnion('type',[
 z.object({type:z.literal('departure'),version,memberId:id,itemIds:ids.optional()}).strict(),
 z.object({type:z.literal('recovery'),version,itemIds:ids,option:z.enum(['keep','cancel','replace']),replacements:z.array(addition).max(8).default([])}).strict(),
 z.object({type:z.literal('approve'),version,changeId:z.string().uuid(),confirm:z.literal(true)}).strict(),
 z.object({type:z.literal('apply'),version,changeId:z.string().uuid(),confirm:z.literal(true)}).strict(),
 z.object({type:z.literal('cancel'),version,changeId:z.string().uuid(),confirm:z.literal(true)}).strict(),
]);
type Terms={kind:'departure'|'recovery';option?:'keep'|'cancel'|'replace';memberId?:string;currency:string;
 originals:Item[];updates:Item[];additions:z.infer<typeof addition>[];required:string[];events:string;
 warnings:string[];figures:{retained:number;expectedRefund:number|null;newPaymentNow:number|null;finalTotal:number|null;perMember:Shares;memberImpacts:Record<string,{expectedRefund:number|null;newPaymentNow:number|null;finalChange:number|null}>}};
type Row={id:string;owner:string;plan_id:string;body:string;status:string;created:string;created_by:string;applied_at:string|null};
const fail=(message:string)=>new BackendError('PLAN_CHANGE_INVALID',message);
const signature=(i:Item)=>JSON.stringify({...i,status:undefined,paid:undefined,approvals:undefined,booking:undefined,bookingReference:undefined});
const moneyFacts=(s:State,itemIds:string[])=>{const ids=new Set(itemIds.flatMap(id=>accountingItemIds(s,id)));return JSON.stringify(s.events.filter(e=>ids.has(e.itemId)).map(e=>({id:e.id,amount:e.amount,status:e.status,shares:e.shares,contributions:e.contributions})).sort((a,b)=>a.id.localeCompare(b.id)));};
function recordedCost(state:State,itemId:string){const events=purchaseEvents(state,itemId).filter(e=>e.status==='confirmed'&&e.kind!=='settlement'),shares:Shares={},contributions:Shares={};for(const event of events){for(const [id,n]of Object.entries(event.shares))shares[id]=(shares[id]??0)+n;for(const [id,n]of Object.entries(event.contributions))contributions[id]=(contributions[id]??0)+n;}return {events,shares,contributions,amount:events.reduce((n,e)=>n+e.amount,0)};}
const effectivePrice=(state:State,item:Item)=>hasFinalizedReceiptPurchase(state,item.id)?recordedCost(state,item.id).amount:item.price;
function projectedRemaining(state:State,item:Item){
 if(item.status==='cancelled'||hasFinalizedReceiptPurchase(state,item.id))return 0;
 const paid:Shares={};for(const event of purchaseEvents(state,item.id).filter(e=>e.status==='confirmed'&&['expense','adjustment'].includes(e.kind)))for(const [id,n]of Object.entries(event.shares))paid[id]=(paid[id]??0)+n;
 return Object.entries(item.shares).reduce((sum,[id,n])=>sum+Math.max(0,n-(paid[id]??0)),0);
}
export function dependentClosure(state:State,itemIds:string[]){
 const selected=new Set(itemIds);let more=true;
 while(more){more=false;for(const item of state.items)if(item.status!=='cancelled'&&item.depends.some(d=>selected.has(d))&&!selected.has(item.id)){selected.add(item.id);more=true;}}
 return state.items.filter(i=>selected.has(i.id));
}
export function cancellationOrder(items:Item[]){const remaining=new Set(items.map(i=>i.id)),result:string[]=[];while(remaining.size){const ready=items.filter(i=>remaining.has(i.id)&&!items.some(other=>remaining.has(other.id)&&other.depends.includes(i.id))).map(i=>i.id).sort();if(!ready.length)throw fail('Resolve the dependency cycle before preparing recovery.');for(const id of ready){remaining.delete(id);result.push(id);}}return result;}
export function compilePlanChange(state:State,input:Extract<z.infer<typeof changeRequest>,{type:'departure'|'recovery'}>,policies:Record<string,{refundableBps:number;cancellationFeeUnits:number;cutoff:string|null}>={},now=Date.now()):Terms{
 assertDependenciesReviewed(state.items,state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
 const members=(state.people??[]).filter(p=>p.role!=='legacy'),allowed=members.map(p=>p.id);
 const originals=input.type==='departure'?state.items.filter(i=>i.status!=='cancelled'&&i.participants.includes(input.memberId)&&(!input.itemIds||input.itemIds.includes(i.id))):
  input.option==='keep'?state.items.filter(i=>input.itemIds.includes(i.id)):dependentClosure(state,input.itemIds).filter(i=>i.status!=='cancelled');
 if(!originals.length||originals.length>30||input.type==='recovery'&&input.itemIds.some(id=>!state.items.some(i=>i.id===id)))throw fail('Select current plan items.');
 if(input.type==='departure'&&!allowed.includes(input.memberId))throw fail('Select a current departing member.');
 if(input.type==='departure'&&input.itemIds?.some(id=>!originals.some(i=>i.id===id)))throw fail('Each selected item must include the departing member.');
 const warnings:string[]=[],updates=structuredClone(originals),perMember:Shares={};
 for(const item of updates){
  if(input.type==='departure'){
   const remaining=item.participants.filter(id=>id!==input.memberId);
   if(!remaining.length)throw fail('A booking with no remaining participants needs a cancellation recovery.');
   const finalized=hasFinalizedReceiptPurchase(state,item.id),recorded=recordedCost(state,item.id),priorShares=finalized?recorded.shares:{...item.shares};
   if(finalized){if(recorded.amount<0)throw fail('Resolve refunded costs before changing this receipt allocation.');item.price=recorded.amount;warnings.push(`${item.name}: use the finalized receipt cost; no further merchant balance is collected.`);}
   if(item.price===null)throw fail('Confirm the item price before reallocating obligations.');
   const collected=recorded.amount;
   if(!finalized&&collected>0&&collected<item.price)warnings.push(`${item.name}: retain the collected deposit and approve only the remaining balance under the new allocation. Resolve existing invoices first.`);
   item.participants=remaining;item.shares=allocate(item.price,remaining,'equal',{},allowed);item.required=[...remaining];item.allocation='equal';item.values={};
   for(const member of new Set([...Object.keys(priorShares),...remaining]))perMember[member]=(perMember[member]??0)+(item.shares[member]??0)-(priorShares[member]??0);
  }else if(input.option!=='keep')item.status='cancelled';
 }
 const additions=input.type==='recovery'&&input.option==='replace'?input.replacements:[];
 if(input.type==='recovery'&&input.option==='replace'&&!additions.length)throw fail('Supply reviewed replacement drafts.');
 if(input.type==='recovery'&&input.option!=='replace'&&input.replacements.length)throw fail('Replacement items require the replace option.');
 for(const item of additions){const {depends,dependencySource,dependencyConfirm,...draft}=item;parseWorkspaceMutation({version:state.version,action:{type:'add_item',...draft}});
  if(new Set(item.participants).size!==item.participants.length||item.participants.some(id=>!allowed.includes(id)))throw fail('Use current replacement participants.');
  if(item.start.slice(0,10)<state.plan.start||item.start.slice(0,10)>state.plan.end)throw fail('Replacement dates must fit this plan.');
  if(depends?.length&&(!dependencySource||!dependencyConfirm))throw fail('Confirm the prerequisite relationships and their source before review.');
  if(depends&&(new Set(depends).size!==depends.length||depends.some(id=>!state.items.some(i=>i.id===id&&i.status!=='cancelled')||originals.some(i=>i.id===id))))throw fail('Replacement prerequisites must be distinct retained current items.');
 }
 if(input.type==='recovery'&&input.option!=='keep')cancellationOrder(originals);
 const required=[...new Set([...originals.flatMap(i=>{const recorded=recordedCost(state,i.id);return [...i.participants,...(i.funding?.participants??[]),...Object.entries(recorded.shares).filter(([,n])=>n!==0).map(([id])=>id),...Object.entries(recorded.contributions).filter(([,n])=>n!==0).map(([id])=>id)];}),...additions.flatMap(i=>i.participants)])].sort();
 if(required.some(id=>!members.some(p=>p.id===id&&['owner','editor'].includes(p.role))))throw fail('All affected people need active editing membership to approve.');
 const impacts=Object.fromEntries(required.map(id=>[id,{expectedRefund:0 as number|null,newPaymentNow:0 as number|null,finalChange:0 as number|null}]));
 let expectedRefund:number|null=0,cancelledFuture=0,cancelledRecorded=0;
 if(input.type==='recovery'&&input.option!=='keep')for(const item of originals){
  const recorded=recordedCost(state,item.id),events=recorded.events,paid=recorded.amount,p=policies[item.id],priorShares=hasFinalizedReceiptPurchase(state,item.id)?recorded.shares:item.shares;cancelledFuture+=paid+projectedRemaining(state,item);cancelledRecorded+=paid;
  for(const member of required)perMember[member]=(perMember[member]??0)-(priorShares[member]??0)+events.reduce((n,e)=>n+(e.shares[member]??0),0);
  if(paid>0){if(!p||p.cutoff&&Date.parse(p.cutoff)<=now){expectedRefund=null;for(const member of new Set([...item.participants,...(item.funding?.participants??[])]))impacts[member].expectedRefund=null;warnings.push(`${item.name}: current confirmed cancellation terms are required.`);}else{
   const funding=item.funding??item,fees=allocate(p.cancellationFeeUnits,funding.participants,'weight',funding.shares,allowed);
   for(const member of funding.participants){const captured=events.filter(e=>e.kind==='expense').reduce((n,e)=>n+(e.contributions[member]??0),0),refunded=-events.filter(e=>e.kind==='refund').reduce((n,e)=>n+(e.contributions[member]??0),0),amount=Math.max(0,Math.floor(captured*p.refundableBps/10000)-(fees[member]??0)-refunded);if(expectedRefund!==null)expectedRefund+=amount;
    if(impacts[member].expectedRefund!==null)impacts[member].expectedRefund!+=amount;
    const costShares=item.funding?allocate(amount,item.participants,'weight',item.shares,allowed):{[member]:amount};for(const [id,n]of Object.entries(costShares))perMember[id]=(perMember[id]??0)-n;
   }
  }}
 }
 const known=state.items.filter(i=>i.status!=='cancelled').every(i=>effectivePrice(state,i)!==null),total=state.events.filter(e=>e.status==='confirmed'&&e.kind!=='settlement').reduce((n,e)=>n+e.amount,0)+state.items.reduce((sum,item)=>sum+projectedRemaining(state,item),0);
 const newPaymentNow=additions.some(i=>i.price===null)?null:additions.reduce((sum,i)=>sum+(i.price??0),0);
 for(const item of additions){if(item.price===null){for(const id of item.participants)impacts[id].newPaymentNow=null;}else{const shares=allocate(item.price,item.participants,'equal',{},allowed);for(const [id,n]of Object.entries(shares)){perMember[id]=(perMember[id]??0)+n;if(impacts[id].newPaymentNow!==null)impacts[id].newPaymentNow!+=n;}}}
 for(const id of required)impacts[id].finalChange=impacts[id].expectedRefund===null||impacts[id].newPaymentNow===null?null:perMember[id]??0;
 if(additions.some(i=>i.price===null))warnings.push('Unknown replacement prices prevent a confirmed total or cash requirement.');
 if(input.type==='recovery'&&input.option!=='keep')warnings.push('Paid bookings require their separate policy-backed cancellation/refund approvals. Pending refunds cannot fund replacements.');
 const retained=state.events.filter(e=>e.status==='confirmed'&&e.kind!=='settlement').reduce((sum,e)=>sum+e.amount,0);
 return {kind:input.type,...(input.type==='departure'?{memberId:input.memberId}:{option:input.option}),currency:planCurrency(state.plan),originals,updates,additions,required,
  events:moneyFacts(state,originals.map(i=>i.id)),warnings,figures:{retained,expectedRefund,newPaymentNow,finalTotal:known&&expectedRefund!==null&&newPaymentNow!==null?total-cancelledFuture+cancelledRecorded-expectedRefund+newPaymentNow:null,perMember,memberImpacts:impacts}};
}

export class PlanChangeService{
 constructor(private database:D1Database,private repository=new PlanRepository(database)){}
 private async access(planId:string,identity:Identity,edit=false){const record=await this.repository.getPlan(planId,identity);if(edit&&!['owner','editor'].includes(record.role))throw forbidden();return record;}
 async list(planId:string,identity:Identity){const record=await this.access(planId,identity);const rows=await this.database.prepare('SELECT * FROM plan_changes WHERE owner=? AND plan_id=? ORDER BY created DESC,id DESC LIMIT 100').bind(record.owner,planId).all<Row>();return Promise.all(rows.results.map(row=>this.view(row,identity)));}
 private async view(row:Row,identity:Identity){const approvals=await this.database.prepare('SELECT member_id FROM plan_change_approvals WHERE change_id=? ORDER BY member_id').bind(row.id).all<{member_id:string}>();const terms=JSON.parse(row.body) as Terms;
  const current=await this.database.prepare('SELECT body FROM plans WHERE owner=? AND id=?').bind(row.owner,row.plan_id).first<{body:string}>(),state=current?JSON.parse(current.body) as State:null;
  const progress=terms.kind==='recovery'&&terms.option!=='keep'&&state?cancellationOrder(terms.originals).map(id=>{const item=state.items.find(i=>i.id===id);return {itemId:id,name:item?.name??id,status:item?.status==='cancelled'?'completed':purchaseEvents(state,id).some(e=>e.kind==='expense'&&e.status==='confirmed')?'cancellation-required':'ready-to-apply',blockedBy:state.items.filter(i=>i.status!=='cancelled'&&i.depends.includes(id)).map(i=>i.id)};}):[];
 const record=await this.access(row.plan_id,identity),impact=terms.figures.memberImpacts[identity.id],applied=row.status==='applied',replacementIds=terms.additions.map((_,index)=>replacementId(row.id,index)),replacements=replacementIds.map(id=>record.state.items.find(i=>i.id===id)).filter((item):item is Item=>!!item&&item.status!=='cancelled');
 const remaining=replacements.some(i=>i.price===null)?null:replacements.reduce((total,item)=>{const recorded=purchaseEvents(record.state,item.id).filter(e=>e.status==='confirmed'&&e.kind!=='settlement').reduce((n,e)=>n+(e.shares[identity.id]??0),0);return total+Math.max(0,(item.shares[identity.id]??0)-recorded);},0);
 const review=await reviewPlanning(this.database,record,identity.id,applied?replacements:terms.additions,{removeIds:[...terms.originals.map(i=>i.id),...replacementIds],finalChange:applied?0:impact?.finalChange,newPaymentNow:applied?remaining:impact?.newPaymentNow,financialEffectsAlreadyIncluded:applied});
 return {id:row.id,planId:row.plan_id,terms,status:row.status,created:row.created,approved:approvals.results.map(a=>a.member_id),fullyApproved:terms.required.every(id=>approvals.results.some(a=>a.member_id===id)),appliedAt:row.applied_at,progress,review,workflow:await syncChangeWorkflow(this.database,row.id)};}
 async propose(planId:string,identity:Identity,input:Extract<z.infer<typeof changeRequest>,{type:'departure'|'recovery'}>,stableId?:string){
  if(stableId){const prior=await this.database.prepare('SELECT id FROM plan_changes WHERE id=?').bind(stableId).first();if(prior)return this.get(planId,identity,stableId);}
  const record=await this.access(planId,identity,true);if(record.version!==input.version)throw conflict();
  const policies=await this.database.prepare('SELECT body FROM booking_policies WHERE owner=? AND plan_id=? ORDER BY created').bind(record.owner,planId).all<{body:string}>();
  const byItem:Record<string,any>={};for(const p of policies.results){const policy=JSON.parse(p.body),item=record.state.items.find(i=>i.id===policy.itemId);if(item&&item.revision===policy.itemRevision&&item.source===policy.source&&item.price===policy.itemPrice&&JSON.stringify(item.shares)===JSON.stringify(policy.shares)&&JSON.stringify(item.participants)===JSON.stringify(policy.participants))byItem[item.id]=policy;}
  const terms=compilePlanChange(record.state,input,byItem),changeId=stableId??crypto.randomUUID(),now=new Date().toISOString();
  const result=await this.database.prepare(`INSERT INTO plan_changes(id,owner,plan_id,body,status,created,created_by) SELECT ?,?,?,?,'review',?,? WHERE EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))`)
   .bind(changeId,record.owner,planId,JSON.stringify(terms),now,identity.id,record.owner,planId,input.version,identity.id).run();if(!result.meta.changes)throw conflict();
  const saved=await this.get(planId,identity,changeId),impact=terms.figures.memberImpacts[identity.id];return {...saved,review:await reviewPlanning(this.database,record,identity.id,terms.additions,{removeIds:terms.originals.map(i=>i.id),finalChange:impact?.finalChange,newPaymentNow:impact?.newPaymentNow})};
 }
 async get(planId:string,identity:Identity,changeId:string){const record=await this.access(planId,identity);const row=await this.database.prepare('SELECT * FROM plan_changes WHERE id=? AND owner=? AND plan_id=?').bind(changeId,record.owner,planId).first<Row>();if(!row)throw new BackendError('CHANGE_UNAVAILABLE','This change is unavailable.',404);return this.view(row,identity);}
 async act(planId:string,identity:Identity,input:Extract<z.infer<typeof changeRequest>,{type:'approve'|'apply'|'cancel'}>){
  const record=await this.access(planId,identity,true),change=await this.get(planId,identity,input.changeId),terms=change.terms;
  if(change.status==='applied'&&input.type==='apply')return change;
  if(record.version!==input.version||change.status!=='review')throw conflict();
  if(input.type==='cancel'){if(record.role!=='owner')throw forbidden();await this.database.prepare("UPDATE plan_changes SET status='cancelled' WHERE id=? AND status='review'").bind(change.id).run();return this.get(planId,identity,change.id);}
  assertDependenciesReviewed(record.state.items,record.state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
  const current=terms.originals.map(original=>record.state.items.find(i=>i.id===original.id));
  if(current.some((item,index)=>!item||signature(item)!==signature(terms.originals[index]))||terms.required.some(id=>!record.state.people?.some(p=>p.id===id&&['owner','editor'].includes(p.role))))throw conflict();
  if(terms.kind==='departure'&&(moneyFacts(record.state,terms.originals.map(i=>i.id))!==terms.events||current.some((item,index)=>item!.status!==terms.originals[index].status)))throw conflict();
  if(input.type==='approve'){
   if(!terms.required.includes(identity.id))throw forbidden();
   const guard=crypto.randomUUID();await this.database.batch([
    this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND m.member_id=? AND m.role IN ('owner','editor') AND p.status<>'deleted') THEN 1 ELSE 0 END)`).bind(guard,record.owner,planId,record.version,identity.id),
    this.database.prepare('INSERT OR IGNORE INTO plan_change_approvals(change_id,member_id,approved_at) VALUES (?,?,?)').bind(change.id,identity.id,new Date().toISOString()),this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)]);
   return this.get(planId,identity,change.id);
  }
  if(record.role!=='owner'||!change.fullyApproved)throw new BackendError('CHANGE_APPROVALS','The owner may apply this only after every affected person approves.',409);
  const paymentScope={owner:record.owner,planId,itemIds:terms.originals.map(i=>i.id)};
  await assertPaymentChangeReady(this.database,paymentScope);
  const root=await this.repository.loadWorkspace(record.owner);if(!root)throw conflict();const state=sharedTripView(root,planId),now=new Date().toISOString();
  const steps=[];
  const ordered=terms.kind==='recovery'&&terms.option!=='keep'?cancellationOrder(terms.originals):terms.originals.map(i=>i.id);
  for(const originalId of ordered){const item=state.items.find(i=>i.id===originalId)!;
   const paid=purchaseEvents(state,item.id).some(e=>e.kind==='expense'&&e.status==='confirmed');
   if(terms.kind==='recovery'&&terms.option!=='keep'&&paid&&item.status!=='cancelled')steps.push({itemId:item.id,name:item.name,status:'cancellation-required',blockedBy:state.items.filter(i=>i.status!=='cancelled'&&i.depends.includes(item.id)).map(i=>i.id),reviewUrl:`/flows?plan=${encodeURIComponent(planId)}`});
  }
  if(steps.length)return {...change,steps,status:'awaiting-cancellations',workflow:await syncChangeWorkflow(this.database,change.id)};
  for(const update of terms.updates){const item=state.items.find(i=>i.id===update.id)!;
   if(terms.kind==='departure'){
    if(!item.funding&&item.price!==null&&state.events.some(e=>e.itemId===item.id&&e.mode==='sandbox'&&e.kind==='expense'&&e.providerId))item.funding={revision:item.revision,participants:[...item.participants],shares:{...item.shares},price:item.price,source:item.source};
    const recorded:Shares={};for(const event of purchaseEvents(state,item.id).filter(e=>e.status==='confirmed'&&e.kind!=='settlement'))for(const [id,amount]of Object.entries(event.shares))recorded[id]=(recorded[id]??0)+amount;
    const total=Object.values(recorded).reduce((a,b)=>a+b,0);if(total<0)throw fail('Refunded costs need a separate reviewed allocation.');
    const revised=allocate(total,update.participants,'equal',{},state.people!.map(p=>p.id)),delta=Object.fromEntries([...new Set([...Object.keys(recorded),...update.participants])].map(id=>[id,(revised[id]??0)-(recorded[id]??0)]));
    if(Object.values(delta).some(n=>n!==0))state.events.push({id:`change-${change.id}-${item.id}`,itemId:item.id,kind:'adjustment',label:`Approved participation change: ${item.name}`,shares:delta,contributions:{},amount:0,status:'confirmed',evidence:`Exact change ${change.id} approved by all affected members; original contributions retained.`,mode:'manual',created:now});
    const finalized=hasFinalizedReceiptPurchase(state,item.id);
    Object.assign(item,{price:update.price,participants:update.participants,shares:update.shares,required:update.required,allocation:'equal',values:{},revision:item.revision+1,approvals:[...update.participants],paid:finalized?[...update.participants]:item.paid.filter(id=>update.participants.includes(id))});
     if(finalized){delete item.collection;item.status='scheduled';}
     else if(total>0&&total<(item.price??0)){
      item.collection={due:Object.fromEntries(update.participants.map(id=>[id,Math.max(0,(update.shares[id]??0)-(revised[id]??0))])),credits:revised,originalRevision:item.funding?.revision??item.revision-1};
      item.paid=update.participants.filter(id=>item.collection!.due[id]===0);item.status='awaiting-payment';
     }else item.status=total>=(item.price??0)?'scheduled':hasMerchantCheckout(item)?'awaiting-payment':'draft';
   }else if(terms.option!=='keep')item.status='cancelled';
  }
  const cancelled=new Set(terms.kind==='recovery'&&terms.option!=='keep'?terms.originals.map(i=>i.id):[]);
  for(const item of state.items)if(item.status!=='cancelled'&&item.depends.some(id=>cancelled.has(id)))throw fail('A dependent booking was added after this recovery was reviewed.');
  for(const [index,add] of terms.additions.entries()){const {dependencySource,dependencyConfirm,depends,...draft}=add,shares=add.price===null?{}:allocate(add.price,add.participants,'equal',{},state.people!.map(p=>p.id));state.items.push({...draft,id:replacementId(change.id,index),shares,allocation:'equal',values:{},revision:1,approvals:[],status:'draft',booking:'unconfirmed',policy:'Reviewed recovery replacement draft. Confirm supplier quote and terms before checkout.',source:'Recovery proposal draft',expires:null,deadline:null,depends:depends??[],...(depends?.length?{dependencyEvidence:{source:dependencySource!,confirmedBy:identity.id,confirmedAt:now}}:{}),paid:[]});}
  state.reminders=state.reminders.filter(r=>!cancelled.has(r.itemId));state.audit.unshift({id:`change-${change.id}`,at:now,actorId:identity.id,text:`Applied approved ${terms.kind} change.`,detail:change.id});
  const token=crypto.randomUUID(),paymentToken=crypto.randomUUID(),effects=[paymentChangeGuard(this.database,paymentScope,paymentToken),this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plan_changes WHERE id=? AND status='review') AND NOT EXISTS(SELECT 1 FROM json_each(?) member WHERE NOT EXISTS(SELECT 1 FROM plan_change_approvals WHERE change_id=? AND member_id=member.value)) THEN 1 ELSE 0 END)`).bind(token,change.id,JSON.stringify(terms.required),change.id),
   this.database.prepare("UPDATE plan_changes SET status='applied',applied_at=? WHERE id=? AND status='review'").bind(now,change.id),this.database.prepare('DELETE FROM backend_write_guards WHERE id IN (?,?)').bind(token,paymentToken)];
  await this.repository.saveWorkspace(record.owner,mergeSharedTrip(root,state,planId),root.version,{planId,version:record.version,memberId:identity.id},undefined,effects);
  return this.get(planId,identity,change.id);
 }
}
