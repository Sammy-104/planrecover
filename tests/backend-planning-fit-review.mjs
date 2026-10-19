import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {applyAction,tripCatalog} from '../lib/model.ts';
import {defaultPlanningPreferences,PlanningPreferencesRepository} from '../lib/planning-constraints.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),origin='https://planrecover.test',owner='fit-workspace-owner';
const alice={id:await accountPersonId(owner),name:'Alice'},viewer={id:await accountPersonId('fit-viewer'),name:'Viewer'};
const token='d'.repeat(64),tokenHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
const require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','planning-fit-review-'));
globalThis.planningFitTestEnv={};let checks=0;
globalThis.fetch=async()=>{throw Error('Private fit review must not contact a provider.');};
const request=(planId,body,account=owner,extra={})=>new Request(`${origin}/api/plans/${planId}/review`,{method:'POST',
 headers:{origin,'content-type':'application/json',...(account?{'oai-authenticated-user-id':account}:{}),...extra},body:JSON.stringify(body)});
async function decoded(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));
 if(status===200)assert.match(response.headers.get('cache-control'),/private, no-store/);return body;}

try{
 const output=join(directory,'route.mjs');await build({entryPoints:[resolve(root,'app/api/plans/[planId]/review/route.ts')],outfile:output,
  bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
  plugins:[{name:'fit-bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fit-test'}));
   builder.onLoad({filter:/.*/,namespace:'fit-test'},()=>({contents:'export const env=globalThis.planningFitTestEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(output).href);
 async function check(name,run){const database=createTestD1();globalThis.planningFitTestEnv.DB=database;try{
  const repository=new PlanRepository(database),first=await repository.createPlan(owner,alice,{name:'Fit plan A',destination:'Toronto',
   start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}),id=first.state.plan.id;
  const second=await repository.createPlan(owner,alice,{name:'Fit plan B',destination:'Toronto',start:'2027-05-05',end:'2027-05-05',
   timezone:'America/Toronto',currency:'CAD',budget:7000});
  let workspace=await repository.loadWorkspace(owner);workspace=applyAction(workspace,{type:'select_trip',tripId:id,actor:alice.id});
  addPerson(workspace,viewer,'viewer');workspace.recommendations={destinationKey:'toronto',resolvedCity:'Toronto',fetchedAt:new Date().toISOString(),source:'open-places',
   entries:[{id:'osm-node-123',name:'Synthetic public venue',category:'Activity',description:'Offline catalog fixture',area:'Toronto',
    sourceUrl:'https://www.openstreetmap.org/node/123',sourceLabel:'Synthetic OSM fixture',tags:['Museums'],latitude:43.6,longitude:-79.3}]};
  await repository.saveWorkspace(owner,workspace,workspace.version);
  workspace=await repository.loadWorkspace(owner);const record=await repository.getPlan(id,alice),suggestion=tripCatalog(record.state)[0];assert.ok(suggestion);
  assert.notEqual(workspace.version,record.version,'Multiple plans and selection must reproduce the version-scope mismatch.');
  const action={type:'add_suggestion',suggestionId:suggestion.id,participants:[alice.id],start:'2027-04-04T10:00:00-04:00',duration:60};
  const context={params:Promise.resolve({planId:id})},post=(body,account=owner,extra={})=>route.POST(request(id,body,account,extra),context);
  const before=structuredClone(workspace),financial=database.sqlite.prepare('SELECT COUNT(*) n FROM financial_events WHERE owner=? AND plan_id=?').get(owner,id).n;
  const unchanged=async()=>{assert.deepEqual(await repository.loadWorkspace(owner),before);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM financial_events WHERE owner=? AND plan_id=?').get(owner,id).n,financial);
   assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n,0);};
  const invitation=(tripId=id,role='viewer')=>database.sqlite.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)')
   .run(tokenHash,token,owner,tripId,role,new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
  await run({database,repository,id,second,record,workspace,action,post,context,unchanged,invitation});checks++;console.log('PASS '+name);
 }finally{database.close();}}

 await check('Explicit workspace version reviews the selected plan even when global and per-plan versions differ',async t=>{
  await decoded(await t.post({version:t.workspace.version,action:t.action}),409);
  const value=await decoded(await t.post({workspaceVersion:t.workspace.version,action:t.action}));
  assert.equal(value.review.planVersion,t.record.version);assert.equal(value.review.requiresReview,true);await t.unchanged();
 });
 await check('Existing per-plan version requests retain their original strict stale-version contract',async t=>{
  const value=await decoded(await t.post({version:t.record.version,action:t.action}));assert.equal(value.review.planVersion,t.record.version);
  await decoded(await t.post({version:t.record.version+1,action:t.action}),409);await t.unchanged();
 });
 await check('Workspace version cannot be paired with a different active plan or a stale selection',async t=>{
  const body={workspaceVersion:t.workspace.version,action:t.action};
  await decoded(await route.POST(request(t.second.state.plan.id,body),{params:Promise.resolve({planId:t.second.state.plan.id})}),409);
  let root=await t.repository.loadWorkspace(owner);root=applyAction(root,{type:'select_trip',tripId:t.second.state.plan.id,actor:alice.id});
  await t.repository.saveWorkspace(owner,root,root.version);await decoded(await t.post(body),409);
  assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n,0);
 });
 await check('Both versions, extra actor fields and malformed workspace envelopes are rejected',async t=>{
  for(const body of [{workspaceVersion:t.workspace.version,version:t.record.version,action:t.action},
   {workspaceVersion:t.workspace.version,action:t.action,memberId:viewer.id},{workspaceVersion:'1',action:t.action},
   {workspaceVersion:-1,action:t.action},{workspaceVersion:t.workspace.version,action:t.action,confirm:true}])await decoded(await t.post(body),400);
  await t.unchanged();
 });
 await check('Anonymous, outsider and foreign-origin requests cannot obtain a private fit review',async t=>{
  const body={workspaceVersion:t.workspace.version,action:t.action};await decoded(await t.post(body,null),401);
  await decoded(await t.post(body,'fit-outsider'),404);await decoded(await t.post(body,owner,{origin:'https://outside.test'}),400);
  assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM workspaces WHERE owner=?').get('fit-outsider').n,0);await t.unchanged();
 });
 await check('A viewer invitation can read only the signed-in member’s private fit for its exact shared plan',async t=>{
  t.invitation();const input={workspaceVersion:t.workspace.version,action:{...t.action,participants:[viewer.id]}};
  const value=await decoded(await t.post(input,'fit-viewer',{'x-trip-share':token}));assert.equal(value.review.planVersion,t.record.version);
  assert.equal(value.review.requiresReview,true);assert.equal('preferences' in value.review,false);
  const other={params:Promise.resolve({planId:t.second.state.plan.id})};
  await decoded(await route.POST(request(t.second.state.plan.id,input,'fit-viewer',{'x-trip-share':token}),other),404);
  await t.unchanged();
 });
 function interceptEvidenceRead(t,mutate){const original=t.database.prepare.bind(t.database);let fired=false;
  t.database.prepare=sql=>{const statement=original(sql);if(!sql.startsWith('SELECT * FROM planning_evidence '))return statement;
   return {bind(...values){const bound=statement.bind(...values);return {all:async()=>{const value=await bound.all();if(!fired){fired=true;await mutate();}return value;}};}};};
  return ()=>assert.equal(fired,true);
 }
 await check('A plan mutation during a workspace-scoped check rejects the stale private review',async t=>{
  const fired=interceptEvidenceRead(t,()=>t.repository.updatePlan(t.id,alice,t.record.version,{type:'add_item',actor:alice.id,
   name:'Concurrent synthetic task',category:'Preparation',start:'2027-04-04T09:00:00-04:00',duration:15,price:0,participants:[alice.id],taskOwner:alice.id}));
  const value=await decoded(await t.post({workspaceVersion:t.workspace.version,action:t.action}),409);assert.equal('review' in value,false);fired();
 });
 await check('An independent private-preference revision during a fit check rejects its stale result',async t=>{
  const preferences=new PlanningPreferencesRepository(t.database),configured=defaultPlanningPreferences('America/Toronto');
  await preferences.update(t.id,alice,configured,0);
  const fired=interceptEvidenceRead(t,()=>preferences.update(t.id,alice,{...configured,bufferMinutes:60},1));
  const value=await decoded(await t.post({workspaceVersion:t.workspace.version,action:t.action}),409);assert.equal('review' in value,false);fired();
  assert.equal((await t.repository.loadWorkspace(owner)).version,t.workspace.version,'Private preferences do not change the workspace CAS.');
 });
 await check('Invitation revocation during a private fit check returns no review',async t=>{
  t.invitation();const fired=interceptEvidenceRead(t,()=>t.database.sqlite.prepare('DELETE FROM trip_links WHERE token_hash=?').run(tokenHash));
  const value=await decoded(await t.post({workspaceVersion:t.workspace.version,action:{...t.action,participants:[viewer.id]}},'fit-viewer',{'x-trip-share':token}),400);
  assert.equal('review' in value,false);fired();await t.unchanged();
 });
 await check('A membership downgrade during a per-plan review cannot expose a result after access is removed',async t=>{
  const fired=interceptEvidenceRead(t,()=>t.database.sqlite.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").run(owner,t.id,alice.id));
  const value=await decoded(await t.post({version:t.record.version,action:t.action}),404);assert.equal('review' in value,false);fired();
 });
 console.log(`${checks} private fit-review checks passed using multi-plan migrated SQLite and actual HTTP handlers; no external calls or financial actions.`);
}finally{delete globalThis.planningFitTestEnv;rmSync(directory,{recursive:true,force:true});}
