import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/d1.mjs';
import { converseJson, converseAgent, bedrockConfig, BedrockError } from '../lib/bedrock.ts';
import { withTrackedBedrock, readBedrockOperationsSummary, bedrockSharedControls, bedrockConfigurationHash } from '../lib/bedrock-operations.ts';

const settings={AWS_BEARER_TOKEN_BEDROCK:'private-fixture-key',BEDROCK_REGION:'ca-central-1',BEDROCK_MODEL_ID:'fixture-model',BEDROCK_MAX_TOKENS:'128'};
const context={owner:'owner-account',memberId:'member-id',planId:'plan-id',feature:'chat'};
const request={system:'Private test system',prompt:'Private test evidence',validate:value=>{if(value.ok!==true)throw Error('private rejected text');return value;}};
const envelope=(overrides={})=>({stopReason:'end_turn',output:{message:{role:'assistant',content:[{text:'{"ok":true}'}]}},usage:{inputTokens:20,outputTokens:10,totalTokens:30},...overrides});
const response=body=>Response.json(body??envelope());
let checks=0,network=0;
async function check(name,work){const db=createTestD1();try{await work(db);checks++;console.log('PASS '+name);}finally{db.close();}}
const rows=(db,table)=>db.sqlite.prepare(`SELECT * FROM ${table}`).all();
async function tracked(db,options={},fetcher=async()=>response(),feature='chat'){
 return withTrackedBedrock(db,{...settings,...options},{...context,feature},observer=>converseJson(bedrockConfig({...settings,...options}),request,{observer,fetch:fetcher}));
}
async function manual(db,options={},scope=context,usage={inputTokens:50,outputTokens:20,totalTokens:70},reservation=208){
 return withTrackedBedrock(db,{...settings,...options},scope,async observer=>{
  const id=await observer.beforeInvocation({estimatedInputTokens:reservation-128,maxOutputTokens:128,timeoutMs:1000});
  if(usage)await observer.recordUsage(id,usage);
  await observer.afterInvocation(id,{outcome:'succeeded',latencyMs:1});return observer.operationId;
 });
}

