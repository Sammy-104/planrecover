import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {acquireAiLease} from '../lib/ai-usage.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','readiness-'));
const origin='https://planrecover.test',owner='readiness-owner-account',editorAccount='readiness-editor-account',viewerAccount='readiness-viewer-account';
const identity={id:await accountPersonId(owner),name:'Owner'},editor={id:await accountPersonId(editorAccount),name:'Editor'},viewer={id:await accountPersonId(viewerAccount),name:'Viewer'};
const configured={AWS_BEARER_TOKEN_BEDROCK:'fixture-sensitive-bedrock-key',BEDROCK_REGION:'us-east-1',BEDROCK_MODEL_ID:'fixture-private-model'};
let checks=0,calls=0,provider;
globalThis.readinessTestEnv={DB:undefined};
globalThis.fetch=async(url,init)=>{calls++;assert.match(String(url),/^https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\/model\//);return provider(url,init);};
const response=()=>Response.json({output:{message:{role:'assistant',content:[{text:'{"ok":true}'}]}},stopReason:'end_turn',usage:{inputTokens:20,outputTokens:5,totalTokens:25}});
const input=()=>({action:'check-bedrock',requestId:crypto.randomUUID(),confirm:true});
function request(planId,{method='GET',body,account=owner,requestOrigin=origin,contentType='application/json',raw,token}={}){
 return new Request(`${origin}/api/plans/${planId}/readiness`,{method,headers:{...(account?{'oai-authenticated-user-id':account}:{}),...(token?{'x-trip-share':token}:{}),...(method==='POST'?{'Content-Type':contentType,Origin:requestOrigin}:{})},...(method==='POST'?{body:raw??JSON.stringify(body===undefined?input():body)}:{})});
}
const context=planId=>({params:Promise.resolve({planId})});
async function decoded(result,status=200){const body=await result.json();assert.equal(result.status,status,JSON.stringify(body));assert.match(result.headers.get('Cache-Control')??'',/private, no-store/);return body;}
function noSecrets(value){const text=JSON.stringify(value);for(const secret of ['fixture-sensitive-bedrock-key','fixture-private-model','us-east-1','private-provider-body','fixture-paypal-secret','fixture-runner-secret','private-plan-name','secret-sensitive-destination'])assert.equal(text.includes(secret),false,secret);}

try{
 const outfile=join(directory,'readiness.mjs');await build({entryPoints:[resolve(root,'app/api/plans/[planId]/readiness/route.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'readiness-bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.readinessTestEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(outfile).href);
 async function check(name,run){const database=createTestD1(),repository=new PlanRepository(database);try{
  for(const key of Object.keys(globalThis.readinessTestEnv))delete globalThis.readinessTestEnv[key];Object.assign(globalThis.readinessTestEnv,{DB:database,...configured});calls=0;provider=async()=>response();
  const record=await repository.createPlan(owner,identity,{name:'private-plan-name',destination:'secret-sensitive-destination',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
  const state=await repository.loadWorkspace(owner);addPerson(state,editor,'editor');addPerson(state,viewer,'viewer');await repository.saveWorkspace(owner,state,state.version);
  const id=record.state.plan.id;await run({database,repository,id,get:options=>route.GET(request(id,options),context(id)),post:(body=input(),options={})=>route.POST(request(id,{method:'POST',body,...options}),context(id))});checks++;console.log('PASS '+name);
 }finally{database.close();}}

 await check('Owner-only inspection and tests reject anonymous users, unrelated accounts, editors, viewers and sharing links',async t=>{
  for(const method of ['get','post']){
   await decoded(await t[method](...(method==='get'?[{account:null}]:[input(),{account:null}])),401);
   await decoded(await t[method](...(method==='get'?[{account:editorAccount}]:[input(),{account:editorAccount}])),403);
   await decoded(await t[method](...(method==='get'?[{account:viewerAccount}]:[input(),{account:viewerAccount}])),403);
   await decoded(await t[method](...(method==='get'?[{account:'unrelated-account'}]:[input(),{account:'unrelated-account'}])),404);
  }
  const token='a'.repeat(64),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  await t.database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created) VALUES (?,?,?,?,?,?)').bind(hash,token,owner,t.id,'editor',new Date().toISOString()).run();
  await decoded(await t.get({token}),403);await decoded(await t.post(input(),{token}),403);assert.equal(calls,0);
  assert.equal(await t.database.prepare("SELECT COUNT(*) AS n FROM adapter_operations WHERE provider='bedrock-readiness'").first('n'),0);
 });
 await check('POST requires same origin, explicit confirmation, a UUID and a bounded strict JSON body',async t=>{
  await decoded(await t.post(input(),{requestOrigin:'https://other.example'}),403);
  for(const body of [{...input(),confirm:false},{action:'check-bedrock',confirm:true},{...input(),requestId:'invalid'},{...input(),prompt:'private-provider-body'},{...input(),action:'check-all'},null])await decoded(await t.post(body),400);
  await decoded(await t.post(input(),{raw:'{'}),400);await decoded(await t.post(input(),{raw:'x'.repeat(513)}),413);await decoded(await t.post(input(),{contentType:'text/plain'}),415);assert.equal(calls,0);
 });
 await check('GET validates missing/invalid configuration without disclosing values or making provider calls',async t=>{
  for(const key of Object.keys(configured))delete globalThis.readinessTestEnv[key];let body=await decoded(await t.get());
  assert.equal(body.services.bedrock.configuration,'missing');assert.equal(body.services.paypal.configuration,'missing');assert.equal(body.services.runner.configuration,'missing');
  Object.assign(globalThis.readinessTestEnv,{AWS_BEARER_TOKEN_BEDROCK:'fixture-sensitive-bedrock-key',BEDROCK_REGION:'bad-secret-region',PAYPAL_CLIENT_ID:'client',PAYPAL_CLIENT_SECRET:'bad secret',PAYPAL_WEBHOOK_ID:'bad secret',JOB_RUNNER_KEY:'short',SUPPLIER_ORIGIN:'https://token:private-provider-body@host.example',SUPPLIER_TOKEN:'supplier-token',SUPPLIER_MODE:'sandbox',NOTIFICATION_ORIGIN:'http://localhost',NOTIFICATION_TOKEN:'notification-token'});
  body=await decoded(await t.get());for(const service of Object.values(body.services))assert.equal(service.configuration,'invalid');noSecrets(body);
  const failure=await decoded(await t.post(),503);noSecrets(failure);assert.equal(calls,0);assert.equal(await t.database.prepare('SELECT COUNT(*) AS n FROM ai_usage_limits').first('n'),0);
 });
 await check('Configured services remain unverified and a saved manual runner completion never proves an unattended schedule',async t=>{
  Object.assign(globalThis.readinessTestEnv,{PAYPAL_CLIENT_ID:'fixture-client',PAYPAL_CLIENT_SECRET:'fixture-paypal-secret',PAYPAL_WEBHOOK_ID:'WEBHOOK-123',JOB_RUNNER_KEY:'fixture-runner-secret',SUPPLIER_ORIGIN:'https://supplier.example.com',SUPPLIER_TOKEN:'supplier-token',SUPPLIER_MODE:'sandbox',NOTIFICATION_ORIGIN:'https://notify.example.com',NOTIFICATION_TOKEN:'notification-token'});
  await t.database.prepare("INSERT INTO background_job_runs(owner,status,last_completed) VALUES (?,'completed',?)").bind(owner,new Date().toISOString()).run();const body=await decoded(await t.get());
  assert.equal(body.configurationIsNotVerification,true);for(const service of Object.values(body.services)){assert.equal(service.configuration,'configured');assert.equal(service.verification,'unverified');}
  assert.equal(body.services.runner.lastObservedRun.status,'completed');assert.equal(body.services.bedrock.lastCheck,null);noSecrets(body);assert.equal(calls,0);
 });
 await check('Explicit SES configuration is inspected without sending and invalid SES cannot silently claim generic email readiness',async t=>{
  Object.assign(globalThis.readinessTestEnv,{AWS_SES_ENABLED:'true',NOTIFICATION_ORIGIN:'https://notify.example.com',NOTIFICATION_TOKEN:'notification-token'});
  let body=await decoded(await t.get());assert.equal(body.services.notifications.configuration,'invalid');assert.equal(body.services.notifications.channels.email.configuration,'invalid');assert.equal(body.services.notifications.channels.email.provider,'amazon-ses');assert.equal(body.services.notifications.channels.push.configuration,'configured');
  Object.assign(globalThis.readinessTestEnv,{AWS_SES_REGION:'ca-central-1',AWS_SES_FROM_EMAIL:'sender@example.com',AWS_SES_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),AWS_SES_SECRET_ACCESS_KEY:'A'.repeat(40)});
  delete globalThis.readinessTestEnv.NOTIFICATION_ORIGIN;delete globalThis.readinessTestEnv.NOTIFICATION_TOKEN;
  body=await decoded(await t.get());assert.equal(body.services.notifications.configuration,'configured');assert.equal(body.services.notifications.channels.email.configuration,'configured');assert.equal(body.services.notifications.channels.email.verification,'unverified');assert.equal(body.services.notifications.channels.push.configuration,'missing');
  const text=JSON.stringify(body);for(const secret of ['sender@example.com','AKIA'+'A'.repeat(16),'A'.repeat(40),'ca-central-1'])assert.equal(text.includes(secret),false);assert.equal(calls,0);
 });
 await check('One tiny synthetic JSON call persists coarse counts/timestamps and replay never repeats inference or changes plan facts',async t=>{
  const before=await t.repository.loadWorkspace(owner),checksBefore=await t.database.prepare('SELECT COUNT(*) AS n FROM financial_events').first('n');
  provider=async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.inferenceConfig.maxTokens,128);assert.equal(body.messages.length,1);assert.equal(body.messages[0].content.length,1);assert.ok(JSON.stringify(body).length<1000);noSecrets(body);return response();};
  const body=input(),result=await decoded(await t.post(body));assert.equal(calls,1);assert.equal(result.duplicate,false);assert.equal(result.check.status,'passed');assert.equal(result.check.scope,'synthetic-json-converse');assert.deepEqual(result.check.usage,{inputTokens:20,outputTokens:5,totalTokens:25});assert.ok(result.check.completedAt);assert.equal(result.readiness.services.bedrock.verification,'passed');assert.equal(result.readiness.services.bedrock.fullWorkflowVerification,'unverified');noSecrets(result);
  const saved=await t.database.prepare("SELECT request,response FROM adapter_operations WHERE provider='bedrock-readiness'").first();noSecrets(saved);assert.match(JSON.parse(saved.request).configurationHash,/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(saved.response),{version:1,outcome:'passed',usage:{inputTokens:20,outputTokens:5,totalTokens:25}});
  const replay=await decoded(await t.post(body));assert.equal(replay.duplicate,true);assert.deepEqual(replay.check,result.check);await decoded(await t.get());assert.equal(calls,1);
  assert.deepEqual(await t.repository.loadWorkspace(owner),before);assert.equal(await t.database.prepare('SELECT COUNT(*) AS n FROM financial_events').first('n'),checksBefore);
 });
 await check('Provider failure is coarse, persisted and replayable; current configuration changes invalidate old successful verification',async t=>{
  provider=async()=>new Response('private-provider-body',{status:403});const requestBody=input(),failed=await decoded(await t.post(requestBody));assert.equal(failed.check.status,'failed');assert.equal(failed.check.outcome,'access-denied');assert.equal(failed.check.usage,null);noSecrets(failed);
  assert.equal((await decoded(await t.post(requestBody))).duplicate,true);assert.equal(calls,1);noSecrets(await t.database.prepare('SELECT request,response FROM adapter_operations').all());
  const release=await acquireAiLease(t.database,identity.id,'plan-draft');await release();
  globalThis.readinessTestEnv.AWS_BEARER_TOKEN_BEDROCK='changed-private-secret';assert.equal((await decoded(await t.get())).services.bedrock.verification,'stale');assert.equal(calls,1);
 });
 await check('Concurrent, rapid repeated and exhausted shared AI budgets cannot trigger additional diagnostic calls',async t=>{
  let enter,complete;const entered=new Promise(resolve=>{enter=resolve;});provider=async()=>{enter();return new Promise(resolve=>{complete=resolve;});};
  const body=input(),first=t.post(body);await entered;
  assert.equal((await decoded(await t.get())).services.bedrock.verification,'running');await decoded(await t.post(body),409);await decoded(await t.post(),429);assert.equal(calls,1);complete(response());await decoded(await first);await decoded(await t.post(),429);assert.equal(calls,1);
  await t.database.prepare("DELETE FROM adapter_operations WHERE provider='bedrock-readiness'").run();await t.database.prepare("UPDATE ai_usage_limits SET request_count=20,lease_until=0,lease_token=NULL WHERE member_id=? AND feature='plan-draft'").bind(identity.id).run();
  await decoded(await t.post(),429);assert.equal(calls,1);
 });
 await check('Invalid model output never becomes verified and an interrupted saved check is never automatically retried',async t=>{
  provider=async()=>Response.json({output:{message:{role:'assistant',content:[{text:'{"ok":false,"private":"private-provider-body"}'}]}},stopReason:'end_turn',usage:{inputTokens:20,outputTokens:5,totalTokens:25}});
  const body=input(),result=await decoded(await t.post(body));assert.equal(result.check.outcome,'invalid-response');noSecrets(result);
  await t.database.prepare("UPDATE adapter_operations SET status='processing',response=NULL,lease_until=0 WHERE id=?").bind('readiness-bedrock-'+body.requestId).run();
  assert.equal((await decoded(await t.get())).services.bedrock.lastCheck.status,'interrupted');assert.equal((await decoded(await t.post(body))).check.status,'interrupted');assert.equal(calls,1);
 });
 await check('A membership change during the diagnostic fences the returned result without exposing provider data',async t=>{
  provider=async()=>{const state=await t.repository.loadWorkspace(owner);state.people.find(person=>person.id===identity.id).role='viewer';await t.repository.saveWorkspace(owner,state,state.version);return response();};
  const body=await decoded(await t.post(),403);noSecrets(body);assert.equal(calls,1);const stored=await t.database.prepare("SELECT response FROM adapter_operations WHERE provider='bedrock-readiness'").first();noSecrets(stored);assert.equal(JSON.parse(stored.response).outcome,'passed');
 });
 console.log(`${checks} owner readiness checks passed using real migrations and injected model fixtures; no live providers.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.readinessTestEnv;}
