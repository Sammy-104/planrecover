import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint=new URL(process.argv[2]??'http://127.0.0.1:5184/mcp');
if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.pathname!=='/mcp')
  throw Error('This test client connects only to the local PlanRecover MCP endpoint.');
const client=new Client({name:'PlanRecover Alexa track verification',version:'1.0.0'});
const transport=new StreamableHTTPClientTransport(endpoint);
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name,'PlanRecover');
  console.log('PASS independent SDK client connects over Streamable HTTP');
  const discovered=await client.listTools();
  assert.deepEqual(discovered.tools.filter(t=>['get_decisions','get_my_money','get_plan','list_plans'].includes(t.name)).map(t=>t.name).sort(),['get_decisions','get_my_money','get_plan','list_plans']);
  assert.equal(discovered.tools.length,9);
  assert.ok(discovered.tools.filter(t=>t.name.startsWith('prepare_')).every(t=>t.annotations?.readOnlyHint===false));
  const resources=await client.listResources();
  assert.ok(resources.resources.some(r=>r.uri==='planrecover://skills/planning'));
  const skill=await client.readResource({uri:'planrecover://skills/planning'});
  assert.match(skill.contents[0].text,/refunds cannot fund a payment/i);
  console.log('PASS four read-only tools and planning Agent Skill discovered');
  const call=async(name,args)=>{
    const result=await client.callTool({name,arguments:args});
    assert.notEqual(result.isError,true,`${name} failed`);
    assert.ok(result.structuredContent,`${name} returned no structured data`);
    return result.structuredContent;
  };
  const list=await call('list_plans',{});
  assert.ok(list.plans.length,'Create a personal plan before running this read-only check.');
  const planId=process.argv[3]??list.plans[0].id;
  const plan=await call('get_plan',{planId});
  const money=await call('get_my_money',{planId});
  const decisions=await call('get_decisions',{planId});
  assert.equal(plan.plan.id,planId);
  assert.equal(money.planId,planId);
  assert.equal(decisions.planId,planId);
  assert.ok(!('preferences' in plan)&&!('receipts' in plan));
  assert.ok(Number.isFinite(money.amounts.cost));
  assert.ok(Array.isArray(decisions.approvals)&&Array.isArray(decisions.proposals));
  const after=await call('get_plan',{planId});
  assert.equal(after.version,plan.version,'Read-only MCP calls changed the plan.');
  console.log('PASS all four tools read a saved member plan; preferences stay private and plan version is unchanged');
  console.log('Local MCP verification passed. An Amazon Alexa+ service/device connection is not established by this check.');
} finally { await client.close(); }
