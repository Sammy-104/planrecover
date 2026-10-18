import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,unlinkSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initialState,applyAction,affectedItems,tripCatalog} from '../lib/model.ts';
import {parseWorkspaceMutation} from '../lib/action-contracts.ts';
import {reimbursementHandoff} from '../lib/reimbursement.ts';
import {assertDependenciesReviewed} from '../lib/dependencies.ts';
import {validatePlanDraft,previewPlanDraft} from '../lib/ai-plan.ts';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
import {createTestD1} from './helpers/d1.mjs';

let checks=0;
function check(name,run){run();checks++;console.log(`PASS ${name}`);}
const act=(state,action)=>applyAction(state,parseWorkspaceMutation({version:state.version,action:{actor:'sam',...action}}).action);
function custom(){let state=act(initialState(),{type:'create_trip',plan:{kind:'day-out',name:'Custom chain',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000}});for(const name of ['Hike','Shuttle','Return shuttle','Useful lodging'])state=act(state,{type:'add_item',name,category:'Activity',start:'2027-04-04T10:00:00-04:00',duration:30,price:6400,participants:['sam','alex'],location:'Toronto'});state.items.forEach((item,index)=>{item.id=['hike-custom','shuttle-custom','return-custom','lodging-custom'][index];item.status='scheduled';item.approvals=['sam','alex'];});return state;}
const dependency=(state,itemId,depends)=>act(state,{type:'item_dependencies',itemId,depends,revision:state.items.find(item=>item.id===itemId).revision,source:'Reviewed supplier reservation terms',confirm:true});

check('Repayment handoff and visible amount share currency and exact minor units',()=>{
 for(const [currency,amount,suffix,label] of [['CAD',3013,'30.13CAD','CAD 30.13'],['USD',3013,'30.13USD','USD 30.13'],['EUR',3013,'30.13EUR','EUR 30.13'],['JPY',3013,'3013JPY','JPY 3,013'],['TWD',3000,'30TWD','TWD 30.00']]){
  const link=reimbursementHandoff('https://paypal.me/approved-profile/',amount,currency);assert.equal(link.href,`https://paypal.me/approved-profile/${suffix}`);assert.equal(link.label.replace(/\s/g,' '),label);
 }
 for(const amount of [0,-1,NaN,Infinity,1.5,1e12+1])assert.equal(reimbursementHandoff('https://paypal.me/alex',amount,'CAD'),undefined);
 for(const profile of ['https://attacker.test/alex','https://paypal.me/alex?currency=CAD','https://paypal.me/alex/30','javascript:alert(1)'])assert.equal(reimbursementHandoff(profile,3013,'USD'),undefined);
 for(const currency of ['BHD','ZZZ','usd'])assert.equal(reimbursementHandoff('https://paypal.me/alex',3013,currency),undefined);
 assert.equal(reimbursementHandoff('https://paypal.me/alex',3013,'TWD'),undefined,'No rounding a fractional TWD request to an unsupported PayPal amount.');
});

check('A custom three-item chain propagates impact and preserves independent lodging and financial facts',()=>{
 let state=custom();state=dependency(state,'shuttle-custom',['hike-custom']);state=dependency(state,'return-custom',['shuttle-custom']);
 state.items.forEach(item=>{item.status='scheduled';item.approvals=['sam','alex'];});
 state.events=[{id:'outside-paid',itemId:'hike-custom',kind:'expense',label:'Reviewed purchase',shares:{sam:3200,alex:3200},contributions:{sam:6400},amount:6400,status:'confirmed',mode:'manual',evidence:'Receipt',created:'2027-04-01T00:00:00Z'}];
 const original=structuredClone(state),next=dependency(state,'hike-custom',[]);
 assert.deepEqual(affectedItems(next,'hike-custom').map(item=>item.id),['hike-custom','shuttle-custom','return-custom']);
 for(const item of next.items.slice(0,3)){assert.equal(item.status,'draft');assert.deepEqual(item.approvals,[]);assert.equal(item.revision,original.items.find(before=>before.id===item.id).revision+1);}
 assert.deepEqual(next.items[3],original.items[3]);assert.deepEqual(next.events,original.events);assert.deepEqual(state,original,'Mutation retains the caller snapshot.');
 assert.equal(next.items[0].dependencyEvidence.confirmedBy,'sam');assert.equal(next.items[0].dependencyEvidence.source,'Reviewed supplier reservation terms');
 assert.ok(Date.parse(next.items[0].dependencyEvidence.confirmedAt));
});

check('Unknown prerequisites, duplicate edges, self-dependencies, cycles, stale revisions and unconfirmed edits are rejected',()=>{
 let state=custom();state=dependency(state,'shuttle-custom',['hike-custom']);state=dependency(state,'return-custom',['shuttle-custom']);
 const before=structuredClone(state);
 for(const [itemId,depends] of [['hike-custom',['return-custom']],['hike-custom',['hike-custom']],['hike-custom',['missing']],['hike-custom',['lodging-custom','lodging-custom']]])assert.throws(()=>dependency(state,itemId,depends));
 assert.throws(()=>act(state,{type:'item_dependencies',itemId:'hike-custom',depends:[],revision:100,source:'Terms',confirm:true}),/revision changed/);
 assert.throws(()=>act(state,{type:'item_dependencies',itemId:'hike-custom',depends:[],revision:1,source:'Terms',confirm:false}));
 const cancelled=structuredClone(state);cancelled.items[3].status='cancelled';assert.throws(()=>dependency(cancelled,'hike-custom',['lodging-custom']),/cancelled prerequisite/);
 assert.deepEqual(state,before);
});

