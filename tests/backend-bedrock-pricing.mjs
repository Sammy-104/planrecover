import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {bedrockConfig,converseJson} from '../lib/bedrock.ts';
import {BEDROCK_PRICING_PRESET,bedrockPricingSettings,bedrockPricingModelHash,readBedrockPricing} from '../lib/bedrock-pricing.ts';
import {bedrockConfigurationHash,withTrackedBedrock,readBedrockOperationsSummary} from '../lib/bedrock-operations.ts';

const now=Date.parse('2026-10-19T15:00:00Z'),originalNow=Date.now;
Date.now=()=>now;
const settings={AWS_BEARER_TOKEN_BEDROCK:'private-pricing-fixture-key',BEDROCK_REGION:'ca-central-1',BEDROCK_MODEL_ID:'ca.amazon.nova-lite-v1:0',BEDROCK_MAX_TOKENS:'128'};
const configured={...settings,BEDROCK_PRICING_PRESET,BEDROCK_PRICING_MODEL_SHA256:await bedrockPricingModelHash(settings)};
const context={owner:'pricing-owner',memberId:'pricing-member',planId:'pricing-plan',feature:'chat'};
const usage={inputTokens:20,outputTokens:10,totalTokens:30};
const envelope=(overrides={})=>({stopReason:'end_turn',output:{message:{role:'assistant',content:[{text:'{"ok":true}'}]}},usage:{...usage,...overrides}});
let checks=0;
const check=async(name,work)=>{await work();checks++;console.log('PASS '+name);};
async function call(db,config=settings,body=envelope()){
 return withTrackedBedrock(db,config,context,observer=>converseJson(bedrockConfig(config),{system:'Synthetic',prompt:'Synthetic',validate:value=>value},
  {observer,fetch:async()=>Response.json(body)}));
}
const invocations=db=>db.sqlite.prepare('SELECT * FROM bedrock_invocations ORDER BY rowid').all();
try{
 await check('Official reviewed Canadian rates have exact source, routing, currency and a review date',async()=>{
  const price=await readBedrockPricing(configured,now);assert.equal(price.status,'configured');
  assert.equal(price.basis.inputUsdPerMillionTokens,0.064);assert.equal(price.basis.outputUsdPerMillionTokens,0.256);
  assert.equal(price.basis.currency,'USD');assert.equal(price.basis.sourceRegion,'ca-central-1');assert.equal(price.basis.serviceTier,'standard');
  assert.equal(price.basis.routing,'canada-geographic-cross-region');assert.equal(price.basis.checkedAt,'2026-10-19');assert.equal(price.basis.reviewBy,'2026-11-18');
  assert.equal(price.basis.publishedAt,'2026-10-16T21:08:06Z');assert.equal(price.basis.sourceUrl,'https://aws.amazon.com/bedrock/pricing/');
  const serialized=JSON.stringify(price);for(const value of ['private-pricing-fixture-key',configured.BEDROCK_PRICING_MODEL_SHA256,'arn:'])assert.equal(serialized.includes(value),false);
 });
 await check('Unverified manual numbers never become prices; malformed explicit settings remain rejected',async()=>{
  assert.equal((await readBedrockPricing(settings,now)).status,'not-configured');
  assert.equal((await readBedrockPricing({...settings,BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'0.064',BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS:'0.256'},now)).status,'binding-required');
  for(const config of [{BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'0.1'},{BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'NaN',BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS:'0.2'},
   {BEDROCK_PRICING_PRESET:'unreviewed-model'},{BEDROCK_PRICING_MODEL_SHA256:'private-sensitive-text'},
   {BEDROCK_PRICING_PRESET,BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'0.06',BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS:'0.24'}])
   assert.throws(()=>bedrockPricingSettings({...settings,...config}),error=>error.code==='BEDROCK_CONFIG');
 });
 await check('Binding requires the exact current model/profile and source region without binding an API key',async()=>{
  assert.equal((await readBedrockPricing({...configured,BEDROCK_PRICING_MODEL_SHA256:undefined},now)).status,'binding-required');
  for(const config of [{BEDROCK_MODEL_ID:'other-model'},{BEDROCK_REGION:'us-east-1'},
   {BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/other'}])
   assert.equal((await readBedrockPricing({...configured,...config},now)).status,'model-mismatch');
  assert.equal(await bedrockPricingModelHash({...settings,AWS_BEARER_TOKEN_BEDROCK:'rotated-key'}),configured.BEDROCK_PRICING_MODEL_SHA256);
  const profile={...settings,BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/fixture'};
  assert.equal((await readBedrockPricing({...profile,BEDROCK_PRICING_PRESET,BEDROCK_PRICING_MODEL_SHA256:await bedrockPricingModelHash(profile)},now)).status,'configured');
 });
 await check('Rates outside the reviewed window disable estimates without disabling model inference',async()=>{
  assert.equal((await readBedrockPricing(configured,Date.parse('2026-11-18T00:00:00Z'))).status,'review-required');
  assert.equal((await readBedrockPricing(configured,Date.parse('2026-10-18T23:59:59Z'))).status,'review-required');
  const db=createTestD1();try{await call(db,{...configured,BEDROCK_PRICING_MODEL_SHA256:'0'.repeat(64)});assert.equal(invocations(db)[0].state,'succeeded');assert.equal(invocations(db)[0].estimated_cost_usd,null);}finally{db.close();}
 });
 await check('Pricing-only changes preserve the pre-existing unpriced v27 evidence fingerprint exactly',async()=>{
  const config=bedrockConfig(settings),controls={requestsPerMinute:20,tokensPerMinute:400000,dailyTokenLimit:null,inputUsdPerMillionTokens:null,outputUsdPerMillionTokens:null};
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:1,configuration:config,controls})));
  const legacy=[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
  assert.equal(await bedrockConfigurationHash(configured),legacy);
  assert.equal(await bedrockConfigurationHash({...configured,BEDROCK_INPUT_USD_PER_MILLION_TOKENS:'0.064',BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS:'0.256'}),legacy);
  assert.notEqual(await bedrockConfigurationHash({...configured,AWS_BEARER_TOKEN_BEDROCK:'rotated-key'}),legacy);
 });
 await check('New calls retain the original price basis and existing unpriced calls are never silently revalued',async()=>{
  const db=createTestD1();try{
   await call(db);await call(db,configured);const saved=invocations(db),summary=await readBedrockOperationsSummary(db,configured,context.owner,context.planId,now);
   assert.equal(saved[0].estimated_cost_usd,null);assert.equal(saved[0].pricing_basis,null);
   assert.equal(saved[1].estimated_cost_usd,0.00000384);assert.equal(JSON.parse(saved[1].pricing_basis).id,BEDROCK_PRICING_PRESET);
   assert.equal(summary.features.chat.knownTokens,60);assert.equal(summary.features.chat.succeeded,2);assert.equal(summary.features.chat.estimatedCostUsd,null);
   assert.equal(summary.pricedCostSubtotalUsd,0.00000384);assert.equal(summary.unpricedUsageInvocations,1);
   const changed=await readBedrockOperationsSummary(db,{...configured,BEDROCK_PRICING_PRESET:undefined,BEDROCK_PRICING_MODEL_SHA256:undefined},context.owner,context.planId,now);
   assert.equal(changed.features.chat.knownTokens,60);assert.equal(changed.features.chat.estimatedCostUsd,null);assert.equal(changed.pricedCostSubtotalUsd,0.00000384);
   assert.equal(JSON.stringify(saved).includes('private-pricing-fixture-key'),false);assert.equal(JSON.stringify(saved).includes(configured.BEDROCK_PRICING_MODEL_SHA256),false);
  }finally{db.close();}
 });
 await check('Cached or malformed extra token counters retain known counts but prevent a false complete cost',async()=>{
  for(const extra of [{cacheReadInputTokens:20},{cacheWriteInputTokens:5},{cacheReadInputTokens:'0'},{cacheWriteInputTokens:-1}]){
   const db=createTestD1();try{const result=await call(db,configured,envelope(extra));assert.deepEqual(result.usage,usage);
    assert.equal(invocations(db)[0].total_tokens,30);assert.equal(invocations(db)[0].estimated_cost_usd,null);
    const summary=await readBedrockOperationsSummary(db,configured,context.owner,context.planId,now);assert.equal(summary.unpricedUsageInvocations,1);assert.equal(summary.features.chat.estimatedCostUsd,null);
   }finally{db.close();}
  }
  const db=createTestD1();try{await call(db,configured,envelope({cacheReadInputTokens:0,cacheWriteInputTokens:0}));assert.equal(invocations(db)[0].estimated_cost_usd,0.00000384);}finally{db.close();}
 });
 await check('Missing usage and old unattributed numeric costs cannot produce a complete current estimate',async()=>{
  const db=createTestD1();try{
   await call(db,configured);const id=invocations(db)[0].id;
   db.sqlite.prepare('UPDATE bedrock_invocations SET pricing_basis=NULL WHERE id=?').run(id);
   let summary=await readBedrockOperationsSummary(db,configured,context.owner,context.planId,now);
   assert.equal(summary.features.chat.estimatedCostUsd,null);assert.equal(summary.pricedCostSubtotalUsd,0);assert.equal(summary.unpricedUsageInvocations,1);
   const malformed=envelope();delete malformed.usage;await assert.rejects(call(db,configured,malformed));
   summary=await readBedrockOperationsSummary(db,configured,context.owner,context.planId,now);assert.equal(summary.features.chat.unknownUsageInvocations,1);assert.equal(summary.features.chat.estimatedCostUsd,null);
  }finally{db.close();}
 });
}finally{Date.now=originalNow;}
console.log(`${checks} model pricing and provenance checks passed; no live network.`);
