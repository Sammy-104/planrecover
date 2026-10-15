import assert from 'node:assert/strict';

const origin=new URL(process.argv[2]??'http://localhost:5173');
if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new Error('This smoke check uses only a local test app.');
async function request(path,method='GET',body) {
  const response=await fetch(new URL(path,origin),{method,signal:AbortSignal.timeout(15000),headers:{
    ...(body?{'Content-Type':'application/json',Origin:origin.origin}:{}),
  },body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  assert.ok(response.ok,`${path}: ${response.status} ${data.error??''}`);
  return data;
}
const plan={kind:'day-out',name:'Local backend verification',destination:'Toronto, Canada',
  start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000};
const created=await request('/api/plans','POST',{plan});
const planId=created.state.plan.id;
assert.equal(created.state.people.length,1);
assert.ok((await request('/api/plans')).plans.some(saved=>saved.id===planId));
const preferencePath=`/api/plans/${planId}/me/preferences`;
const before=await request(preferencePath);
const preferences={...before.preferences,budget:12500,cash:5500,reserve:500};
await request(preferencePath,'PATCH',{version:before.version,preferences});
assert.equal((await request(preferencePath)).preferences.cash,5500);
const loaded=await request(`/api/plans/${planId}`);
await request(`/api/plans/${planId}`,'PATCH',{version:loaded.version,action:{type:'plan',plan:{...loaded.state.plan,name:'Local backend verified'}}});
const workspace=await request('/api/workspace');
assert.equal(workspace.state.plan.name,'Local backend verified');
assert.deepEqual(Object.keys(workspace.state.preferences),[workspace.collaboration.memberId]);
const response=await fetch(new URL('/mcp',origin),{method:'POST',signal:AbortSignal.timeout(15000),headers:{
  'Content-Type':'application/json',Accept:'application/json, text/event-stream',Origin:origin.origin,'MCP-Protocol-Version':'2025-11-25',
},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_my_money',arguments:{planId}}})});
assert.equal(response.status,200);
const mcp=await response.json();
assert.equal(mcp.result.structuredContent.privatePreferences.cash,5500);
assert.equal(mcp.result.structuredContent.amounts.cost,0);
console.log('Local Worker smoke passed: plan create/list/edit, private preferences, workspace compatibility and authenticated MCP money.');
