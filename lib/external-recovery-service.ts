import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {PlanRepository,type PlanRecord} from './plan-repository.ts';
import {allocate,type Shares,type State} from './model.ts';
import {financialEventFacts} from './financial-history.ts';
import {recoveryItemFingerprint} from './recovery-service.ts';
import {planCurrency} from './money.ts';
import {sharedTripView,mergeSharedTrip} from './trip-sharing.ts';
import {assertPaymentChangeReady,paymentChangeGuard} from './payment-change-fence.ts';
import type {Identity} from './people.ts';
import {assertDependenciesReviewed} from './dependencies.ts';
import {purchaseEvents} from './receipt-accounting.ts';

const identifier=z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(value=>!['__proto__','constructor','prototype'].includes(value)),units=z.number().int().min(0).max(1e12),version=z.number().int().nonnegative();
const sourceUrl=z.string().url().max(2000).refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;});
export const externalRecoveryRequest=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),version,requestId:z.string().uuid(),itemId:identifier,refundAmount:units,
  refundContributions:z.record(identifier,units).optional(),evidence:z.string().trim().min(10).max(5000),sourceUrl,
  reference:z.string().trim().min(1).max(300)}).strict(),
 z.object({action:z.enum(['approve','apply','cancel']),version,id:z.string().uuid(),confirm:z.literal(true)}).strict(),
]);
type Prepare=Extract<z.infer<typeof externalRecoveryRequest>,{action:'prepare'}>;
type Terms={itemId:string;itemName:string;currency:string;fingerprint:string;events:string;refundAmount:number;
 refundShares:Shares;refundContributions:Shares;recordedCost:number;retainedCost:number;evidence:string;sourceUrl:string;reference:string;required:string[]};
