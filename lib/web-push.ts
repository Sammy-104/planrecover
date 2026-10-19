import {buildPushPayload} from '@block65/webcrypto-web-push';
import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
import type {Env} from './http-adapters.ts';
import {sesDigest} from './ses-email.ts';
import {deliveryFence} from './reminder-jobs.ts';

const badSubscription=()=>new BackendError('PUSH_SUBSCRIPTION','Choose a supported browser push subscription with valid encryption keys.');
const encoder=new TextEncoder();
function decode(value:string,length:number){if(!/^[A-Za-z0-9_-]+$/.test(value))throw badSubscription();let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch{throw badSubscription();}if(bytes.length!==length)throw badSubscription();return bytes;}
export function validatePushEndpoint(value:string){
 let url:URL;try{url=new URL(value);}catch{throw badSubscription();}
 if(value.length>2048||url.protocol!=='https:'||url.port||url.username||url.password||url.hash||url.search||url.hostname.endsWith('.'))throw badSubscription();
 const google=url.hostname==='fcm.googleapis.com'&&/^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:.~%-]+$/.test(url.pathname);
 const mozilla=url.hostname==='updates.push.services.mozilla.com'&&/^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname);
 const apple=url.hostname==='web.push.apple.com'&&/^\/[A-Za-z0-9_./~%-]+$/.test(url.pathname)&&url.pathname.length>2;
 const microsoft=/^[a-z0-9-]{1,63}\.notify\.windows\.com$/.test(url.hostname)&&/^\/w\/[A-Za-z0-9_./~%=-]+$/.test(url.pathname);
 if(!google&&!mozilla&&!apple&&!microsoft)throw badSubscription();return url.href;
}
export const pushSubscriptionRequest=z.object({subscription:z.object({endpoint:z.string().min(1).max(2048),expirationTime:z.number().int().nonnegative().nullable(),keys:z.object({p256dh:z.string().max(100),auth:z.string().max(30)}).strict()}).strict(),confirm:z.literal(true)}).strict();
export type BrowserPushSubscription=z.infer<typeof pushSubscriptionRequest>['subscription'];
export async function validatePushSubscription(value:BrowserPushSubscription,now=Date.now()){
 const parsed=pushSubscriptionRequest.safeParse({subscription:value,confirm:true});if(!parsed.success)throw badSubscription();
 const input=parsed.data.subscription,point=decode(input.keys.p256dh,65);decode(input.keys.auth,16);if(point[0]!==4||input.expirationTime!==null&&(input.expirationTime<=now||input.expirationTime>now+366*86400000))throw badSubscription();
 try{await crypto.subtle.importKey('raw',point as BufferSource,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw badSubscription();}
 return {...input,endpoint:validatePushEndpoint(input.endpoint)};
}
export type WebPushConfig={publicKey:string;privateKey:string;subject:string};
export function webPushConfig(env:Env):WebPushConfig|null{
 if(env.WEB_PUSH_ENABLED!=='true')return null;
 const publicKey=env.WEB_PUSH_PUBLIC_KEY,privateKey=env.WEB_PUSH_PRIVATE_KEY,subject=env.WEB_PUSH_SUBJECT;
 try{if(typeof publicKey!=='string'||typeof privateKey!=='string'||typeof subject!=='string')throw Error();const point=decode(publicKey,65);decode(privateKey,32);if(point[0]!==4||!/^mailto:[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(subject)||subject.length>261)throw Error();return {publicKey,privateKey,subject};}
 catch{throw new BackendError('WEB_PUSH_CONFIG','Web Push needs a valid dedicated VAPID key pair and contact email.',503);}
}
type SubscriptionRow={id:string;owner:string;plan_id:string;member_id:string;subscription:string;version:number;status:string;expires_at:number|null};
const memberFence=`EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON p.owner=m.owner AND p.id=m.plan_id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))`;
export class PushSubscriptionRepository{
 constructor(private database:D1Database,private settings:Env={}){}
 private async access(planId:string,identity:Identity){const plan=await new PlanRepository(this.database).getPlan(planId,identity);if(!['owner','editor'].includes(plan.role))throw forbidden();return plan;}
 async list(planId:string,identity:Identity){const plan=await this.access(planId,identity);let config:WebPushConfig|null=null;try{config=webPushConfig({...this.settings,WEB_PUSH_ENABLED:'true'});}catch{}
  const rows=await this.database.prepare('SELECT id,version,status,expires_at,updated FROM web_push_subscriptions WHERE owner=? AND plan_id=? AND member_id=? ORDER BY updated DESC LIMIT 20').bind(plan.owner,planId,identity.id).all();
  return {subscriptions:rows.results,enabled:this.settings.WEB_PUSH_ENABLED==='true'&&!!config,publicKey:config?.publicKey??null,configurationIsNotDeliveryVerification:true};
 }
 async save(planId:string,identity:Identity,value:BrowserPushSubscription,now=Date.now()){
  const plan=await this.access(planId,identity),subscription=await validatePushSubscription(value,now),hash=await sesDigest(subscription.endpoint),time=new Date(now).toISOString();
  const prior=await this.database.prepare('SELECT id,owner,plan_id,member_id FROM web_push_subscriptions WHERE endpoint_hash=?').bind(hash).first<{id:string;owner:string;plan_id:string;member_id:string}>();
  if(prior&&(prior.owner!==plan.owner||prior.plan_id!==planId||prior.member_id!==identity.id))throw new BackendError('PUSH_IN_USE','This browser subscription is registered to another plan or account. Disable it there before registering again.',409);
  const id=prior?.id??`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,guard=crypto.randomUUID();
  try{await this.database.batch([
   this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN ${memberFence} AND ((SELECT COUNT(*) FROM web_push_subscriptions WHERE owner=? AND plan_id=? AND member_id=? AND status='active')<3 OR EXISTS(SELECT 1 FROM web_push_subscriptions WHERE id=? AND status='active')) THEN 1 ELSE 0 END)`).bind(guard,plan.owner,planId,identity.id,plan.owner,planId,identity.id,id),
   this.database.prepare(`INSERT INTO web_push_subscriptions(id,owner,plan_id,member_id,endpoint_hash,subscription,version,status,expires_at,created,updated) VALUES (?,?,?,?,?,?,1,'active',?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription=excluded.subscription,version=web_push_subscriptions.version+1,status='active',expires_at=excluded.expires_at,updated=excluded.updated WHERE web_push_subscriptions.owner=excluded.owner AND web_push_subscriptions.plan_id=excluded.plan_id AND web_push_subscriptions.member_id=excluded.member_id`).bind(id,plan.owner,planId,identity.id,hash,JSON.stringify(subscription),subscription.expirationTime,time,time),
   this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
  ]);}catch{throw new BackendError('PUSH_SAVE_CONFLICT','The subscription changed or this plan already has three active devices. Refresh and remove an old device.',409);}
  return {id,saved:true};
 }
 async revoke(planId:string,identity:Identity,id:string){const plan=await this.access(planId,identity);const result=await this.database.prepare(`UPDATE web_push_subscriptions SET status='revoked',subscription='{}',version=version+1,updated=? WHERE id=? AND owner=? AND plan_id=? AND member_id=? AND ${memberFence}`).bind(new Date().toISOString(),id,plan.owner,planId,identity.id,plan.owner,planId,identity.id).run();if(!result.meta.changes)throw conflict();return {revoked:true};}
}
export async function expirePushSubscriptions(database:D1Database,now=Date.now(),owner?:string){return database.prepare(`UPDATE web_push_subscriptions SET status='expired',subscription='{}',version=version+1,updated=? WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=? ${owner?'AND owner=?':''}`).bind(new Date(now).toISOString(),now,...(owner?[owner]:[])).run();}

