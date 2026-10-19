import assert from 'node:assert/strict';
import {receiptDeepLink,followReceiptDeepLink} from '../lib/receipt-deep-link.ts';
import {initialState,applyAction} from '../lib/model.ts';
import {initializePeople} from '../lib/people.ts';

const identity={id:'signed-in-member',name:'Private member'};
function personal(name='First personal plan',date='2027-04-04'){
 const state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{kind:'day-out',name,destination:'Toronto',start:date,end:date,timezone:'America/Toronto',currency:'CAD',budget:5000}});
 state.archives=[];initializePeople(state,identity);return state;
}
function harness(state,flags={}){
 let current={state,visitorDemo:false,shared:false,signedIn:true,canEdit:true,memberId:identity.id,hasShareToken:false,...flags},opened=[],selected=[];
 const handled=new Set();
 const dependencies={current:()=>current,selectPlan:async id=>{selected.push(id);current={...current,state:applyAction(current.state,{type:'select_trip',actor:current.state.people?identity.id:'sam',tripId:id}),memberId:identity.id};return current.state;},
  openBlank:(receipt,planId)=>opened.push({receipt,planId})};
 return {handled,dependencies,opened,selected,get current(){return current;},set current(value){current=value;}};
}
let checks=0;
async function check(name,work){await work();checks++;console.log('PASS '+name);}

