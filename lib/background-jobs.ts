import {BackendError} from './backend-errors.ts';
import {reconcileOwnerPayments} from './paypal-reconciliation.ts';
import type {PayPalReconciliationDependencies} from './paypal-webhooks.ts';
import {reconcilePendingPlanInvoices,type InvoiceProvider} from './plan-invoices.ts';
import {finalizeConfirmedRecoveries} from './recovery-service.ts';
import {syncAllPlanReminders,runDueReminderJobs} from './reminder-jobs.ts';
import {providerCents} from './payment-guards.ts';
import {sha256} from './financial-history.ts';
type JobDependencies=PayPalReconciliationDependencies & {provider:InvoiceProvider;clock?:()=>number};
const onlyKeys=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
function approvalOnly(body:any){const unit=body?.purchase_units?.[0],context=body?.payment_source?.paypal?.experience_context;
 return onlyKeys(body,['intent','purchase_units','payment_source'])&&onlyKeys(unit,['reference_id','custom_id','description','amount'])&&
  onlyKeys(unit.amount,['currency_code','value'])&&onlyKeys(body.payment_source,['paypal'])&&onlyKeys(body.payment_source.paypal,['experience_context'])&&
  onlyKeys(context,['shipping_preference','user_action'])&&context.shipping_preference==='NO_SHIPPING'&&context.user_action==='PAY_NOW';}

/** Restores a missing order identity using its original bounded idempotency key.
 * Creating an approval order does not capture money. Capture/refund POSTs are
 * never replayed by this unattended worker. */
export async function recoverOrderIdentities(database:D1Database,owner:string,provider:InvoiceProvider,now=Date.now()){
 const rows=await database.prepare(`SELECT p.id,p.item_id,p.amount,p.payload,i.path,i.method,i.request_body,i.request_key,i.fingerprint,i.replay_before
  FROM provider_operations p JOIN provider_request_intents i ON i.operation_id=p.id AND i.owner=p.owner
  WHERE p.owner=? AND p.kind='order' AND p.provider_id IS NULL AND p.status IN ('creating','creation-uncertain') ORDER BY i.created LIMIT 1`)
  .bind(owner).all<{id:string;item_id:string;amount:number;payload:string;path:string;method:string;request_body:string;request_key:string;fingerprint:string;replay_before:string}>();
 const results:{operationId:string;status:string}[]=[];
 for(const operation of rows.results){
  let body:any;try{body=JSON.parse(operation.request_body);}catch{body=null;}
  const expiry=Date.parse(operation.replay_before),unit=body?.purchase_units?.[0];
  let validAmount=false;try{validAmount=providerCents(unit?.amount)===operation.amount;}catch{}
  if(!Number.isFinite(expiry)||expiry<=now||operation.path!=='/v2/checkout/orders'||operation.method!=='POST'||
   !body||!approvalOnly(body)||body.intent!=='CAPTURE'||body.purchase_units?.length!==1||unit.reference_id!==operation.item_id||unit.custom_id!==operation.id||!validAmount||
   !operation.request_key||await sha256(JSON.stringify({path:operation.path,body,requestKey:operation.request_key}))!==operation.fingerprint){
   await database.prepare("UPDATE provider_operations SET status='manual-review' WHERE id=? AND owner=? AND provider_id IS NULL").bind(operation.id,owner).run();
   results.push({operationId:operation.id,status:'manual-review'});continue;
  }
  try{
   const order=await provider(operation.path,'POST',body,operation.request_key);
   if(typeof order.id!=='string'||!/^[A-Z0-9]{1,36}$/.test(order.id))throw Error('Invalid saved order identity.');
   // Keep returned identity even if canonical evidence needs manual review.
   await database.prepare("UPDATE provider_operations SET provider_id=?,status='created' WHERE id=? AND owner=? AND provider_id IS NULL").bind(order.id,operation.id,owner).run();
   const canonical=await provider(`/v2/checkout/orders/${encodeURIComponent(order.id)}`),unit=canonical.purchase_units?.[0];
   let matches=false;try{matches=canonical.id===order.id&&canonical.purchase_units?.length===1&&unit.reference_id===operation.item_id&&unit.custom_id===operation.id&&providerCents(unit.amount)===operation.amount;}catch{}
   if(!matches){
    await database.prepare("UPDATE provider_operations SET status='manual-review' WHERE id=? AND owner=? AND provider_id=? AND status='created'").bind(operation.id,owner,order.id).run();
    results.push({operationId:operation.id,status:'manual-review'});continue;
   }
   await database.prepare('UPDATE provider_operations SET payload=? WHERE id=? AND owner=? AND provider_id=?')
    .bind(JSON.stringify({...canonical,...JSON.parse(operation.payload),planrecoverRecoveredOrderId:order.id}),operation.id,owner,order.id).run();
   results.push({operationId:operation.id,status:'created'});
  }catch{results.push({operationId:operation.id,status:'retry-or-review'});}
 }
 return results;
}