check('Removed edges keep recovery blocked until every affected revision has full group approval',()=>{
 let state=dependency(custom(),'shuttle-custom',['hike-custom']);
 const approve=id=>{for(const actor of ['sam','alex'])state=act(state,{type:'approve_item',actor,itemId:id,revision:state.items.find(item=>item.id===id).revision});};
 for(const id of ['hike-custom','shuttle-custom'])approve(id);
 assert.doesNotThrow(()=>assertDependenciesReviewed(state.items,['hike-custom']));
 state=dependency(state,'shuttle-custom',[]);assert.deepEqual(state.items.find(item=>item.id==='shuttle-custom').depends,[]);
 assert.throws(()=>assertDependenciesReviewed(state.items,['hike-custom']),/Complete group approval/);
 approve('hike-custom');assert.equal(state.items.find(item=>item.id==='hike-custom').dependencyReviewPending,undefined);
 assert.throws(()=>assertDependenciesReviewed(state.items,['hike-custom']),/Complete group approval/,'The other group marker retains the removed prerequisite identity.');
 const revision=state.items.find(item=>item.id==='shuttle-custom').revision;state=act(state,{type:'approve_item',itemId:'shuttle-custom',revision});
 assert.throws(()=>assertDependenciesReviewed(state.items,['hike-custom']),/Complete group approval/);
 state=act(state,{type:'approve_item',actor:'alex',itemId:'shuttle-custom',revision});assert.doesNotThrow(()=>assertDependenciesReviewed(state.items,['hike-custom']));
 state=dependency(state,'shuttle-custom',['hike-custom']);state=dependency(state,'shuttle-custom',['lodging-custom']);
 assert.deepEqual(state.items.find(item=>item.id==='shuttle-custom').dependencyReviewPending.affected,['hike-custom','lodging-custom','shuttle-custom']);
 assert.throws(()=>assertDependenciesReviewed(state.items,['hike-custom']),/Complete group approval/,'Repeated edits retain earlier group identities.');
});

check('Editing a free preparation task preserves an approvable pending prerequisite review',()=>{
 let state=act(custom(),{type:'add_item',name:'Pack gear',category:'Preparation',start:'2027-04-04T09:00:00-04:00',duration:15,price:0,participants:['sam'],taskOwner:'sam'}),taskId=state.items.at(-1).id;
 state=dependency(state,taskId,['hike-custom']);state=act(state,{type:'task_edit',itemId:taskId,name:'Pack rain gear',taskOwner:'alex',start:'2027-04-04T08:30:00-04:00'});
 const task=state.items.find(item=>item.id===taskId);assert.equal(task.status,'draft');assert.deepEqual(task.approvals,[]);assert.deepEqual([...task.required].sort(),['alex','sam']);assert.ok(task.dependencyReviewPending);
 for(const id of [taskId,'hike-custom'])for(const actor of ['sam','alex'])state=act(state,{type:'approve_item',actor,itemId:id,revision:state.items.find(item=>item.id===id).revision});
 assert.doesNotThrow(()=>assertDependenciesReviewed(state.items,['hike-custom']));assert.equal(state.items.find(item=>item.id===taskId).status,'scheduled');
});

check('AI dependencies remain proposals until a person confirms source and direction',()=>{
 const state=custom(),facts={summary:'Museum after a prepared activity',currency:'CAD',items:[{name:'Museum',category:'Activity',localStart:'2027-04-04T15:00',duration:60,price:0,participants:['sam'],location:'Toronto',reason:'Afternoon stop',taskOwner:null,dependsOn:['shuttle-custom'],dependencyReason:'The group needs its reserved shuttle to reach the venue.'}],warnings:[]};
 const validated=validatePlanDraft(facts,state),preview=previewPlanDraft(validated,state,'sam'),next=act(state,preview.items[0].action),added=next.items.at(-1);
 assert.deepEqual(added.depends,[]);assert.deepEqual(added.suggestedDependencies.ids,['shuttle-custom']);assert.equal(added.dependencyEvidence,undefined);assert.deepEqual(added.approvals,[]);
 assert.match(preview.warnings.join(' '),/unconfirmed/);assert.match(added.suggestedDependencies.source,/AI suggestion \(unverified\)/);
 const confirmed=dependency(next,added.id,['shuttle-custom']).items.at(-1);assert.deepEqual(confirmed.depends,['shuttle-custom']);assert.equal(confirmed.suggestedDependencies,undefined);
 for(const bad of [['missing'],['shuttle-custom','shuttle-custom']]){const invalid=structuredClone(facts);invalid.items[0].dependsOn=bad;assert.throws(()=>validatePlanDraft(invalid,state));}
 const noSource=structuredClone(facts);noSource.items[0].dependencyReason='';assert.throws(()=>validatePlanDraft(noSource,state));
});

