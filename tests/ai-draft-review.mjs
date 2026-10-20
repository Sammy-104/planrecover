import assert from 'node:assert/strict';
import {initialState,applyAction} from '../lib/model.ts';
import {validatePlanDraft,previewPlanDraft} from '../lib/ai-plan.ts';
import {reviewedAiDraftActions,selectableAiDraftItems} from '../lib/ai-draft-review.ts';
import {applyDraftBatch} from '../lib/draft-batch.ts';

const state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{kind:'day-out',name:'AI selection review',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:10000}});
const facts=validatePlanDraft({summary:'Two visits for your day.',currency:'CAD',items:[
 {name:'Museum visit',category:'Activity',localStart:'2027-04-04T10:00',duration:60,price:null,participants:['sam'],location:'Toronto',reason:'An indoor start.',taskOwner:null},
 {name:'Park stroll',category:'Free stop',localStart:'2027-04-04T14:00',duration:45,price:0,participants:['sam'],location:'Toronto',reason:'Leave time for an easy afternoon.',taskOwner:null},
],warnings:[]},state);
const draft=previewPlanDraft(facts,state,'sam'),review={planId:state.plan.id,version:state.version,memberId:'sam',batchId:crypto.randomUUID(),draft};
let checks=0;const check=(name,work)=>{work();checks++;console.log('PASS '+name);};

check('A reviewed AI selection carries the exact validated actions in display order',()=>{
 const selected=[1,0],before=structuredClone(review);
 const actions=reviewedAiDraftActions(review,state,'sam',selected);
 assert.deepEqual(actions.map(action=>action.name),['Museum visit','Park stroll']);
 assert.equal(actions[0].price,null);assert.equal(actions[1].price,0);
 assert.match(actions[0].policy,/AI draft estimate/);
 assert.deepEqual(review,before);assert.deepEqual(selected,[1,0]);
});
check('A change of plan, workspace version or signed-in member blocks stale additions',()=>{
 for(const changed of [{...state,plan:{...state.plan,id:'another-plan'}},{...state,version:state.version+1}])
  assert.throws(()=>reviewedAiDraftActions(review,changed,'sam',[0]),/plan changed/);
 assert.throws(()=>reviewedAiDraftActions(review,state,'alex',[0]),/plan changed/);
});
check('Empty, duplicate, fractional and unknown selections are rejected',()=>{
 for(const selected of [[],[0,0],[-1],[2],[0.5]])assert.throws(()=>reviewedAiDraftActions(review,state,'sam',selected));
});
check('Blocking planning constraints cannot be selected while another valid suggestion remains usable',()=>{
 const blocked=structuredClone(review);blocked.draft.constraints.items[1].issues.push({code:'FIXTURE_CONFLICT',severity:'error',itemId:'draft-1',message:'Outside availability.'});
 assert.deepEqual(selectableAiDraftItems(blocked.draft),[0]);
 assert.throws(()=>reviewedAiDraftActions(blocked,state,'sam',[1]),/planning conflicts/);
 assert.equal(reviewedAiDraftActions(blocked,state,'sam',[0]).length,1);
});
check('Multiple reviewed suggestions become actual unapproved itinerary items with one retained batch',()=>{
 const actions=reviewedAiDraftActions(review,state,'sam',[0,1]),before=structuredClone(state);
 const next=applyDraftBatch(state,{type:'add_drafts',actor:'sam',tripId:state.plan.id,batchId:review.batchId,actions});
 assert.deepEqual(next.items.map(item=>item.name),['Museum visit','Park stroll']);
 for(const item of next.items){assert.equal(item.status,'draft');assert.deepEqual(item.approvals,[]);assert.deepEqual(item.paid,[]);assert.equal(item.booking,'unconfirmed');}
 assert.deepEqual(next.events,state.events);assert.deepEqual(next.receipts,state.receipts);
 assert.ok(next.appliedDrafts.includes(review.batchId));assert.deepEqual(state,before);
 assert.throws(()=>applyDraftBatch(next,{type:'add_drafts',actor:'sam',tripId:state.plan.id,batchId:review.batchId,actions}),/already added/);
});
check('An invalid later AI suggestion cannot leave a partially added itinerary',()=>{
 const actions=structuredClone(reviewedAiDraftActions(review,state,'sam',[0,1])),before=structuredClone(state);
 actions[1].start=actions[0].start;
 assert.throws(()=>applyDraftBatch(state,{type:'add_drafts',actor:'sam',tripId:state.plan.id,batchId:crypto.randomUUID(),actions}),/Overlaps/);
 assert.deepEqual(state,before);
});
console.log(`${checks} AI selection and itinerary integration checks passed; no inference or provider calls.`);
