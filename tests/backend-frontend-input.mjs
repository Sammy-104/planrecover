import assert from 'node:assert/strict';
import {frontendJson} from '../lib/frontend-request.ts';
import {parseWorkspaceMutation} from '../lib/action-contracts.ts';
const request=(body,headers={})=>new Request('https://example.test/api/plan-draft',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
let checks=0;
async function check(name,run){await run();checks++;console.log('PASS '+name);}
await check('JSON parsing bounds actual streamed bytes as well as declared lengths',async()=>{
 await assert.rejects(frontendJson(request('{}',{'Content-Length':'999999'}),128),/too large/);
 await assert.rejects(frontendJson(request('12345'),4),/too large/);
 assert.deepEqual(await frontendJson(request('{"goal":"walk"}',{'Content-Type':'Application/JSON; charset=utf-8'})),{goal:'walk'});
});
await check('Malformed UTF-8, arrays and foreign content types are rejected',async()=>{
 await assert.rejects(frontendJson(request(new Uint8Array([123,34,120,34,58,34,255,34,125]))),/valid JSON/);
 await assert.rejects(frontendJson(request('[]')),/JSON object/);
 await assert.rejects(frontendJson(request('{}',{'Content-Type':'text/plain'})),/as JSON/);
});
await check('Slow bodies are cancelled by a bounded deadline',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
 await assert.rejects(frontendJson(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'}),100,5),/too long/);
 assert.equal(cancelled,true);
});
await check('Clients cannot inject server-only routed entries or extra financial fields',()=>{
 for(const action of [
  {type:'apply_draft',draftId:'draft-1',entries:[{suggestionId:'place-1',start:'2027-04-04T12:00:00Z',duration:60}],_draftEntries:[{suggestionId:'forged'}]},
  {type:'planning_costs',costs:{currency:'CAD',entries:[]},events:[{kind:'expense'}]},
  {type:'planning_style',style:{pace:'balanced',interests:[]},actor:'alice',preferences:{bob:{cash:100}}},
 ])assert.throws(()=>parseWorkspaceMutation({version:1,action}));
});
console.log(`${checks} frontend input checks passed.`);