await check('Shared settings are explicit, bounded and never guess pricing',async db=>{
 assert.deepEqual(bedrockSharedControls(settings),{requestsPerMinute:20,tokensPerMinute:400000,dailyTokenLimit:null,inputUsdPerMillionTokens:null,outputUsdPerMillionTokens:null});
 for(const change of [{BEDROCK_SHARED_REQUESTS_PER_MINUTE:'0'},{BEDROCK_SHARED_REQUESTS_PER_MINUTE:'121'},{BEDROCK_SHARED_TOKENS_PER_MINUTE:'Infinity'},
  {BEDROCK_DAILY_TOKEN_LIMIT:'1'},{BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'0.1'},{BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'-1',BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS:'0.2'}])
  await assert.rejects(tracked(db,change),error=>error.code==='BEDROCK_CONFIG');
 assert.equal(rows(db,'bedrock_operations').length,0);
 assert.notEqual(await bedrockConfigurationHash(settings),await bedrockConfigurationHash({...settings,AWS_BEARER_TOKEN_BEDROCK:'rotated-key'}));
});
await check('Known billed usage survives invalid application output without retaining private content',async db=>{
 await assert.rejects(tracked(db,{},async()=>response(envelope({output:{message:{role:'assistant',content:[{text:'{"ok":false,"private":"untrusted-secret"}'}]}}}))),error=>error.code==='BEDROCK_OUTPUT');
 const op=rows(db,'bedrock_operations')[0],inv=rows(db,'bedrock_invocations')[0];
 assert.equal(op.state,'failed');assert.equal(inv.state,'failed');assert.equal(inv.total_tokens,30);assert.equal(inv.estimated_cost_usd,null);
 assert.equal(JSON.parse(inv.diagnostic).validationReason,'application-schema');
 const durable=JSON.stringify([op,inv]);for(const value of ['private-fixture-key','Private test','untrusted-secret','fixture-model','ca-central-1','arn:'])assert.equal(durable.includes(value),false,value);
 const summary=await readBedrockOperationsSummary(db,settings,context.owner,context.planId);
 assert.equal(summary.features.chat.failed,1);assert.equal(summary.features.chat.knownTokens,30);assert.equal(summary.features.chat.estimatedCostUsd,null);
 assert.equal(summary.scope,'validated-provider-workflow');assert.equal('acceptance' in summary,false);
});
await check('Atomic account admission serializes simultaneous members and profiles before network',async db=>{
 let calls=0,release;const wait=new Promise(resolve=>release=resolve);
 const first=tracked(db,{BEDROCK_SHARED_REQUESTS_PER_MINUTE:'1'},async()=>{calls++;await wait;return response();});
 while(calls===0)await new Promise(resolve=>setTimeout(resolve,1));
 const attempts=await Promise.allSettled(Array.from({length:8},(_,index)=>withTrackedBedrock(db,{...settings,BEDROCK_SHARED_REQUESTS_PER_MINUTE:'1',BEDROCK_MODEL_ID:'other-model'},
  {...context,owner:'different-owner',memberId:'member-'+index,feature:'receipt-image'},observer=>converseJson(bedrockConfig(settings),request,{observer,fetch:async()=>{calls++;return response();}}))));
 assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.code==='BEDROCK_SHARED_LIMIT').length,8);assert.equal(calls,1);
 release();await first;assert.equal(rows(db,'bedrock_invocations').length,1);
});
await check('Rolling-minute limits cross clock boundaries and known usage releases cautious reservations',async db=>{
 const original=Date.now;let now=Date.UTC(2026,9,19,12,0,59);Date.now=()=>now;
 try{
  await manual(db,{BEDROCK_SHARED_REQUESTS_PER_MINUTE:'1'});
  now+=2000;await assert.rejects(manual(db,{BEDROCK_SHARED_REQUESTS_PER_MINUTE:'1'}),error=>error.code==='BEDROCK_SHARED_LIMIT');
  now+=58001;await manual(db,{BEDROCK_SHARED_REQUESTS_PER_MINUTE:'1'});assert.equal(rows(db,'bedrock_invocations').length,2);
 }finally{Date.now=original;}
 const small={BEDROCK_SHARED_TOKENS_PER_MINUTE:'300'};
 // Existing known totals70+70 plus another reservation208 would exceed300, so use a new rolling minute.
 db.sqlite.prepare('UPDATE bedrock_invocations SET started_at=started_at-120000').run();
 await manual(db,small);await manual(db,small);assert.equal(rows(db,'bedrock_invocations').at(-1).total_tokens,70);
});
await check('Unknown usage consumes its reservation and optional daily UTC ceiling fails closed',async db=>{
 const options={BEDROCK_SHARED_TOKENS_PER_MINUTE:'300',BEDROCK_DAILY_TOKEN_LIMIT:'300'};
 await manual(db,options,context,null);
 await assert.rejects(manual(db,options),error=>error.code==='BEDROCK_DAILY_LIMIT');
 assert.equal(rows(db,'bedrock_invocations').length,1);assert.equal(rows(db,'bedrock_invocations')[0].total_tokens,null);
 const summary=await readBedrockOperationsSummary(db,{...settings,...options},context.owner,context.planId);
 assert.equal(summary.features.chat.unknownUsageInvocations,1);assert.equal(summary.controls.reservationIsEstimate,true);assert.equal(summary.controls.dailyWindow,'UTC');
});
await check('The optional daily ceiling changes only at UTC midnight, independently of rolling-minute admission',async db=>{
 const original=Date.now;let now=Date.UTC(2026,9,19,23,59,59);Date.now=()=>now;
 try{
  const options={BEDROCK_DAILY_TOKEN_LIMIT:'300'};
  await manual(db,options,context,null);
  await assert.rejects(manual(db,options),error=>error.code==='BEDROCK_DAILY_LIMIT');
  now+=2000;await manual(db,options);assert.equal(rows(db,'bedrock_invocations').length,2);
 }finally{Date.now=original;}
});
await check('Agent rounds independently reserve shared quota and never silently retry denied calls',async db=>{
 let calls=0;const agent={system:'Read only',prompt:'Prepare a preview',tools:[{name:'preview',description:'Preview',inputSchema:{type:'object'}}],execute:async()=>({review:true})};
 const fetcher=async()=>{calls++;return response(envelope(calls===1?{stopReason:'tool_use',output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'preview-1',name:'preview',input:{}}}]}}}:{output:{message:{role:'assistant',content:[{text:'Review is ready.'}]}}}));};
 await assert.rejects(withTrackedBedrock(db,{...settings,BEDROCK_SHARED_REQUESTS_PER_MINUTE:'1'},{...context,feature:'agent'},observer=>
  converseAgent(bedrockConfig(settings),agent,{observer,fetch:fetcher})),error=>error.code==='BEDROCK_SHARED_LIMIT');
 assert.equal(calls,1);assert.equal(rows(db,'bedrock_invocations').length,1);assert.equal(rows(db,'bedrock_operations')[0].state,'failed');
});
await check('Every successful agent round keeps its own strict token counts',async db=>{
 let calls=0;const agent={system:'Read only',prompt:'Prepare a preview',tools:[{name:'preview',description:'Preview',inputSchema:{type:'object'}}],execute:async()=>({review:true})};
 const value=await withTrackedBedrock(db,settings,{...context,feature:'agent'},observer=>converseAgent(bedrockConfig(settings),agent,{observer,fetch:async()=>{
  calls++;return response(envelope(calls===1?{stopReason:'tool_use',output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'one',name:'preview',input:{}}}]}}}:{output:{message:{role:'assistant',content:[{text:'Review is ready.'}]}}}));
 }}));assert.equal(value.totalTokens,60);assert.equal(calls,2);assert.deepEqual(rows(db,'bedrock_invocations').map(row=>row.total_tokens),[30,30]);
});
await check('Ignored abort and late network completion cannot convert a timed-out workflow to success',async db=>{
 let release,calls=0;const wait=new Promise(resolve=>release=resolve);
 await assert.rejects(tracked(db,{BEDROCK_TIMEOUT_MS:'100'},async()=>{calls++;await wait;return response();}),error=>error.code==='BEDROCK_TIMEOUT');
 assert.equal(calls,1);assert.equal(rows(db,'bedrock_operations')[0].state,'failed');assert.equal(rows(db,'bedrock_invocations')[0].total_tokens,null);
 release();await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(rows(db,'bedrock_operations')[0].state,'failed');assert.equal(rows(db,'bedrock_invocations')[0].state,'failed');
});
await check('Hostile diagnostic fields and accessors are dropped from durable metadata',async db=>{
 let getters=0;await withTrackedBedrock(db,settings,context,async observer=>{
  const id=await observer.beforeInvocation({estimatedInputTokens:80,maxOutputTokens:128,timeoutMs:1000});
  const diagnostic={stage:'headers',upstreamStatus:503,awsException:'private-secret',raw:'private-secret',get networkErrorName(){getters++;return 'TypeError';},networkErrorCode:'private-secret'};
  await observer.afterInvocation(id,{outcome:'succeeded',latencyMs:2,errorCode:'private-secret',diagnostic});
 });
 const row=rows(db,'bedrock_invocations')[0];assert.equal(getters,0);assert.equal(row.error_code,null);assert.equal(row.diagnostic.includes('private-secret'),false);
 assert.deepEqual(JSON.parse(row.diagnostic),{stage:'headers',upstreamStatus:503,awsException:null,networkErrorName:null,networkErrorCode:null});
});
await check('Storage failure prevents initial network and completion failure never repeats a billed request',async db=>{
 let calls=0;const unavailable={prepare(){throw Error('private DB internals');}};
 await assert.rejects(withTrackedBedrock(unavailable,settings,context,observer=>converseJson(bedrockConfig(settings),request,{observer,fetch:async()=>{calls++;return response();}})),error=>error.code==='BEDROCK_ACCOUNTING');
 assert.equal(calls,0);
 const broken={prepare(sql){if(sql.includes("SET state='succeeded'"))throw Error('private completion failure');return db.prepare(sql);}};
 await assert.rejects(tracked(broken,{},async()=>{calls++;return response();}),error=>error.code==='BEDROCK_ACCOUNTING');
 assert.equal(calls,1);assert.equal(rows(db,'bedrock_operations')[0].state,'failed');assert.equal(rows(db,'bedrock_invocations')[0].total_tokens,30);
});
await check('Abandoned leases are observable while late trustworthy usage remains countable',async db=>{
 let saved,id;const operation=withTrackedBedrock(db,settings,context,async observer=>{saved=observer;id=await observer.beforeInvocation({estimatedInputTokens:80,maxOutputTokens:128,timeoutMs:100});return 'not actually finished';});
 await assert.rejects(operation,error=>error.code==='BEDROCK_ACCOUNTING');
 // Reproduce a worker that disappeared before completing either ledger row.
 db.sqlite.prepare("UPDATE bedrock_operations SET state='running',completed_at=NULL").run();
 const now=Date.now()+121000;const summary=await readBedrockOperationsSummary(db,settings,context.owner,context.planId,now);
 assert.equal(summary.features.chat.abandoned,1);assert.equal(rows(db,'bedrock_invocations')[0].state,'abandoned');
 await saved.recordUsage(id,{inputTokens:20,outputTokens:10,totalTokens:30});
 await saved.afterInvocation(id,{outcome:'succeeded',latencyMs:121000});
 assert.equal(rows(db,'bedrock_invocations')[0].state,'abandoned');assert.equal(rows(db,'bedrock_invocations')[0].total_tokens,30);
});
await check('Exact config, owner and plan scoping keep observations private and stale proofs out',async db=>{
 await tracked(db);assert.equal((await readBedrockOperationsSummary(db,settings,context.owner,context.planId)).features.chat.succeeded,1);
 for(const [configuration,owner,plan] of [[{...settings,BEDROCK_MODEL_ID:'changed-model'},context.owner,context.planId],[settings,'other-owner',context.planId],[settings,context.owner,'other-plan']])
  assert.equal((await readBedrockOperationsSummary(db,configuration,owner,plan)).features.chat.attempted,0);
});
await check('Explicit prices calculate estimates only from trustworthy counts; partial counts violate SQL constraints',async db=>{
 const options={BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'0.1',BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS:'0.2'};
 await tracked(db,options);const summary=await readBedrockOperationsSummary(db,{...settings,...options},context.owner,context.planId);
 assert.equal(summary.controls.pricingConfigured,true);assert.equal(summary.features.chat.estimatedCostUsd,0.000004);
 const id=rows(db,'bedrock_invocations')[0].id;
 assert.throws(()=>db.sqlite.prepare('UPDATE bedrock_invocations SET input_tokens=NULL WHERE id=?').run(id),/CHECK/);
});
await check('Large histories are bounded and visibly marked as truncated rather than reported as complete daily totals',async db=>{
 const hash=await bedrockConfigurationHash(settings),now=Date.now(),insert=db.sqlite.prepare(`INSERT INTO bedrock_operations
  (id,owner,member_id,plan_id,feature,configuration_hash,state,started_at,expires_at,completed_at) VALUES (?,?,?,?,?,?,'failed',?,?,?)`);
 for(let index=0;index<1001;index++)insert.run('bounded-'+index,context.owner,context.memberId,context.planId,'chat',hash,now-index,now+120000,now);
 const summary=await readBedrockOperationsSummary(db,settings,context.owner,context.planId);
 assert.equal(summary.operationLimit,1000);assert.equal(summary.truncated,true);assert.equal(summary.features.chat.attempted,1000);assert.equal(summary.recent.length,20);
});

console.log(`${checks} shared Bedrock control and durable accounting checks passed; no live network.`);
