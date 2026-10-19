import assert from 'node:assert/strict';
import {agentProposalReview,resolveProposalPlanSelection} from '../lib/agent-proposal-review.ts';

const people=[{id:'alice',name:'Alice',role:'owner'},{id:'bob',name:'Bob',role:'editor'}];
const item={id:'task-1',name:'Pack a bag',category:'Preparation',start:'2026-10-20T09:00:00-04:00',duration:15,price:0,participants:['alice'],taskOwner:'alice',location:'Home'};
const record={state:{plan:{id:'target-plan',name:'MCP test plan',currency:'CAD',timezone:'America/Toronto'},people,items:[item],reminders:[{id:'reminder-1',itemId:item.id,title:'Pack before leaving',due:'2026-10-20T08:00:00-04:00',done:false}]},version:7,role:'owner',memberId:'alice'};
const action={type:'add_item',name:'Synthetic preparation check',category:'Preparation',start:'2026-10-20T09:30:00-04:00',duration:15,price:0,participants:['alice'],taskOwner:'alice',location:'Home'};
const proposal={id:crypto.randomUUID(),plan_id:'target-plan',plan_version:7,status:'review',preview:{kind:'plan-action',action}};
const fields=view=>Object.fromEntries(view.fields.map(field=>[field.label,field.value.replace(/[\u00a0\u202f]/g,' ')]));
let checks=0;function check(name,run){run();checks++;console.log('PASS '+name);}