export async function runOwnerBackgroundJobs(owner:string,dependencies:JobDependencies){
 const database=dependencies.database,now=dependencies.clock?.()??Date.now(),token=crypto.randomUUID();
 await database.prepare('INSERT OR IGNORE INTO background_job_runs(owner) VALUES (?)').bind(owner).run();
 const claim=await database.prepare(`UPDATE background_job_runs SET lease_token=?,lease_until=?,last_started=?,status='running'
  WHERE owner=? AND lease_until<=? AND next_at<=? RETURNING lease_token,reminder_cursor`).bind(token,now+300000,new Date(now).toISOString(),owner,now,now).first<{lease_token:string;reminder_cursor:string|null}>();
 if(claim?.lease_token!==token)return {status:'already-running-or-recent',providerMutations:'none'};
 const renew=async()=>{const at=dependencies.clock?.()??Date.now();
  const row=await database.prepare('UPDATE background_job_runs SET lease_until=? WHERE owner=? AND lease_token=? AND lease_until>? RETURNING lease_token')
   .bind(at+300000,owner,token,at).first<{lease_token:string}>();
  if(row?.lease_token!==token)throw new BackendError('JOBS_LEASE_CHANGED','Another check took over this background run.',409);};
 try{
  const orders=await recoverOrderIdentities(database,owner,dependencies.provider,now);
  await renew();
  const payments=await reconcileOwnerPayments(owner,{retryWebhooks:true},{...dependencies,unfinishedOnly:true,now:()=>new Date(dependencies.clock?.()??Date.now())});
  await renew();
  const invoices=await reconcilePendingPlanInvoices(database,dependencies.provider,{owner,limit:2});
  await renew();
  const recoveries=await finalizeConfirmedRecoveries(database,{owner,limit:5});
  await renew();
  const reminders=await syncAllPlanReminders(database,{owner,limit:10,now,after:claim.reminder_cursor?{owner,id:claim.reminder_cursor}:undefined});
  await renew();
  const delivery=await runDueReminderJobs(database,{owner,limit:100,now});
  await renew();
  const result={status:'completed',orders,payments,invoices,recoveries,reminders,delivery,
   providerMutations:'Only original approval-order identity recovery; no captures, refunds, invoice sends or external messages.'};
  await database.prepare("UPDATE background_job_runs SET status='completed',lease_token=NULL,lease_until=0,next_at=?,reminder_cursor=?,last_completed=?,last_result=? WHERE owner=? AND lease_token=?")
   .bind((dependencies.clock?.()??Date.now())+60000,reminders.nextCursor?.id??null,new Date(dependencies.clock?.()??Date.now()).toISOString(),JSON.stringify(result),owner,token).run();
  return result;
 }catch{
  await database.prepare("UPDATE background_job_runs SET status='retry',lease_token=NULL,lease_until=0,next_at=?,last_result=? WHERE owner=? AND lease_token=?")
   .bind((dependencies.clock?.()??Date.now())+60000,JSON.stringify({error:'Background processing needs another attempt.'}),owner,token).run();
  throw new BackendError('JOBS_RETRY','Background processing needs another attempt. Saved financial evidence is retained.',503);
 }
}
