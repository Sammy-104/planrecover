import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {dirname,resolve,basename,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestD1} from './helpers/d1.mjs';
import {initialState} from '../lib/model.ts';
import {accountPersonId} from '../lib/people.ts';
import {PlanRepository} from '../lib/plan-repository.ts';
import {applyDraftBatch} from '../lib/draft-batch.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
const buildRoot=resolve(root,'build');mkdirSync(buildRoot,{recursive:true});
const directory=mkdtempSync(join(buildRoot,'backend-draft-batches-'));
const origin='https://planrecover.test',accounts={alice:'draft-batch-alice',bob:'draft-batch-bob',carol:'draft-batch-carol'};
const people=Object.fromEntries(await Promise.all(Object.entries(accounts).map(async([key,id])=>[key,await accountPersonId(id)])));
const routes={};let checks=0;
globalThis.backendDraftBatchEnv={DB:undefined};
globalThis.fetch=async()=>{throw Error('Live provider calls are disabled in draft batch tests.');};

function request(path,method='GET',body,{account=accounts.alice,token,requestOrigin=origin}={}){
 const headers=new Headers();if(account){headers.set('oai-authenticated-user-id',account);headers.set('oai-authenticated-user-email',`${Object.entries(accounts).find(([,value])=>value===account)?.[0]??'person'}@example.test`);}
 if(token)headers.set('x-trip-share',token);
 if(method!=='GET'){headers.set('Content-Type','application/json');headers.set('Origin',requestOrigin);}
 return new Request(origin+path,{method,headers,...body===undefined?{}:{body:JSON.stringify(body)}});
}
async function decoded(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));if(status<300){assert.match(response.headers.get('Cache-Control')??'',/private/);assert.match(response.headers.get('Cache-Control')??'',/no-store/);}return body;}
const createPlan=async()=>decoded(await routes.plans.POST(request('/api/plans','POST',{plan:{kind:'trip',name:'Selected draft ideas',destination:'Toronto, Ontario, Canada',start:'2027-04-04',end:'2027-04-06',timezone:'America/Toronto',currency:'CAD',budget:50000,goal:'Review several ideas together.'}})),201);
const workspace=async(options={})=>decoded(await routes.workspace.GET(request('/api/workspace','GET',undefined,options)));
const addition=(name,start,overrides={})=>({type:'add_item',name,category:'Activity',start,duration:45,price:null,participants:[people.alice],location:'Toronto',...overrides});
const batch=(actions,batchId=crypto.randomUUID())=>({type:'add_drafts',batchId,actions});
const post=(version,action,options={})=>routes.workspace.POST(request('/api/workspace','POST',{version,action},options));
function rows(database,table){assert.match(table,/^[A-Za-z0-9_]+$/);return database.sqlite.prepare(`SELECT * FROM "${table}"`).all().map(row=>JSON.stringify(row)).sort();}
// Auth refreshes profile display metadata during reads; all plan, membership,
// workflow, approval and financial tables remain exact comparisons.
function snapshot(database){return Object.fromEntries(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'profiles' ORDER BY name").all().map(({name})=>[name,rows(database,name)]));}
function financialSnapshot(database){return Object.fromEntries(Object.entries(snapshot(database)).filter(([name])=>/^(provider_|webhook_|financial_)|invoice|refund|payment|ledger/.test(name)));}
function financialState(state){return {events:state.events,receipts:state.receipts,proposals:state.proposals,archives:state.archives?.map(value=>({events:value.workspace.events,receipts:value.workspace.receipts,proposals:value.workspace.proposals}))};}
async function check(name,callback){const database=createTestD1();globalThis.backendDraftBatchEnv.DB=database;try{await callback(database);checks++;console.log(`PASS ${name}`);}finally{database.close();globalThis.backendDraftBatchEnv.DB=undefined;}}
async function share(planId,role){return decoded(await routes.sharing.POST(request('/api/trip-share','POST',{tripId:planId,operation:'create',role})));}
async function joinMember(planId,account,token){const before=await workspace({account,token});return decoded(await routes.members.POST(request('/api/plan-members','POST',{operation:'join',tripId:planId,version:before.state.version,name:account===accounts.bob?'Bob':'Carol'},{account,token})));}

try{
 for(const [name,path]of Object.entries({plans:'app/api/plans/route.ts',workspace:'app/api/workspace/route.ts',sharing:'app/api/trip-share/route.ts',members:'app/api/plan-members/route.ts'})){
  const outfile=join(directory,`${name}.mjs`);await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'test-workers-binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare:workers',namespace:'test-workers'}));builder.onLoad({filter:/.*/,namespace:'test-workers'},()=>({contents:'export const env=globalThis.backendDraftBatchEnv;',loader:'js'}));}}]});routes[name]=await import(pathToFileURL(outfile).href);
 }
 await check('Two selected AI drafts persist together in one versioned HTTP save and survive reload',async database=>{
  await createPlan();const before=await workspace(),financial=financialSnapshot(database),money=financialState(before.state);
  const action=batch([addition('Museum idea','2027-04-04T14:00:00Z'),addition('Garden idea','2027-04-04T16:00:00Z')]);
  const result=await decoded(await post(before.state.version,action));
  assert.equal(result.state.version,before.state.version+1);assert.deepEqual(result.state.items.map(item=>item.name),['Museum idea','Garden idea']);
  assert.ok(result.state.items.every(item=>item.status==='draft'&&item.booking==='unconfirmed'&&item.approvals.length===0&&item.paid.length===0&&item.price===null));
  assert.deepEqual(result.state.appliedDrafts,[action.batchId]);
  const reloaded=await workspace();assert.deepEqual(reloaded.state.items,result.state.items);assert.equal(reloaded.state.version,result.state.version);assert.deepEqual(reloaded.state.appliedDrafts,[action.batchId]);
  const stored=await new PlanRepository(database).loadWorkspace(accounts.alice);assert.deepEqual(stored.items,result.state.items);assert.deepEqual(stored.appliedDrafts,[action.batchId]);
  assert.deepEqual(financialState(reloaded.state),money);assert.deepEqual(financialSnapshot(database),financial);
 });
 await check('A later invalid draft rolls back the selection without changing persisted plan/payment/workflow data',async database=>{
  await createPlan();const before=await workspace(),unchanged=snapshot(database);
  const action=batch([addition('Would be valid','2027-04-04T14:00:00Z'),addition('Outside plan dates','2027-04-08T14:00:00Z')]);
  const error=await decoded(await post(before.state.version,action),400);assert.match(error.error,/within.*plan|plan dates/i);
  assert.deepEqual(snapshot(database),unchanged);const reloaded=await workspace();assert.deepEqual(reloaded.state.items,before.state.items);assert.equal(reloaded.state.version,before.state.version);assert.ok(!reloaded.state.appliedDrafts?.includes(action.batchId));
 });
 await check('Stale batches return HTTP 409 and a retained batch ID cannot add the same ideas again',async database=>{
  await createPlan();const before=await workspace(),action=batch([addition('One retained idea','2027-04-04T14:00:00Z')]);
  const saved=await decoded(await post(before.state.version,action)),unchanged=snapshot(database);
  const stale=await decoded(await post(before.state.version,batch([addition('Stale addition','2027-04-05T14:00:00Z')])),409);assert.equal(stale.code,'VERSION_CONFLICT');assert.deepEqual(snapshot(database),unchanged);
  const replay=await decoded(await post(saved.state.version,action),400);assert.match(replay.error,/already added/i);assert.deepEqual(snapshot(database),unchanged);
  const reload=await workspace();assert.equal(reload.state.items.length,1);assert.deepEqual(reload.state.appliedDrafts,[action.batchId]);
 });
 await check('Nested financial actions, identity/plan overrides and unrecognized draft fields are rejected before writes',async database=>{
  await createPlan();const before=await workspace(),valid=addition('Safe idea','2027-04-04T14:00:00Z'),unchanged=snapshot(database);
  const invalid=[{type:'demo_payment',itemId:'unapproved'},{type:'approve_item',itemId:'unapproved',revision:1},{type:'settlement_report',to:people.bob,amount:100},{...valid,actor:people.bob},{...valid,tripId:'another-plan'},{...valid,paid:[people.alice]},{...valid,booking:'confirmed'},{...valid,_insertion:{issues:[]}}];
  for(const child of invalid){await decoded(await post(before.state.version,batch([valid,child])),400);assert.deepEqual(snapshot(database),unchanged);}
  for(const actions of [[],Array.from({length:13},(_,i)=>({...valid,name:`Idea ${i}`}))]){await decoded(await post(before.state.version,batch(actions)),400);assert.deepEqual(snapshot(database),unchanged);}
  await decoded(await post(before.state.version,{...batch([valid]),owner:accounts.bob}),400);assert.deepEqual(snapshot(database),unchanged);
 });
 await check('Viewer access and revoked invitations cannot add a batch or change financial history',async database=>{
  const created=await createPlan(),planId=created.state.plan.id,viewer=await share(planId,'viewer');await joinMember(planId,accounts.bob,viewer.token);
  const current=await workspace({account:accounts.bob,token:viewer.token}),unchanged=snapshot(database);
  const denied=await decoded(await post(current.state.version,batch([addition('Viewer idea','2027-04-04T14:00:00Z',{participants:[people.bob]})]),{account:accounts.bob,token:viewer.token}),403);assert.match(denied.error,/viewing access|editing access/i);assert.deepEqual(snapshot(database),unchanged);
  const editor=await share(planId,'editor');await joinMember(planId,accounts.carol,editor.token);const oldEditor=await workspace({account:accounts.carol,token:editor.token});
  await decoded(await routes.sharing.POST(request('/api/trip-share','POST',{tripId:planId,operation:'revoke'})));const revokedSnapshot=snapshot(database);
  const response=await post(oldEditor.state.version,batch([addition('Revoked idea','2027-04-05T14:00:00Z',{participants:[people.carol]})]),{account:accounts.carol,token:editor.token});assert.ok(response.status>=400);assert.match((await response.json()).error,/invalid|turned off|unavailable/i);assert.deepEqual(snapshot(database),revokedSnapshot);
 });
 await check('Overlapping selected AI activities fail atomically, including conflicts with an existing activity',async database=>{
  await createPlan();let current=await workspace(),unchanged=snapshot(database);
  const conflicting=batch([addition('First suggested stop','2027-04-04T14:00:00Z'),addition('Overlapping second stop','2027-04-04T14:15:00Z')]);
  const first=await decoded(await post(current.state.version,conflicting),400);assert.match(first.error,/Overlaps First suggested stop/);assert.deepEqual(snapshot(database),unchanged);
  current=await decoded(await post(current.state.version,batch([addition('Saved stop','2027-04-04T14:00:00Z')])));unchanged=snapshot(database);
  const second=await decoded(await post(current.state.version,batch([addition('New conflict','2027-04-04T14:10:00Z')])),400);assert.match(second.error,/Overlaps Saved stop/);assert.deepEqual(snapshot(database),unchanged);
 });
 await check('Free AI preparation suggestions stay unapproved drafts and never create financial effects',async database=>{
  await createPlan();const before=await workspace(),financial=financialSnapshot(database),money=financialState(before.state);
  const result=await decoded(await post(before.state.version,batch([addition('AI preparation checklist','2027-04-04T12:00:00Z',{category:'Preparation',price:0,taskOwner:people.alice})])));
  const task=result.state.items.find(item=>item.name==='AI preparation checklist');assert.ok(task);assert.equal(task.category,'Preparation');assert.equal(task.status,'draft');assert.deepEqual(task.approvals,[]);assert.deepEqual(task.paid,[]);assert.equal(task.booking,'unconfirmed');assert.deepEqual(financialState(result.state),money);assert.deepEqual(financialSnapshot(database),financial);
 });
 await check('The pure helper accepts mixed catalog/AI additions without mutating input or money and fences failures/replays',async()=>{
  const original=initialState(),unchanged=structuredClone(original),action={...batch([{type:'add_suggestion',suggestionId:'pack',participants:['sam']},addition('AI morning stop','2026-10-16T12:00:00Z',{participants:['sam']})]),actor:'sam',tripId:original.plan.id};
  const result=applyDraftBatch(original,action);assert.equal(result.items.length,original.items.length+2);assert.equal(result.items.at(-1).name,'AI morning stop');assert.deepEqual(original,unchanged);assert.deepEqual(financialState(result),financialState(original));
  assert.throws(()=>applyDraftBatch(result,action),/already added/);assert.throws(()=>applyDraftBatch(original,{...action,tripId:'wrong-plan'}),/active plan changed/i);
  assert.throws(()=>applyDraftBatch(original,{...action,batchId:crypto.randomUUID(),actions:[action.actions[1],{...action.actions[1],name:'Bad later time',start:'2026-11-01T12:00:00Z'}]}),/within.*plan|plan dates/i);assert.deepEqual(original,unchanged);
 });
 console.log(`${checks} atomic draft batch HTTP/SQLite and helper checks passed.`);
}finally{
 const target=resolve(directory);if(dirname(target)!==buildRoot||!basename(target).startsWith('backend-draft-batches-'))throw Error('Refusing unexpected test cleanup.');rmSync(target,{recursive:true,force:true});delete globalThis.backendDraftBatchEnv;
}
