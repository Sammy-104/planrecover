import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {validatePlanDraft} from '../lib/ai-plan.ts';
import {acquireAiLease} from '../lib/ai-usage.ts';
import {PlanningEvidenceRepository} from '../lib/planning-evidence.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});
const directory=mkdtempSync(join(root,'build','backend-ai-'));
const origin='https://planrecover.test',owner='ai-owner-account',memberId=await accountPersonId(owner);
const identity={id:memberId,name:'AI route tester'};
globalThis.backendTestEnv={DB:undefined};
let calls=0,providerReply;
globalThis.fetch=async (url,options)=>{
  calls++;
  assert.match(String(url),/^https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\/model\//);
  assert.equal(options.method,'POST');
  return providerReply(JSON.parse(options.body));
};
const configured={AWS_BEARER_TOKEN_BEDROCK:'fixture-bedrock-key',BEDROCK_REGION:'us-east-1',BEDROCK_MODEL_ID:'fixture.model-v1'};
const facts=()=>({summary:'A suggested afternoon.',currency:'CAD',items:[{
  name:'Museum visit',category:'Activity',localStart:'2027-04-04T14:00',duration:60,price:null,
  participants:[memberId],location:'Toronto',reason:'An indoor stop.',taskOwner:null,
}],warnings:[]});
const reply=data=>Response.json({output:{message:{role:'assistant',content:[{text:JSON.stringify(data)}]}},
  stopReason:'end_turn',usage:{inputTokens:80,outputTokens:40,totalTokens:120}});
let checks=0;
try{
  const routes={};
  for(const [name,path] of Object.entries({draft:'app/api/plans/[planId]/draft/route.ts',plan:'app/api/plans/[planId]/route.ts'})){
    const outfile=join(directory,`${name}.mjs`);
    await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
      plugins:[{name:'binding',setup(builder){
        builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));
        builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.backendTestEnv;',loader:'js'}));
      }}]});
    routes[name]=await import(pathToFileURL(outfile).href);
  }
  function request(planId,body,{account=owner,requestOrigin=origin,method='POST',raw}={}){
    return new Request(`${origin}/api/plans/${planId}/draft`,{method,headers:{'content-type':'application/json',origin:requestOrigin,
      ...(account?{'oai-authenticated-user-id':account}:{})},body:raw??JSON.stringify(body)});
  }
  const context=planId=>({params:Promise.resolve({planId})});
  async function decoded(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;}
  async function check(name,run){
    const database=createTestD1(),repository=new PlanRepository(database);
    Object.assign(globalThis.backendTestEnv,{DB:database,...configured});calls=0;providerReply=()=>reply(facts());
    try{
      const record=await repository.createPlan(owner,identity,{kind:'day-out',name:'AI route test',destination:'Toronto',
        start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
      await run({database,repository,record,id:record.state.plan.id,body:{version:record.version,prompt:'Suggest an afternoon museum visit.'}});
      checks++;console.log(`PASS ${name}`);
    }finally{database.close();delete globalThis.backendTestEnv.DB;}
  }
  await check('AI previews preserve plan and ledger, unknown costs, and require human review',async({database,repository,record,id,body})=>{
    const response=await routes.draft.POST(request(id,body),context(id));
    assert.match(response.headers.get('cache-control'),/private, no-store/);
    const data=await decoded(response);
    assert.equal(data.provider,'bedrock');assert.equal(data.draft.requiresReview,true);
    assert.equal(data.draft.items[0].price,null);assert.equal(data.draft.items[0].shares,null);
    assert.match(data.draft.items[0].start,/-04:00$/);
    assert.ok(data.draft.warnings.some(w=>w.includes('unknown')));
    assert.deepEqual((await repository.getPlan(id,identity)).state,record.state);
    assert.equal(calls,1);
    assert.equal(database.sqlite.prepare("SELECT count(*) n FROM bedrock_operations WHERE plan_id=? AND feature='plan-draft' AND state='succeeded'").get(id).n,1);
    assert.equal(database.sqlite.prepare('SELECT total_tokens FROM bedrock_invocations').get().total_tokens,120);
    assert.equal(database.sqlite.prepare("SELECT count(*) n FROM bedrock_workflow_evidence WHERE plan_id=? AND scope='draft-preview-constructed'").get(id).n,1);
  });
  await check('Authentication, origin and membership fail before inference',async({id,body})=>{
    await decoded(await routes.draft.POST(request(id,body,{account:null}),context(id)),401);
    await decoded(await routes.draft.POST(request(id,body,{account:'stranger'}),context(id)),404);
    await decoded(await routes.draft.POST(request(id,body,{requestOrigin:'https://bad.test'}),context(id)),400);
    assert.equal(calls,0);
  });
  await check('Viewer roles cannot request inference',async({repository,id,body})=>{
    const rootState=await repository.loadWorkspace(owner),viewer={id:await accountPersonId('viewer-account'),name:'Viewer'};
    addPerson(rootState,viewer,'viewer');await repository.saveWorkspace(owner,rootState,rootState.version);
    await decoded(await routes.draft.POST(request(id,body,{account:'viewer-account'}),context(id)),403);assert.equal(calls,0);
  });
  await check('Missing AWS settings return a clear status without changing the plan',async({repository,record,id,body})=>{
    for(const key of Object.keys(configured))delete globalThis.backendTestEnv[key];
    const error=await decoded(await routes.draft.POST(request(id,body),context(id)),503);
    assert.equal(error.code,'BEDROCK_NOT_CONFIGURED');assert.equal(calls,0);
    assert.deepEqual((await repository.getPlan(id,identity)).state,record.state);
  });
  await check('Strict requests and bounded bodies fail before inference',async({id,body})=>{
    await decoded(await routes.draft.POST(request(id,{...body,actor:'forged'}),context(id)),400);
    await decoded(await routes.draft.POST(request(id,body,{raw:' '.repeat(20001)}),context(id)),413);
    await decoded(await routes.draft.POST(request(id,{...body,version:body.version+1}),context(id)),409);assert.equal(calls,0);
  });
  await check('Invalid AI currency, participants, dates, fractional money and action fields are rejected',async({id,body})=>{
    for(const mutate of [data=>data.currency='USD',data=>data.items[0].participants=['outsider'],data=>data.items[0].localStart='2027-04-05T14:00',
      data=>data.items[0].localStart='2027-02-30T14:00',data=>data.items[0].price=1.5,data=>data.items[0].approvals=[memberId],
      data=>data.items[0].duration=1440,data=>{data.items[0].category='Preparation';data.items[0].price=0;},
      data=>data.items[0].taskOwner=memberId]){
      const data=facts();mutate(data);providerReply=()=>reply(data);
      const error=await decoded(await routes.draft.POST(request(id,body),context(id)),502);assert.equal(error.code,'BEDROCK_OUTPUT');
    }
  });
  await check('AI prompts omit other members private settings, repayment links and account IDs',async({repository,id})=>{
    const rootState=await repository.loadWorkspace(owner),other={id:await accountPersonId('other-private-account'),name:'Friend'};
    addPerson(rootState,other,'editor');rootState.preferences[other.id]={budget:123456789,cash:654321987,reserve:0,financing:999,
      pace:'private-pace',interests:['private-interest'],paypalMe:'https://paypal.me/privatefriend'};
    rootState.preferences[memberId].paypalMe='https://paypal.me/privateowner';
    await repository.saveWorkspace(owner,rootState,rootState.version);
    const version=(await repository.getPlan(id,identity)).version;
    providerReply=payload=>{const text=JSON.stringify(payload);
      for(const secret of ['123456789','654321987','private-pace','private-interest','paypal.me','ai-owner-account','other-private-account'])assert.ok(!text.includes(secret),secret);
      return reply(facts());};
    await decoded(await routes.draft.POST(request(id,{version,prompt:'An afternoon plan.'}),context(id)));
  });
  await check('Code flags cumulative budget, cash and schedule conflicts',async({id,body})=>{
    const data=facts();data.items[0].price=6000;data.items.push({...data.items[0],name:'Another museum'});providerReply=()=>reply(data);
    const result=await decoded(await routes.draft.POST(request(id,body),context(id)));
    assert.ok(result.draft.warnings.some(w=>w.includes('budget')));assert.ok(result.draft.warnings.some(w=>w.includes('cash')));
    assert.deepEqual(result.draft.items[1].conflicts,['Museum visit']);
  });
  await check('A plan edited during inference invalidates the preview',async({repository,id,body})=>{
    providerReply=async()=>{await repository.updatePlan(id,identity,body.version,{type:'add_item',name:'New stop',category:'Free stop',
      start:'2027-04-04T12:00:00-04:00',duration:30,price:0,participants:[memberId]});return reply(facts());};
    await decoded(await routes.draft.POST(request(id,body),context(id)),409);
    assert.equal((await repository.getPlan(id,identity)).state.items.length,1);
  });
  await check('Revoked editing access during inference invalidates the preview',async({database,id,body})=>{
    providerReply=()=>{database.sqlite.prepare("UPDATE plan_members SET role='viewer' WHERE plan_id=? AND member_id=?").run(id,memberId);return reply(facts());};
    await decoded(await routes.draft.POST(request(id,body),context(id)),403);
  });
  await check('Private budget edits during inference invalidate stale advice',async({database,id,body})=>{
    providerReply=()=>{
      const row=database.sqlite.prepare('SELECT body FROM member_preferences WHERE owner=? AND plan_id=? AND member_id=?').get(owner,id,memberId);
      const preferences=JSON.parse(row.body);preferences.budget=100;
      database.sqlite.prepare('UPDATE member_preferences SET body=?,version=version+1 WHERE owner=? AND plan_id=? AND member_id=?')
        .run(JSON.stringify(preferences),owner,id,memberId);return reply(facts());};
    await decoded(await routes.draft.POST(request(id,body),context(id)),409);
  });
  await check('Durable inference leases block concurrent calls and fence stale releases',async({database})=>{
    const now=1800000000000,first=await acquireAiLease(database,memberId,'plan-draft',now);
    await assert.rejects(acquireAiLease(database,memberId,'plan-draft',now+1),error=>error.code==='AI_RATE_LIMIT');
    const independent=await acquireAiLease(database,memberId,'receipt-extraction',now);await independent();
    const replacement=await acquireAiLease(database,memberId,'plan-draft',now+65001);
    await first();
    await assert.rejects(acquireAiLease(database,memberId,'plan-draft',now+65002),error=>error.code==='AI_RATE_LIMIT');
    await replacement();
  });
  await check('Hourly inference budget persists and resets only in the next window',async({database})=>{
    const hour=1800000000000,window=Math.floor(hour/3600000)*3600000;
    for(let index=0;index<20;index++){const release=await acquireAiLease(database,memberId,'plan-draft',window+index);await release();}
    await assert.rejects(acquireAiLease(database,memberId,'plan-draft',window+21),error=>error.code==='AI_RATE_LIMIT');
    const next=await acquireAiLease(database,memberId,'plan-draft',window+3600000);await next();
    assert.equal(database.sqlite.prepare('SELECT request_count FROM ai_usage_limits WHERE member_id=? AND feature=?').get(memberId,'plan-draft').request_count,1);
  });
  await check('Provider failures are sanitized and never retried',async({database,id,body})=>{
    providerReply=()=>new Response('secret-provider-debug',{status:403});
    const error=await decoded(await routes.draft.POST(request(id,body),context(id)),503);
    assert.equal(error.code,'BEDROCK_AUTH');assert.ok(!JSON.stringify(error).includes('secret-provider'));assert.equal(calls,1);
    const recorded=database.sqlite.prepare('SELECT state,error_code,total_tokens,diagnostic FROM bedrock_invocations').get();
    assert.equal(recorded.state,'failed');assert.equal(recorded.error_code,'BEDROCK_AUTH');assert.equal(recorded.total_tokens,null);
    assert.ok(!JSON.stringify(recorded).includes('secret-provider'));
    assert.equal(database.sqlite.prepare('SELECT count(*) n FROM bedrock_workflow_evidence').get().n,0);
  });
  await check('Reviewed free draft can use existing authenticated plan edit without financial events',async({repository,id,body})=>{
    const data=facts();data.items[0].price=0;data.items[0].category='Free stop';providerReply=()=>reply(data);
    const preview=await decoded(await routes.draft.POST(request(id,body),context(id)));
    await decoded(await routes.plan.PATCH(request(id,{version:body.version,action:preview.draft.items[0].action},{method:'PATCH'}),context(id)));
    const saved=await repository.getPlan(id,identity);assert.equal(saved.state.items.length,1);assert.equal(saved.state.events.length,0);
    assert.deepEqual(saved.state.items[0].approvals,[]);assert.equal(saved.state.items[0].booking,'unconfirmed');
  });
  await check('Nonexistent daylight saving time and duplicate participants never become plan edits',async({record})=>{
    const data=facts(),state=structuredClone(record.state);state.plan.start=state.plan.end='2027-03-14';
    data.items[0].localStart='2027-03-14T02:30';assert.throws(()=>validatePlanDraft(data,state));
    data.items[0].localStart='2027-03-14T14:00';data.items[0].participants=[memberId,memberId];assert.throws(()=>validatePlanDraft(data,state));
  });
  await check('Saved supplier evidence attaches only to exact source identities and detects closure',async({database,repository,id,record})=>{
    const saved=await repository.updatePlan(id,identity,record.version,{type:'add_item',name:'Museum visit',category:'Activity',
      start:'2027-04-04T08:00:00-04:00',duration:60,price:0,participants:[memberId],location:'Toronto'});
    const itemId=saved.state.items[0].id,evidence=new PlanningEvidenceRepository(database);
    await evidence.save(id,identity,{kind:'supplier',planVersion:saved.version,version:0,confirm:true,evidence:{itemId,
      sourceUrl:'https://supplier.example.com/hours',checkedAt:new Date().toISOString(),openIntervals:[{start:'2027-04-04T08:00:00-04:00',end:'2027-04-04T12:00:00-04:00'}]}});
    const body={version:saved.version,prompt:'Suggest another museum visit.'},before=await repository.loadWorkspace(owner);
    providerReply=payload=>{const prompt=JSON.parse(payload.messages[0].content[0].text);assert.equal(prompt.confirmedSources[0].name,'Museum visit');return reply(facts());};
    const result=await decoded(await routes.draft.POST(request(id,body),context(id)));
    assert.ok(result.draft.constraints.issues.some(issue=>issue.code==='CLOSED'));assert.equal(result.draft.constraints.hasBlockingIssues,true);
    const changed=facts();changed.items[0].location='Different Toronto venue';providerReply=()=>reply(changed);
    const unknown=await decoded(await routes.draft.POST(request(id,body),context(id)));
    assert.ok(unknown.draft.constraints.issues.some(issue=>issue.code==='HOURS_UNKNOWN'));
    assert.deepEqual(await repository.loadWorkspace(owner),before);
  });
  await check('Source evidence changed during inference invalidates stale AI advice',async({database,repository,id,record})=>{
    const saved=await repository.updatePlan(id,identity,record.version,{type:'add_item',name:'Museum visit',category:'Activity',
      start:'2027-04-04T08:00:00-04:00',duration:60,price:0,participants:[memberId],location:'Toronto'});
    const itemId=saved.state.items[0].id,evidence=new PlanningEvidenceRepository(database),input={kind:'supplier',planVersion:saved.version,version:0,confirm:true,
      evidence:{itemId,sourceUrl:'https://supplier.example.com/hours',checkedAt:new Date().toISOString(),openIntervals:[]}};
    await evidence.save(id,identity,input);
    providerReply=async()=>{await evidence.revoke(id,identity,{kind:'supplier',planVersion:saved.version,version:1,itemId});return reply(facts());};
    await decoded(await routes.draft.POST(request(id,{version:saved.version,prompt:'Plan my visit.'}),context(id)),409);
  });
  console.log(`${checks} AI route checks passed.`);
}finally{rmSync(directory,{recursive:true,force:true});}
