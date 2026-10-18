import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
import {applyAction} from '../lib/model.ts';
import {PlanningPreferencesRepository,defaultPlanningPreferences} from '../lib/planning-constraints.ts';
import {syncPlanReminders,reminderDeliveryConfiguration} from '../lib/reminder-jobs.ts';
import {runExternalReminderJobs,saveNotificationDestination} from '../lib/notification-adapter.ts';
import {sesEmailConfig,sendSesEmail} from '../lib/ses-email.ts';

const owner='ses-fixture-owner',alice={id:await accountPersonId(owner),name:'Alice'},now=Date.parse('2027-04-04T13:00:00Z');
const settings={AWS_SES_ENABLED:'true',AWS_SES_REGION:'ca-central-1',AWS_SES_FROM_EMAIL:'reminders@example.test',AWS_SES_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),AWS_SES_SECRET_ACCESS_KEY:'s'.repeat(40)};
let checks=0;
async function setup(){const database=createTestD1(),plans=new PlanRepository(database),record=await plans.createPlan(owner,alice,{kind:'day-out',name:'SES test',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:10000}),planId=record.state.plan.id;
 let state=await plans.loadWorkspace(owner);state=applyAction(state,{type:'add_item',actor:alice.id,name:'Pack rain gear',category:'Preparation',start:'2027-04-04T09:00:00-04:00',duration:15,price:0,participants:[alice.id],taskOwner:alice.id});await plans.saveWorkspace(owner,state,state.version);
 const preferences=new PlanningPreferencesRepository(database),pref={...defaultPlanningPreferences('America/Toronto'),leadMinutes:[0],delivery:{inApp:false,email:true,push:false}};
 await preferences.update(planId,alice,pref,0);await saveNotificationDestination(database,planId,alice,{channel:'email',destination:'alice@example.test',version:0,confirm:true},'alice@example.test');
 await syncPlanReminders(database,owner,{plan:{id:planId}},{now});return {database,plans,planId,preferences,pref};
}
async function check(name,run){const fixture=await setup();try{await run(fixture);checks++;console.log('PASS '+name);}finally{fixture.database.close();}}
const attempts=database=>database.sqlite.prepare("SELECT * FROM adapter_operations WHERE provider='aws-ses' ORDER BY created,id").all();
const job=database=>database.sqlite.prepare("SELECT * FROM reminder_jobs WHERE channel='email'").get();
const accepted=()=>Response.json({MessageId:'SES-fixture-message-1'});
const run=(database,fetch,at=now,extra={})=>runExternalReminderJobs(database,{...settings,...extra},owner,{now:at,fetch});

await check('SES config is explicit, independent of Bedrock, region-pinned and sanitized',async({database})=>{
 assert.equal(sesEmailConfig({AWS_BEARER_TOKEN_BEDROCK:'private-bedrock-value'}),null);
 assert.equal(sesEmailConfig({...settings,AWS_SES_ENABLED:'false'}),null);
 assert.equal(reminderDeliveryConfiguration(settings).email,'configured');assert.equal(reminderDeliveryConfiguration(settings).push,'unconfigured');
 for(const change of [{AWS_SES_REGION:'ca-central-1.attacker.example'},{AWS_SES_FROM_EMAIL:'sender@example.test\r\nBcc:someone@example.test'},{AWS_SES_ACCESS_KEY_ID:'private-invalid-id'},{AWS_SES_SECRET_ACCESS_KEY:'private-invalid-secret'},{AWS_SES_SESSION_TOKEN:'private\nvalue'},{AWS_SES_CONFIGURATION_SET:'https://attacker.example'}]){
  assert.throws(()=>sesEmailConfig({...settings,...change}),error=>error.code==='SES_CONFIG'&&!error.message.includes('private')&&!error.message.includes('attacker'));
 }
 let calls=0;assert.equal((await runExternalReminderJobs(database,{...settings,AWS_SES_ENABLED:'false'},owner,{now,fetch:async()=>{calls++;return accepted();}})).configured,false);
 await assert.rejects(runExternalReminderJobs(database,{...settings,AWS_SES_SECRET_ACCESS_KEY:'invalid',NOTIFICATION_ORIGIN:'https://notify.example.com',NOTIFICATION_TOKEN:'fixture-token'},owner,{now,fetch:async()=>{calls++;return accepted();}}),error=>error.code==='SES_CONFIG');assert.equal(calls,0);
});

