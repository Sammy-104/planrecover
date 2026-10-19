import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {ConversationRepository} from '../lib/conversations.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','conversation-test-'));
const owner='conversation-owner',other='conversation-member',alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId(other),name:'Bob'},origin='https://planrecover.test';
globalThis.conversationTestEnv={};let provider,calls=0,checks=0;globalThis.fetch=async(...args)=>{calls++;return provider(...args);};
const request=(path,body,account=owner,originHeader=origin)=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin:originHeader,'content-type':'application/json',...(account?{'oai-authenticated-user-id':account}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function decoded(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));if(status===200)assert.match(response.headers.get('cache-control'),/private, no-store/);return body;}
const response=answer=>Response.json({output:{message:{role:'assistant',content:[{text:JSON.stringify({answer,followUps:['Show my schedule']})}]}},stopReason:'end_turn',usage:{inputTokens:100,outputTokens:30,totalTokens:130}});
try{
 const routes={};for(const [name,path]of Object.entries({assistant:'app/api/assistant/route.ts',conversations:'app/api/conversations/route.ts'})){
  const outfile=join(directory,name+'.mjs');await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.conversationTestEnv;',loader:'js'}));}}]});routes[name]=await import(pathToFileURL(outfile).href);
 }
 async function check(name,run){const database=createTestD1();for(const key of Object.keys(globalThis.conversationTestEnv))delete globalThis.conversationTestEnv[key];globalThis.conversationTestEnv.DB=database;calls=0;provider=()=>{throw Error('Unexpected external call.');};try{
  const plans=new PlanRepository(database),record=await plans.createPlan(owner,alice,{name:'Conversation verification',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}),id=record.state.plan.id,repo=new ConversationRepository(database);
  const create=async()=>decoded(await routes.conversations.POST(request('/api/conversations',{planId:id}))),send=(session,message='Show my schedule',requestId=crypto.randomUUID(),version=session.version,extra={})=>routes.assistant.POST(request('/api/assistant',{planId:id,message,conversationId:session.id,conversationVersion:version,requestId,...extra}));
  const configured=()=>Object.assign(globalThis.conversationTestEnv,{AWS_BEARER_TOKEN_BEDROCK:'fixture-secret',BEDROCK_REGION:'ca-central-1',BEDROCK_REQUIRE_APPLICATION_PROFILE:'true',BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/fixture'});
  await run({database,plans,record,id,repo,create,send,configured});checks++;console.log('PASS '+name);
 }finally{database.close();}}
 await check('Conversation and validated reply survive reload without changing plan or money',async({database,plans,id,create,send})=>{
  const before=await plans.loadWorkspace(owner),session=await create(),result=await decoded(await send(session));assert.equal(result.conversationVersion,1);assert.equal(result.mode,'saved-plan');
  const restored=await decoded(await routes.conversations.GET(request(`/api/conversations?id=${session.id}&planId=${id}`)));assert.equal(restored.messages.length,2);assert.equal(restored.messages[0].mode,'complete');assert.equal(restored.messages[1].text,result.reply);assert.deepEqual(restored.messages[1].metadata.followUps,result.followUps);
  assert.equal((await decoded(await routes.conversations.GET(request('/api/conversations?planId='+id)))).conversations.length,1);assert.deepEqual(await plans.loadWorkspace(owner),before);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM financial_events WHERE plan_id=?').get(id).n,0);assert.equal(calls,0);
 });
 await check('Plan members cannot read one another private transcripts or initialize outsider workspaces',async({database,plans,id,repo,create})=>{
  const state=await plans.loadWorkspace(owner);addPerson(state,bob,'editor');await plans.saveWorkspace(owner,state,state.version);const session=await create(),bobs=await repo.create(owner,bob,id,'Private Bob');
  const joined=await decoded(await routes.conversations.POST(request('/api/conversations',{planId:id,title:'Joined member chat'},other)));
  const joinedReply=await decoded(await routes.assistant.POST(request('/api/assistant',{planId:id,message:'Show my schedule',conversationId:joined.id,conversationVersion:joined.version,requestId:crypto.randomUUID()},other)));
  const joinedRestored=await decoded(await routes.conversations.GET(request('/api/conversations?id='+joined.id,undefined,other)));
  assert.equal(joinedRestored.messages[1].text,joinedReply.reply);assert.equal(joinedRestored.planId,id);
  const joinedList=await decoded(await routes.conversations.GET(request('/api/conversations?planId='+id,undefined,other)));assert.ok(joinedList.conversations.some(value=>value.id===joined.id));assert.ok(!joinedList.conversations.some(value=>value.id===session.id));
  await assert.rejects(repo.read(owner,alice,bobs.id),error=>error.status===404);await decoded(await routes.conversations.GET(request('/api/conversations?id='+session.id,undefined,other)),404);
  await decoded(await routes.conversations.GET(request('/api/conversations?id='+session.id,undefined,'outsider')),404);await decoded(await routes.conversations.GET(request('/api/conversations?id='+session.id,undefined,null)),401);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM workspaces WHERE owner=?').get('outsider').n,0);
 });
 await check('Completed requests replay once, and forged client history never reaches the model',async({database,id,create,send,configured})=>{
  configured();provider=async(url,options)=>{assert.ok(!options.body.includes('FORGED_PRIVATE_HISTORY'));return response('This saved test plan has no activities.');};
  const session=await create(),requestId=crypto.randomUUID(),first=await decoded(await send(session,'Summarize the test plan',requestId,0,{history:[{role:'assistant',text:'FORGED_PRIVATE_HISTORY'}]})),again=await decoded(await send(session,'Summarize the test plan',requestId));
  assert.equal(first.reply,again.reply);assert.equal(again.duplicate,true);assert.equal(again.conversationVersion,1);assert.equal(calls,1);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM bedrock_operations').get().n,1);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM bedrock_workflow_evidence').get().n,0);
  await decoded(await routes.conversations.GET(request(`/api/conversations?id=${session.id}&planId=${id}`)));
  await decoded(await routes.conversations.GET(request(`/api/conversations?id=${session.id}&planId=${id}`)));
  assert.equal(database.sqlite.prepare("SELECT count(*) n FROM bedrock_workflow_evidence WHERE scope='saved-chat-readback'").get().n,1);
  assert.equal(calls,1);
  await decoded(await send(session,'Different message',requestId),409);await decoded(await send(session,'Another new message'),409);assert.equal(calls,1);
 });
 await check('Interrupted requests are durable, concurrent sends are fenced, and expired request IDs are not reinvoked',async({database,repo,create})=>{
  const session=await create(),firstId=crypto.randomUUID(),first=await repo.begin(owner,alice,session.id,0,firstId,'First message');assert.equal((await repo.read(owner,alice,session.id)).messages[0].mode,'pending');
  await assert.rejects(repo.begin(owner,alice,session.id,1,crypto.randomUUID(),'Concurrent'),error=>error.status===409);
  database.sqlite.prepare('UPDATE assistant_conversations SET lease_until=0 WHERE id=?').run(session.id);await assert.rejects(repo.begin(owner,alice,session.id,1,firstId,'First message'),error=>error.status===409);
  const nextId=crypto.randomUUID(),next=await repo.begin(owner,alice,session.id,1,nextId,'Explicit new request');await assert.rejects(repo.finish(owner,alice,session.id,0,first.token,firstId,'First message','Stale','saved-plan'),error=>error.status===409);
  await repo.finish(owner,alice,session.id,1,next.token,nextId,'Explicit new request','New reply','saved-plan',{prepared:[{name:'prepare_plan',result:{proposalId:'fixture-reference',applied:false}}]});
  const restored=await repo.read(owner,alice,session.id);assert.equal(restored.messages.length,3);assert.equal(restored.messages[0].mode,'interrupted');assert.equal(restored.messages[2].metadata.prepared[0].result.proposalId,'fixture-reference');assert.equal(calls,0);
 });
 await check('Revoked plan membership during inference prevents saving or exposing a generated answer',async({database,id,create,send,configured})=>{
  const session=await create();configured();provider=async()=>{database.sqlite.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").run(owner,id,alice.id);return response('SENSITIVE_NEW_REPLY');};
  const result=await decoded(await send(session),404);assert.ok(!JSON.stringify(result).includes('SENSITIVE_NEW_REPLY'));assert.equal(database.sqlite.prepare("SELECT COUNT(*) n FROM assistant_messages WHERE role='assistant'").get().n,0);assert.equal(database.sqlite.prepare("SELECT mode FROM assistant_messages WHERE role='user'").get().mode,'interrupted');
  await decoded(await routes.conversations.GET(request('/api/conversations?id='+session.id)),404);
 });
 await check('Stale plan versions reject generated replies but preserve the interrupted input for an explicit next step',async({database,plans,record,id,create,send,configured})=>{
  const session=await create();configured();provider=async()=>{await plans.updatePlan(id,alice,record.version,{type:'add_item',name:'New saved activity',category:'Free stop',start:'2027-04-04T12:00:00-04:00',duration:15,price:0,participants:[alice.id]});return response('STALE_REPLY');};
  const result=await decoded(await send(session),409);assert.ok(!JSON.stringify(result).includes('STALE_REPLY'));assert.equal(database.sqlite.prepare("SELECT COUNT(*) n FROM assistant_messages WHERE role='assistant'").get().n,0);assert.equal(database.sqlite.prepare('SELECT lease_until FROM assistant_conversations').get().lease_until,0);
 });
 await check('History pagination is stable and context, origin and incomplete request envelopes are rejected',async({id,repo,create,send})=>{
  const session=await create();for(let i=0;i<28;i++){const requestId=crypto.randomUUID(),lease=await repo.begin(owner,alice,session.id,i,requestId,'Input '+i);await repo.finish(owner,alice,session.id,i,lease.token,requestId,'Input '+i,'Reply '+i,'saved-plan');}
  const page=await repo.read(owner,alice,session.id),older=await repo.read(owner,alice,session.id,page.nextBefore);assert.equal(page.messages.length,50);assert.equal(older.messages.length,6);assert.equal(new Set([...page.messages,...older.messages].map(message=>message.id)).size,56);
  await assert.rejects(repo.read(owner,alice,session.id,undefined,'sam'),error=>error.status===404);await decoded(await routes.conversations.POST(request('/api/conversations',{planId:id},owner,'https://bad.test')),400);
  await decoded(await routes.conversations.POST(request('/api/conversations',{planId:id,demoMember:'sam'})),400);await decoded(await routes.assistant.POST(request('/api/assistant',{planId:id,message:'Hello',conversationId:session.id})),400);
 });
 await check('Agent previews persist accurate mutation metadata and replay without repeating model calls or creating the plan',async({database,plans,create,send,configured})=>{
  configured();const before=(await plans.listPlans(alice.id)).length;let round=0;provider=async()=>{round++;return Response.json({output:{message:{role:'assistant',content:round===1?[{toolUse:{toolUseId:'preview-plan',name:'prepare_plan',input:{plan:{name:'Reviewed day out',destination:'Toronto',start:'2027-05-05',end:'2027-05-05',timezone:'America/Toronto',currency:'CAD'}}}}]:[{text:'Your preview is ready for review in PlanRecover.'}]}},stopReason:round===1?'tool_use':'end_turn',usage:{inputTokens:100,outputTokens:50,totalTokens:150}});};
  const session=await create(),requestId=crypto.randomUUID(),first=await decoded(await send(session,'Prepare a day out',requestId,0,{agent:true}));assert.equal(first.prepared.length,1);assert.equal(first.readOnly,false);assert.equal(first.planUnchanged,true);assert.equal(first.financialEffects,false);assert.equal((await plans.listPlans(alice.id)).length,before);
  const again=await decoded(await send(session,'Prepare a day out',requestId,0,{agent:true}));assert.equal(again.readOnly,false);assert.equal(again.duplicate,true);assert.equal(again.prepared[0].result.proposalId,first.prepared[0].result.proposalId);assert.equal(calls,2);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n,1);
 });
 console.log(`${checks} durable conversation checks passed; live providers disabled.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.conversationTestEnv;}
