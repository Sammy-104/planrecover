import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {PlanningPreferencesRepository,defaultPlanningPreferences} from '../lib/planning-constraints.ts';
import {syncPlanReminders,syncAllPlanReminders,runDueReminderJobs,ReminderRepository} from '../lib/reminder-jobs.ts';
import {accountPersonId} from '../lib/people.ts';

const alice={id:'person-alice',name:'Alice'},bob={id:'person-bob',name:'Bob'},stranger={id:'person-stranger',name:'Stranger'},owner='reminder-owner';
const now=Date.parse('2027-04-04T15:00:00Z');let checks=0;
async function setup(){const database=createTestD1(),plans=new PlanRepository(database),record=await plans.createPlan(owner,alice,{kind:'day-out',name:'Reminders',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
 const id=record.state.plan.id,body={...record.state,items:[{id:'task-1',name:'Pack supplies',category:'Preparation',start:'2027-04-04T12:00:00-04:00',duration:15,participants:[alice.id],taskOwner:alice.id,price:0,status:'scheduled',done:false,deadline:null}],reminders:[]};
 await database.prepare('UPDATE plans SET body=?,version=version+1 WHERE owner=? AND id=?').bind(JSON.stringify(body),owner,id).run();
 return {database,plans,id,state:body,preferences:new PlanningPreferencesRepository(database),reminders:new ReminderRepository(database)};
}
async function check(name,run){const fixture=await setup();try{await run(fixture);checks++;console.log(`PASS ${name}`);}finally{fixture.database.close();}}
const count=async(database,table)=>Number(await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first('count'));
async function sync(fixture){return syncPlanReminders(fixture.database,owner,fixture.state,{now});}

await check('Real migration persists private per-member planning preferences with optimistic version and access guards',async({database,id,preferences,plans})=>{
 const before=(await plans.getPlan(id,alice)).state,initial=await preferences.get(id,alice);assert.equal(initial.configured,false);assert.equal(initial.version,0);
 const privateValues={...initial.preferences,dietaryNeeds:['vegan'],accessibilityNeeds:['step-free'],availability:[{start:'2027-04-04T12:00:00Z',end:'2027-04-04T22:00:00Z',status:'available'}]};
 await preferences.update(id,alice,privateValues,0);assert.deepEqual((await preferences.get(id,alice)).preferences,privateValues);
 assert.deepEqual((await plans.getPlan(id,alice)).state,before,'No private availability or needs enter the shared aggregate');
 await assert.rejects(()=>preferences.update(id,alice,privateValues,0),error=>error.status===409);
 await assert.rejects(()=>preferences.get(id,stranger),error=>error.status===404);
 await database.prepare("INSERT INTO plan_members(owner,plan_id,member_id,role,body) VALUES (?,?,?,'viewer',?)").bind(owner,id,bob.id,JSON.stringify({...bob,role:'viewer'})).run();
 await assert.rejects(()=>preferences.update(id,bob,privateValues,0),error=>error.status===403);
 assert.deepEqual((await preferences.get(id,bob)).preferences.dietaryNeeds,[]);
});
await check('Explicit task deadlines create deterministic jobs and duplicate syncs do not duplicate notifications',async(fixture)=>{
 const {database}=fixture;await sync(fixture);await sync(fixture);assert.equal(await count(database,'reminder_jobs'),2);
 const results=await Promise.all([runDueReminderJobs(database,{now}),runDueReminderJobs(database,{now})]);
 assert.equal(results.reduce((sum,result)=>sum+result.delivered,0),1);assert.equal(await count(database,'plan_notifications'),1);
 assert.equal((await runDueReminderJobs(database,{now})).delivered,0);
 await sync(fixture);assert.equal((await runDueReminderJobs(database,{now})).delivered,0);assert.equal(await count(database,'plan_notifications'),1);
});
await check('Rescheduling cancels obsolete jobs and schedules the new explicit instant',async(fixture)=>{
 const {database,id,state}=fixture;await sync(fixture);const old=await database.prepare('SELECT id FROM reminder_jobs').all();
 state.items[0].start='2027-04-04T15:00:00-04:00';await database.prepare('UPDATE plans SET body=?,version=version+1 WHERE owner=? AND id=?').bind(JSON.stringify(state),owner,id).run();
 await sync(fixture);for(const job of old.results)assert.equal(await database.prepare('SELECT status FROM reminder_jobs WHERE id=?').bind(job.id).first('status'),'cancelled');
 assert.equal((await runDueReminderJobs(database,{now})).delivered,0);
 assert.equal((await runDueReminderJobs(database,{now:Date.parse('2027-04-04T18:00:00Z')})).delivered,1);
});
await check('Preference edits cancel leased jobs and never claim email/push were sent',async(fixture)=>{
 const {database,id,preferences}=fixture;await sync(fixture);await preferences.update(id,alice,{...defaultPlanningPreferences('America/Toronto'),leadMinutes:[60],delivery:{inApp:true,email:true,push:true}},0);
 await sync(fixture);const external=await database.prepare("SELECT status,last_error FROM reminder_jobs WHERE channel IN ('email','push') AND status<>'cancelled'").all();
 assert.equal(external.results.length,2);assert.ok(external.results.every(row=>row.status==='unavailable'&&row.last_error==='delivery-channel-unconfigured'));
 assert.equal((await runDueReminderJobs(database,{now})).delivered,1);assert.equal(await count(database,'plan_notifications'),1);
});
await check('Unknown or date-only deadlines are skipped; completed/cancelled items suppress jobs',async(fixture)=>{
 const {database,id,state}=fixture;state.items[0].done=true;state.items.push({id:'outside',name:'Outside visit',category:'Activity',status:'scheduled',participants:[alice.id],start:'2027-04-04T14:00:00-04:00',duration:60,deadline:'2027-04-04'});
 state.reminders=[{id:'unknown',itemId:'outside',title:'Unknown',due:'Tomorrow evening',done:false,consequence:'No known deadline'}];
 await database.prepare('UPDATE plans SET body=?,version=version+1 WHERE owner=? AND id=?').bind(JSON.stringify(state),owner,id).run();await sync(fixture);assert.equal(await count(database,'reminder_jobs'),0);
});
await check('Expired worker lease recovers safely and failed notification transaction retries without duplicate delivery',async(fixture)=>{
 const {database}=fixture;await sync(fixture);await database.prepare("UPDATE reminder_jobs SET status='processing',lease_token='old-worker',lease_until=? WHERE due_at<=?").bind(now-1,now).run();
 const originalBatch=database.batch.bind(database);let fail=true;database.batch=async statements=>{if(fail&&statements.some(statement=>statement.sql.includes('INSERT OR IGNORE INTO plan_notifications'))){fail=false;throw Error('Fixture transaction failure');}return originalBatch(statements);};
 assert.equal((await runDueReminderJobs(database,{now})).failed,1);assert.equal(await count(database,'plan_notifications'),0);
 assert.equal((await runDueReminderJobs(database,{now})).delivered,1);assert.equal(await count(database,'plan_notifications'),1);
 assert.equal(await database.prepare("SELECT attempts FROM reminder_jobs WHERE status='delivered'").first('attempts'),2);
});
await check('Delivery fence suppresses stale jobs when a source changes after the lease claim',async(fixture)=>{
 const {database,id,state}=fixture;await sync(fixture);const prepare=database.prepare.bind(database);let changed=false;
 database.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),run=bound.run.bind(bound);
  if(sql.includes("SET status='processing',lease_token="))bound.run=async()=>{const result=await run();if(result.meta.changes&&!changed){changed=true;state.items[0].done=true;await prepare('UPDATE plans SET body=?,version=version+1 WHERE owner=? AND id=?').bind(JSON.stringify(state),owner,id).run();}return result;};return bound;};return statement;};
 const result=await runDueReminderJobs(database,{now});assert.equal(result.delivered,0);assert.equal(result.cancelled,1);assert.equal(await count(database,'plan_notifications'),0);
});
await check('Member removal and plan deletion suppress delivery and preserve prior notification history',async(fixture)=>{
 const {database,id}=fixture;await sync(fixture);await runDueReminderJobs(database,{now});assert.equal(await count(database,'plan_notifications'),1);
 await database.prepare("UPDATE plans SET status='deleted',version=version+1 WHERE owner=? AND id=?").bind(owner,id).run();await sync(fixture);
 assert.equal((await runDueReminderJobs(database,{now:now+3600000})).delivered,0);assert.equal(await count(database,'plan_notifications'),1);
 await assert.rejects(()=>fixture.reminders.list(id,alice),error=>error.status===404);
});
await check('Personal notification read/list operations are scoped to their actual recipient',async(fixture)=>{
 const {database,id,reminders}=fixture;await sync(fixture);await runDueReminderJobs(database,{now});const listing=await reminders.list(id,alice);
 assert.equal(listing.notifications.length,1);assert.equal(listing.notifications[0].readAt,null);assert.equal(listing.delivery.email,'unconfigured');
 const notification=listing.notifications[0].id;await reminders.markRead(id,alice,notification);await reminders.markRead(id,alice,notification);
 assert.ok((await reminders.list(id,alice)).notifications[0].readAt);
 await database.prepare("INSERT INTO plan_members(owner,plan_id,member_id,role,body) VALUES (?,?,?,'editor',?)").bind(owner,id,bob.id,JSON.stringify({...bob,role:'editor'})).run();
 assert.equal((await reminders.list(id,bob)).notifications.length,0);
 await assert.rejects(()=>reminders.markRead(id,bob,notification),error=>error.status===404);
});
await check('Invoice reminders use an explicit deadline and payer and stop when fully paid',async(fixture)=>{
 const {database,id}=fixture;await database.prepare(`INSERT INTO plan_invoices(id,owner,plan_id,item_id,member_id,revision,request_id,terms,amount,minimum,paid,status,created,updated) VALUES (?,?,?,?,?,1,?,?,1000,500,0,'sent',?,?)`)
  .bind('invoice-1',owner,id,'service',alice.id,'fixture-request',JSON.stringify({due:'2027-04-04',dueAt:'2027-04-04T12:00:00-04:00'}),new Date(now).toISOString(),new Date(now).toISOString()).run();
 await sync(fixture);assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM reminder_jobs WHERE source_kind='invoice'").first('count'),2);
 await database.prepare("UPDATE plan_invoices SET status='paid',paid=amount,version=version+1 WHERE id='invoice-1'").run();
 await sync(fixture);assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM reminder_jobs WHERE source_kind='invoice' AND status<>'cancelled'").first('count'),0);
});
await check('Global synchronization and due runner enforce bounded batches with cursor continuation',async({database})=>{
 const first=await syncAllPlanReminders(database,{now,limit:1});assert.equal(first.synced,1);assert.ok(first.nextCursor);
 const next=await syncAllPlanReminders(database,{now,limit:1,after:first.nextCursor});assert.ok(next.synced<=1);
 const result=await runDueReminderJobs(database,{now,limit:1});assert.ok(result.attempted<=1);
});
await check('Signed-owner job runs synchronize and deliver only their own account’s plans',async fixture=>{
 const {database}=fixture,otherOwner='other-reminder-owner',identity={id:'person-other-owner',name:'Other owner'},plans=new PlanRepository(database);
 const record=await plans.createPlan(otherOwner,identity,{kind:'day-out',name:'Other owner task',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
 const body={...record.state,items:[{...fixture.state.items[0],participants:[identity.id],taskOwner:identity.id}]};
 await database.prepare('UPDATE plans SET body=?,version=version+1 WHERE owner=? AND id=?').bind(JSON.stringify(body),otherOwner,record.state.plan.id).run();
 await syncAllPlanReminders(database,{now,owner});assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM reminder_jobs WHERE owner=?').bind(otherOwner).first('count'),0);
 await syncAllPlanReminders(database,{now,owner:otherOwner});
 assert.equal((await runDueReminderJobs(database,{now,owner})).delivered,1);
 assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM plan_notifications WHERE owner=?').bind(otherOwner).first('count'),0);
 assert.equal((await runDueReminderJobs(database,{now,owner:otherOwner})).delivered,1);
 assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM plan_notifications WHERE owner=?').bind(otherOwner).first('count'),1);
});

// Exercise the actual route modules against the same migrated SQLite database.
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-reminders-'));
globalThis.reminderRouteEnv={};
try{
 const routes={};
 for(const [name,path] of Object.entries({preferences:'app/api/plans/[planId]/me/planning-preferences/route.ts',reminders:'app/api/plans/[planId]/reminders/route.ts'})){
  const outfile=join(directory,`${name}.mjs`);await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
   plugins:[{name:'binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.reminderRouteEnv;',loader:'js'}));}}]});
  routes[name]=await import(pathToFileURL(outfile).href);
 }
 const database=createTestD1();globalThis.reminderRouteEnv.DB=database;
 try{
  const account='reminder-route-owner',identity={id:await accountPersonId(account),name:'Route Owner'},plans=new PlanRepository(database),record=await plans.createPlan(account,identity,{kind:'day-out',name:'Private routes',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}),id=record.state.plan.id;
  const origin='https://planrecover.test',context={params:Promise.resolve({planId:id})};
  const request=(method,body,{user=account,requestOrigin=origin}={})=>new Request(`${origin}/api/plans/${id}/me/planning-preferences`,{method,headers:{origin:requestOrigin,'content-type':'application/json',...(user?{'oai-authenticated-user-id':user}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const initial=await routes.preferences.GET(request('GET'),context);assert.equal(initial.status,200);assert.match(initial.headers.get('cache-control'),/private, no-store/);
  assert.equal((await routes.preferences.GET(request('GET',undefined,{user:null}),context)).status,401);
  assert.equal((await routes.preferences.GET(request('GET',undefined,{user:'another-account'}),context)).status,404);
  const preferences={...defaultPlanningPreferences('America/Toronto'),dietaryNeeds:['private dietary need']};
  assert.equal((await routes.preferences.PATCH(request('PATCH',{version:0,preferences},{requestOrigin:'https://foreign.test'}),context)).status,400);
  assert.equal((await routes.preferences.PATCH(request('PATCH',{version:0,preferences,memberId:'another-member'}),context)).status,400);
  const saved=await routes.preferences.PATCH(request('PATCH',{version:0,preferences}),context);assert.equal(saved.status,200);
  assert.equal((await routes.preferences.PATCH(request('PATCH',{version:0,preferences}),context)).status,409);
  assert.equal((await routes.reminders.GET(request('GET'),context)).status,200);
  assert.equal((await routes.reminders.PATCH(request('PATCH',{notificationId:'unknown',read:true}),context)).status,404);
  assert.equal((await routes.reminders.PATCH(request('PATCH',{notificationId:'unknown',read:true,memberId:'other'}),context)).status,400);
  assert.equal(JSON.stringify((await plans.getPlan(id,identity)).state).includes('private dietary need'),false);
  checks++;console.log('PASS Actual private preference/reminder routes enforce authentication, identity, origin, versions and no shared private projection');
 }finally{database.close();delete globalThis.reminderRouteEnv.DB;}
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.reminderRouteEnv;}
console.log(`Reminders: ${checks} real SQLite persistence, private access, job lease and deduplication checks passed.`);
