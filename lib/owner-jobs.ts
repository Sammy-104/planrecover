import {paypal,reconcileCapture} from './paypal';
import {db,loadState,saveState} from './store';
import {runOwnerBackgroundJobs} from './background-jobs';
import {env} from 'cloudflare:workers';
import {cleanupReceiptObjects} from './receipt-retention';
import {runExternalReminderJobs} from './notification-adapter';
export async function runSavedOwnerJobs(owner:string){const result=await runOwnerBackgroundJobs(owner,{database:db(),provider:paypal,
 fetchOrder:id=>paypal(`/v2/checkout/orders/${encodeURIComponent(id)}`),fetchRefund:id=>paypal(`/v2/payments/refunds/${encodeURIComponent(id)}`),
 reconcileCapture,loadState,saveState});
 if(result.status!=='completed')return result;
 const stamp=await db().prepare("SELECT last_started,last_completed,last_result FROM background_job_runs WHERE owner=? AND status='completed'").bind(owner).first<{last_started:string;last_completed:string;last_result:string}>();
 let external,receiptCleanup;try{external=await runExternalReminderJobs(db(),env as unknown as Record<string,unknown>,owner);}catch{external={status:'configuration-review-required'};}
 try{if(env.BUCKET)receiptCleanup=await cleanupReceiptObjects(db(),env.BUCKET,owner);}catch{receiptCleanup={status:'retry-required'};}
 const complete={...result,external,receiptCleanup,providerMutations:'Original-order identity recovery and configured opted-in reminders only; no captures, refunds or invoice sends.'};
 if(stamp)await db().prepare("UPDATE background_job_runs SET last_result=? WHERE owner=? AND status='completed' AND lease_token IS NULL AND last_started=? AND last_completed=? AND last_result=?").bind(JSON.stringify(complete),owner,stamp.last_started,stamp.last_completed,stamp.last_result).run();
 return complete;}
