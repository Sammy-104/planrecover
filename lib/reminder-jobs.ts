import {BackendError,missingPlan} from './backend-errors.ts';
import {defaultPlanningPreferences,planningPreferencesSchema,type PlanningPreferences} from './planning-constraints.ts';
import type {State} from './model.ts';
import type {Identity} from './people.ts';
import {z} from 'zod';

type Source={kind:'task'|'item-deadline'|'reminder'|'invoice';id:string;due:number;title:string;body:string;members:string[];invoiceVersion:number};
type InvoiceRow={id:string;member_id:string;terms:string;version:number;status:string;amount:number;paid:number};
type Job={id:string;owner:string;plan_id:string;member_id:string;source_kind:Source['kind'];source_id:string;source_due_at:number;
 title:string;body:string;timezone:string;lead_minutes:number;channel:'in-app'|'email'|'push';due_at:number;plan_version:number;
 preferences_version:number;invoice_version:number;status:string;attempts:number;lease_until:number;lease_token:string|null;last_error:string|null};
const instantSchema=z.string().datetime({offset:true});
const instant=(value:unknown):number|null=>typeof value==='string'&&instantSchema.safeParse(value).success&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const iso=(now:number)=>new Date(now).toISOString();
async function stableId(values:unknown[]){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));return 'reminder-'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');}

function sources(state:State,invoices:InvoiceRow[],members:Set<string>):Source[]{
 const result:Source[]=[];
 for(const item of state.items){
  if(item.status==='cancelled')continue;
  const targets=(item.category==='Preparation'&&item.taskOwner?[item.taskOwner]:item.participants).filter(member=>members.has(member));
  if(item.category==='Preparation'&&!item.done){const due=instant(item.start);if(due!==null)result.push({kind:'task',id:item.id,due,title:item.name,body:'Scheduled preparation task. Review the plan for details.',members:targets,invoiceVersion:-1});}
  const due=instant(item.deadline);if(due!==null)result.push({kind:'item-deadline',id:item.id,due,title:`Deadline: ${item.name}`,body:'Stored item deadline. Check the saved supplier terms before taking action.',members:targets,invoiceVersion:-1});
 }
 for(const reminder of state.reminders){
  const item=state.items.find(item=>item.id===reminder.itemId),due=instant(reminder.due);
  if(reminder.done||!item||item.status==='cancelled'||due===null)continue;
  result.push({kind:'reminder',id:reminder.id,due,title:reminder.title,body:reminder.consequence,members:item.participants.filter(member=>members.has(member)),invoiceVersion:-1});
 }
 for(const invoice of invoices){
  if(!['sent','partially-paid'].includes(invoice.status)||invoice.paid>=invoice.amount||!members.has(invoice.member_id))continue;
  let terms:Record<string,unknown>;try{terms=JSON.parse(invoice.terms);}catch{continue;}
  // A PayPal date-only due field does not establish a time-of-day cutoff.
  const due=instant(terms.dueAt);if(due===null)continue;
  result.push({kind:'invoice',id:invoice.id,due,title:'Invoice payment deadline',body:'A sent sandbox invoice has an outstanding balance. Review the invoice before paying.',members:[invoice.member_id],invoiceVersion:invoice.version});
 }
 return result;
}