check('Proposal target wins over first-listed plan and an incompatible explicit query is explained',()=>{
 const plans=[{id:'wrong-plan',name:'Recovery plan'},{id:'target-plan',name:'MCP test plan'}];
 assert.deepEqual(resolveProposalPlanSelection(plans,null,proposal),{planId:'target-plan',notice:null});
 const selection=resolveProposalPlanSelection(plans,'wrong-plan',proposal);assert.equal(selection.planId,'target-plan');assert.match(selection.notice,/correct plan/);
 assert.equal(resolveProposalPlanSelection(plans,'target-plan',proposal).notice,null);assert.equal(resolveProposalPlanSelection(plans,null,null).planId,'wrong-plan');
 assert.equal(resolveProposalPlanSelection([],null,proposal).planId,'target-plan');
});
check('A concrete task review names the exact plan, money, category, time, duration and people',()=>{
 const review=agentProposalReview(proposal,'target-plan',record),value=fields(review);assert.equal(review.canApply,true);assert.equal(review.targetPlanId,'target-plan');
 assert.equal(value.Plan,'MCP test plan');assert.equal(value.Currency,'CAD');assert.equal(value.Category,'Preparation');assert.equal(value.Duration,'15 minutes');assert.equal(value['Proposed price'],'CAD 0.00');assert.equal(value.Participants,'Alice');assert.equal(value['Task owner'],'Alice');assert.equal(value.Start,'2026-10-20 09:30 · America/Toronto');
});
check('Changing selector or supplying a mismatched loaded record disables Apply and hides unrelated plan context',()=>{
 const wrong={...record,state:{...record.state,plan:{...record.state.plan,id:'wrong-plan',name:'Recovery plan',currency:'USD'}}};
 for(const [selected,loaded] of [['wrong-plan',wrong],['target-plan',wrong],['target-plan',null]]){const review=agentProposalReview(proposal,selected,loaded);assert.equal(review.canApply,false);assert.ok(review.blockedReason);assert.equal(JSON.stringify(review.fields).includes('Recovery plan'),false);assert.equal(JSON.stringify(review.fields).includes('USD'),false);}
 assert.equal(agentProposalReview(proposal,'target-plan',record).canApply,true);
});
check('Fresh plan version, edit access and review status are required at display and confirmation',()=>{
 assert.match(agentProposalReview(proposal,'target-plan',{...record,version:8}).blockedReason,/changed/);
 assert.equal(agentProposalReview(proposal,'target-plan',{...record,role:'viewer'}).canApply,false);
 assert.equal(agentProposalReview({...proposal,status:'applied'},'target-plan',record).canApply,false);
 assert.equal(agentProposalReview({...proposal,plan_version:undefined},'target-plan',record).canApply,false);
 assert.equal(agentProposalReview({...proposal,plan_id:null},'target-plan',record).canApply,false);
});
check('Price review preserves exact minor units, zero and explicitly unknown prices',()=>{
 for(const [price,expected] of [[123456,'CAD 1,234.56'],[0,'CAD 0.00'],[null,'Unknown']])assert.equal(fields(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{...action,price}}},'target-plan',record))['Proposed price'],expected);
 const yen={...record,state:{...record.state,plan:{...record.state.plan,currency:'JPY'}}};assert.equal(fields(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{...action,price:1234}}},'target-plan',yen))['Proposed price'],'JPY 1,234');
});
check('Task edits review inherited terms and the proposed owner and participants by name',()=>{
 const review=agentProposalReview({...proposal,preview:{kind:'plan-action',action:{type:'task_edit',itemId:item.id,name:'Pack warm layers',taskOwner:'bob',start:'2026-10-20T14:00:00Z'}}},'target-plan',record),value=fields(review);
 assert.equal(review.canApply,true);assert.equal(value.Item,'Pack warm layers');assert.equal(value.Category,'Preparation');assert.equal(value.Duration,'15 minutes');assert.equal(value['Proposed price'],'CAD 0.00');assert.equal(value['Task owner'],'Bob');assert.equal(value.Participants,'Bob');assert.equal(value.Start,'2026-10-20 10:00 · America/Toronto');
 const missing={...record,state:{...record.state,people:[people[0]]}};assert.equal(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{...action,participants:['bob']}}},'target-plan',missing).canApply,false);
});
check('Item allocation and completion changes show their concrete proposed terms',()=>{
 const split=fields(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{type:'item_edit',itemId:item.id,participants:['alice','bob'],price:1500,allocation:'fixed',values:{alice:1000,bob:500}}}},'target-plan',record));
 assert.equal(split.Participants,'Alice, Bob');assert.equal(split['Cost split'],'Fixed amounts');assert.equal(split['Alice share'],'CAD 10.00');assert.equal(split['Bob share'],'CAD 5.00');
 const task=fields(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{type:'task',itemId:item.id,done:true}}},'target-plan',record));assert.equal(task['Task status'],'Complete');
 const reminder=fields(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{type:'reminder',reminderId:'reminder-1',done:false}}},'target-plan',record));assert.equal(reminder['Reminder status'],'Open');assert.equal(reminder['Reminder due'],'2026-10-20 08:00 · America/Toronto');
 assert.equal(agentProposalReview({...proposal,preview:{kind:'plan-action',action:{type:'task',itemId:'missing',done:true}}},'target-plan',record).canApply,false);
});
check('New-plan review is independent of selector and includes exact dates, zone, currency and budget',()=>{
 const plan={name:'New weekend',destination:'Toronto',start:'2026-11-01',end:'2026-11-03',timezone:'America/Toronto',currency:'CAD',budget:50234,goal:'Explore the city',kind:'trip'},creation={status:'review',preview:{kind:'create-plan',plan}};
 const review=agentProposalReview(creation,'wrong-plan',null),value=fields(review);assert.equal(review.canApply,true);assert.equal(review.targetPlanId,null);assert.equal(value.Dates,'2026-11-01 to 2026-11-03');assert.equal(value['Time zone'],'America/Toronto');assert.equal(value.Currency,'CAD');assert.equal(value.Budget,'CAD 502.34');
 const noBudget={...plan};delete noBudget.budget;assert.equal(fields(agentProposalReview({...creation,preview:{kind:'create-plan',plan:noBudget}},'',null)).Budget,'CAD 300.00 (default)');
 for(const incomplete of [{...plan,timezone:undefined},{...plan,currency:undefined},{...plan,end:'2026-10-31'}])assert.equal(agentProposalReview({...creation,preview:{kind:'create-plan',plan:incomplete}},'',null).canApply,false);
});
console.log(`${checks} proposal review checks passed without network access or applying a proposal.`);
