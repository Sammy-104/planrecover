import {providerConfig,providerPost,type Env} from './http-adapters.ts';
import {deliveryFence} from './reminder-jobs.ts';
import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
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
export async function runExternalReminderJobs(database:D1Database,env:Env,owner:string,options:{now?:number;fetch?:typeof fetch;limit?:number}={}){
 const config=providerConfig(env,'NOTIFICATION');if(!config)return {attempted:0,accepted:0,failed:0,configured:false};
 const now=options.now??Date.now(),time=new Date(now).toISOString(),limit=Math.min(10,Math.max(1,options.limit??5));
 const optin=`EXISTS(SELECT 1 FROM member_planning_preferences x WHERE x.owner=reminder_jobs.owner AND x.plan_id=reminder_jobs.plan_id AND x.member_id=reminder_jobs.member_id AND json_extract(x.body,'$.delivery.'||reminder_jobs.channel)=1)`;
 const destination=`EXISTS(SELECT 1 FROM notification_destinations d WHERE d.owner=reminder_jobs.owner AND d.plan_id=reminder_jobs.plan_id AND d.member_id=reminder_jobs.member_id AND d.channel=reminder_jobs.channel)`;
 const rows=await database.prepare(`SELECT * FROM reminder_jobs WHERE owner=? AND channel IN ('email','push') AND due_at<=? AND attempts<5 AND (attempts=0 OR updated<=?) AND (status IN ('scheduled','unavailable') OR status='processing' AND lease_until<=?) ORDER BY due_at,id LIMIT ?`).bind(owner,now,new Date(now-60000).toISOString(),now,limit).all<{id:string;plan_id:string;member_id:string;channel:string;title:string;body:string}>();
 let accepted=0,failed=0;
 for(const job of rows.results){const token=crypto.randomUUID();const claimed=await database.prepare(`UPDATE reminder_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated=? WHERE id=? AND owner=? AND (status IN ('scheduled','unavailable') OR status='processing' AND lease_until<=?) AND ${deliveryFence} AND ${optin} AND ${destination}`).bind(token,now+30000,time,job.id,owner,now).run();if(!claimed.meta.changes)continue;
  try{const dest=await database.prepare('SELECT destination,version FROM notification_destinations WHERE owner=? AND plan_id=? AND member_id=? AND channel=?').bind(owner,job.plan_id,job.member_id,job.channel).first<{destination:string;version:number}>();if(!dest)throw conflict();
   const current=await database.prepare(`SELECT id FROM reminder_jobs WHERE id=? AND lease_token=? AND ${deliveryFence} AND ${optin}`).bind(job.id,token).first();if(!current)throw conflict();
   const key=`${job.id}-${dest.version}`,payload={channel:job.channel,destination:dest.destination,title:job.title,text:job.body,requestId:key};
   const result=z.object({accepted:z.literal(true),requestId:z.string(),deliveryId:z.string().min(1).max(180)}).strict().parse(await providerPost(config,'/deliver',payload,key,options.fetch));if(result.requestId!==key)throw new BackendError('NOTIFICATION_EVIDENCE','Delivery acknowledgment does not match this request.',502);
   const saved=await database.prepare(`UPDATE reminder_jobs SET status='delivered',delivered=?,lease_token=NULL,lease_until=0,last_error='provider-accepted',updated=? WHERE id=? AND lease_token=? AND lease_until>? AND ${deliveryFence} AND ${optin} AND EXISTS(SELECT 1 FROM notification_destinations WHERE owner=? AND plan_id=? AND member_id=? AND channel=? AND version=?)`).bind(time,time,job.id,token,Date.now(),owner,job.plan_id,job.member_id,job.channel,dest.version).run();if(saved.meta.changes)accepted++;
  }catch{failed++;await database.prepare("UPDATE reminder_jobs SET status='unavailable',lease_token=NULL,lease_until=0,last_error='external-delivery-needs-review',updated=? WHERE id=? AND lease_token=?").bind(time,job.id,token).run();}
 }
 return {attempted:rows.results.length,accepted,failed,configured:true,evidence:'Provider acceptance does not establish inbox or device receipt.'};
}
