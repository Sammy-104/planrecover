import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1,applyMigrations} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {applyAction} from '../lib/model.ts';
import {PlanningPreferencesRepository,defaultPlanningPreferences} from '../lib/planning-constraints.ts';
import {syncPlanReminders} from '../lib/reminder-jobs.ts';
import {saveNotificationDestination} from '../lib/notification-adapter.ts';
import {ControlledReminderEmailService} from '../lib/controlled-reminder-email.ts';
import {sesDigest} from '../lib/ses-email.ts';

const owner='controlled-email-owner',email='owner@example.test',alice={id:await accountPersonId(owner),name:'Owner'};
const bob={id:await accountPersonId('controlled-editor'),name:'Editor'},viewer={id:await accountPersonId('controlled-viewer'),name:'Viewer'};
const fixed=Date.parse('2027-04-04T13:00:00Z'),origin='https://planrecover.test';let checks=0;
const baseSettings={AWS_SES_ENABLED:'false',WEB_PUSH_ENABLED:'false',AWS_SES_REGION:'ca-central-1',AWS_SES_FROM_EMAIL:'sender@example.test',
 AWS_SES_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),AWS_SES_SECRET_ACCESS_KEY:'s'.repeat(40),NOTIFICATION_ORIGIN:'https://never-call.example.test',NOTIFICATION_TOKEN:'fixture-only'};
