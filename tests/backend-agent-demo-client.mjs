import assert from 'node:assert/strict';
import {AgentDemoClient} from '../lib/agent-demo-client.ts';
import {handlePlanMcp} from '../lib/plan-mcp.ts';
import {PlanRepository} from '../lib/plan-repository.ts';
import {BackendError} from '../lib/backend-errors.ts';
import {createTestD1} from './helpers/d1.mjs';

const database=createTestD1(),repository=new PlanRepository(database);
const identity={id:'demo-client-owner',name:'Demo member'};
const record=await repository.createPlan('demo-client-account',identity,{name:'Client verification',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000});
const endpoint=new URL('https://planrecover.test/api/agent-client');
const events=[],messages=[];
let authorized=true,failDiscovery=false;
const client=new AgentDemoClient(endpoint,{observe:event=>events.push(event),fetch:async(input,init)=>{
 const request=new Request(input,init);if(request.method==='GET')return new Response(null,{status:405});
 const message=JSON.parse(init.body);messages.push(message);assert.equal(init.credentials,'same-origin');
 if(message.method==='tools/list'&&failDiscovery)return new Response('Unavailable',{status:503});
 return handlePlanMcp(request,async()=>{if(!authorized)throw new BackendError('AUTH_REQUIRED','Sign in.',401);return {identity,repository,agentContext:{database,repository,owner:'demo-client-account',identity}};});
}});
try{
 const [plans,money]=await Promise.all([client.call('list_plans',{}),client.call('get_my_money',{planId:record.state.plan.id})]);
 assert.equal(plans.plans[0].id,record.state.plan.id);assert.equal(money.amounts.cost,0);assert.equal(messages.filter(message=>message.method==='initialize').length,1);
 const order=messages.map(message=>message.method);assert.equal(order[0],'initialize');assert.ok(order.indexOf('notifications/initialized')<order.indexOf('tools/list'));assert.ok(order.indexOf('resources/read')<order.indexOf('tools/call'));assert.equal(messages.find(message=>message.method==='resources/read').params.uri,'planrecover://skills/planning');
 assert.deepEqual(Object.keys(events[0]).sort(),['method','status','tool']);assert.ok(events.some(event=>event.method==='tools/list'&&event.status===200));assert.equal((await repository.getPlan(record.state.plan.id,identity)).version,record.version);
 console.log('PASS SDK handshake, discovery and skill read precede concurrent authenticated tool calls; reads preserve plan');
 authorized=false;await assert.rejects(client.call('get_plan',{planId:record.state.plan.id}),/Sign in to Knota/);authorized=true;
 await assert.rejects(client.call('get_plan',{planId:'missing-plan'}));await assert.rejects(client.call('execute_payment',{}),/unavailable/);await client.close();await assert.rejects(client.call('list_plans',{}),/closed/);
 console.log('PASS expired sessions, unavailable financial tools and disposed clients are rejected');
 const retryMessages=[],retry=new AgentDemoClient(endpoint,{fetch:async(input,init)=>{
  const request=new Request(input,init);if(request.method==='GET')return new Response(null,{status:405});const message=JSON.parse(init.body);retryMessages.push(message.method);
  if(message.method==='tools/list'&&failDiscovery)return new Response('Unavailable',{status:503});return handlePlanMcp(request,async()=>({identity,repository}));
 }});
 failDiscovery=true;await assert.rejects(retry.call('list_plans',{}));assert.ok(!retryMessages.includes('tools/call'));failDiscovery=false;assert.ok((await retry.call('list_plans',{})).plans.length);assert.equal(retryMessages.filter(method=>method==='initialize').length,2);await retry.close();
 console.log('PASS failed discovery makes no data call and a deliberate retry reconnects');
}finally{await client.close();database.close();}