const optIn=`EXISTS(SELECT 1 FROM member_planning_preferences x WHERE x.owner=reminder_jobs.owner AND x.plan_id=reminder_jobs.plan_id AND x.member_id=reminder_jobs.member_id AND json_extract(x.body,'$.delivery.push')=1)`;
export async function runWebPushReminderJobs(database:D1Database,config:WebPushConfig,owner:string,options:{now?:number;fetch?:typeof fetch;limit?:number}={}){
 const now=options.now??Date.now(),time=new Date(now).toISOString();await expirePushSubscriptions(database,now,owner);
 const jobs=await database.prepare(`SELECT id,plan_id,member_id FROM reminder_jobs WHERE owner=? AND channel='push' AND due_at<=? AND attempts<5 AND (attempts=0 OR updated<=?) AND (status IN ('scheduled','unavailable') OR status='processing' AND lease_until<=?) AND ${deliveryFence} AND ${optIn} ORDER BY due_at,id LIMIT ?`).bind(owner,now,new Date(now-60000).toISOString(),now,Math.min(5,Math.max(1,options.limit??5))).all<{id:string;plan_id:string;member_id:string}>();
 let accepted=0,failed=0,manualReview=0;
 for(const job of jobs.results){const token=crypto.randomUUID(),claimAt=options.now??Date.now();
  const claimed=await database.prepare(`UPDATE reminder_jobs SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated=? WHERE id=? AND owner=? AND (status IN ('scheduled','unavailable') OR status='processing' AND lease_until<=?) AND ${deliveryFence} AND ${optIn}`).bind(token,claimAt+60000,new Date(claimAt).toISOString(),job.id,owner,claimAt).run();if(!claimed.meta.changes)continue;
  let deviceAccepted=0,deviceFailed=0,uncertain=false;
  try{
   const rows=await database.prepare("SELECT * FROM web_push_subscriptions WHERE owner=? AND plan_id=? AND member_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?) ORDER BY id LIMIT 3").bind(owner,job.plan_id,job.member_id,options.now??Date.now()).all<SubscriptionRow>();
   for(const row of rows.results){const id=await sesDigest(`${job.id}:${row.id}`),prior=await database.prepare('SELECT status,subscription_version FROM web_push_attempts WHERE id=?').bind(id).first<{status:string;subscription_version:number}>();
    if(prior){if(prior.status==='accepted'&&prior.subscription_version===row.version)deviceAccepted++;else{deviceFailed++;uncertain=uncertain||['sending','uncertain'].includes(prior.status);}continue;}
    let dispatched=false;
    try{const subscription=await validatePushSubscription(JSON.parse(row.subscription),options.now??Date.now());
     const payload=await buildPushPayload({data:{title:'PlanRecover reminder',body:'Open PlanRecover to review your saved reminder.',url:'/flows',tag:'planrecover-'+job.id},options:{ttl:60,urgency:'normal'}},subscription,config);
     const reserved=await database.prepare(`INSERT OR IGNORE INTO web_push_attempts(id,job_id,subscription_id,subscription_version,status,reason,created,updated) SELECT ?,id,?,?,'sending','awaiting-provider',?,? FROM reminder_jobs WHERE id=? AND owner=? AND lease_token=? AND lease_until>? AND status='processing' AND ${deliveryFence} AND ${optIn} AND EXISTS(SELECT 1 FROM web_push_subscriptions WHERE id=? AND version=? AND status='active' AND (expires_at IS NULL OR expires_at>?))`).bind(id,row.id,row.version,time,time,job.id,owner,token,options.now??Date.now(),row.id,row.version,options.now??Date.now()).run();
     if(!reserved.meta.changes){deviceFailed++;continue;}
     const current=await database.prepare(`SELECT id FROM reminder_jobs WHERE id=? AND lease_token=? AND lease_until>? AND status='processing' AND ${deliveryFence} AND ${optIn} AND EXISTS(SELECT 1 FROM web_push_subscriptions WHERE id=? AND version=? AND status='active' AND (expires_at IS NULL OR expires_at>?))`).bind(job.id,token,options.now??Date.now(),row.id,row.version,options.now??Date.now()).first();
     if(!current){await database.prepare("UPDATE web_push_attempts SET status='cancelled',reason='source-changed',updated=? WHERE id=? AND status='sending'").bind(time,id).run();deviceFailed++;continue;}
     dispatched=true;const response=await(options.fetch??fetch)(subscription.endpoint,{...payload,body:payload.body as BodyInit,redirect:'error',signal:AbortSignal.timeout(8000)});await response.body?.cancel();
     const successful=response.status===201||response.status===202,expired=response.status===404||response.status===410;
     const definitive=successful||expired||[400,401,403,413,429].includes(response.status),status=successful?'accepted':expired?'expired':definitive?'rejected':'uncertain';
     const commands=[database.prepare("UPDATE web_push_attempts SET status=?,reason=?,updated=? WHERE id=? AND status='sending'").bind(status,successful?'push-service-accepted':expired?'subscription-expired':definitive?'provider-rejected':'provider-result-uncertain',time,id)];
     if(expired)commands.push(database.prepare("UPDATE web_push_subscriptions SET status='expired',subscription='{}',version=version+1,updated=? WHERE id=? AND version=? AND status='active'").bind(time,row.id,row.version));
     await database.batch(commands);if(successful)deviceAccepted++;else{deviceFailed++;uncertain=uncertain||!definitive;}
    }catch{deviceFailed++;uncertain=uncertain||dispatched;if(dispatched)await database.prepare("UPDATE web_push_attempts SET status='uncertain',reason='provider-result-uncertain',updated=? WHERE id=? AND status='sending'").bind(time,id).run();}
   }
   if(uncertain)manualReview++;
   const status=deviceAccepted>0?'delivered':'unavailable',reason=uncertain?'push-manual-review-required':deviceFailed?'push-partial-or-failed':deviceAccepted?'provider-accepted':'no-active-push-subscription';
   const result=await database.prepare(`UPDATE reminder_jobs SET status=?,delivered=?,last_error=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=? AND lease_until>? AND ${deliveryFence} AND ${optIn}`).bind(status,deviceAccepted?time:null,reason,time,job.id,token,options.now??Date.now()).run();if(result.meta.changes&&deviceAccepted)accepted++;else failed++;
  }catch{failed++;await database.prepare("UPDATE reminder_jobs SET status='unavailable',last_error='push-review-required',lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=?").bind(time,job.id,token).run();}
 }
 return {attempted:jobs.results.length,accepted,failed,manualReview,configured:true,evidence:'Push service acceptance is not proof of device display.'};
}