await check('Real migrated attempt is persisted before correctly signed SES v2 email and acceptance is safely replayed',async({database})=>{
 let calls=0;const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://email.ca-central-1.amazonaws.com/v2/email/outbound-emails');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers['Idempotency-Key'],undefined);assert.equal(attempts(database)[0].status,'sending');
  const payload=JSON.parse(init.body);assert.deepEqual(payload.Destination,{ToAddresses:['alice@example.test']});assert.equal(payload.FromEmailAddress,'reminders@example.test');assert.equal(payload.Content.Simple.Subject.Data,'Pack rain gear');assert.equal(payload.ConfigurationSetName,'reminder-events');assert.match(payload.EmailTags[0].Value,/^ses-[a-f0-9]{64}-1$/);
  const headers=Object.fromEntries(Object.entries(init.headers).filter(([key])=>key!=='Authorization')),names=Object.keys(headers).sort(),canonical=names.map(key=>key+':'+headers[key].trim()+'\n').join(''),hash=value=>createHash('sha256').update(value).digest('hex'),hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
  const day='20270404',date='20270404T130000Z',scope=day+'/ca-central-1/ses/aws4_request',request='POST\n/v2/email/outbound-emails\n\n'+canonical+'\n'+names.join(';')+'\n'+hash(init.body),key=hmac(hmac(hmac(hmac('AWS4'+settings.AWS_SES_SECRET_ACCESS_KEY,day),'ca-central-1'),'ses'),'aws4_request'),signature=hmac(key,'AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+hash(request)).toString('hex');
  assert.equal(init.headers.Authorization,`AWS4-HMAC-SHA256 Credential=${settings.AWS_SES_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`);assert.equal(init.headers['x-amz-security-token'],'fixture-session-token');return accepted();};
 const extra={AWS_SES_SESSION_TOKEN:'fixture-session-token',AWS_SES_CONFIGURATION_SET:'reminder-events',NOTIFICATION_ORIGIN:'https://generic.example.com',NOTIFICATION_TOKEN:'fixture-generic-token'};
 assert.equal((await run(database,fetcher,now,extra)).accepted,1);assert.equal(job(database).status,'delivered');assert.equal(attempts(database)[0].status,'completed');assert.equal(JSON.parse(attempts(database)[0].response).messageId,'SES-fixture-message-1');
 database.sqlite.prepare("UPDATE reminder_jobs SET status='unavailable',attempts=0,updated='2020-01-01T00:00:00Z' WHERE channel='email'").run();assert.equal((await run(database,fetcher,now+61000,extra)).accepted,1);assert.equal(calls,1);assert.equal(attempts(database).length,1);
 const persisted=JSON.stringify(attempts(database));for(const secret of [settings.AWS_SES_ACCESS_KEY_ID,settings.AWS_SES_SECRET_ACCESS_KEY,'fixture-session-token','alice@example.test','reminders@example.test','fixture-generic-token'])assert.ok(!persisted.includes(secret),secret);
});

await check('An uncertain send or malformed success never automatically sends the reminder again',async({database})=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('timeout containing '+settings.AWS_SES_SECRET_ACCESS_KEY);};
 const first=await run(database,fetcher);assert.equal(first.manualReview,1);assert.equal(attempts(database)[0].status,'uncertain');assert.equal(job(database).last_error,'ses-result-uncertain');
 await run(database,fetcher,now+61000);assert.equal(calls,1);assert.equal(attempts(database).length,1);assert.ok(!JSON.stringify(attempts(database)).includes(settings.AWS_SES_SECRET_ACCESS_KEY));
});

await check('Disabling SES cannot resend an uncertain prior email through the generic provider fallback',async({database})=>{
 let calls=0;await run(database,async()=>{calls++;throw Error('Ambiguous SES result');});
 const fallback={AWS_SES_ENABLED:'false',NOTIFICATION_ORIGIN:'https://generic.example.com',NOTIFICATION_TOKEN:'fixture-token'};
 const result=await runExternalReminderJobs(database,fallback,owner,{now:now+61000,fetch:async()=>{calls++;throw Error('Generic fallback must not resend');}});
 assert.equal(calls,1);assert.equal(result.manualReview,1);assert.equal(job(database).last_error,'ses-provider-change-needs-review');
});

await check('Enabling SES cannot replay an earlier generic email attempt with unknown acceptance',async({database})=>{
 let calls=0;const generic={NOTIFICATION_ORIGIN:'https://generic.example.com',NOTIFICATION_TOKEN:'fixture-token'};
 await runExternalReminderJobs(database,generic,owner,{now,fetch:async()=>{calls++;throw Error('Unknown generic acceptance');}});assert.equal(job(database).attempts,1);assert.equal(attempts(database).length,0);
 const result=await run(database,async()=>{calls++;return accepted();},now+61000);assert.equal(calls,1);assert.equal(result.manualReview,1);assert.equal(job(database).last_error,'ses-prior-provider-attempt-needs-review');assert.equal(attempts(database).length,0);
});

for(const [name,response] of [['malformed success',()=>Response.json({})],['unrecognized provider failure',()=>Response.json({message:'private upstream detail'},{status:500})],['oversized response',()=>new Response('x'.repeat(17000),{status:200})]])await check(name+' retains uncertainty instead of resending',async({database})=>{
 let calls=0;const fetcher=async()=>{calls++;return response();};await run(database,fetcher);await run(database,fetcher,now+61000);assert.equal(calls,1);assert.equal(attempts(database)[0].status,'uncertain');assert.ok(!JSON.stringify(attempts(database)).includes('private upstream detail'));
});

