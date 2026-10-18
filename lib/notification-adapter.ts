import {providerConfig,providerPost,type Env} from './http-adapters.ts';
import {deliveryFence} from './reminder-jobs.ts';
import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
import {sesEmailConfig,sendSesEmail,sesDigest,SesEmailError,type SesEmailConfig} from './ses-email.ts';
export const destinationRequest=z.object({channel:z.enum(['email','push']),destination:z.string().trim().min(1).max(2000),version:z.number().int().nonnegative(),confirm:z.literal(true)}).strict();
export async function saveNotificationDestination(database:D1Database,planId:string,identity:Identity,input:z.infer<typeof destinationRequest>,verifiedEmail?:string|null){
 const record=await new PlanRepository(database).getPlan(planId,identity);if(!['owner','editor'].includes(record.role))throw forbidden();
 if(input.channel==='email'&&(!verifiedEmail||input.destination.toLowerCase()!==verifiedEmail.toLowerCase()||!z.string().email().safeParse(input.destination).success))throw new BackendError('NOTIFICATION_RECIPIENT','Email delivery must use your signed-in account email.');
 const now=new Date().toISOString(),result=await database.prepare(`INSERT INTO notification_destinations(owner,plan_id,member_id,channel,destination,version,confirmed_at)
 SELECT ?,?,?,?,?,1,? WHERE ?=0 AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))
 ON CONFLICT(owner,plan_id,member_id,channel) DO UPDATE SET destination=excluded.destination,version=notification_destinations.version+1,confirmed_at=excluded.confirmed_at WHERE notification_destinations.version=?`)
 .bind(record.owner,planId,identity.id,input.channel,input.destination,now,input.version,record.owner,planId,identity.id,input.version).run();
 if(!result.meta.changes&&input.version>0){const updated=await database.prepare(`UPDATE notification_destinations SET destination=?,version=version+1,confirmed_at=? WHERE owner=? AND plan_id=? AND member_id=? AND channel=? AND version=? AND EXISTS(SELECT 1 FROM plan_members m JOIN plans p ON p.owner=m.owner AND p.id=m.plan_id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))`).bind(input.destination,now,record.owner,planId,identity.id,input.channel,input.version,record.owner,planId,identity.id).run();if(updated.meta.changes)return {channel:input.channel,version:input.version+1};}
 if(!result.meta.changes)throw conflict();return {channel:input.channel,version:input.version+1};
}
const reminderOptIn=`EXISTS(SELECT 1 FROM member_planning_preferences x WHERE x.owner=reminder_jobs.owner AND x.plan_id=reminder_jobs.plan_id AND x.member_id=reminder_jobs.member_id AND json_extract(x.body,'$.delivery.'||reminder_jobs.channel)=1)`;
const reminderDestination=`EXISTS(SELECT 1 FROM notification_destinations d WHERE d.owner=reminder_jobs.owner AND d.plan_id=reminder_jobs.plan_id AND d.member_id=reminder_jobs.member_id AND d.channel=reminder_jobs.channel AND d.confirmed_at<>'')`;
type ExternalJob={id:string;plan_id:string;member_id:string;channel:string;title:string;body:string;attempts:number};
type Destination={destination:string;version:number};
type SesOperation={id:string;request:string;response:string|null;status:string};
function savedJson(value:string|null):Record<string,unknown>{try{const parsed=JSON.parse(value??'{}');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}

/** Every SES network attempt has a durable row. No expired lease or unknown
 * response can authorize a second SendEmail request for the same reminder. */
async function deliverSesReminder(database:D1Database,config:SesEmailConfig|null,owner:string,job:ExternalJob,dest:Destination,token:string,options:{now?:number;fetch?:typeof fetch}){
 const now=options.now??Date.now(),time=new Date(now).toISOString(),base='ses-'+await sesDigest(JSON.stringify([owner,job.id])),fingerprint=await sesDigest(JSON.stringify([job.id,dest.version,dest.destination,job.title,job.body]));
 const attempts=await database.prepare("SELECT id,request,response,status FROM adapter_operations WHERE owner=? AND plan_id=? AND member_id=? AND provider='aws-ses' AND kind='send-email' AND id LIKE ? ORDER BY created,id LIMIT 4").bind(owner,job.plan_id,job.member_id,base+'-%').all<SesOperation>();
 const accepted=attempts.results.find(row=>row.status==='completed');
 if(accepted){const response=savedJson(accepted.response);if(savedJson(accepted.request).fingerprint!==fingerprint||response.accepted!==true||typeof response.messageId!=='string')throw new SesEmailError('uncertain',false,'ses-accepted-evidence-needs-review');return {messageId:response.messageId,reused:true};}
 if(!config){if(attempts.results.length)throw new SesEmailError('uncertain',false,'ses-provider-change-needs-review');return null;}
 if(!attempts.results.length&&job.attempts>0)throw new SesEmailError('uncertain',false,'ses-prior-provider-attempt-needs-review');
 if(attempts.results.some(row=>!['rejected','cancelled'].includes(row.status)||row.status==='rejected'&&savedJson(row.response).retryable!==true))throw new SesEmailError('uncertain',false,'ses-manual-review-required');
 if(attempts.results.length>=3)throw new SesEmailError('uncertain',false,'ses-retry-limit');
 const id=base+'-'+(attempts.results.length+1),request=JSON.stringify({jobId:job.id,fingerprint,destinationVersion:dest.version,destinationHash:await sesDigest(dest.destination),region:config.region,fromHash:await sesDigest(config.fromEmail)});
 const eligibility=`status='processing' AND lease_token=? AND lease_until>? AND ${deliveryFence} AND ${reminderOptIn} AND EXISTS(SELECT 1 FROM notification_destinations d WHERE d.owner=reminder_jobs.owner AND d.plan_id=reminder_jobs.plan_id AND d.member_id=reminder_jobs.member_id AND d.channel='email' AND d.version=? AND d.destination=? AND d.confirmed_at<>'')`;
 const reserved=await database.prepare(`INSERT OR IGNORE INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,status,lease_token,lease_until,created,updated)
 SELECT ?,owner,plan_id,member_id,'aws-ses','send-email',?,'sending',?,?,?,? FROM reminder_jobs WHERE id=? AND owner=? AND channel='email' AND ${eligibility}`)
 .bind(id,request,token,now+30000,time,time,job.id,owner,token,now,dest.version,dest.destination).run();
 if(!reserved.meta.changes)throw new SesEmailError('not-sent',false,'ses-source-changed');
 let receivedMessageId:string|undefined;
 try{
  const result=await sendSesEmail(config,{destination:dest.destination,title:job.title,text:job.body,attemptId:id},{fetch:options.fetch,now:new Date(now),beforeSend:async()=>!!await database.prepare(`SELECT id FROM reminder_jobs WHERE id=? AND owner=? AND ${eligibility} AND EXISTS(SELECT 1 FROM adapter_operations a WHERE a.id=? AND a.status='sending' AND a.lease_token=?)`)
   .bind(job.id,owner,token,options.now??Date.now(),dest.version,dest.destination,id,token).first()});
  receivedMessageId=result.messageId;
  const saved=await database.prepare("UPDATE adapter_operations SET status='completed',response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=? AND status IN ('sending','uncertain')")
   .bind(JSON.stringify({accepted:true,messageId:result.messageId,evidence:'SES accepted; inbox delivery unverified'}),new Date(options.now??Date.now()).toISOString(),id,token).run();
  if(!saved.meta.changes)throw new SesEmailError('uncertain',false,'ses-acceptance-storage-needs-review');
  return {...result,reused:false};
 }catch(error){
  const outcome=error instanceof SesEmailError?error:new SesEmailError('uncertain');
  await database.prepare("UPDATE adapter_operations SET status=?,response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=? AND status='sending'")
   .bind(outcome.outcome==='not-sent'?'cancelled':outcome.outcome,JSON.stringify({accepted:!!receivedMessageId,...(receivedMessageId?{messageId:receivedMessageId}:{}),retryable:outcome.retryable,reason:receivedMessageId?'ses-acceptance-storage-needs-review':outcome.reason}),new Date(options.now??Date.now()).toISOString(),id,token).run();
  throw outcome;
 }
}

export async function runExternalReminderJobs(database:D1Database,env:Env,owner:string,options:{now?:number;fetch?:typeof fetch;limit?:number}={}){
 const ses=sesEmailConfig(env);let config:ReturnType<typeof providerConfig>=null;try{config=providerConfig(env,'NOTIFICATION');}catch(error){if(!ses)throw error;}
 if(!ses&&!config)return {attempted:0,accepted:0,failed:0,configured:false};
 const now=options.now??Date.now(),time=new Date(now).toISOString(),limit=Math.min(10,Math.max(1,options.limit??5));
 const channels=config?"('email','push')":"('email')";
 const rows=await database.prepare(`SELECT * FROM reminder_jobs WHERE owner=? AND channel IN ${channels} AND due_at<=? AND attempts<5 AND (attempts=0 OR updated<=?) AND (status IN ('scheduled','unavailable') OR status='processing' AND lease_until<=?) ORDER BY due_at,id LIMIT ?`).bind(owner,now,new Date(now-60000).toISOString(),now,limit).all<ExternalJob>();
 let accepted=0,failed=0,manualReview=0;
 for(const job of rows.results){const token=crypto.randomUUID(),claimNow=options.now??Date.now();const claimed=await database.prepare(`UPDATE reminder_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated=? WHERE id=? AND owner=? AND (status IN ('scheduled','unavailable') OR status='processing' AND lease_until<=?) AND ${deliveryFence} AND ${reminderOptIn} AND ${reminderDestination}`).bind(token,claimNow+30000,new Date(claimNow).toISOString(),job.id,owner,claimNow).run();if(!claimed.meta.changes)continue;
  try{const dest=await database.prepare('SELECT destination,version FROM notification_destinations WHERE owner=? AND plan_id=? AND member_id=? AND channel=?').bind(owner,job.plan_id,job.member_id,job.channel).first<{destination:string;version:number}>();if(!dest)throw conflict();
   const current=await database.prepare(`SELECT id FROM reminder_jobs WHERE id=? AND lease_token=? AND lease_until>? AND ${deliveryFence} AND ${reminderOptIn}`).bind(job.id,token,options.now??Date.now()).first();if(!current)throw conflict();
   const sesDelivery=job.channel==='email'?await deliverSesReminder(database,ses,owner,job,dest,token,options):null;
   if(!sesDelivery){if(!config)throw new BackendError('NOTIFICATION_CONFIG','The selected reminder channel is not configured.',503);const key=`${job.id}-${dest.version}`,payload={channel:job.channel,destination:dest.destination,title:job.title,text:job.body,requestId:key};
    const result=z.object({accepted:z.literal(true),requestId:z.string(),deliveryId:z.string().min(1).max(180)}).strict().parse(await providerPost(config,'/deliver',payload,key,options.fetch));if(result.requestId!==key)throw new BackendError('NOTIFICATION_EVIDENCE','Delivery acknowledgment does not match this request.',502);}
   const saved=await database.prepare(`UPDATE reminder_jobs SET status='delivered',delivered=?,lease_token=NULL,lease_until=0,last_error='provider-accepted',updated=? WHERE id=? AND lease_token=? AND lease_until>? AND ${deliveryFence} AND ${reminderOptIn} AND EXISTS(SELECT 1 FROM notification_destinations WHERE owner=? AND plan_id=? AND member_id=? AND channel=? AND version=?)`).bind(time,time,job.id,token,options.now??Date.now(),owner,job.plan_id,job.member_id,job.channel,dest.version).run();if(saved.meta.changes)accepted++;
  }catch(error){failed++;if(error instanceof SesEmailError&&(!error.retryable||error.outcome==='uncertain'))manualReview++;await database.prepare("UPDATE reminder_jobs SET status='unavailable',lease_token=NULL,lease_until=0,last_error=?,updated=? WHERE id=? AND lease_token=?").bind(error instanceof SesEmailError?error.reason:'external-delivery-needs-review',time,job.id,token).run();}
 }
 return {attempted:rows.results.length,accepted,failed,manualReview,configured:true,evidence:'Provider acceptance does not establish inbox or device receipt.'};
}
