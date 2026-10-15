import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
const origin='https://planrecover.test',owner='assistant-alice',alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId('assistant-bob'),name:'Bob'};
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-assistant-'));
globalThis.assistantTestEnv={};let provider,calls=0,checks=0;
globalThis.fetch=async(...args)=>{calls++;return provider(...args);};
try{
 const outfile=join(directory,'route.mjs');await build({entryPoints:[resolve(root,'app/api/assistant/route.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'workers',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.assistantTestEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(outfile).href);
 const plan=name=>({name,destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
 const response=(value={answer:'Your recorded cost is CAD 0.00. Review changes in the app.',followUps:['Show my schedule']})=>Response.json({output:{message:{role:'assistant',content:[{text:JSON.stringify(value)}]}},stopReason:'end_turn',usage:{inputTokens:80,outputTokens:40,totalTokens:120}});
 function request(body,{account=owner,originHeader=origin,raw,headers={}}={}){return new Request(origin+'/api/assistant',{method:'POST',headers:{'content-type':'application/json',origin:originHeader,...(account?{'oai-authenticated-user-id':account}:{}),...headers},body:raw??JSON.stringify(body)});}
 async function decoded(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));if(status===200)assert.match(response.headers.get('cache-control'),/private, no-store/);return value;}
 function configured(){Object.assign(globalThis.assistantTestEnv,{AWS_BEARER_TOKEN_BEDROCK:'fixture-secret',BEDROCK_REGION:'ca-central-1',BEDROCK_REQUIRE_APPLICATION_PROFILE:'true',BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/fixture'});}
 async function check(name,run){const database=createTestD1();for(const key of Object.keys(globalThis.assistantTestEnv))delete globalThis.assistantTestEnv[key];Object.assign(globalThis.assistantTestEnv,{DB:database,BEDROCK_REGION:'ca-central-1',BEDROCK_REQUIRE_APPLICATION_PROFILE:'true'});calls=0;provider=()=>{throw Error('No fixture model was selected.');};
  try{const repository=new PlanRepository(database),record=await repository.createPlan(owner,alice,plan('Assistant test'));
   await run({database,repository,record,id:record.state.plan.id});checks++;console.log('PASS '+name);}finally{database.close();}}
 await check('Saved-plan conversations work with partial AWS setup and do not create usage, approvals or money',async({database,repository,id})=>{
  const before=await repository.loadWorkspace(owner);
  for(const message of ['Show my schedule','Explain my money','What needs my attention?','Help me scan a receipt','Please approve and refund everything']){
   const result=await decoded(await route.POST(request({planId:id,message})));assert.equal(result.mode,'saved-plan');assert.equal(result.modelConnected,false);assert.equal(result.readOnly,true);assert.ok(result.reply.length);
  }
  assert.deepEqual(await repository.loadWorkspace(owner),before);assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage_limits').get().n,0);assert.equal(calls,0);
 });
 await check('Plan listing is bound to caller membership and never initializes outsider workspaces',async({database,repository,id})=>{
  await repository.createPlan('other-owner',bob,plan('Private other plan'));
  const result=await decoded(await route.POST(request({message:'List my plans'})));assert.ok(result.reply.includes('Assistant test'));assert.ok(!result.reply.includes('Private other plan'));
  await decoded(await route.POST(request({planId:id,message:'Show my money'},{account:'outsider'})),404);
  assert.equal(await database.prepare('SELECT owner FROM workspaces WHERE owner=?').bind('outsider').first(),null);assert.equal(calls,0);
 });
 await check('Strict input, identity, origin and personal actor spoofing fail before inference',async({id})=>{
  configured();await decoded(await route.POST(request({planId:id,message:'Hello'},{account:null})),401);
  await decoded(await route.POST(request({planId:id,message:'Hello'},{originHeader:'https://bad.test'})),400);
  for(const body of [{planId:id,message:'x',actor:bob.id},{planId:id,message:'x'.repeat(2001)},{planId:id,message:'x',history:Array(9).fill({role:'user',text:'x'})}])await decoded(await route.POST(request(body)),400);
  await decoded(await route.POST(request({planId:id,message:'x',demoMember:'sam'})),400);assert.equal(calls,0);
 });
 await check('Connected Bedrock receives only caller private preferences and returns a validated read-only answer',async({repository,id})=>{
  const rootState=await repository.loadWorkspace(owner);addPerson(rootState,bob,'editor');rootState.preferences[bob.id]={budget:987654321,cash:456789123,reserve:12345,pace:'private-pace',interests:['private-allergy-sentinel'],paypalMe:'https://paypal.me/private-sentinel',financing:8888};
  await repository.saveWorkspace(owner,rootState,rootState.version);const before=await repository.loadWorkspace(owner);configured();
  provider=async(url,options)=>{assert.match(String(url),/^https:\/\/bedrock-runtime\.ca-central-1\.amazonaws\.com\/model\//);assert.equal(options.method,'POST');
   assert.ok(!options.body.includes('private-allergy-sentinel'));assert.ok(!options.body.includes('987654321'));assert.ok(!options.body.includes('private-sentinel'));
   return response();};
  const result=await decoded(await route.POST(request({planId:id,message:'Explain my money',history:[{role:'user',text:'How is my day looking?'}]})));
  assert.equal(result.mode,'bedrock');assert.equal(result.money.cost,0);assert.deepEqual(await repository.loadWorkspace(owner),before);assert.equal(calls,1);
 });
 await check('Model failures and invalid action-shaped output fall back without exposing provider secrets',async({id})=>{
  configured();for(const reply of [()=>new Response('secret-provider-debug',{status:403}),()=>response({answer:'Payment sent',followUps:[],action:{type:'capture'}})]){
   provider=async()=>reply();const result=await decoded(await route.POST(request({planId:id,message:'Explain my money'})));
   assert.equal(result.mode,'saved-plan');assert.ok(result.notice);assert.ok(!JSON.stringify(result).includes('secret-provider-debug'));assert.ok(!result.reply.includes('Payment sent'));
  }
 });
 await check('Plan edits or removed membership during inference invalidate the response',async({database,repository,id,record})=>{
  configured();provider=async()=>{await repository.updatePlan(id,alice,record.version,{type:'add_item',name:'New task',category:'Preparation',start:'2027-04-04T10:00:00-04:00',duration:10,price:0,participants:[alice.id],taskOwner:alice.id});return response();};
  await decoded(await route.POST(request({planId:id,message:'Show my schedule'})),409);
  provider=async()=>{database.sqlite.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").run(owner,id,alice.id);return response();};
  await decoded(await route.POST(request({planId:id,message:'Show my schedule'})),404);
 });
 await check('Hourly AI quotas fall back to saved answers and never create provider operations',async({database,id})=>{
  configured();database.sqlite.prepare('INSERT INTO ai_usage_limits(member_id,feature,window_start,request_count,lease_until) VALUES (?,?,?,?,0)').run(alice.id,'plan-draft',Math.floor(Date.now()/3600000)*3600000,20);
  const result=await decoded(await route.POST(request({planId:id,message:'Explain my money'})));assert.equal(result.mode,'saved-plan');assert.equal(calls,0);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM provider_operations').get().n,0);
 });
 console.log(`${checks} authenticated assistant checks passed.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.assistantTestEnv;}
