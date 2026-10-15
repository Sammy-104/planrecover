import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {initialState} from '../lib/model.ts';
import {accountPersonId,makePerson,defaultPreferences} from '../lib/people.ts';
import {saveProviderRequestIntent,sha256} from '../lib/financial-history.ts';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-background-'));
globalThis.backgroundTestEnv={DB:undefined};
globalThis.fetch=async()=>{throw Error('Live provider access is forbidden in background tests.');};
const routes={};
for(const [name,path] of Object.entries({service:'lib/background-jobs.ts',owner:'app/api/jobs/run/route.ts',scheduled:'app/api/jobs/scheduled/route.ts'})){
 const outfile=join(directory,`${name}.mjs`);
 await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
  plugins:[{name:'binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));
   builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.backgroundTestEnv;',loader:'js'}));}}]});
 routes[name]=await import(pathToFileURL(outfile).href);
}
const {recoverOrderIdentities,runOwnerBackgroundJobs}=routes.service;
let checks=0;
const amount={currency_code:'CAD',value:'90.00'};
const requestBody=id=>({intent:'CAPTURE',purchase_units:[{reference_id:'hike',custom_id:id,amount}],
 payment_source:{paypal:{experience_context:{shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW'}}}});
const canonical=(id,operationId)=>({id,status:'CREATED',purchase_units:[{reference_id:'hike',custom_id:operationId,amount:{...amount}}]});
async function seed(database,{owner='job-owner-a',operationId='lost-order-a',providerId=null,path='/v2/checkout/orders',body=requestBody(operationId),kind='order',operation=true,intentOverrides}={}){
 const state=initialState();state.plan.id=`plan-${owner}`;state.events=[];state.items.find(item=>item.id==='hike').paid=[];
 await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(owner,JSON.stringify(state),new Date().toISOString()).run();
 const repository=new PlanRepository(database);await repository.importWorkspace(owner,state);
 if(operation){
  await database.prepare(`INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload)
   VALUES (?,?,?,'sam',1,?,9000,?,?,?)`).bind(operationId,owner,'hike',kind,providerId,providerId?'created':'creating',
    JSON.stringify({planrecoverTripId:state.plan.id,planrecoverCurrency:'CAD',planrecoverApprovalSnapshot:'stored-original-approval'})).run();
  if(intentOverrides){
   const key=`key-${operationId}`,at=Date.now(),intent={path,method:'POST',request_body:JSON.stringify(body),request_key:key,
    fingerprint:await sha256(JSON.stringify({path,body,requestKey:key})),created:new Date(at).toISOString(),replay_before:new Date(at+5*60*60_000).toISOString(),...intentOverrides};
   // Controlled legacy fixtures are inserted once; production immutable triggers stay enabled.
   await database.prepare(`INSERT INTO provider_request_intents(operation_id,owner,plan_id,path,method,request_body,request_key,fingerprint,created,replay_before)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(operationId,owner,state.plan.id,intent.path,intent.method,intent.request_body,intent.request_key,intent.fingerprint,intent.created,intent.replay_before).run();
  }else await saveProviderRequestIntent(database,{operationId,owner,planId:state.plan.id,path,body,requestKey:`key-${operationId}`});
 }
 return {owner,operationId,repository,planId:state.plan.id,body};
}
const op=(database,id)=>database.prepare('SELECT * FROM provider_operations WHERE id=?').bind(id).first();
async function check(name,run){const database=createTestD1();globalThis.backgroundTestEnv.DB=database;
 try{await run(database);checks++;console.log(`PASS ${name}`);}finally{database.close();globalThis.backgroundTestEnv.DB=undefined;delete globalThis.backgroundTestEnv.JOB_RUNNER_KEY;}}
function fixtureProvider(){
 const calls=[],orders=new Map();let failedCreates=0,mutateCanonical;
 const provider=async(path,method='GET',body,key)=>{
  calls.push({path,method,body:structuredClone(body),key});
  if(method==='POST'){
   assert.equal(path,'/v2/checkout/orders','Unattended work must never capture, refund, send invoices or notify externally.');
   if(failedCreates-->0)throw Error('Fixture private provider response must not escape.');
   if(!orders.has(key))orders.set(key,canonical(`ORDER${orders.size+1}`,body.purchase_units[0].custom_id));
   return {id:orders.get(key).id};
  }
  assert.equal(method,'GET');const found=[...orders.values()].find(order=>path===`/v2/checkout/orders/${order.id}`);
  if(found){const data=structuredClone(found);if(mutateCanonical)mutateCanonical(data);return data;}
  throw Error(`Unexpected fixture read: ${path}`);
 };
 return {calls,orders,provider,setFailedCreates(value){failedCreates=value;},setCanonicalMutation(value){mutateCanonical=value;}};
}
function dependencies(database,t,fixture,{clock=()=>Date.now(),fetchOrder}={}){
 return {database,provider:fixture.provider,clock,fetchOrder:fetchOrder??(id=>fixture.provider(`/v2/checkout/orders/${id}`)),
  fetchRefund:id=>fixture.provider(`/v2/payments/refunds/${id}`),reconcileCapture:async()=>{throw Error('These fixtures are approval orders, not captured money.');},
  loadState:owner=>t.repository.loadWorkspace(owner),saveState:(...args)=>t.repository.saveWorkspace(...args)};
}
const origin='https://planrecover.test';
const request=(path,{account,key,body={},raw,requestOrigin=origin,method='POST',headers={}}={})=>new Request(`${origin}/api/jobs/${path}`,{
 method,headers:{'content-type':'application/json',...(requestOrigin?{origin:requestOrigin}:{}),...(account?{'oai-authenticated-user-id':account}:{}),
  ...(key!==undefined?{authorization:key}:{}),...headers},...(method==='GET'?{}:{body:raw??JSON.stringify(body)})});
async function status(response,expected){const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;}
try{
 await check('Lost approval-order IDs replay exactly the immutable original request and keep early provider identity',async database=>{
  const t=await seed(database),fixture=fixtureProvider();const result=await recoverOrderIdentities(database,t.owner,fixture.provider);
  assert.deepEqual(result,[{operationId:t.operationId,status:'created'}]);assert.equal(fixture.calls.length,2);
  assert.deepEqual(fixture.calls[0].body,t.body);assert.equal(fixture.calls[0].key,`key-${t.operationId}`);assert.equal(fixture.calls[0].method,'POST');assert.equal(fixture.calls[1].method,'GET');
  const row=await op(database,t.operationId);assert.equal(row.provider_id,'ORDER1');assert.equal(row.status,'created');
  assert.equal(JSON.parse(row.payload).planrecoverApprovalSnapshot,'stored-original-approval');assert.equal(JSON.parse(row.payload).planrecoverTripId,t.planId);
  assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
  await recoverOrderIdentities(database,t.owner,fixture.provider);assert.equal(fixture.calls.length,2);
  await assert.rejects(database.prepare('UPDATE provider_request_intents SET request_body=? WHERE operation_id=?').bind('{}',t.operationId).run(),/immutable/);
  await assert.rejects(database.prepare('DELETE FROM provider_request_intents WHERE operation_id=?').bind(t.operationId).run(),/immutable/);
 });
 await check('Expired and malformed replay windows fail closed without another provider request',async database=>{
  const fixture=fixtureProvider();let index=0;
  for(const value of ['2000-01-01T00:00:00Z','invalid-expiry',new Date().toISOString()]){
   const t=await seed(database,{owner:`expiry-owner-${index}`,operationId:`expiry-order-${index++}`,intentOverrides:{replay_before:value}});
   const result=await recoverOrderIdentities(database,t.owner,fixture.provider,Date.now()+1);assert.equal(result[0].status,'manual-review');
   assert.equal((await op(database,t.operationId)).provider_id,null);
  }assert.equal(fixture.calls.length,0);
 });
 await check('Altered method, path, amount, request key or fingerprint never replays an immutable intent',async database=>{
  const fixture=fixtureProvider();let index=0;
  for(const change of [{method:'GET'},{path:'/v2/checkout/orders/ORDER1/capture'},{request_key:'altered-key'},
   {request_body:'{"intent":"CAPTURE","purchase_units":[]}'},{fingerprint:'0'.repeat(64)}]){
   const t=await seed(database,{owner:`altered-owner-${index}`,operationId:`altered-order-${index++}`,intentOverrides:change});
   assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'manual-review');
  }assert.equal(fixture.calls.length,0);
 });
 await check('Payment-source and processing-instruction intents cannot trigger unattended funds movement',async database=>{
  const fixture=fixtureProvider();let index=0;
  for(const mutate of [body=>body.payment_source={card:{vault_id:'stored-vault'}},body=>body.payment_source.paypal.vault_id='stored-vault',
   body=>body.processing_instruction='ORDER_COMPLETE_ON_PAYMENT_APPROVAL']){
   const id=`unsafe-source-${index}`,body=requestBody(id);mutate(body);
   const t=await seed(database,{owner:`unsafe-source-owner-${index++}`,operationId:id,body});
   assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'manual-review');
  }assert.equal(fixture.calls.length,0);
 });
 await check('Canonical currency, identity, item and amount mismatches preserve returned ID for merchant review',async database=>{
  const t=await seed(database),fixture=fixtureProvider();
  for(const mutate of [order=>order.id='OTHERORDER',order=>order.purchase_units[0].amount.currency_code='USD',
   order=>order.purchase_units[0].amount.value='99.00',order=>order.purchase_units[0].reference_id='other-item',
   order=>order.purchase_units[0].custom_id='other-operation',order=>order.purchase_units.push({...order.purchase_units[0]})]){
   await database.prepare("UPDATE provider_operations SET status='creating',provider_id=NULL WHERE id=?").bind(t.operationId).run();fixture.setCanonicalMutation(mutate);
   assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'manual-review');
   const row=await op(database,t.operationId);assert.equal(row.provider_id,'ORDER1');assert.equal(row.status,'manual-review');
   assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
  }
  assert.ok(fixture.calls.every(call=>call.method==='GET'||call.path==='/v2/checkout/orders'));
 });
 await check('Provider failures retry the same key and body without duplicating payment or invoice effects',async database=>{
  const t=await seed(database),fixture=fixtureProvider();fixture.setFailedCreates(1);
  assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'retry-or-review');assert.equal((await op(database,t.operationId)).provider_id,null);
  assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'created');
  const creates=fixture.calls.filter(call=>call.method==='POST');assert.equal(creates.length,2);assert.deepEqual(creates[0],creates[1]);
  assert.equal(fixture.orders.size,1);assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
 });
 await check('A failed early identity save recovers the original provider resource on the next replay',async database=>{
  const t=await seed(database),fixture=fixtureProvider(),original=database.prepare.bind(database);let fault=true;
  database.prepare=sql=>{const statement=original(sql);if(!sql.startsWith('UPDATE provider_operations SET provider_id'))return statement;
   return {bind(...values){const bound=statement.bind(...values);return {async run(){if(fault){fault=false;throw Error('Fixture database interruption');}return bound.run();}};}};};
  assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'retry-or-review');assert.equal((await op(database,t.operationId)).provider_id,null);
  assert.equal((await recoverOrderIdentities(database,t.owner,fixture.provider))[0].status,'created');assert.equal(fixture.orders.size,1);
  assert.equal((await op(database,t.operationId)).provider_id,'ORDER1');assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
 });
 await check('Background batches isolate owners and never replay saved capture or refund mutations',async database=>{
  const t=await seed(database),other=await seed(database,{owner:'job-owner-b',operationId:'lost-order-b'}),fixture=fixtureProvider();
  await recoverOrderIdentities(database,t.owner,fixture.provider);assert.equal((await op(database,other.operationId)).provider_id,null);
  const body=requestBody('unsafe-order');await database.prepare(`INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload)
   VALUES ('unsafe-order',?,'hike','sam',1,'order',9000,'creating','{}')`).bind(t.owner).run();
  await saveProviderRequestIntent(database,{operationId:'unsafe-order',owner:t.owner,planId:t.planId,path:'/v2/checkout/orders/ORDER1/capture',body,requestKey:'capture-key'});
  await database.prepare(`INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload)
   VALUES ('unsafe-refund',?,'hike','sam',1,'refund',9000,'creating','{}')`).bind(t.owner).run();
  await saveProviderRequestIntent(database,{operationId:'unsafe-refund',owner:t.owner,planId:t.planId,path:'/v2/payments/captures/CAPTURE1/refund',body:{amount},requestKey:'refund-key'});
  const count=fixture.calls.length;await recoverOrderIdentities(database,t.owner,fixture.provider);assert.equal(fixture.calls.length,count);
  assert.equal((await op(database,'unsafe-order')).status,'manual-review');assert.equal((await op(database,'unsafe-refund')).provider_id,null);
 });
 await check('Owner leases and cooldowns prevent overlapping jobs and permit a later safe run',async database=>{
  const t=await seed(database),fixture=fixtureProvider();let now=Date.now();
  await recoverOrderIdentities(database,t.owner,fixture.provider);let entered,release;
  const started=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
  const deps=dependencies(database,t,fixture,{clock:()=>now,fetchOrder:async id=>{entered();await waiting;return fixture.provider(`/v2/checkout/orders/${id}`);}});
  const first=runOwnerBackgroundJobs(t.owner,deps);await started;
  assert.equal((await runOwnerBackgroundJobs(t.owner,deps)).status,'already-running-or-recent');release();assert.equal((await first).status,'completed');
  const saved=await database.prepare('SELECT * FROM background_job_runs WHERE owner=?').bind(t.owner).first();assert.equal(saved.lease_token,null);assert.equal(saved.next_at,now+60000);
  const count=fixture.calls.length;assert.equal((await runOwnerBackgroundJobs(t.owner,deps)).status,'already-running-or-recent');assert.equal(fixture.calls.length,count);
  now+=60001;assert.equal((await runOwnerBackgroundJobs(t.owner,dependencies(database,t,fixture,{clock:()=>now}))).status,'completed');
  assert.ok(fixture.calls.filter(call=>call.method==='POST').every(call=>call.path==='/v2/checkout/orders'));
 });
 await check('Storage failures release owner leases, preserve evidence and return sanitized retry diagnostics',async database=>{
  const t=await seed(database,{providerId:'ORDER1'}),fixture=fixtureProvider();fixture.orders.set('fixture',canonical('ORDER1',t.operationId));
  const original=database.prepare.bind(database);let fail=true,now=Date.now();
  database.prepare=sql=>{const statement=original(sql);if(!fail||!sql.startsWith('SELECT p.* FROM provider_operations p'))return statement;
   return {bind(){return {async all(){throw Error('Private provider body fixture-secret not for user output');}};}};};
  await assert.rejects(runOwnerBackgroundJobs(t.owner,dependencies(database,t,fixture,{clock:()=>now})),error=>error.code==='JOBS_RETRY'&&!error.message.includes('fixture-secret'));
  const saved=await database.prepare('SELECT * FROM background_job_runs WHERE owner=?').bind(t.owner).first();assert.equal(saved.status,'retry');assert.equal(saved.lease_token,null);
  assert.ok(!saved.last_result.includes('fixture-secret'));assert.equal((await op(database,t.operationId)).provider_id,'ORDER1');assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
  fail=false;now+=60001;assert.equal((await runOwnerBackgroundJobs(t.owner,dependencies(database,t,fixture,{clock:()=>now}))).status,'completed');
 });
 await check('Expired and stolen owner leases stop later financial and reminder phases',async database=>{
  const t=await seed(database),fixture=fixtureProvider();let now=Date.now(),expire=true;
  const provider=async(...args)=>{const result=await fixture.provider(...args);if(args[1]!=='POST'&&expire){expire=false;now+=300001;}return result;};
  const deps={...dependencies(database,t,fixture,{clock:()=>now}),provider};
  await assert.rejects(runOwnerBackgroundJobs(t.owner,deps),error=>error.code==='JOBS_RETRY');assert.equal(fixture.calls.length,2);
  assert.equal((await op(database,t.operationId)).provider_id,'ORDER1');assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM reminder_jobs').first('count'),0);
  now+=60001;
  const stolen=async id=>{
   await database.prepare("UPDATE background_job_runs SET lease_token='replacement-owner-lease',lease_until=?,status='running',last_result='replacement-run' WHERE owner=?")
    .bind(now+300000,t.owner).run();return fixture.provider(`/v2/checkout/orders/${id}`);
  };
  await assert.rejects(runOwnerBackgroundJobs(t.owner,dependencies(database,t,fixture,{clock:()=>now,fetchOrder:stolen})),error=>error.code==='JOBS_RETRY');
  const saved=await database.prepare('SELECT * FROM background_job_runs WHERE owner=?').bind(t.owner).first();
  assert.equal(saved.lease_token,'replacement-owner-lease');assert.equal(saved.status,'running');assert.equal(saved.last_result,'replacement-run');
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM reminder_jobs').first('count'),0);
 });
 await check('Persisted reminder cursors reach later plans instead of rescheduling the first batch forever',async database=>{
  const owner='cursor-owner',member=await accountPersonId(owner),identity={id:member,name:'Cursor owner'},person=makePerson(member,identity.name,'owner');let now=Date.now();
  const makeState=index=>{const state=initialState();state.plan={...state.plan,id:`cursor-plan-${String(index).padStart(2,'0')}`,destination:'Toronto',contentDestination:'Toronto',template:'custom'};
   state.people=[person];state.preferences={[member]:defaultPreferences(30000)};state.events=[];state.receipts=[];state.reminders=[];
   state.items=[{id:`task-${index}`,name:`Preparation ${index}`,category:'Preparation',start:new Date(now-60000).toISOString(),duration:10,price:0,
    participants:[member],shares:{[member]:0},allocation:'equal',values:{},revision:1,approvals:[member],required:[member],status:'scheduled',
    booking:'unconfirmed',policy:'Preparation task.',source:'Manual preparation task',expires:null,deadline:null,depends:[],paid:[],taskOwner:member,done:false,location:'Toronto'}];
   delete state.archives;delete state.deletedTrips;return state;};
  const state=makeState(1);state.archives=Array.from({length:10},(_,index)=>{const workspace=makeState(index+2);return {id:workspace.plan.id,archivedAt:new Date(now).toISOString(),workspace};});
  await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(owner,JSON.stringify(state),new Date(now).toISOString()).run();
  const repository=new PlanRepository(database);await repository.importWorkspace(owner,state,identity);
  const fixture=fixtureProvider(),deps=dependencies(database,{repository},fixture,{clock:()=>now});
  const first=await runOwnerBackgroundJobs(owner,deps);assert.equal(first.reminders.synced,10);
  assert.equal(await database.prepare('SELECT COUNT(DISTINCT plan_id) AS count FROM plan_notifications').first('count'),10);
  assert.equal((await database.prepare('SELECT reminder_cursor FROM background_job_runs WHERE owner=?').bind(owner).first()).reminder_cursor,'cursor-plan-10');
  now+=60001;const second=await runOwnerBackgroundJobs(owner,deps);assert.equal(second.reminders.synced,1);
  assert.equal(await database.prepare('SELECT COUNT(DISTINCT plan_id) AS count FROM plan_notifications').first('count'),11);
  assert.equal((await database.prepare('SELECT reminder_cursor FROM background_job_runs WHERE owner=?').bind(owner).first()).reminder_cursor,null);
  assert.equal(fixture.calls.length,0);
 });
 await check('The scheduled HTTP runner requires its separate service key before accepting an empty bounded request',async database=>{
  const t=await seed(database,{operation:false});
  await status(await routes.scheduled.POST(request('scheduled')),503);globalThis.backgroundTestEnv.JOB_RUNNER_KEY='fixture-service-key-32-characters';
  for(const key of [undefined,'Bearer '+'x'.repeat(globalThis.backgroundTestEnv.JOB_RUNNER_KEY.length),'Bearer short','Basic fixture-service-key-32-characters','Bearer '+'x'.repeat(4097)])
   await status(await routes.scheduled.POST(request('scheduled',{key,account:t.owner})),401);
  const key=`Bearer ${globalThis.backgroundTestEnv.JOB_RUNNER_KEY}`;
  for(const body of [{owner:'someone-else'},[],null])await status(await routes.scheduled.POST(request('scheduled',{key,body})),400);
  await status(await routes.scheduled.POST(request('scheduled',{key,raw:'{'})),400);
  await status(await routes.scheduled.POST(request('scheduled',{key,raw:' '.repeat(65)})),413);
  await status(await routes.scheduled.POST(request('scheduled',{key,requestOrigin:'https://other.test'})),400);
  const result=await status(await routes.scheduled.POST(request('scheduled',{key,requestOrigin:null})),200);assert.equal(result.processed,1);assert.equal(result.results[0].status,'completed');
  assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,0);
 });
 await check('Owner job routes reject visitor-controlled targets, invalid origins and shared invitations',async database=>{
  const t=await seed(database,{operation:false}),other=await seed(database,{owner:'job-owner-b',operation:false});
  await status(await routes.owner.POST(request('run')),401);await status(await routes.owner.POST(request('run',{account:t.owner,body:{owner:other.owner}})),400);
  await status(await routes.owner.POST(request('run',{account:t.owner,requestOrigin:'https://other.test'})),400);
  await status(await routes.owner.POST(request('run',{account:t.owner,raw:' '.repeat(65)})),413);
  const token='a'.repeat(64),hash=await sha256(token);await database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)')
   .bind(hash,token,t.owner,t.planId,'editor',new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
  await status(await routes.owner.POST(request('run',{account:t.owner,headers:{'x-trip-share':token}})),403);
  const result=await status(await routes.owner.POST(request('run',{account:t.owner})),200);assert.equal(result.status,'completed');
  assert.equal(await database.prepare('SELECT owner FROM background_job_runs WHERE owner=?').bind(other.owner).first(),null);
  const own=await routes.owner.GET(request('run',{account:t.owner,method:'GET'}));assert.equal(own.headers.get('cache-control'),'private, no-store');assert.equal((await own.json()).status.status,'completed');
  const unrelated=await status(await routes.owner.GET(request('run',{account:other.owner,method:'GET'})),200);assert.equal(unrelated.status.status,'not-run');
 });
 console.log(`${checks} background job checks passed.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.backgroundTestEnv;}