const accepted=()=>Response.json({MessageId:'controlled-fixture-message'});
async function setup(){
 const database=createTestD1(),repository=new PlanRepository(database),created=await repository.createPlan(owner,alice,{name:'Controlled reminder acceptance',destination:'Toronto',
  start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}),planId=created.state.plan.id;
 let state=await repository.loadWorkspace(owner);addPerson(state,bob,'editor');addPerson(state,viewer,'viewer');
 for(let i=0;i<3;i++)state=applyAction(state,{type:'add_item',actor:alice.id,name:'Synthetic reminder '+i,category:'Preparation',
  start:'2027-04-04T09:00:00-04:00',duration:15,price:0,participants:[alice.id],taskOwner:alice.id});
 await repository.saveWorkspace(owner,state,state.version);
 const preferences=new PlanningPreferencesRepository(database),pref={...defaultPlanningPreferences('America/Toronto'),leadMinutes:[0],delivery:{inApp:true,email:false,push:false}};
 await preferences.update(planId,alice,pref,0);
 await saveNotificationDestination(database,planId,alice,{channel:'email',destination:email,version:0,confirm:true},email);
 await syncPlanReminders(database,owner,{plan:{id:planId}},{now:fixed});
 const job=database.sqlite.prepare("SELECT * FROM reminder_jobs WHERE channel='in-app' ORDER BY id LIMIT 1").get();
 // Other queued channels must remain completely untouched by a scoped copy.
 for(const channel of ['email','push'])database.sqlite.prepare(`INSERT INTO reminder_jobs(id,owner,plan_id,member_id,source_kind,source_type,source_id,source_due_at,title,body,timezone,lead_minutes,channel,due_at,plan_version,preferences_version,invoice_version,status,last_error,created,updated)
  SELECT ?,owner,plan_id,member_id,source_kind,source_type,source_id,source_due_at,title,body,timezone,lead_minutes,?,due_at,plan_version,preferences_version,invoice_version,'unavailable','fixture-unconfigured',created,updated FROM reminder_jobs WHERE id=?`)
  .run('other-queued-'+channel,channel,job.id);
 const grant={planId,reminderJobId:job.id,expiresAt:new Date(fixed+900000).toISOString(),grantId:'controlled-fixture-grant'};
 const settings={...baseSettings,AWS_SES_CONTROLLED_TEST:JSON.stringify(grant)},scope={planId,identity:alice,authenticatedEmail:email};
 const input={reminderJobId:job.id,planVersion:job.plan_version,preferencesVersion:job.preferences_version,destinationVersion:1,confirm:true};
 let now=fixed,calls=0,provider=async()=>accepted();
 const fetcher=async(url,init)=>{assert.equal(url,'https://email.ca-central-1.amazonaws.com/v2/email/outbound-emails','No other provider or owner job may run.');calls++;return provider(url,init);};
 const service=new ControlledReminderEmailService(database,settings,{now:()=>now,fetch:fetcher});
 const originalJobs=database.sqlite.prepare('SELECT * FROM reminder_jobs ORDER BY id').all(),originalPreferences=database.sqlite.prepare('SELECT * FROM member_planning_preferences ORDER BY member_id').all();
 const unchanged=()=>{assert.deepEqual(database.sqlite.prepare('SELECT * FROM reminder_jobs ORDER BY id').all(),originalJobs);
  assert.deepEqual(database.sqlite.prepare('SELECT * FROM member_planning_preferences ORDER BY member_id').all(),originalPreferences);
  assert.equal(settings.AWS_SES_ENABLED,'false');assert.equal(settings.WEB_PUSH_ENABLED,'false');
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM background_job_runs').get().n,0);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n,0);};
 const attempts=()=>database.sqlite.prepare("SELECT * FROM adapter_operations WHERE kind='controlled-self-test' ORDER BY id").all();
 return {database,repository,planId,preferences,pref,job,grant,settings,scope,input,service,unchanged,attempts,
  now:value=>{now=value;},calls:()=>calls,provider:value=>{provider=value;},fetcher};
}
async function check(name,run){const t=await setup();try{await run(t);checks++;console.log('PASS '+name);}finally{t.database.close();}}

await check('Default, invalid, expired, excessive, mismatched and normally enabled grants cannot send',async t=>{
 for(const invalid of [undefined,'not-json',JSON.stringify({...t.grant,planId:'another-plan'}),JSON.stringify({...t.grant,expiresAt:new Date(fixed-1).toISOString()}),
  JSON.stringify({...t.grant,expiresAt:new Date(fixed+3600001).toISOString()}),JSON.stringify({...t.grant,recipient:'arbitrary@example.test'})]){
  t.settings.AWS_SES_CONTROLLED_TEST=invalid;assert.equal((await t.service.preview(t.scope)).available,false);await assert.rejects(t.service.send(t.scope,t.input),e=>e.code==='SES_CONTROLLED_TEST_UNAVAILABLE');
 }
 t.settings.AWS_SES_CONTROLLED_TEST=JSON.stringify(t.grant);t.settings.AWS_SES_ENABLED='true';
 await assert.rejects(t.service.send(t.scope,t.input),e=>e.code==='SES_CONTROLLED_TEST_UNAVAILABLE');assert.equal(t.calls(),0);assert.equal(t.attempts().length,0);
});
await check('Missing, boolean and malformed disable flags cannot enable a controlled or generic send',async t=>{
 for(const flag of [undefined,false,true,'TRUE','FALSE','disabled','']){
  t.settings.AWS_SES_ENABLED=flag;assert.equal((await t.service.preview(t.scope)).available,false);
  await assert.rejects(t.service.send(t.scope,t.input),e=>e.code==='SES_CONTROLLED_TEST_UNAVAILABLE');
 }
 assert.equal(t.calls(),0);assert.equal(t.attempts().length,0);
});
await check('Preview selects exactly one saved due reminder and discloses no credentials or grant secret',async t=>{
 const preview=await t.service.preview(t.scope);assert.equal(preview.reminder.id,t.job.id);assert.equal(preview.recipient,email);
 assert.deepEqual(preview.versions,{planVersion:t.input.planVersion,preferencesVersion:t.input.preferencesVersion,destinationVersion:1});
 assert.equal(preview.normalEmailEnabled,false);assert.equal(preview.inboxDelivery,'unverified');assert.equal(preview.attempt,undefined);
 for(const secret of [baseSettings.AWS_SES_ACCESS_KEY_ID,baseSettings.AWS_SES_SECRET_ACCESS_KEY,t.grant.grantId])assert.ok(!JSON.stringify(preview).includes(secret));
 assert.equal(t.calls(),0);t.unchanged();
});
await check('One signed SES copy is durably reserved, explicitly labelled, and never consumes any canonical reminder or opt-in',async t=>{
 t.provider(async(_url,init)=>{assert.equal(t.attempts().length,1);assert.equal(t.attempts()[0].status,'sending');
  const body=JSON.parse(init.body);assert.deepEqual(body.Destination,{ToAddresses:[email]});assert.match(body.Content.Simple.Subject.Data,/controlled reminder test/);
  assert.match(body.Content.Simple.Body.Text.Data,/one controlled email copy/);assert.match(body.Content.Simple.Body.Text.Data,/original reminder are unchanged/);
  assert.match(init.headers.Authorization,/^AWS4-HMAC-SHA256 Credential=/);assert.equal(init.redirect,'manual');return accepted();});
 const first=await t.service.send(t.scope,t.input),replay=await t.service.send(t.scope,t.input);
 assert.equal(first.status,'accepted');assert.equal(first.accepted,true);assert.equal(first.inboxDelivery,'unverified');assert.equal(first.reused,false);
 assert.equal(replay.reused,true);assert.equal(replay.messageId,first.messageId);assert.equal(t.calls(),1);assert.equal(t.attempts().length,1);
 assert.equal((await t.service.preview(t.scope)).attempt.status,'accepted');t.unchanged();
 const persisted=JSON.stringify(t.attempts());for(const secret of [email,baseSettings.AWS_SES_FROM_EMAIL,baseSettings.AWS_SES_ACCESS_KEY_ID,baseSettings.AWS_SES_SECRET_ACCESS_KEY,'fixture-only'])assert.ok(!persisted.includes(secret));
});
for(const [name,response,expected]of [['uncertain timeout',()=>{throw Error('private-provider-detail');},'uncertain'],['known throttle rejection',()=>Response.json({}, {status:429,headers:{'x-amzn-errortype':'TooManyRequestsException'}}),'rejected'],
 ['known content rejection',()=>Response.json({}, {status:400,headers:{'x-amzn-errortype':'MessageRejected'}}),'rejected'],['malformed success',()=>Response.json({}),'uncertain']]){
 await check(name+' never retries, including after rotating the private grant',async t=>{
  t.provider(response);const first=await t.service.send(t.scope,t.input);assert.equal(first.status,expected);
  await t.service.send(t.scope,t.input);t.now(fixed+60000);t.settings.AWS_SES_CONTROLLED_TEST=JSON.stringify({...t.grant,grantId:'rotated-grant',expiresAt:new Date(fixed+960000).toISOString()});
  await assert.rejects(t.service.send(t.scope,t.input),e=>e.code==='SES_CONTROLLED_TEST_CHANGED');assert.equal(t.calls(),1);assert.equal(t.attempts().length,1);
  assert.equal((await t.service.preview(t.scope)).attempt.status,expected);assert.ok(!JSON.stringify(t.attempts()).includes('private-provider-detail'));t.unchanged();
 });
}
await check('Accepted copies cannot be reset by a new grant ID or a changed expiry',async t=>{
 await t.service.send(t.scope,t.input);t.settings.AWS_SES_CONTROLLED_TEST=JSON.stringify({...t.grant,grantId:'new-id',expiresAt:new Date(fixed+1000000).toISOString()});
 await assert.rejects(t.service.send(t.scope,t.input),e=>e.code==='SES_CONTROLLED_TEST_CHANGED');assert.equal(t.calls(),1);t.unchanged();
});
await check('Concurrent requests reserve one immutable attempt and an expired lease never authorizes another POST',async t=>{
 let release,entered;const pending=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});t.provider(async()=>{entered();await pending;return accepted();});
 const first=t.service.send(t.scope,t.input);await started;const concurrent=await t.service.send(t.scope,t.input);assert.equal(concurrent.status,'pending');
 t.now(fixed+31000);const expired=await t.service.send(t.scope,t.input);assert.equal(expired.status,'uncertain');release();const completed=await first;
 assert.equal(completed.status,'accepted');assert.equal(completed.messageId,'controlled-fixture-message');
 assert.equal(JSON.parse(t.attempts()[0].response).messageId,'controlled-fixture-message');
 assert.equal(t.calls(),1);assert.equal(t.attempts().length,1);await t.service.send(t.scope,t.input);assert.equal(t.calls(),1);t.unchanged();
});
await check('Removing the private grant retains an owner-only coarse outcome without permitting another send',async t=>{
 await t.service.send(t.scope,t.input);delete t.settings.AWS_SES_CONTROLLED_TEST;
 const value=await t.service.preview(t.scope);assert.equal(value.available,false);assert.equal(value.lastAttempt.status,'accepted');
 assert.equal(value.lastAttempt.messageId,'controlled-fixture-message');
 for(const field of ['recipient','reminder','versions','expiresAt','normalEmailEnabled'])assert.equal(field in value,false);
 const text=JSON.stringify(value);for(const privateValue of [email,t.job.title,t.job.body,t.grant.grantId])assert.ok(!text.includes(privateValue));
 await assert.rejects(t.service.preview({...t.scope,identity:bob}),e=>e.status===403);
 await assert.rejects(t.service.send(t.scope,t.input),e=>e.code==='SES_CONTROLLED_TEST_UNAVAILABLE');assert.equal(t.calls(),1);t.unchanged();
});
await check('Email identity, owner role, target job and exact version tuple precede any durable attempt',async t=>{
 for(const scope of [{...t.scope,authenticatedEmail:null},{...t.scope,authenticatedEmail:'another@example.test'},
  {...t.scope,identity:bob,authenticatedEmail:email},{...t.scope,identity:viewer,authenticatedEmail:email}])await assert.rejects(t.service.send(scope,t.input));
 for(const change of [{reminderJobId:'another-job'},{planVersion:t.input.planVersion+1},{preferencesVersion:2},{destinationVersion:2},{confirm:false}])
  await assert.rejects(t.service.send(t.scope,{...t.input,...change}),e=>e.code==='SES_CONTROLLED_TEST_CHANGED');
 assert.equal(t.calls(),0);assert.equal(t.attempts().length,0);t.unchanged();
});
await check('Only an already due current in-app job can be copied',async t=>{
 for(const changed of [{reminderJobId:'other-queued-email'},{reminderJobId:'other-queued-push'}]){t.settings.AWS_SES_CONTROLLED_TEST=JSON.stringify({...t.grant,...changed});await assert.rejects(t.service.preview(t.scope),e=>e.code==='SES_CONTROLLED_TEST_CHANGED');}
 t.settings.AWS_SES_CONTROLLED_TEST=JSON.stringify(t.grant);t.now(fixed-1);await assert.rejects(t.service.preview(t.scope),e=>e.code==='SES_CONTROLLED_TEST_CHANGED');
 assert.equal(t.calls(),0);assert.equal(t.attempts().length,0);
});
function afterReservation(t,change){const original=t.database.prepare.bind(t.database);let fired=false;t.database.prepare=sql=>{const statement=original(sql);
 if(!sql.startsWith('INSERT OR IGNORE INTO adapter_operations'))return statement;
 return {bind(...values){const bound=statement.bind(...values);return {run:async()=>{const result=await bound.run();if(!fired&&result.meta.changes){fired=true;await change();}return result;}};}};};return ()=>assert.equal(fired,true);}
