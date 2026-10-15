import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {PlanningEvidenceRepository,loadPlanningEvidence,parsePlanningEvidenceMutation,MAX_PLANNING_EVIDENCE} from '../lib/planning-evidence.ts';
import {PlanningPreferencesRepository,defaultPlanningPreferences,checkPlanningConstraints} from '../lib/planning-constraints.ts';
import {cityKey} from '../lib/cities.ts';

const accounts={owner:'evidence-owner',buyer:'evidence-buyer',viewer:'evidence-viewer',other:'evidence-other'};
const people=Object.fromEntries(await Promise.all(Object.entries(accounts).map(async([name,account])=>[name,{id:await accountPersonId(account),name}])));
const now=Date.now(),origin='https://planrecover.test';let checks=0,networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw Error('Planning evidence must never fetch live inventory, websites or providers.');};
const source=()=>({itemId:'venue-museum',sourceUrl:'https://supplier.test/hours',checkedAt:new Date(now).toISOString(),
 openIntervals:[{start:'2027-04-04T10:00:00-04:00',end:'2027-04-04T17:00:00-04:00'}],dietary:{vegan:'supported'},accessibility:{'step-free':'supported'}});
const travel=()=>({fromId:'previous',toId:'venue-museum',sourceUrl:'https://routes.test/route',checkedAt:new Date(now).toISOString(),minutes:40,basis:'provider'});
async function setup(){
 const database=createTestD1(),plans=new PlanRepository(database),created=await plans.createPlan(accounts.owner,people.owner,{kind:'day-out',name:'Evidence test',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:20000});
 const workspace=await plans.loadWorkspace(accounts.owner);addPerson(workspace,people.buyer,'editor');addPerson(workspace,people.viewer,'viewer');
 workspace.recommendations={destinationKey:cityKey(workspace.plan.destination),resolvedCity:'Toronto',fetchedAt:new Date(now).toISOString(),source:'open-places',entries:[{id:'venue-museum',name:'Saved museum',category:'Activity',area:'Toronto',description:'Saved source place',sourceUrl:'https://supplier.test/museum',officialWebsite:'https://supplier.test/',latitude:43.65,longitude:-79.38}]};
 workspace.items=[{id:'previous',name:'Earlier stop',category:'Activity',start:'2027-04-04T12:45:00-04:00',duration:60,price:0,participants:[people.owner.id,people.buyer.id],shares:{[people.owner.id]:0,[people.buyer.id]:0},allocation:'equal',values:{},revision:1,approvals:[],status:'scheduled',booking:'unconfirmed',policy:'Outside visit',source:'User entered place',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'},
  {id:'owner-only',name:'Owner activity',category:'Activity',start:'2027-04-04T17:00:00-04:00',duration:30,price:0,participants:[people.owner.id],shares:{[people.owner.id]:0},allocation:'equal',values:{},revision:1,approvals:[],status:'scheduled',booking:'unconfirmed',policy:'Outside visit',source:'User entered place',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'}];
 await plans.saveWorkspace(accounts.owner,workspace,workspace.version);const id=created.state.plan.id,evidence=new PlanningEvidenceRepository(database);
 const mutation=async(kind='supplier',facts=source(),version=0)=>({kind,planVersion:(await plans.getPlan(id,people.owner)).version,version,evidence:facts,confirm:true});
 return {database,plans,id,evidence,mutation};
}
async function check(name,run){const fixture=await setup();try{await run(fixture);checks++;console.log(`PASS ${name}`);}finally{fixture.database.close();}}
const count=database=>database.prepare('SELECT COUNT(*) AS count FROM planning_evidence').first('count');

await check('Actual migration persists owner-confirmed supplier/travel facts and supplies checker-compatible options',async t=>{
 const before=(await t.plans.getPlan(t.id,people.owner)).state;
 const supplier=await t.evidence.save(t.id,people.owner,await t.mutation(),now);assert.equal(supplier.version,1);assert.equal(supplier.provenance,'owner-confirmed');assert.equal(supplier.liveInventoryVerified,false);
 await t.evidence.save(t.id,people.owner,await t.mutation('travel',travel()),now);
 const options=await loadPlanningEvidence(t.database,accounts.owner,t.id,{now});assert.equal(options.supplierEvidence.length,1);assert.equal(options.travelEvidence.length,1);assert.equal(options.travelEvidence[0].minutes,40);
 const candidate={id:'venue-museum',name:'Saved museum',category:'Activity',start:'2027-04-04T14:00:00-04:00',duration:60,participants:[people.owner.id],price:0};
 const preferences={[people.owner.id]:{...defaultPlanningPreferences('America/Toronto'),availability:[{start:'2027-04-04T08:00:00-04:00',end:'2027-04-04T20:00:00-04:00',status:'available'}],dietaryNeeds:['vegan'],accessibilityNeeds:['step-free']}};
 const report=checkPlanningConstraints(before,[candidate],preferences,{...options,now}),codes=report.issues.map(issue=>issue.code);
  assert.ok(!codes.includes('HOURS_UNKNOWN'));assert.ok(!codes.includes('DIETARY_UNKNOWN'));assert.ok(!codes.includes('ACCESSIBILITY_UNKNOWN'));assert.ok(codes.includes('TRAVEL_CONFLICT'));
  assert.ok(codes.includes('TRAVEL_UNKNOWN'),'The unrelated onward leg remains unknown rather than borrowing evidence for the previous leg');
 assert.deepEqual((await t.plans.getPlan(t.id,people.owner)).state,before,'Shared plan and financial state are untouched');
});
await check('A distinct draft ID uses only its server-bound saved source identity for supplier and travel evidence',async t=>{
 await t.evidence.save(t.id,people.owner,await t.mutation(),now);await t.evidence.save(t.id,people.owner,await t.mutation('travel',travel()),now);
 const state=(await t.plans.getPlan(t.id,people.owner)).state;state.items=state.items.filter(item=>item.id==='previous');
 const options=await loadPlanningEvidence(t.database,accounts.owner,t.id,{now}),candidate={id:'draft-unique-0',evidenceId:'venue-museum',name:'Saved museum',category:'Activity',location:'Toronto',start:'2027-04-04T14:00:00-04:00',duration:60,participants:[people.owner.id],price:0};
 const pref={...defaultPlanningPreferences('America/Toronto'),availability:[{start:'2027-04-04T08:00:00-04:00',end:'2027-04-04T20:00:00-04:00',status:'available'}]};
 let report=checkPlanningConstraints(state,[candidate],{[people.owner.id]:pref},{...options,now}),codes=report.issues.map(issue=>issue.code);
 assert.ok(!codes.includes('INVALID_ITEM'));assert.ok(!codes.includes('HOURS_UNKNOWN'));assert.ok(!codes.includes('TRAVEL_UNKNOWN'));assert.ok(codes.includes('TRAVEL_CONFLICT'));
 report=checkPlanningConstraints(state,[{...candidate,evidenceId:'unmatched-place'}],{[people.owner.id]:pref},{...options,now});codes=report.issues.map(issue=>issue.code);
 assert.ok(codes.includes('HOURS_UNKNOWN'));assert.ok(codes.includes('TRAVEL_UNKNOWN'));
});
await check('Strict schemas reject invented IDs, insecure sources, credentials, missing confirmation and malformed fact windows',async t=>{
 const base=await t.mutation();
 for(const input of [{...base,confirm:false},{...base,actor:people.owner.id},{...base,evidence:{...source(),itemId:'invented-place'}},
  {...base,evidence:{...source(),sourceUrl:'http://supplier.test/hours'}},{...base,evidence:{...source(),sourceUrl:'https://name:password@supplier.test/hours'}},
  {...base,evidence:{...source(),sourceUrl:'https://127.0.0.1/hours'}},{...base,evidence:{...source(),sourceUrl:'https://place.local/hours'}},
  {...base,evidence:{...source(),openIntervals:[{start:'2027-04-04T10:00:00',end:'2027-04-04T17:00:00'}]}},
  {...base,evidence:{...source(),openIntervals:[{start:'2027-04-04T17:00:00Z',end:'2027-04-04T10:00:00Z'}]}},
  {...base,evidence:{...source(),dietary:{vegan:'guaranteed'}}},
  {...base,evidence:{...source(),availability:[{start:'2027-04-04T00:00:00Z'}]}},
  {...base,evidence:{itemId:'venue-museum',sourceUrl:'https://supplier.test',checkedAt:new Date(now).toISOString()}}])
  await assert.rejects(()=>t.evidence.save(t.id,people.owner,input,now));
 assert.equal(await count(t.database),0);
});
await check('Freshness rejects stale/future-dated/expired writes and ages persisted evidence back to unknown',async t=>{
 for(const facts of [source(),{...source(),checkedAt:new Date(now-86400001).toISOString()},{...source(),checkedAt:new Date(now+300001).toISOString()},
  {...source(),checkedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now-1).toISOString()}]){
  if(facts.checkedAt===source().checkedAt)continue;await assert.rejects(async()=>t.evidence.save(t.id,people.owner,await t.mutation('supplier',facts),now),error=>error.code==='STALE_PLANNING_EVIDENCE');
 }
 await t.evidence.save(t.id,people.owner,await t.mutation(),now);
 const expired=await loadPlanningEvidence(t.database,accounts.owner,t.id,{now:now+86400001});assert.deepEqual(expired.supplierEvidence,[]);
 const listed=await t.evidence.list(t.id,people.owner,now+86400001);assert.equal(listed.records[0].fresh,false);assert.equal(listed.records[0].provenance,'owner-confirmed');
});
await check('Only the owner writes or revokes; unrelated accounts cannot read even existing evidence',async t=>{
 const saved=await t.evidence.save(t.id,people.owner,await t.mutation(),now),revoke={kind:'supplier',itemId:'venue-museum',planVersion:(await t.plans.getPlan(t.id,people.owner)).version,version:saved.version};
 for(const person of [people.buyer,people.viewer]){await assert.rejects(async()=>t.evidence.save(t.id,person,await t.mutation(),now),error=>error.status===403);await assert.rejects(()=>t.evidence.revoke(t.id,person,revoke,now),error=>error.status===403);}
 await assert.rejects(()=>t.evidence.list(t.id,people.other),error=>error.status===404);
 await assert.rejects(()=>loadPlanningEvidence(t.database,accounts.other,t.id,{now}),error=>error.status===404);
});
await check('Member reads show relevant shared source facts but never private needs or other participants’ evidence',async t=>{
 await new PlanningPreferencesRepository(t.database).update(t.id,people.owner,{...defaultPlanningPreferences('America/Toronto'),dietaryNeeds:['private-owner-need'],availability:[{start:'2027-04-04T01:00:00Z',end:'2027-04-04T02:00:00Z',status:'available'}]},0);
 await t.evidence.save(t.id,people.owner,await t.mutation(),now);
 await t.evidence.save(t.id,people.owner,await t.mutation('supplier',{...source(),itemId:'owner-only'}),now);
 await t.evidence.save(t.id,people.owner,await t.mutation('travel',travel()),now);
 const buyer=await t.evidence.list(t.id,people.buyer,now),viewer=await t.evidence.list(t.id,people.viewer,now);
 assert.equal(buyer.records.length,2);assert.equal(viewer.records.length,1);assert.equal(viewer.records[0].evidence.itemId,'venue-museum');
 assert.equal(JSON.stringify(buyer).includes('private-owner-need'),false);assert.equal(JSON.stringify(buyer).includes('availability'),false);
 assert.equal((await t.evidence.list(t.id,people.owner,now)).records.length,3);
});
await check('Concurrent confirmation uses evidence CAS and rejects stale plan versions without overwrites',async t=>{
 const input=await t.mutation(),results=await Promise.allSettled([t.evidence.save(t.id,people.owner,input,now),t.evidence.save(t.id,people.owner,{...input,evidence:{...source(),openIntervals:[]}},now)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,409);assert.equal(await count(t.database),1);
 const stored=(await t.evidence.list(t.id,people.owner,now)).records[0];await assert.rejects(()=>t.evidence.save(t.id,people.owner,{...input,version:stored.version,planVersion:input.planVersion+1},now),error=>error.status===409);
 assert.equal((await t.evidence.list(t.id,people.owner,now)).records[0].version,1);
});
await check('Revocation persists a versioned tombstone and cannot be bypassed by stale delete/recreate writes',async t=>{
 const input=await t.mutation();await t.evidence.save(t.id,people.owner,input,now);
 const revoked=await t.evidence.revoke(t.id,people.owner,{kind:'supplier',itemId:'venue-museum',planVersion:input.planVersion,version:1},now);assert.equal(revoked.version,2);
 assert.deepEqual((await loadPlanningEvidence(t.database,accounts.owner,t.id,{now})).supplierEvidence,[]);
 assert.equal((await t.evidence.list(t.id,people.owner,now)).records[0].status,'revoked');assert.equal((await t.evidence.list(t.id,people.buyer,now)).records.length,0);
 await assert.rejects(()=>t.evidence.save(t.id,people.owner,input,now),error=>error.status===409);
 assert.equal((await t.evidence.save(t.id,people.owner,{...input,version:2},now)).version,3);
});
await check('Renamed, relocated, removed or wrong-city subjects invalidate old evidence until explicitly reconfirmed',async t=>{
 const input=await t.mutation();await t.evidence.save(t.id,people.owner,input,now);
 let workspace=await t.plans.loadWorkspace(accounts.owner);workspace.recommendations.entries[0].name='A renamed venue';await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);
 assert.deepEqual((await loadPlanningEvidence(t.database,accounts.owner,t.id,{now})).supplierEvidence,[]);
 const old=(await t.evidence.list(t.id,people.owner,now)).records[0];assert.equal(old.applicable,false);assert.equal(old.fresh,false);assert.equal((await t.evidence.list(t.id,people.buyer,now)).records.length,0);
 await t.evidence.save(t.id,people.owner,await t.mutation('supplier',source(),old.version),now);assert.equal((await loadPlanningEvidence(t.database,accounts.owner,t.id,{now})).supplierEvidence.length,1);
 workspace=await t.plans.loadWorkspace(accounts.owner);workspace.recommendations.destinationKey='another city';await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);
 assert.deepEqual((await loadPlanningEvidence(t.database,accounts.owner,t.id,{now})).supplierEvidence,[]);
});
await check('Travel estimates remain estimates and expired travel cannot establish a known route',async t=>{
 const facts={...travel(),basis:'estimate',expiresAt:new Date(now+60000).toISOString()};await t.evidence.save(t.id,people.owner,await t.mutation('travel',facts),now);
 const options=await loadPlanningEvidence(t.database,accounts.owner,t.id,{now});assert.equal(options.travelEvidence[0].basis,'estimate');assert.equal(options.travelEvidence[0].provenance,'owner-confirmed');
 assert.deepEqual((await loadPlanningEvidence(t.database,accounts.owner,t.id,{now:now+60001})).travelEvidence,[]);
 await assert.rejects(async()=>t.evidence.save(t.id,people.owner,await t.mutation('travel',{...travel(),toId:'previous'}),now));
});
await check('Atomic owner-role guard prevents evidence persistence when authority changes after initial access',async t=>{
 const input=await t.mutation(),original=t.database.batch.bind(t.database);let changed=false;
 t.database.batch=async statements=>{if(!changed){changed=true;await t.database.prepare("UPDATE plan_members SET role='editor' WHERE owner=? AND plan_id=? AND member_id=?").bind(accounts.owner,t.id,people.owner.id).run();}return original(statements);};
 await assert.rejects(()=>t.evidence.save(t.id,people.owner,input,now),error=>error.status===409);assert.equal(await count(t.database),0);
});
await check('Evidence is isolated between plans and becomes unavailable after plan deletion',async t=>{
 await t.evidence.save(t.id,people.owner,await t.mutation(),now);
 const other=await t.plans.createPlan(accounts.owner,people.owner,{kind:'day-out',name:'Another plan',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:10000});
 assert.deepEqual((await loadPlanningEvidence(t.database,accounts.owner,other.state.plan.id,{now})).supplierEvidence,[]);
 await t.database.prepare("UPDATE plans SET status='deleted',version=version+1 WHERE owner=? AND id=?").bind(accounts.owner,t.id).run();
 await assert.rejects(()=>loadPlanningEvidence(t.database,accounts.owner,t.id,{now}),error=>error.status===404);await assert.rejects(()=>t.evidence.list(t.id,people.owner,now),error=>error.status===404);
});
await check('Strict payloads reject unbounded source maps and source verification spoofing',async t=>{
 const input=await t.mutation();assert.throws(()=>parsePlanningEvidenceMutation({...input,evidence:{...source(),dietary:Object.fromEntries(Array.from({length:31},(_,index)=>[`need-${index}`,'supported']))}},now));
 assert.throws(()=>parsePlanningEvidenceMutation({...input,evidence:{...source(),openIntervals:Array.from({length:51},()=>source().openIntervals[0])}},now));
 assert.throws(()=>parsePlanningEvidenceMutation({...input,evidence:{...source(),provenance:'provider-verified'}},now));
 assert.equal(MAX_PLANNING_EVIDENCE,200);
});
await check('The per-plan active evidence cap is enforced atomically while existing records remain refreshable',async t=>{
 const workspace=await t.plans.loadWorkspace(accounts.owner),template=workspace.recommendations.entries[0];
 workspace.recommendations.entries=Array.from({length:MAX_PLANNING_EVIDENCE+1},(_,index)=>({...template,id:`saved-place-${index}`,name:`Saved source ${index}`}));
 await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);const planVersion=(await t.plans.getPlan(t.id,people.owner)).version;
 for(let index=0;index<MAX_PLANNING_EVIDENCE;index++)await t.evidence.save(t.id,people.owner,{kind:'supplier',planVersion,version:0,evidence:{...source(),itemId:`saved-place-${index}`},confirm:true},now);
 assert.equal(await count(t.database),MAX_PLANNING_EVIDENCE);
 await assert.rejects(()=>t.evidence.save(t.id,people.owner,{kind:'supplier',planVersion,version:0,evidence:{...source(),itemId:`saved-place-${MAX_PLANNING_EVIDENCE}`},confirm:true},now),error=>error.status===409);
 assert.equal((await t.evidence.save(t.id,people.owner,{kind:'supplier',planVersion,version:1,evidence:{...source(),itemId:'saved-place-0'},confirm:true},now)).version,2);
 assert.equal((await t.evidence.list(t.id,people.buyer,now)).records.length,MAX_PLANNING_EVIDENCE);
});

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-evidence-'));
globalThis.evidenceRouteEnv={};
try{
 const outfile=join(directory,'route.mjs');await build({entryPoints:[resolve(root,'app/api/plans/[planId]/planning-evidence/route.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
  plugins:[{name:'binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.evidenceRouteEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(outfile).href);
 await check('Actual route enforces sign-in, origin, owner authority, bounded strict JSON and member-relevant reads',async t=>{
  globalThis.evidenceRouteEnv.DB=t.database;const context={params:Promise.resolve({planId:t.id})};
  const request=(method='GET',body,options={})=>new Request(`${origin}/api/plans/${t.id}/planning-evidence`,{method,headers:{origin:options.origin??origin,'content-type':options.contentType??'application/json',...(options.account===null?{}:{'oai-authenticated-user-id':options.account??accounts.owner})},...(method==='GET'?{}:{body:options.raw??JSON.stringify(body)})});
  assert.equal((await route.GET(request('GET',undefined,{account:null}),context)).status,401);
  assert.equal((await route.GET(request('GET',undefined,{account:accounts.other}),context)).status,404);
  const input=await t.mutation();assert.equal((await route.POST(request('POST',input,{origin:'https://foreign.test'}),context)).status,400);
  assert.equal((await route.POST(request('POST',input,{account:accounts.buyer}),context)).status,403);
  assert.equal((await route.POST(request('POST',input,{account:accounts.viewer}),context)).status,403);
  assert.equal((await route.POST(request('POST',input,{contentType:'text/plain'}),context)).status,415);
  assert.equal((await route.POST(request('POST',input,{raw:'{broken'}),context)).status,400);
  assert.equal((await route.POST(request('POST',input,{raw:' '.repeat(20001)}),context)).status,413);
  const saved=await route.POST(request('POST',input),context);assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/private, no-store/);
  const owner=await saved.json();assert.equal(owner.provenance,'owner-confirmed');assert.equal(owner.liveInventoryVerified,false);
  const member=await route.GET(request('GET',undefined,{account:accounts.buyer}),context);assert.equal(member.status,200);assert.equal((await member.json()).records[0].evidence.itemId,'venue-museum');
  const revoke={kind:'supplier',itemId:'venue-museum',planVersion:input.planVersion,version:1};
  assert.equal((await route.DELETE(request('DELETE',revoke,{account:accounts.buyer}),context)).status,403);
  assert.equal((await route.DELETE(request('DELETE',revoke),context)).status,200);
  delete globalThis.evidenceRouteEnv.DB;
 });
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.evidenceRouteEnv;}
assert.equal(networkCalls,0);console.log(`Planning evidence: ${checks} real SQLite, route and freshness checks passed; no provider calls.`);
