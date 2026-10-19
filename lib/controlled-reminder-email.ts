import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
import {deliveryFence} from './reminder-jobs.ts';
import {emailDestinationSuppressed} from './ses-delivery-events.ts';
import {sesEmailConfig,sesDigest,sendSesEmail,SesEmailError} from './ses-email.ts';

type Settings=Record<string,unknown>;
type Dependencies={now?:()=>number;fetch?:typeof fetch};
const id=z.string().min(1).max(180),version=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const grantSchema=z.object({planId:id,reminderJobId:id,expiresAt:z.string().datetime({offset:true}),grantId:z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).optional()}).strict();
export const controlledReminderEmailRequest=z.object({reminderJobId:id,planVersion:version,preferencesVersion:version,destinationVersion:version,confirm:z.literal(true)}).strict();
type Input=z.infer<typeof controlledReminderEmailRequest>;
type Job={id:string;plan_id:string;member_id:string;title:string;body:string;timezone:string;due_at:number;source_due_at:number;source_id:string;source_type:string|null;source_kind:string;lead_minutes:number;plan_version:number;preferences_version:number;invoice_version:number;status:string};
type AttemptRow={id:string;request:string;response:string|null;status:string;lease_token:string|null;lease_until:number;updated:string};
type Scope={planId:string;identity:Identity;authenticatedEmail:string|null};
const unavailable=()=>new BackendError('SES_CONTROLLED_TEST_UNAVAILABLE','A private, unexpired grant is required for one controlled self-email test. Normal email delivery remains disabled.',503);
const changed=()=>new BackendError('SES_CONTROLLED_TEST_CHANGED','The reminder, destination or test authorization changed. Review current details before proceeding.',409);
const evidence='Amazon SES acceptance does not establish inbox delivery.';
function json(value:string|null):Record<string,any>{try{const parsed=JSON.parse(value??'{}');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}
function grant(settings:Settings,planId:string,now:number){
 if(settings.AWS_SES_ENABLED!=='false')throw unavailable();
 const raw=settings.AWS_SES_CONTROLLED_TEST;if(typeof raw!=='string'||raw.length>2048)throw unavailable();
 let parsed;try{parsed=grantSchema.safeParse(JSON.parse(raw));}catch{throw unavailable();}
 if(!parsed.success||parsed.data.planId!==planId)throw unavailable();
 const expires=Date.parse(parsed.data.expiresAt);if(expires<=now||expires-now>3600000)throw unavailable();
 return parsed.data;
}
function attempt(row:AttemptRow){
 const response=json(row.response),accepted=row.status==='completed'&&response.accepted===true&&typeof response.messageId==='string';
 const status=accepted?'accepted':row.status==='sending'?'pending':row.status==='cancelled'?'not-sent':row.status==='rejected'?'rejected':'uncertain';
 return {id:row.id,status,accepted,...(accepted?{messageId:response.messageId as string}:{}),recordedAt:row.updated,evidence};
}

/** One explicit email copy of an existing due in-app reminder. This service
 * never starts owner jobs, changes opt-ins, consumes the reminder or retries a
 * provider attempt. Its private grant is independent of normal email sending. */
export class ControlledReminderEmailService{
 private clock:()=>number;
 constructor(private database:D1Database,private settings:Settings,private dependencies:Dependencies={}){this.clock=dependencies.now??Date.now;}
 private async context(scope:Scope){
  const now=this.clock(),authorization=grant(this.settings,scope.planId,now),repository=new PlanRepository(this.database);
  const record=await repository.getPlan(scope.planId,scope.identity);if(record.role!=='owner')throw forbidden();
  const email=z.string().email().max(254).safeParse(scope.authenticatedEmail?.trim());
  if(!email.success)throw new BackendError('SES_CONTROLLED_TEST_RECIPIENT','The signed-in account email is required for this self-email test.',403);
  const destination=await this.database.prepare("SELECT destination,version,confirmed_at FROM notification_destinations WHERE owner=? AND plan_id=? AND member_id=? AND channel='email'")
   .bind(record.owner,scope.planId,scope.identity.id).first<{destination:string;version:number;confirmed_at:string}>();
  if(!destination?.confirmed_at||destination.destination.trim().toLowerCase()!==email.data.toLowerCase())throw new BackendError('SES_CONTROLLED_TEST_RECIPIENT','Confirm this same signed-in email as your reminder destination first.',403);
  const job=await this.database.prepare(`SELECT * FROM reminder_jobs WHERE id=? AND owner=? AND plan_id=? AND member_id=? AND channel='in-app'
   AND due_at<=? AND status IN ('scheduled','processing','delivered') AND ${deliveryFence}`)
   .bind(authorization.reminderJobId,record.owner,scope.planId,scope.identity.id,now).first<Job>();
  if(!job||record.version!==job.plan_version)throw changed();
  if(await emailDestinationSuppressed(this.database,record.owner,destination.destination,now))throw new BackendError('SES_CONTROLLED_TEST_SUPPRESSED','This confirmed email destination is suppressed. No test email can be sent.',409);
  const grantHash=await sesDigest(JSON.stringify(authorization)),attemptId='ses-selftest-'+await sesDigest(JSON.stringify([record.owner,scope.planId,scope.identity.id,job.id]));
  const source={id:job.id,planId:job.plan_id,memberId:job.member_id,title:job.title,body:job.body,timezone:job.timezone,dueAt:job.due_at,sourceDueAt:job.source_due_at,
   sourceId:job.source_id,sourceType:job.source_type??job.source_kind,leadMinutes:job.lead_minutes,planVersion:job.plan_version,preferencesVersion:job.preferences_version,invoiceVersion:job.invoice_version};
  const fingerprint=await sesDigest(JSON.stringify({grantHash,source,destinationVersion:destination.version,destinationHash:await sesDigest(destination.destination.trim().toLowerCase())}));
  return {now,authorization,record,destination,job,grantHash,attemptId,fingerprint};
 }
 private async saved(attemptId:string,owner:string,planId:string,memberId:string){return this.database.prepare("SELECT id,request,response,status,lease_token,lease_until,updated FROM adapter_operations WHERE id=? AND owner=? AND plan_id=? AND member_id=? AND provider='aws-ses' AND kind='controlled-self-test'")
  .bind(attemptId,owner,planId,memberId).first<AttemptRow>();}
 async preview(scope:Scope){
  const record=await new PlanRepository(this.database).getPlan(scope.planId,scope.identity);if(record.role!=='owner')throw forbidden();
  let current;try{current=await this.context(scope);}catch(error){
   if(!(error instanceof BackendError)||error.code!=='SES_CONTROLLED_TEST_UNAVAILABLE')throw error;
   const retained=await this.database.prepare("SELECT id,response,status,updated FROM adapter_operations WHERE owner=? AND plan_id=? AND member_id=? AND provider='aws-ses' AND kind='controlled-self-test' ORDER BY created DESC,id DESC LIMIT 1")
    .bind(record.owner,scope.planId,scope.identity.id).first<AttemptRow>();
   // Reading a past coarse outcome needs no sending grant. It exposes neither
   // the recipient nor the grant, request body or copied reminder contents.
   return {available:false,planId:scope.planId,reason:error.code,...(retained?{lastAttempt:attempt(retained)}:{}),canonicalReminderUnchanged:true,inboxDelivery:'unverified'};
  }
  const saved=await this.saved(current.attemptId,current.record.owner,scope.planId,scope.identity.id);
  // Validate dedicated credentials without enabling the normal delivery runner.
  sesEmailConfig({...this.settings,AWS_SES_ENABLED:'true'});
  return {available:true,planId:scope.planId,expiresAt:current.authorization.expiresAt,recipient:current.destination.destination,
   reminder:{id:current.job.id,title:current.job.title,body:current.job.body,dueAt:new Date(current.job.due_at).toISOString(),timezone:current.job.timezone},
   versions:{planVersion:current.job.plan_version,preferencesVersion:current.job.preferences_version,destinationVersion:current.destination.version},
   ...(saved?{attempt:attempt(saved)}:{}),normalEmailEnabled:false,inboxDelivery:'unverified',canonicalReminderUnchanged:true};
 }
 async send(scope:Scope,input:Input){
  const current=await this.context(scope);
  if(input.confirm!==true||input.reminderJobId!==current.job.id||input.planVersion!==current.job.plan_version||input.preferencesVersion!==current.job.preferences_version||input.destinationVersion!==current.destination.version)throw changed();
  const config=sesEmailConfig({...this.settings,AWS_SES_ENABLED:'true'});if(!config)throw unavailable();
  const now=current.now,stamp=new Date(now).toISOString(),token=crypto.randomUUID(),request=JSON.stringify({sourceJobId:current.job.id,grantHash:current.grantHash,
   fingerprint:current.fingerprint,planVersion:input.planVersion,preferencesVersion:input.preferencesVersion,destinationVersion:input.destinationVersion,
   destinationHash:await sesDigest(current.destination.destination.trim().toLowerCase()),grantExpiresAt:current.authorization.expiresAt,consent:'one-manual-self-email-copy'});
  const destinationHash=await sesDigest(current.destination.destination.trim().toLowerCase());
  const eligible=`id=? AND owner=? AND plan_id=? AND member_id=? AND channel='in-app' AND due_at<=? AND status IN ('scheduled','processing','delivered')
   AND plan_version=? AND preferences_version=? AND ${deliveryFence}
   AND title=? AND body=? AND timezone=? AND source_due_at=? AND due_at=?
   AND EXISTS(SELECT 1 FROM plan_members m JOIN plans p ON p.owner=m.owner AND p.id=m.plan_id WHERE p.owner=reminder_jobs.owner AND p.id=reminder_jobs.plan_id AND p.status<>'deleted' AND m.member_id=reminder_jobs.member_id AND m.role='owner')
   AND EXISTS(SELECT 1 FROM notification_destinations d WHERE d.owner=reminder_jobs.owner AND d.plan_id=reminder_jobs.plan_id AND d.member_id=reminder_jobs.member_id AND d.channel='email' AND d.version=? AND d.destination=? AND d.confirmed_at<>'')
   AND NOT EXISTS(SELECT 1 FROM notification_suppressions s WHERE s.owner=reminder_jobs.owner AND s.destination_hash=? AND (s.suppressed_until IS NULL OR s.suppressed_until>?))`;
  const values=(at:number)=>[current.job.id,current.record.owner,scope.planId,scope.identity.id,at,input.planVersion,input.preferencesVersion,current.job.title,current.job.body,current.job.timezone,current.job.source_due_at,current.job.due_at,input.destinationVersion,current.destination.destination,destinationHash,at];
  const reserved=await this.database.prepare(`INSERT OR IGNORE INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,status,lease_token,lease_until,created,updated)
   SELECT ?,owner,plan_id,member_id,'aws-ses','controlled-self-test',?,'sending',?,?,?,? FROM reminder_jobs WHERE ${eligible}`)
   .bind(current.attemptId,request,token,now+30000,stamp,stamp,...values(now)).run();
  const result=(row:AttemptRow,reused:boolean)=>({...attempt(row),attemptId:row.id,reused,normalEmailEnabled:false,inboxDelivery:'unverified',canonicalReminderUnchanged:true});
  if(!reserved.meta.changes){
   let prior=await this.saved(current.attemptId,current.record.owner,scope.planId,scope.identity.id);if(!prior)throw changed();
   if(json(prior.request).fingerprint!==current.fingerprint)throw changed();
   if(prior.status==='sending'&&prior.lease_until<=this.clock()){
    await this.database.prepare("UPDATE adapter_operations SET status='uncertain',response=?,lease_until=0,updated=? WHERE id=? AND status='sending' AND lease_until<=?")
     .bind(JSON.stringify({accepted:false,reason:'ses-controlled-test-lease-expired'}),new Date(this.clock()).toISOString(),prior.id,this.clock()).run();
    prior=(await this.saved(prior.id,current.record.owner,scope.planId,scope.identity.id))!;
   }
   return result(prior,true);
  }
  let acceptedMessageId:string|undefined;
  try{
   const sent=await sendSesEmail(config,{destination:current.destination.destination,title:`PlanRecover controlled reminder test: ${current.job.title}`,
    text:`This is one controlled email copy of your saved in-app reminder.\n\n${current.job.title}\n${current.job.body}\n\nOriginal reminder due: ${new Date(current.job.due_at).toISOString()} (${current.job.timezone}).\n\nNormal email reminder settings and the original reminder are unchanged. ${evidence}`,
    attemptId:current.attemptId},{fetch:this.dependencies.fetch,now:new Date(now),beforeSend:async()=>{
     try{const latest=await this.context(scope);if(latest.attemptId!==current.attemptId||latest.fingerprint!==current.fingerprint)return false;
      const at=this.clock();if(at>=Date.parse(current.authorization.expiresAt))return false;
      const ready=await this.database.prepare(`SELECT id FROM reminder_jobs WHERE ${eligible} AND EXISTS(SELECT 1 FROM adapter_operations a WHERE a.id=? AND a.status='sending' AND a.lease_token=? AND a.lease_until>?)`)
       .bind(...values(at),current.attemptId,token,at).first();
      return !!ready&&this.clock()<Date.parse(current.authorization.expiresAt)&&this.clock()<now+30000;
     }catch{return false;}
    }});
   acceptedMessageId=sent.messageId;
   const saved=await this.database.prepare("UPDATE adapter_operations SET status='completed',response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND status IN ('sending','uncertain') AND lease_token=?")
    .bind(JSON.stringify({accepted:true,messageId:sent.messageId,evidence:'SES accepted; inbox delivery unverified'}),new Date(this.clock()).toISOString(),current.attemptId,token).run();
   if(!saved.meta.changes)throw new SesEmailError('uncertain',false,'ses-controlled-test-acceptance-storage');
  }catch(error){
   const outcome=error instanceof SesEmailError?error:new SesEmailError('uncertain');
   await this.database.prepare("UPDATE adapter_operations SET status=?,response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND status IN ('sending','uncertain') AND lease_token=?")
    .bind(outcome.outcome==='not-sent'?'cancelled':outcome.outcome,JSON.stringify({accepted:!!acceptedMessageId,...(acceptedMessageId?{messageId:acceptedMessageId}:{}),reason:acceptedMessageId?'ses-controlled-test-acceptance-storage':outcome.reason,retryable:false}),new Date(this.clock()).toISOString(),current.attemptId,token).run();
  }
  const saved=await this.saved(current.attemptId,current.record.owner,scope.planId,scope.identity.id);if(!saved)throw conflict();return result(saved,false);
 }
}
