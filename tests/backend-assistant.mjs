import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {ConversationRepository} from '../lib/conversations.ts';
import {executeAgentTool} from '../lib/agent-tools.ts';
import {recoveryMoney} from '../lib/agent-recovery.ts';
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
 await check('Planless chat prepares a first-plan preview through tools without creating or approving a plan',async({database,repository})=>{
  configured();const before=await repository.listPlans(alice.id);let step=0;provider=async()=>Response.json(step++===0?{output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'create-preview',name:'prepare_plan',input:{plan:plan('First plan preview')}}}]}},stopReason:'tool_use',usage:{inputTokens:30,outputTokens:10,totalTokens:40}}:{output:{message:{role:'assistant',content:[{text:'Your new plan is prepared for review.'}]}},stopReason:'end_turn',usage:{inputTokens:15,outputTokens:5,totalTokens:20}});
  const result=await decoded(await route.POST(request({agent:true,message:'Create my first Toronto day out'})));assert.equal(result.mode,'bedrock');assert.equal(result.prepared[0].name,'prepare_plan');assert.match(result.prepared[0].result.reviewUrl,/^\/flows\?proposal=/);assert.equal((await repository.listPlans(alice.id)).length,before.length);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n,0);
 });
 await check('An agent tool preview remains linked to the private conversation when later model inference fails',async({database,id})=>{
  configured();const conversation=await new ConversationRepository(database).create(owner,alice,id);let step=0;provider=async()=>step++===0?Response.json({output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'prepare',name:'prepare_plan',input:{plan:plan('Retained preview')}}}]}},stopReason:'tool_use',usage:{inputTokens:30,outputTokens:10,totalTokens:40}}):new Response('fixture outage',{status:503});
  const result=await decoded(await route.POST(request({planId:id,agent:true,message:'Prepare another plan',conversationId:conversation.id,conversationVersion:conversation.version,requestId:crypto.randomUUID()})));assert.equal(result.prepared.length,1);assert.match(result.notice,/saved/);const read=await new ConversationRepository(database).read(owner,alice,conversation.id);assert.equal(read.prepared.length,1);assert.equal(read.messages.find(m=>m.role==='assistant').metadata.prepared.length,1);
 });
 await check('Recovery with an omitted discriminator saves one review and displays authoritative CAD amounts despite incorrect model prose',async({database,repository,id,record})=>{
  let current=record;
  for(const [name,price,hour,duration] of [['Hike',9000,'10',120],['Lodge',12000,'16',45],['Shuttle',3000,'09',45],['Dinner',2000,'18',75]])current=await repository.updatePlan(id,alice,current.version,{type:'add_item',name,category:'Activity',start:'2027-04-04T'+hour+':00:00-04:00',duration,price,participants:[alice.id],location:'Fictional demo estimate'});
  const before=await repository.getPlan(id,alice),hike=before.state.items.find(item=>item.name==='Hike');
  const change={version:before.version,itemIds:[hike.id],option:'replace',replacements:[{name:'Indoor workshop',category:'Activity',start:hike.start,duration:120,price:10500,participants:[alice.id],location:'Fictional demo estimate'}]};
  const conversation=await new ConversationRepository(database).create(owner,alice,id),requestId=crypto.randomUUID();
  configured();let step=0;provider=async(url,options)=>{
   const body=JSON.parse(options.body);
   if(step++===0){const schema=body.toolConfig.tools.find(tool=>tool.toolSpec.name==='prepare_plan_change').toolSpec.inputSchema.json;assert.deepEqual(schema.properties.change.properties.type.enum,['recovery','departure']);
    return Response.json({output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'recovery',name:'prepare_plan_change',input:{planId:id,change}}}]}},stopReason:'tool_use',usage:{inputTokens:30,outputTokens:10,totalTokens:40}});}
   const result=body.messages.at(-1).content[0].toolResult.content[0].json;assert.equal(result.money.currency,'CAD');assert.equal(result.money.decimalPlaces,2);assert.equal(result.figures.newPaymentNow,10500);assert.match(result.money.display.newPaymentNow,/105\.00/);
   return Response.json({output:{message:{role:'assistant',content:[{text:'The payment was sent. New cash is CAD 10,500.00 and the total is CAD 27,500.00.'}]}},stopReason:'end_turn',usage:{inputTokens:30,outputTokens:10,totalTokens:40}});
  };
  const result=await decoded(await route.POST(request({planId:id,agent:true,message:'Rain affects the hike. Prepare the CAD 105 indoor replacement for review.',conversationId:conversation.id,conversationVersion:conversation.version,requestId})));
  assert.equal(result.mode,'bedrock');assert.equal(result.prepared.length,1);assert.ok(result.reply.includes(String.fromCharCode(10)));assert.match(result.reply,/Recovery proposal ready for review/);assert.match(result.reply,/CAD\s105\.00/);assert.match(result.reply,/CAD\s275\.00/);assert.match(result.reply,/CAD\s15\.00/);assert.doesNotMatch(result.reply,/10,500|27,500|payment was sent/);
  assert.deepEqual(await repository.getPlan(id,alice),before);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM plan_change_approvals').get().n,0);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n,1);
  const saved=await new ConversationRepository(database).read(owner,alice,conversation.id);assert.equal(saved.messages.at(-1).text,result.reply);assert.equal(saved.prepared[0].result.changeId,result.prepared[0].result.changeId);
  const replay=await executeAgentTool({database,repository,owner,identity:alice,boundPlanId:id,turn:{conversationId:conversation.id,requestId,conversationOwner:owner}},'prepare_plan_change',{planId:id,change:{...change,type:'recovery'}});
  assert.equal(replay.changeId,result.prepared[0].result.changeId);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n,1);
 });
 await check('Invalid, ambiguous, explicit execution and stale recovery inputs remain rejected',async({database,repository,id,record})=>{
  const context={database,repository,owner,identity:alice,boundPlanId:id};
  for(const change of [{version:record.version,memberId:alice.id},{type:'apply',version:record.version,changeId:crypto.randomUUID(),confirm:true},{type:'wrong',version:record.version,itemIds:['missing'],option:'cancel'},{version:record.version,itemIds:['missing'],option:'cancel',approve:true},{version:record.version+1,itemIds:['missing'],option:'cancel'}])await assert.rejects(executeAgentTool(context,'prepare_plan_change',{planId:id,change}));
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n,0);assert.deepEqual(await repository.getPlan(id,alice),record);
 });
 await check('Money presentation honors zero-, two- and three-decimal currencies and preserves unknown and signed amounts',async()=>{
  const figures={retained:0,expectedRefund:null,newPaymentNow:10500,finalTotal:null,perMember:{alice:-1500},memberImpacts:{alice:{expectedRefund:null,newPaymentNow:10500,finalChange:-1500}}};
  for(const [currency,digits,display] of [['CAD',2,'105.00'],['JPY',0,'10,500'],['KWD',3,'10.500']]){const money=recoveryMoney(currency,figures);assert.equal(money.decimalPlaces,digits);assert.ok(money.display.newPaymentNow.includes(display));assert.equal(money.display.expectedRefund,'Unknown');assert.equal(money.display.finalTotal,'Unknown');assert.match(money.display.memberImpacts.alice.finalChange,/-/);}
  assert.equal(figures.newPaymentNow,10500);assert.equal(figures.expectedRefund,null);
 });
 console.log(`${checks} authenticated assistant checks passed.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.assistantTestEnv;}