/** Synchronize from canonical database facts; supplied state is used only to identify the plan. */
export async function syncPlanReminders(database:D1Database,owner:string,state:Pick<State,'plan'>,options:{now?:number}={}) {
 const planId=state.plan.id;if(!planId)throw new BackendError('INVALID_PLAN','The plan needs an identifier.');
 const now=options.now??Date.now();
 for(let attempt=0;attempt<3;attempt++){
  const row=await database.prepare('SELECT body,version,status FROM plans WHERE owner=? AND id=?').bind(owner,planId)
   .first<{body:string;version:number;status:string}>();
  if(!row)throw missingPlan();
  if(row.status==='deleted'){
   await database.prepare("UPDATE reminder_jobs SET status='cancelled',lease_token=NULL,lease_until=0,last_error='plan-deleted',updated=? WHERE owner=? AND plan_id=? AND status IN ('scheduled','processing','unavailable')")
    .bind(iso(now),owner,planId).run();return {scheduled:0,cancelled:true};
  }
  const canonical=JSON.parse(row.body) as State;
  const memberRows=await database.prepare("SELECT member_id FROM plan_members WHERE owner=? AND plan_id=? AND role<>'legacy'").bind(owner,planId).all<{member_id:string}>();
  const prefRows=await database.prepare('SELECT member_id,body,version FROM member_planning_preferences WHERE owner=? AND plan_id=?').bind(owner,planId)
   .all<{member_id:string;body:string;version:number}>();
  const invoices=await database.prepare('SELECT id,member_id,terms,version,status,amount,paid FROM plan_invoices WHERE owner=? AND plan_id=?').bind(owner,planId).all<InvoiceRow>();
  const allSources=sources(canonical,invoices.results,new Set(memberRows.results.map(member=>member.member_id))),jobs:Job[]=[];
  for(const source of allSources)for(const memberId of source.members){
   const stored=prefRows.results.find(pref=>pref.member_id===memberId),pref:PlanningPreferences=stored?planningPreferencesSchema.parse(JSON.parse(stored.body)):defaultPlanningPreferences(canonical.plan.timezone);
   for(const lead of pref.leadMinutes)for(const channel of ['in-app','email','push'] as const){
    if(!({ 'in-app':pref.delivery.inApp,email:pref.delivery.email,push:pref.delivery.push })[channel])continue;
    const id=await stableId([owner,planId,memberId,source.kind,source.id,source.due,source.title,source.body,lead,channel,pref.timezone]);
    jobs.push({id,owner,plan_id:planId,member_id:memberId,source_kind:source.kind,source_id:source.id,source_due_at:source.due,title:source.title,body:source.body,
     timezone:pref.timezone,lead_minutes:lead,channel,due_at:source.due-lead*60000,plan_version:row.version,preferences_version:stored?.version??0,
     invoice_version:source.invoiceVersion,status:channel==='in-app'?'scheduled':'unavailable',attempts:0,lease_until:0,lease_token:null,last_error:channel==='in-app'?null:'delivery-channel-unconfigured'});
   }
  }
  const token=crypto.randomUUID(),conditions=[
   "EXISTS(SELECT 1 FROM plans WHERE owner=? AND id=? AND version=? AND status<>'deleted')",
   '(SELECT COUNT(*) FROM member_planning_preferences WHERE owner=? AND plan_id=?)=?',
   '(SELECT COUNT(*) FROM plan_invoices WHERE owner=? AND plan_id=?)=?',
  ],values:(string|number)[]=[owner,planId,row.version,owner,planId,prefRows.results.length,owner,planId,invoices.results.length];
  for(const pref of prefRows.results){conditions.push('EXISTS(SELECT 1 FROM member_planning_preferences WHERE owner=? AND plan_id=? AND member_id=? AND version=?)');values.push(owner,planId,pref.member_id,pref.version);}
  for(const invoice of invoices.results){conditions.push('EXISTS(SELECT 1 FROM plan_invoices WHERE id=? AND version=?)');values.push(invoice.id,invoice.version);}
  const commands=[database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE 0 END)`).bind(token,...values),
   database.prepare("UPDATE reminder_jobs SET status='cancelled',lease_token=NULL,lease_until=0,last_error='source-changed',updated=? WHERE owner=? AND plan_id=? AND status IN ('scheduled','processing','unavailable') AND id NOT IN (SELECT value FROM json_each(?))")
    .bind(iso(now),owner,planId,JSON.stringify(jobs.map(job=>job.id))),
  ];
  for(const job of jobs)commands.push(database.prepare(`INSERT INTO reminder_jobs(id,owner,plan_id,member_id,source_kind,source_id,source_due_at,title,body,timezone,lead_minutes,channel,due_at,plan_version,preferences_version,invoice_version,status,last_error,created,updated)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET plan_version=excluded.plan_version,preferences_version=excluded.preferences_version,invoice_version=excluded.invoice_version,
    status=CASE WHEN reminder_jobs.status='cancelled' THEN excluded.status ELSE reminder_jobs.status END,
    last_error=CASE WHEN reminder_jobs.status='cancelled' THEN excluded.last_error ELSE reminder_jobs.last_error END,updated=excluded.updated`)
   .bind(job.id,owner,planId,job.member_id,job.source_kind,job.source_id,job.source_due_at,job.title,job.body,job.timezone,job.lead_minutes,job.channel,job.due_at,
    job.plan_version,job.preferences_version,job.invoice_version,job.status,job.last_error,iso(now),iso(now)));
  commands.push(database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token));
  try{await database.batch(commands);return {scheduled:jobs.filter(job=>job.channel==='in-app').length,unavailable:jobs.filter(job=>job.channel!=='in-app').length};}
  catch(error){if(!String(error).includes('CHECK constraint failed')||attempt===2)throw error;}
 }
 throw new BackendError('REMINDER_SYNC_CONFLICT','Reminder sources changed; retry synchronization.',409);
}

/** Cursor prevents large accounts/plans from starving later plans during scheduled runs. */
export async function syncAllPlanReminders(database:D1Database,options:{now?:number;limit?:number;owner?:string;after?:{owner:string;id:string}}={}) {
 const limit=Math.max(1,Math.min(500,options.limit??100));
 const filters=[...(options.owner?['owner=?']:[]),...(options.after?['(owner>? OR (owner=? AND id>?))']:[])];
 const rows=await database.prepare(`SELECT owner,id FROM plans ${filters.length?`WHERE ${filters.join(' AND ')}`:''} ORDER BY owner,id LIMIT ?`)
  .bind(...(options.owner?[options.owner]:[]),...(options.after?[options.after.owner,options.after.owner,options.after.id]:[]),limit).all<{owner:string;id:string}>();
 let synced=0,failed=0;
 for(const row of rows.results){try{await syncPlanReminders(database,row.owner,{plan:{id:row.id} as State['plan']},{now:options.now});synced++;}catch{failed++;}}
 return {synced,failed,nextCursor:rows.results.length===limit?rows.results.at(-1):undefined};
}

export const deliveryFence=`EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
 WHERE p.owner=reminder_jobs.owner AND p.id=reminder_jobs.plan_id AND p.version=reminder_jobs.plan_version AND p.status<>'deleted'
 AND m.member_id=reminder_jobs.member_id AND m.role<>'legacy')
 AND COALESCE((SELECT version FROM member_planning_preferences x WHERE x.owner=reminder_jobs.owner AND x.plan_id=reminder_jobs.plan_id AND x.member_id=reminder_jobs.member_id),0)=reminder_jobs.preferences_version
 AND (reminder_jobs.source_kind<>'invoice' OR EXISTS(SELECT 1 FROM plan_invoices i WHERE i.id=reminder_jobs.source_id AND i.version=reminder_jobs.invoice_version AND i.status IN ('sent','partially-paid') AND i.paid<i.amount))`;

/** Leased, fenced, retryable delivery. No external provider is called or claimed as sent. */
export async function runDueReminderJobs(database:D1Database,options:{now?:number;limit?:number;leaseMs?:number;owner?:string}={}){
 const now=options.now??Date.now(),limit=Math.max(1,Math.min(500,options.limit??100)),leaseMs=Math.max(1000,Math.min(300000,options.leaseMs??60000));
 const rows=await database.prepare(`SELECT * FROM reminder_jobs WHERE channel='in-app' AND due_at<=? AND (status='scheduled' OR (status='processing' AND lease_until<=?)) ${options.owner?'AND owner=?':''} ORDER BY due_at,id LIMIT ?`)
  .bind(now,now,...(options.owner?[options.owner]:[]),limit).all<Job>();
 let delivered=0,cancelled=0,failed=0;
 for(const row of rows.results){
  const token=crypto.randomUUID();
  const claim=await database.prepare(`UPDATE reminder_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated=?
   WHERE id=? AND channel='in-app' AND due_at<=? AND (status='scheduled' OR (status='processing' AND lease_until<=?))`)
   .bind(token,now+leaseMs,iso(now),row.id,now,now).run();
  if(!claim.meta.changes)continue;
  try{
   const finalNow=options.now??Date.now();
   const results=await database.batch([
    database.prepare(`INSERT OR IGNORE INTO plan_notifications(id,job_id,owner,plan_id,member_id,title,body,created)
     SELECT ?,id,owner,plan_id,member_id,title,body,? FROM reminder_jobs WHERE id=? AND status='processing' AND lease_token=? AND lease_until>? AND ${deliveryFence}`)
     .bind(`notification-${row.id}`,iso(finalNow),row.id,token,finalNow),
    database.prepare(`UPDATE reminder_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM plan_notifications WHERE job_id=reminder_jobs.id) THEN 'delivered' WHEN lease_until<=? THEN 'scheduled' ELSE 'cancelled' END,
     delivered=CASE WHEN EXISTS(SELECT 1 FROM plan_notifications WHERE job_id=reminder_jobs.id) THEN ? ELSE NULL END,
     last_error=CASE WHEN EXISTS(SELECT 1 FROM plan_notifications WHERE job_id=reminder_jobs.id) THEN NULL WHEN lease_until<=? THEN 'lease-expired' ELSE 'source-changed' END,lease_token=NULL,lease_until=0,updated=?
     WHERE id=? AND status='processing' AND lease_token=?`).bind(finalNow,iso(finalNow),finalNow,iso(finalNow),row.id,token),
   ]);
   if(results[0].meta.changes)delivered++;else if(results[1].meta.changes)cancelled++;
  }catch{
   failed++;
   await database.prepare("UPDATE reminder_jobs SET status='scheduled',lease_token=NULL,lease_until=0,last_error='notification-storage-failed',updated=? WHERE id=? AND status='processing' AND lease_token=?")
    .bind(iso(now),row.id,token).run();
  }
 }
 return {delivered,cancelled,failed,attempted:rows.results.length};
}

export class ReminderRepository{
 private database:D1Database;
 constructor(database:D1Database){this.database=database;}
 private async access(planId:string,identity:Identity){const row=await this.database.prepare(`SELECT p.owner,p.body FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
  WHERE p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy'`).bind(planId,identity.id).first<{owner:string;body:string}>();if(!row)throw missingPlan();return row;}
 async list(planId:string,identity:Identity){
  const plan=await this.access(planId,identity);await syncPlanReminders(this.database,plan.owner,JSON.parse(plan.body));
  const notifications=await this.database.prepare('SELECT id,title,body,created,read_at FROM plan_notifications WHERE owner=? AND plan_id=? AND member_id=? ORDER BY created DESC,id LIMIT 100')
   .bind(plan.owner,planId,identity.id).all<{id:string;title:string;body:string;created:string;read_at:string|null}>();
  const jobs=await this.database.prepare("SELECT id,source_kind,source_id,source_due_at,title,timezone,lead_minutes,channel,due_at,status,last_error FROM reminder_jobs WHERE owner=? AND plan_id=? AND member_id=? AND status<>'cancelled' ORDER BY due_at,id LIMIT 200")
   .bind(plan.owner,planId,identity.id).all();
  return {notifications:notifications.results.map(row=>({id:row.id,title:row.title,body:row.body,created:row.created,readAt:row.read_at})),jobs:jobs.results,
   delivery:{inApp:'configured',email:'unconfigured',push:'unconfigured'}};
 }
 async markRead(planId:string,identity:Identity,notificationId:string){
  const plan=await this.access(planId,identity),now=iso(Date.now());
  const result=await this.database.prepare(`UPDATE plan_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND owner=? AND plan_id=? AND member_id=?
   AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=plan_notifications.owner AND p.id=plan_notifications.plan_id
   AND p.status<>'deleted' AND m.member_id=plan_notifications.member_id AND m.role<>'legacy')`).bind(now,notificationId,plan.owner,planId,identity.id).run();
  if(!result.meta.changes)throw new BackendError('NOTIFICATION_NOT_FOUND','This notification is unavailable.',404);
  return {read:true};
 }
}