await check('Only documented definite nonacceptance may retry, with separate durable records and a three-attempt bound',async({database})=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({message:'quota details stay private'},{status:429,headers:{'x-amzn-errortype':'TooManyRequestsException'}});};
 for(let i=0;i<4;i++)await run(database,fetcher,now+i*61000);assert.equal(calls,3);assert.equal(attempts(database).length,3);assert.ok(attempts(database).every(row=>row.status==='rejected'&&JSON.parse(row.response).retryable===true));assert.equal(job(database).last_error,'ses-retry-limit');
});

await check('Rejected configuration or content cannot enter an automatic resend loop',async({database})=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({message:'private SES account diagnostic'},{status:400,headers:{'x-amzn-errortype':'MailFromDomainNotVerifiedException'}});};await run(database,fetcher);await run(database,fetcher,now+61000);assert.equal(calls,1);assert.equal(attempts(database)[0].status,'rejected');assert.ok(!JSON.stringify(attempts(database)).includes('private SES account diagnostic'));
});

await check('Concurrent runners and an expired sending lease never authorize a second SES request',async({database})=>{
 let release,started;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let calls=0;
 const fetcher=async()=>{calls++;started();await pending;return accepted();},first=run(database,fetcher);await entered;
 const other=await run(database,fetcher,now+61000);assert.equal(other.manualReview,1);assert.equal(calls,1);release();await first;
 assert.equal(attempts(database)[0].status,'completed');await run(database,fetcher,now+122000);assert.equal(calls,1);assert.equal(job(database).status,'delivered');
});

for(const target of ['acceptance-evidence','job-projection'])await check(target+' storage failure after SES acceptance cannot trigger a duplicate send',async({database})=>{
 const prepare=database.prepare.bind(database);let fail=true,calls=0;
 database.prepare=sql=>{const statement=prepare(sql),matching=target==='acceptance-evidence'?sql.startsWith("UPDATE adapter_operations SET status='completed'"):sql.startsWith("UPDATE reminder_jobs SET status='delivered'");if(matching){const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),execute=bound.run.bind(bound);bound.run=async()=>{if(fail){fail=false;throw Error('Fixture storage interruption');}return execute();};return bound;};}return statement;};
 const fetcher=async()=>{calls++;return accepted();};await run(database,fetcher);await run(database,fetcher,now+61000);assert.equal(calls,1);
 assert.equal(attempts(database)[0].status,target==='acceptance-evidence'?'uncertain':'completed');assert.equal(JSON.parse(attempts(database)[0].response).messageId,'SES-fixture-message-1');if(target==='job-projection')assert.equal(job(database).status,'delivered');
});

for(const change of ['opt-out','deleted-plan','removed-member','changed-destination'])await check(change+' between durable reservation and dispatch suppresses the external call',async({database,planId,preferences,pref})=>{
 const prepare=database.prepare.bind(database);let changed=false;
 database.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT OR IGNORE INTO adapter_operations')){const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),execute=bound.run.bind(bound);bound.run=async()=>{const result=await execute();if(!changed&&result.meta.changes){changed=true;if(change==='opt-out')await preferences.update(planId,alice,{...pref,delivery:{inApp:false,email:false,push:false}},1);if(change==='deleted-plan')await prepare("UPDATE plans SET status='deleted' WHERE owner=? AND id=?").bind(owner,planId).run();if(change==='removed-member')await prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").bind(owner,planId,alice.id).run();if(change==='changed-destination')await prepare('UPDATE notification_destinations SET version=version+1,destination=? WHERE owner=? AND plan_id=? AND member_id=?').bind('new@example.test',owner,planId,alice.id).run();}return result;};return bound;};}return statement;};
 let calls=0;await run(database,async()=>{calls++;return accepted();});assert.equal(calls,0);assert.equal(attempts(database)[0].status,'cancelled');
});

await check('Membership, explicit opt-in, signed-in destination verification and owner scope precede attempts',async({database,planId,preferences,pref})=>{
 await assert.rejects(saveNotificationDestination(database,planId,alice,{channel:'email',destination:'another@example.test',version:1,confirm:true},'alice@example.test'),error=>error.code==='NOTIFICATION_RECIPIENT');
 await assert.rejects(saveNotificationDestination(database,planId,{id:'outsider',name:'Outsider'},{channel:'email',destination:'outside@example.test',version:0,confirm:true},'outside@example.test'));
 let calls=0;const fetcher=async()=>{calls++;return accepted();};assert.equal((await runExternalReminderJobs(database,settings,'other-owner',{now,fetch:fetcher})).attempted,0);
 await preferences.update(planId,alice,{...pref,delivery:{inApp:false,email:false,push:false}},1);await run(database,fetcher);assert.equal(calls,0);assert.equal(attempts(database).length,0);
});

await check('The signed request rechecks eligibility immediately before dispatch',async()=>{
 let calls=0;await assert.rejects(sendSesEmail(sesEmailConfig(settings),{destination:'alice@example.test',title:'Reminder',text:'Plan reminder',attemptId:'fixture-attempt'},{now:new Date(now),beforeSend:async()=>false,fetch:async()=>{calls++;return accepted();}}),error=>error.outcome==='not-sent');assert.equal(calls,0);
});
console.log(`SES email: ${checks} offline migration, signing, privacy and no-duplicate checks passed.`);
