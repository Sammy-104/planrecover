import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]??'http://localhost:5184');
if(!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('This creates only local verification data.');
async function request(path,method='GET',body){const response=await fetch(new URL(path,origin),{method,signal:AbortSignal.timeout(20000),
 headers:body?{'content-type':'application/json',origin:origin.origin}:{},body:body?JSON.stringify(body):undefined});const data=await response.json();
 assert.ok(response.ok,`${path}: ${response.status} ${data.error??''}`);return data;}
const now=Date.now(),start=new Date(now-86400000).toISOString().slice(0,10),end=new Date(now+86400000).toISOString().slice(0,10);
const created=await request('/api/plans','POST',{plan:{name:'Local backend feature verification',kind:'trip',destination:'Toronto',start,end,
 timezone:'America/Toronto',currency:'CAD',budget:30000}}),planId=created.state.plan.id,memberId=created.state.people[0].id;
const prefPath=`/api/plans/${planId}/me/planning-preferences`,before=await request(prefPath);
await request(prefPath,'PATCH',{version:before.version,preferences:{...before.preferences,leadMinutes:[0],bufferMinutes:20}});
const current=await request(`/api/plans/${planId}`),updated=await request(`/api/plans/${planId}`,'PATCH',{version:current.version,
 action:{type:'add_item',name:'Verify in-app reminder delivery',category:'Preparation',start:new Date(now-60000).toISOString(),duration:10,
 price:0,participants:[memberId],taskOwner:memberId,location:'Toronto'}});
assert.equal((await request(`/api/plans/${planId}/invoices`)).invoices.length,0);
assert.equal((await request(`/api/plans/${planId}/recoveries`)).proposals.length,0);
assert.equal((await request(`/api/plans/${planId}/planning-evidence`)).records.length,0);
const run=await request('/api/jobs/run','POST',{});assert.equal(run.status,'completed');
const reminders=await request(`/api/plans/${planId}/reminders`);assert.ok(reminders.notifications.some(value=>value.title==='Verify in-app reminder delivery'));
const history=await request(`/api/plans/${planId}/financial-history?limit=2`);assert.equal(history.events.length,0);
const after=await request(`/api/plans/${planId}`);assert.equal(after.version,updated.version);assert.equal(after.state.events.length,0);
const mcp=await fetch(new URL('/mcp',origin),{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',
 accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_decisions',arguments:{planId}}})});
assert.ok(mcp.ok);const decisions=(await mcp.json()).result.structuredContent;
assert.ok(decisions.notifications.some(value=>value.title==='Verify in-app reminder delivery'));assert.equal(decisions.currency,'CAD');
console.log('Local built Worker verified: private planning preferences, invoice/recovery/evidence reads, durable reminder delivery, unchanged money/history and new MCP decisions.');
