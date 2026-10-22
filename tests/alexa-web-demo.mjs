import assert from 'node:assert/strict';
import {people,alternatives,freshContext,validateContext,compare,itinerary,ledger,runTool,intent} from '../lib/alexa-demo.ts';
import {handleDemoMcp,tools,reply} from '../lib/alexa-demo-mcp.ts';
const ids=people.map(p=>p.id),original=JSON.stringify(ledger());
for(const scenario of ['rain','cancelled','late']){
 const affected=runTool('report_trip_disruption',{context:freshContext(),scenario}).context;
 const options=runTool('find_recovery_options',{context:affected}).options;assert.equal(options.length,3);
 for(const option of alternatives){
  const preview=runTool('preview_recovery',{context:affected,optionId:option.id}),c=preview.comparison;
  assert.equal(c.projectedFinal,c.originalPaid-c.expectedRefund+c.upfront);assert.equal(c.receivedRefund,0);
  for(const [shares,total] of [[c.upfrontShares,c.upfront],[c.refundShares,c.expectedRefund],[c.finalShares,c.projectedFinal]])assert.equal(Object.values(shares).reduce((a,b)=>a+b,0),total);
  assert.throws(()=>runTool('apply_reviewed_recovery',{context:preview.context,confirmed:true,reviewToken:c.reviewToken}),/four/);
  const context={...preview.context,approvals:ids};
  assert.throws(()=>runTool('apply_reviewed_recovery',{context,confirmed:false,reviewToken:c.reviewToken}),/explicitly/);
  assert.throws(()=>runTool('apply_reviewed_recovery',{context,confirmed:true,reviewToken:'stale'}),/current/);
  const result=runTool('apply_reviewed_recovery',{context,confirmed:true,reviewToken:c.reviewToken});
  assert.equal(result.applied,true);assert.equal(result.nextActions.length,3);
  const stops=itinerary(result.context);assert.equal(stops[0].id,'hotel');assert.equal(stops[2].id,'dinner');assert.equal(stops[1].name,option.name);assert.equal(stops[1].time,scenario==='late'?'15:00':'11:00');assert.equal(JSON.stringify(ledger()),original);
  assert.deepEqual(runTool('apply_reviewed_recovery',{context:result.context,confirmed:true,reviewToken:c.reviewToken}).context,result.context);
  assert.deepEqual(runTool('preview_recovery',{context:result.context,optionId:option.id}).context.approvals,[]);
 }
}
const c=compare(freshContext(),'gallery');assert.equal(c.upfrontShares.sam,3000);assert.equal(c.refundShares.sam,2500);assert.equal(c.finalShares.sam,13500);
const tight=runTool('preview_recovery',{context:{...freshContext(),cashLimit:1000},optionId:'gallery'});assert.equal(tight.comparison.cashShortfall,2000);
assert.throws(()=>runTool('apply_reviewed_recovery',{context:{...tight.context,approvals:ids},confirmed:true,reviewToken:tight.comparison.reviewToken}),/Expected refunds/);
assert.equal(compare(freshContext(),'library').upfront,0);
for(const bad of [{...freshContext(),owner:'private'},{...freshContext(),cashLimit:1.5},{...freshContext(),approvals:['sam','sam']},{...freshContext(),approvals:['foreign']},{...freshContext(),choice:'forged'},{...freshContext(),applied:true}])assert.throws(()=>validateContext(bad));
assert.throws(()=>runTool('get_trip_overview',{planId:'private-plan'}),/only accepts/);
for(const text of ['Hey Alexa, it is raining','Knota, it is raining','Alexa: it is raining'])assert.equal(intent(text,freshContext()).steps[1].arguments.scenario,'rain');
for(const text of ['Approve everyone and book it','Alexa, book the gallery'])assert.ok(intent(text,freshContext()).help);
assert.equal(intent('Choose the free option',freshContext()).steps[0].arguments.optionId,'library');assert.equal(intent('start over',freshContext()).reset,true);
assert.equal(tools.length,6);assert.ok(tools.every(t=>t.inputSchema.additionalProperties===false));
assert.equal(reply({id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}}).result.serverInfo.name,'knota-sample-trip-recovery');
const request=(body,headers={},method='POST')=>new Request('https://knota.test/api/alexa/mcp',{method,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25',...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
let r=await handleDemoMcp(request(rpc('initialize',{protocolVersion:'2025-11-25'})));assert.equal(r.status,200);assert.equal((await r.json()).result.protocolVersion,'2025-11-25');
assert.equal((await handleDemoMcp(request({jsonrpc:'2.0',method:'notifications/initialized'}))).status,202);
r=await handleDemoMcp(request(rpc('tools/list')));assert.equal((await r.json()).result.tools.length,6);
r=await handleDemoMcp(request(rpc('tools/call',{name:'get_trip_overview',arguments:{}})));assert.equal((await r.json()).result.structuredContent.overview.ledger.recordedPaid,52000);
assert.equal((await handleDemoMcp(request(rpc('tools/list'),{Origin:'https://evil.test'}))).status,403);
assert.equal((await handleDemoMcp(request(rpc('tools/list'),{'MCP-Protocol-Version':'2024-01-01'}))).status,400);
assert.equal((await handleDemoMcp(request(rpc('tools/list'),{Accept:'text/xml'}))).status,406);
assert.equal((await handleDemoMcp(request(rpc('tools/list'),{'Content-Type':'text/plain'}))).status,415);
assert.equal((await handleDemoMcp(request('bad-json'))).status,400);
assert.equal((await handleDemoMcp(request('x'.repeat(16385)))).status,413);
assert.equal((await handleDemoMcp(request(undefined,{},'GET'))).status,405);
assert.equal((await handleDemoMcp(request([rpc('tools/list')]))).status,400);
console.log('Knota demo: all scenarios/options, exact shares, refund separation, review guards, cash shortfalls, ledger retention, request isolation and MCP lifecycle/error boundaries passed.');