type Row={id:string;owner:string;plan_id:string;item_id:string;body:string;status:'review'|'completed'|'cancelled';created:string;created_by:string;applied_at:string|null};
const invalid=(message:string)=>new BackendError('EXTERNAL_RECOVERY_INVALID',message,409);
const facts=(state:State,itemId:string)=>JSON.stringify(purchaseEvents(state,itemId).filter(e=>e.kind!=='settlement').map(e=>({facts:financialEventFacts(e),status:e.status})).sort((a,b)=>a.facts.localeCompare(b.facts)));
function compile(record:PlanRecord,input:Prepare):Terms{
 const state=record.state,item=state.items.find(i=>i.id===input.itemId);
 assertDependenciesReviewed(state.items,state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
 if(!item||item.status==='cancelled')throw invalid('Choose a current paid outside booking.');
 const events=purchaseEvents(state,item.id).filter(e=>e.kind!=='settlement');
 if(!events.some(e=>e.kind==='expense'&&e.status==='confirmed')||events.some(e=>e.mode!=='manual'||e.providerId||e.status!=='confirmed'))
  throw invalid('Only confirmed manual purchase evidence can use this closure. Reconcile provider payments through their saved refund flow.');
 const cost:Shares={},cash:Shares={};let total=0;
 for(const event of events){total+=event.amount;for(const [id,n]of Object.entries(event.shares))cost[id]=(cost[id]??0)+n;for(const [id,n]of Object.entries(event.contributions))cash[id]=(cash[id]??0)+n;}
 if(!Number.isSafeInteger(total)||total<0||Object.values(cost).some(n=>!Number.isSafeInteger(n)||n<0)||Object.values(cash).some(n=>!Number.isSafeInteger(n)||n<0)||
  Object.values(cost).reduce((a,b)=>a+b,0)!==total||Object.values(cash).reduce((a,b)=>a+b,0)!==total||input.refundAmount>total)
  throw invalid('Resolve the recorded cost and original cash contributions before closing this booking.');
 const payers=Object.keys(cash).filter(id=>cash[id]>0),beneficiaries=Object.keys(cost).filter(id=>cost[id]>0);
 if(input.refundAmount>0&&payers.length>1&&!input.refundContributions)throw invalid('Specify the exact received refund to each original payer for this split payment.');
 const refundContributions=input.refundContributions??(input.refundAmount?{[payers[0]]:input.refundAmount}:{});
 if(Object.values(refundContributions).reduce((a,b)=>a+b,0)!==input.refundAmount||Object.entries(refundContributions).some(([id,n])=>!Number.isSafeInteger(n)||n<0||n>(cash[id]??0)))
  throw invalid('The received refund must add up exactly and return only to its original cash contributors.');
 const required=[...new Set([...item.participants,...(item.funding?.participants??[]),...Object.entries(cost).filter(([,n])=>n!==0).map(([id])=>id),...Object.entries(cash).filter(([,n])=>n!==0).map(([id])=>id)])].sort();
 if(required.some(id=>!state.people?.some(p=>p.id===id&&['owner','editor'].includes(p.role))))throw invalid('All affected people, including original payers, need active editing membership to review this evidence.');
 return {itemId:item.id,itemName:item.name,currency:planCurrency(state.plan),fingerprint:recoveryItemFingerprint(item),events:facts(state,item.id),refundAmount:input.refundAmount,
  refundShares:input.refundAmount?allocate(input.refundAmount,beneficiaries,'weight',cost,required):{},refundContributions,recordedCost:total,retainedCost:total-input.refundAmount,
  evidence:input.evidence,sourceUrl:input.sourceUrl,reference:input.reference,required};
}
/** Human-reviewed evidence of an outside cancellation/received refund. This never
 * submits a supplier/payment request or describes manual evidence as verified. */
export class ExternalRecoveryService{
 constructor(private database:D1Database,private repository=new PlanRepository(database)){}
 private async row(record:PlanRecord,id:string){const row=await this.database.prepare('SELECT * FROM external_recovery_resolutions WHERE id=? AND owner=? AND plan_id=?').bind(id,record.owner,record.state.plan.id!).first<Row>();if(!row)throw new BackendError('EXTERNAL_RECOVERY_UNAVAILABLE','This external recovery is unavailable.',404);return row;}
 private async view(row:Row){const approvals=await this.database.prepare('SELECT member_id FROM external_recovery_approvals WHERE resolution_id=? ORDER BY member_id').bind(row.id).all<{member_id:string}>(),terms=JSON.parse(row.body) as Terms,approved=approvals.results.map(a=>a.member_id);return {id:row.id,planId:row.plan_id,itemId:row.item_id,status:row.status,terms,approved,fullyApproved:terms.required.every(id=>approved.includes(id)),created:row.created,appliedAt:row.applied_at};}
 async list(planId:string,identity:Identity){const record=await this.repository.getPlan(planId,identity),rows=await this.database.prepare('SELECT * FROM external_recovery_resolutions WHERE owner=? AND plan_id=? ORDER BY created DESC,id DESC LIMIT 100').bind(record.owner,planId).all<Row>();return Promise.all(rows.results.map(row=>this.view(row)));}
 async act(planId:string,identity:Identity,input:z.infer<typeof externalRecoveryRequest>){
  const record=await this.repository.getPlan(planId,identity);if(!['owner','editor'].includes(record.role))throw forbidden();
  if(input.action==='prepare'){
   if(record.role!=='owner')throw forbidden();
   const prior=await this.database.prepare('SELECT * FROM external_recovery_resolutions WHERE id=?').bind(input.requestId).first<Row>();
   if(prior){const terms=JSON.parse(prior.body) as Terms;if(prior.owner!==record.owner||prior.plan_id!==planId||terms.itemId!==input.itemId||terms.refundAmount!==input.refundAmount||terms.evidence!==input.evidence||terms.reference!==input.reference||terms.sourceUrl!==input.sourceUrl||input.refundContributions&&JSON.stringify(terms.refundContributions)!==JSON.stringify(input.refundContributions))throw conflict();return this.view(prior);}
   if(record.version!==input.version)throw conflict();
   const terms=compile(record,input),token=crypto.randomUUID(),paymentToken=crypto.randomUUID(),at=new Date().toISOString(),scope={owner:record.owner,planId,itemIds:[terms.itemId]};
   await assertPaymentChangeReady(this.database,scope);
   await this.database.batch([
    this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role='owner') THEN 1 ELSE 0 END)`).bind(token,record.owner,planId,record.version,identity.id),
    paymentChangeGuard(this.database,scope,paymentToken),
    this.database.prepare("INSERT INTO external_recovery_resolutions(id,owner,plan_id,item_id,body,status,created,created_by) VALUES (?,?,?,?,?,'review',?,?)").bind(input.requestId,record.owner,planId,terms.itemId,JSON.stringify(terms),at,identity.id),
    this.database.prepare('DELETE FROM backend_write_guards WHERE id IN (?,?)').bind(token,paymentToken),
   ]);return this.view(await this.row(record,input.requestId));
  }
  const row=await this.row(record,input.id),view=await this.view(row),terms=view.terms;
  if(row.status==='completed'&&input.action==='apply')return view;
  if(row.status!=='review'||record.version!==input.version)throw conflict();
  if(input.action==='cancel'){if(record.role!=='owner')throw forbidden();await this.database.prepare("UPDATE external_recovery_resolutions SET status='cancelled' WHERE id=? AND status='review'").bind(row.id).run();return this.view(await this.row(record,row.id));}
  assertDependenciesReviewed(record.state.items,record.state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
  const item=record.state.items.find(i=>i.id===terms.itemId);
  if(!item||item.status==='cancelled'||recoveryItemFingerprint(item)!==terms.fingerprint||facts(record.state,item.id)!==terms.events||terms.required.some(id=>!record.state.people?.some(p=>p.id===id&&['owner','editor'].includes(p.role))))throw conflict();
  if(input.action==='approve'){
   if(!terms.required.includes(identity.id))throw forbidden();const token=crypto.randomUUID();
   await this.database.batch([
    this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor')) AND EXISTS(SELECT 1 FROM external_recovery_resolutions WHERE id=? AND status='review') THEN 1 ELSE 0 END)`).bind(token,record.owner,planId,record.version,identity.id,row.id),
    this.database.prepare('INSERT OR IGNORE INTO external_recovery_approvals(resolution_id,member_id,approved_at) VALUES (?,?,?)').bind(row.id,identity.id,new Date().toISOString()),this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token),
   ]);return this.view(await this.row(record,row.id));
  }
  if(record.role!=='owner'||!view.fullyApproved)throw new BackendError('EXTERNAL_RECOVERY_APPROVALS','Every affected person must approve the exact cancellation evidence and received refund before the owner closes it.',409);
  const scope={owner:record.owner,planId,itemIds:[item.id]};await assertPaymentChangeReady(this.database,scope);
  const root=await this.repository.loadWorkspace(record.owner);if(!root)throw conflict();const state=sharedTripView(root,planId),target=state.items.find(i=>i.id===item.id)!;
  if(state.items.some(i=>i.status!=='cancelled'&&i.depends.includes(item.id)))throw new BackendError('RECOVERY_DEPENDENCIES','Resolve each dependent booking before closing this outside booking.',409);
  const at=new Date().toISOString();target.status='cancelled';target.booking='cancelled';state.reminders=state.reminders.filter(r=>r.itemId!==target.id);
  if(terms.refundAmount)state.events.push({id:`external-refund-${row.id}`,itemId:target.id,kind:'refund',amount:-terms.refundAmount,
   label:`Reviewed external refund: ${target.name}`,shares:Object.fromEntries(Object.entries(terms.refundShares).map(([id,n])=>[id,-n])),contributions:Object.fromEntries(Object.entries(terms.refundContributions).map(([id,n])=>[id,-n])),
   status:'confirmed',mode:'manual',created:at,evidence:`Manually documented received refund; all affected members approved resolution ${row.id}. Reference ${terms.reference}. ${terms.evidence} Source: ${terms.sourceUrl}`});
  state.audit.unshift({id:`external-recovery-${row.id}`,at,actorId:identity.id,text:`Closed reviewed outside booking ${target.name}.`,detail:`Manual evidence ${terms.reference}; retained cost ${terms.retainedCost} ${terms.currency} minor units. Original payments retained.`});
  const token=crypto.randomUUID(),paymentToken=crypto.randomUUID(),effects=[paymentChangeGuard(this.database,scope,paymentToken),
   this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM external_recovery_resolutions WHERE id=? AND status='review') AND NOT EXISTS(SELECT 1 FROM json_each(?) member WHERE NOT EXISTS(SELECT 1 FROM external_recovery_approvals WHERE resolution_id=? AND member_id=member.value)) THEN 1 ELSE 0 END)`).bind(token,row.id,JSON.stringify(terms.required),row.id),
   this.database.prepare("UPDATE external_recovery_resolutions SET status='completed',applied_at=? WHERE id=? AND status='review'").bind(at,row.id),this.database.prepare('DELETE FROM backend_write_guards WHERE id IN (?,?)').bind(token,paymentToken)];
  await this.repository.saveWorkspace(record.owner,mergeSharedTrip(root,state,planId),root.version,{planId,version:record.version,memberId:identity.id},undefined,effects);
  return this.view(await this.row(record,row.id));
 }
}