check('Group responses can be revised, skip, suggest time and withdraw without giving financial approval',()=>{
 let state=initialState();const originalItems=structuredClone(state.items),events=structuredClone(state.events),vote=value=>{state=act(state,{type:'suggestion_feedback',suggestionId:'museum',feedback:'vote',vote:value,...value==='alternative-time'?{alternativeStart:'2026-10-18T12:30:00-04:00'}:{}});};
 vote('interested');assert.equal(state.votes.museum.sam,'interested');vote('alternative-time');assert.equal(state.voteTimes.museum.sam,'2026-10-18T12:30:00-04:00');
 vote('not-interested');assert.equal(state.votes.museum.sam,'not-interested');assert.equal(state.voteTimes.museum.sam,undefined);
 state=act(state,{type:'suggestion_feedback',suggestionId:'museum',feedback:'withdraw'});assert.equal(state.votes.museum.sam,undefined);assert.equal(state.voteTimes.museum.sam,undefined);
 assert.deepEqual(state.items,originalItems);assert.deepEqual(state.events,events);
 assert.throws(()=>act(state,{type:'suggestion_feedback',suggestionId:'museum',feedback:'vote',vote:'alternative-time'}));
 assert.throws(()=>act(state,{type:'suggestion_feedback',suggestionId:'museum',feedback:'vote',vote:'alternative-time',alternativeStart:'2028-01-01T12:00:00Z'}));
});

{
 const database=createTestD1(),owner='dependency-regression-owner',identity={id:await accountPersonId(owner),name:'Owner'};
 try{const repository=new PlanRepository(database),created=await repository.createPlan(owner,identity,{kind:'day-out',name:'Saved prerequisites',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:10000}),planId=created.state.plan.id;
  let record=created;for(const name of ['Outdoor venue','Connecting shuttle'])record=await repository.updatePlan(planId,identity,record.version,{type:'add_item',actor:identity.id,name,category:'Activity',start:'2027-04-04T10:00:00-04:00',duration:30,price:1000,participants:[identity.id]});
  const [venue,shuttle]=record.state.items;record=await repository.updatePlan(planId,identity,record.version,{type:'item_dependencies',actor:identity.id,itemId:shuttle.id,revision:shuttle.revision,depends:[venue.id],source:'Reservation checked',confirm:true});
  const restored=await new PlanRepository(database).getPlan(planId,identity);assert.deepEqual(restored.state.items[1].depends,[venue.id]);assert.equal(restored.state.items[1].dependencyEvidence.confirmedBy,identity.id);assert.deepEqual(restored.state.items[1].approvals,[]);
  await assert.rejects(repository.updatePlan(planId,{id:'outsider',name:'Outsider'},record.version,{type:'item_dependencies',actor:identity.id,itemId:shuttle.id,revision:2,depends:[],source:'Spoofed',confirm:true}));
  checks++;console.log('PASS Confirmed prerequisite source persists across repository reload and rejects outsider identity');
 }finally{database.close();}
}

{
 const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
 const outfile=resolve(root,'build','browser-gaps-components.mjs');mkdirSync(resolve(root,'build'),{recursive:true});
 try{await build({stdin:{contents:"export {DependencyReview} from './components/dependency-review';export {SuggestionVotes} from './components/suggestion-votes';",resolveDir:root,loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json')});
  const {DependencyReview,SuggestionVotes}=await import(pathToFileURL(outfile).href);let state=custom();state=dependency(state,'shuttle-custom',['hike-custom']);const item=state.items[1];
  const prerequisites=renderToStaticMarkup(createElement(DependencyReview,{state,item,actor:'sam',busy:false,canEdit:true,onAction:async()=>{}}));
  assert.match(prerequisites,/Shuttle requires Hike/);assert.match(prerequisites,/Reviewed supplier reservation terms/);assert.match(prerequisites,/fresh group approval/);assert.match(prerequisites,/Save prerequisites<\/button>/);
  state=initialState();state.votes.museum={sam:'interested',alex:'interested',maya:'not-interested',chris:'alternative-time'};state.voteTimes={museum:{chris:'2026-10-18T12:30:00-04:00'}};
  const group=renderToStaticMarkup(createElement(SuggestionVotes,{state,suggestion:tripCatalog(state).find(item=>item.id==='museum'),actor:'sam',busy:false,canEdit:true,onAction:async()=>{},onSelect:()=>{}})).replace(/\s/g,' ');
  assert.match(group,/2 interested/);assert.match(group,/Sam: CAD 32.00/);assert.match(group,/Alex: CAD 32.00/);assert.match(group,/Skipping/);assert.match(group,/Another time:/);assert.match(group,/Withdraw response/);assert.match(group,/separately approves/);assert.match(group,/Use interested participants/);
  checks++;console.log('PASS Rendered prerequisite and group-preference controls expose direction, source, responses and smaller-group cost');
 }finally{try{unlinkSync(outfile);}catch{}}
}
console.log(`Browser gaps: ${checks} regression checks passed.`);