for(const race of ['grant-expiry','source','preferences','destination','membership','suppression'])await check(race+' after reservation is checked before the SES dispatch',async t=>{
 const fired=afterReservation(t,async()=>{
  if(race==='grant-expiry')t.now(fixed+900001);
  if(race==='source')await t.repository.updatePlan(t.planId,alice,t.input.planVersion,{type:'task',actor:alice.id,itemId:t.job.source_id,done:true});
  if(race==='preferences')await t.preferences.update(t.planId,alice,{...t.pref,bufferMinutes:60},1);
  if(race==='destination')t.database.sqlite.prepare('UPDATE notification_destinations SET version=version+1,destination=? WHERE owner=? AND plan_id=?').run('changed@example.test',owner,t.planId);
  if(race==='membership')t.database.sqlite.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").run(owner,t.planId,alice.id);
  if(race==='suppression'){
   const id=t.attempts()[0].id;t.database.sqlite.prepare("INSERT INTO notification_delivery_events(id,attempt_id,owner,plan_id,member_id,provider_message_id,event_type,occurred_at,received_at,digest,reason) VALUES ('controlled-bounce',?,?,?,?,'fixture','bounce',?,?,'digest','hard-bounce')")
    .run(id,owner,t.planId,alice.id,new Date(fixed).toISOString(),new Date(fixed).toISOString());
   t.database.sqlite.prepare("INSERT INTO notification_suppressions(owner,destination_hash,reason,suppressed_until,event_id,updated) VALUES (?,?,'hard-bounce',NULL,'controlled-bounce',?)").run(owner,await sesDigest(email),new Date(fixed).toISOString());
  }
 });
 const value=await t.service.send(t.scope,t.input);fired();assert.equal(value.status,'not-sent');assert.equal(t.calls(),0);assert.equal(t.attempts().length,1);
});
await check('Failed acceptance storage retains uncertainty and cannot send a second copy',async t=>{
 const original=t.database.prepare.bind(t.database);let fail=true;t.database.prepare=sql=>{const statement=original(sql);
  if(!sql.startsWith("UPDATE adapter_operations SET status='completed'"))return statement;
  return {bind(...values){const bound=statement.bind(...values);return {run:async()=>{if(fail){fail=false;throw Error('Fixture storage interruption');}return bound.run();}};}};};
 const result=await t.service.send(t.scope,t.input);assert.equal(result.status,'uncertain');await t.service.send(t.scope,t.input);assert.equal(t.calls(),1);
 assert.equal(JSON.parse(t.attempts()[0].response).messageId,'controlled-fixture-message');t.unchanged();
});
await check('Migration enforces one retained immutable source even when a second operation ID is attempted',async t=>{
 await t.service.send(t.scope,t.input);const row=t.attempts()[0];
 assert.throws(()=>t.database.sqlite.prepare('UPDATE adapter_operations SET request=? WHERE id=?').run('{}',row.id),/immutable/);
 assert.throws(()=>t.database.sqlite.prepare('DELETE FROM adapter_operations WHERE id=?').run(row.id),/retained/);
 assert.throws(()=>t.database.sqlite.prepare('INSERT INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,status,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run('different-id',owner,t.planId,alice.id,'aws-ses','controlled-self-test',row.request,'sending','now','now'),/UNIQUE/);t.unchanged();
});
{
 const database=createTestD1({migrations:{through:'0024_bedrock_pricing.sql'}});try{
  database.sqlite.prepare("INSERT INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,status,created,updated) VALUES ('legacy','owner','plan','member','aws-ses','send-email','{}','uncertain','before','before')").run();
  const before=database.sqlite.prepare('SELECT * FROM adapter_operations').all();applyMigrations(database);assert.deepEqual(database.sqlite.prepare('SELECT * FROM adapter_operations').all(),before);
  checks++;console.log('PASS Additive controlled-test migration preserves all legacy provider attempts');
 }finally{database.close();}
}

// Exercise real authenticated route schemas separately from injected service fixtures.
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','controlled-reminder-route-'));
globalThis.controlledReminderEnv={};const actualNow=Date.now;Date.now=()=>fixed;
try{
 const output=join(directory,'route.mjs');await build({entryPoints:[resolve(root,'app/api/plans/[planId]/reminders/test-email/route.ts')],outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
  plugins:[{name:'controlled-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'controlled-fixture'}));b.onLoad({filter:/.*/,namespace:'controlled-fixture'},()=>({contents:'export const env=globalThis.controlledReminderEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(output).href);
 await check('Actual route enforces authentication, origin, owner scope, strict input and gateway email before any send',async t=>{
  Object.assign(globalThis.controlledReminderEnv,t.settings,{DB:t.database});let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://email.ca-central-1.amazonaws.com/v2/email/outbound-emails');return accepted();};
  const context={params:Promise.resolve({planId:t.planId})},request=(body,account=owner,headers={})=>new Request(`${origin}/api/plans/${t.planId}/reminders/test-email`,{method:body?'POST':'GET',headers:{origin,...(account?{'oai-authenticated-user-id':account,'oai-authenticated-user-email':email}:{}),'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await route.GET(request(undefined,null),context)).status,401);
  for(const account of ['controlled-editor','controlled-viewer'])assert.equal((await route.POST(request(t.input,account),context)).status,403);
  assert.equal((await route.POST(request(t.input,owner,{origin:'https://outside.test'}),context)).status,400);
  assert.equal((await route.POST(request({...t.input,to:'arbitrary@example.test'}),context)).status,400);
  assert.equal((await route.POST(request(t.input,owner,{'oai-authenticated-user-email':'another@example.test'}),context)).status,403);
  const preview=await route.GET(request(),context);assert.equal(preview.status,200);assert.match(preview.headers.get('cache-control'),/private, no-store/);
  const sent=await route.POST(request(t.input),context);assert.equal(sent.status,200);assert.equal((await sent.json()).status,'accepted');assert.equal(calls,1);
  await route.POST(request(t.input),context);assert.equal(calls,1);t.unchanged();
 });
}finally{Date.now=actualNow;delete globalThis.controlledReminderEnv;rmSync(directory,{recursive:true,force:true});}
console.log(`${checks} controlled self-reminder email checks passed: migrated SQLite, intercepted SES only, no live mail or normal-delivery activation.`);