await check('Receipt links accept only one fixed scan intent and a bounded exact saved-plan identifier',async()=>{
 assert.deepEqual(receiptDeepLink('?plan=plan-123&receipt=scan'),{planId:'plan-123',key:'receipt-scan:plan-123'});
 assert.deepEqual(receiptDeepLink('?receipt=scan'),{planId:undefined,key:'receipt-scan:current'});
 for(const search of ['', '?plan=x','?receipt=approve','?receipt=scan&receipt=scan','?receipt=scan&plan=x&plan=y','?receipt=scan&plan=','?receipt=scan&plan=%0Aattack','?receipt=scan&plan=https%3A%2F%2Fevil.test','?receipt=scan&plan='+'a'.repeat(181),'?receipt=scan&noise='+'x'.repeat(2048)])assert.equal(receiptDeepLink(search),null,search.slice(0,50));
});
await check('A current-plan link opens an empty review once, uses the signed-in payer and has no financial effects',async()=>{
 const state=personal(),before=structuredClone(state),h=harness(state),link=receiptDeepLink('?receipt=scan&merchant=Injected&total=99999&approve=true');
 assert.equal(await followReceiptDeepLink(link,h.handled,h.dependencies),'opened');
 assert.equal(await followReceiptDeepLink(link,h.handled,h.dependencies),'ignored');
 assert.deepEqual(h.selected,[]);assert.equal(h.opened.length,1);const receipt=h.opened[0].receipt;
 assert.equal(receipt.payer,identity.id);assert.equal(receipt.merchant,'');assert.equal(receipt.total,0);assert.equal(receipt.date,state.plan.start);
 assert.equal(receipt.paymentConfirmed,false);assert.deepEqual(receipt.approvals,[]);assert.deepEqual(receipt.rows[0].claims,[identity.id]);assert.deepEqual(state,before);
});
await check('Cross-plan links select through the existing action before constructing the target-plan blank receipt',async()=>{
 const first=personal(),second=personal('Second personal plan','2027-05-05');first.archives=[{id:second.plan.id,archivedAt:new Date().toISOString(),workspace:second}];
 const events=structuredClone([first.events,second.events]),h=harness(first);let release;
 const select=h.dependencies.selectPlan;h.dependencies.selectPlan=async id=>{await new Promise(resolve=>release=resolve);return select(id);};
 const link=receiptDeepLink(`?plan=${second.plan.id}&receipt=scan`),pending=followReceiptDeepLink(link,h.handled,h.dependencies);
 assert.equal(await followReceiptDeepLink(link,h.handled,h.dependencies),'ignored');assert.equal(h.opened.length,0);
 release();assert.equal(await pending,'opened');assert.deepEqual(h.selected,[second.plan.id]);assert.equal(h.opened[0].planId,second.plan.id);
 assert.equal(h.opened[0].receipt.date,'2027-05-05');assert.deepEqual([first.events,second.events],events);assert.equal(h.current.state.receipts.length,0);
});
await check('A signed-in demo-to-personal link refreshes payer identity rather than retaining the demo actor',async()=>{
 const demo=initialState(),saved=personal();demo.archives=[{id:saved.plan.id,archivedAt:new Date().toISOString(),workspace:saved}];
 const h=harness(demo,{memberId:undefined});assert.equal(await followReceiptDeepLink(receiptDeepLink(`?plan=${saved.plan.id}&receipt=scan`),h.handled,h.dependencies),'opened');
 assert.equal(h.opened[0].receipt.payer,identity.id);assert.deepEqual(h.opened[0].receipt.rows[0].claims,[identity.id]);
});
await check('Anonymous, visitor demo, read-only, viewer, legacy, unknown and shared cross-plan requests cannot open a receipt',async()=>{
 for(const flags of [{signedIn:false},{visitorDemo:true},{canEdit:false},{memberId:'other-member'}]){
  const h=harness(personal(),flags);assert.notEqual(await followReceiptDeepLink(receiptDeepLink('?receipt=scan'),h.handled,h.dependencies),'opened');assert.equal(h.opened.length,0);assert.equal(h.selected.length,0);
 }
 for(const role of ['viewer','legacy']){const state=personal();state.people.find(person=>person.id===identity.id).role=role;const h=harness(state);assert.equal(await followReceiptDeepLink(receiptDeepLink('?receipt=scan'),h.handled,h.dependencies),'unavailable');assert.equal(h.opened.length,0);}
 const first=personal(),second=personal();first.archives=[{id:second.plan.id,archivedAt:new Date().toISOString(),workspace:second}];
 for(const flags of [{shared:true},{hasShareToken:true}]){const h=harness(first,flags);assert.equal(await followReceiptDeepLink(receiptDeepLink(`?plan=${second.plan.id}&receipt=scan`),h.handled,h.dependencies),'unavailable');assert.equal(h.selected.length,0);}
 for(const state of [initialState(),personal()]){const h=harness(state);const link=receiptDeepLink(`?plan=${state.plan.template==='algonquin'?state.plan.id:'unknown-plan'}&receipt=scan`);assert.equal(await followReceiptDeepLink(link,h.handled,h.dependencies),'unavailable');assert.equal(h.opened.length,0);}
 const shared=harness(personal(),{shared:true,hasShareToken:true});assert.equal(await followReceiptDeepLink(receiptDeepLink('?receipt=scan'),shared.handled,shared.dependencies),'opened');
});
await check('Failed selection, changed membership and superseded navigation cannot open the wrong plan review',async()=>{
 const first=personal(),second=personal();first.archives=[{id:second.plan.id,archivedAt:new Date().toISOString(),workspace:second}];
 for(const outcome of ['failed','different-plan','removed-member','superseded']){
  const h=harness(structuredClone(first)),select=h.dependencies.selectPlan;
  h.dependencies.selectPlan=async id=>{if(outcome==='failed')return undefined;const selected=await select(id);if(outcome==='different-plan')h.current={...h.current,state:personal('Different')};if(outcome==='removed-member')h.current={...h.current,memberId:'removed-member'};if(outcome==='superseded')h.current={...h.current,visitorDemo:true};return selected;};
  assert.equal(await followReceiptDeepLink(receiptDeepLink(`?plan=${second.plan.id}&receipt=scan`),h.handled,h.dependencies),'unavailable',outcome);assert.equal(h.opened.length,0);
 }
});
console.log(`${checks} receipt deep-link navigation checks passed; no network or financial mutations.`);
