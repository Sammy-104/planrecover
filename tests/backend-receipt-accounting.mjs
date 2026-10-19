import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {initialState,applyAction,personalMoney,blankReceipt,splitReceipt} from '../lib/model.ts';
import {PlanRepository} from '../lib/plan-repository.ts';
import {commitFinancialEffect} from '../lib/financial-history.ts';
import {receiptRequiredMembers,receiptDuplicateCandidates,purchaseEvents,accountingItemIds} from '../lib/receipt-accounting.ts';

let checks=0;
const run=(state,type,extra={},actor='sam')=>applyAction(state,{type,actor,...extra});
const blank=()=>{const state=initialState();state.items=[];state.events=[];state.receipts=[];return state;};
const receipt=(state,overrides={})=>({...blankReceipt(state),merchant:'Actual meal',date:state.plan.start,rows:[{id:'meal',name:'Shared meal',amount:8000,claims:['sam','alex']}],total:8000,paymentConfirmed:true,...overrides});
const approve=state=>{const current=state.receipts[0];for(const actor of receiptRequiredMembers(current,['sam','alex','maya','chris']))state=run(state,'approve_receipt',{receiptId:current.id,revision:current.revision},actor);return state;};
function check(name,fn){fn();checks++;console.log(`PASS ${name}`);}
check('A lower actual receipt replaces the entire estimate without double counting, including changed diners',()=>{
 let state=run(blank(),'add_item',{name:'Estimated meal',category:'Meal',start:'2026-10-17T18:00:00-04:00',duration:60,price:10000,participants:['sam','alex']});
 const item=state.items[0];assert.equal(personalMoney(state,'alex').projected,5000);
 state=run(state,'receipt',{receipt:receipt(state,{linkedItemId:item.id,rows:[{id:'meal',name:'Meal for Sam and Maya',amount:8000,claims:['sam','maya']}]})});
 assert.equal(state.events.length,0);assert.equal(personalMoney(state,'alex').planned,5000);
 state=approve(state);assert.equal(state.events.length,1);assert.equal(state.events[0].itemId,item.id);
 assert.equal(personalMoney(state,'sam').projected,4000);assert.equal(personalMoney(state,'maya').projected,4000);assert.equal(personalMoney(state,'alex').projected,0);
 const again=run(state,'approve_receipt',{receiptId:state.receipts[0].id,revision:1});assert.deepEqual(again.events,state.events);
});
check('Recorded payment evidence preserves provider contributions and appends only an approved share correction',()=>{
 let state=blank();const item=initialState().items[2];item.price=8000;item.shares={sam:4000,alex:4000};item.participants=['sam','alex'];state.items=[item];
 const capture={id:'captured-purchase',itemId:item.id,kind:'expense',amount:8000,shares:{sam:4000,alex:4000},contributions:{sam:8000},status:'confirmed',mode:'sandbox',providerId:'CAPTURE-RECEIPT',label:'Original capture',evidence:'Verified',created:'2026-10-10T00:00:00Z'};
 state.events=[capture];state=run(state,'receipt',{receipt:receipt(state,{linkedItemId:item.id,recording:'evidence',rows:[{id:'meal',name:'Reviewed consumption',amount:8000,claims:['alex']}]})});
 assert.deepEqual(receiptRequiredMembers(state.receipts[0],['sam','alex','maya','chris']),['sam','alex']);
 state=run(state,'approve_receipt',{receiptId:state.receipts[0].id,revision:1},'alex');assert.equal(state.events.length,1);
 state=run(state,'approve_receipt',{receiptId:state.receipts[0].id,revision:1},'sam');assert.deepEqual(state.events[0],capture);assert.equal(state.events.length,2);
 assert.equal(state.events[1].kind,'adjustment');assert.equal(state.events[1].amount,0);assert.deepEqual(state.events[1].contributions,{});
 assert.equal(personalMoney(state,'sam').contribution,8000);assert.equal(personalMoney(state,'sam').cost,0);assert.equal(personalMoney(state,'alex').cost,8000);
 assert.throws(()=>run(state,'receipt',{receipt:{...state.receipts[0],total:9000,rows:[{id:'meal',name:'Meal',amount:9000,claims:['alex']}],correctionReason:'Additional amount'}}),/recorded purchase total/);
});
check('Evidence with unchanged shares adds no second event and new late capture requires fresh review',()=>{
 let state=blank();const item=initialState().items[2];state.items=[item];state.events=[{id:'paid',itemId:item.id,kind:'expense',amount:8000,shares:{sam:4000,alex:4000},contributions:{sam:8000},status:'confirmed',mode:'manual',label:'Paid',evidence:'Saved',created:'2026-10-10T00:00:00Z'}];
 state=run(state,'receipt',{receipt:receipt(state,{linkedItemId:item.id})});state=approve(state);assert.equal(state.events.length,1);
 let unpaid=run(blank(),'receipt',{receipt:receipt(blank())});unpaid.events.push({...state.events[0],id:'late-payment',itemId:unpaid.receipts[0].id});
 assert.throws(()=>approve(unpaid),/now has a recorded payment/);
 const changed=run(state,'receipt',{receipt:{...state.receipts[0],rows:[{id:'meal',name:'Consumption',amount:8000,claims:['alex']}]}});
 changed.events.push({...state.events[0],id:'new-adjustment',kind:'adjustment',amount:0,shares:{sam:-1,alex:1},contributions:{}});
 assert.throws(()=>approve(changed),/payments or allocation changed/);
});
check('Manual total and payer corrections append signed adjustments after all affected approvals',()=>{
 let state=approve(run(blank(),'receipt',{receipt:receipt(blank())}));const original=structuredClone(state.events[0]);
 const correction={...state.receipts[0],total:6000,payer:'maya',rows:[{id:'meal',name:'Corrected meal',amount:6000,claims:['alex']}],correctionReason:'Corrected merchant total and payer after checking the source.'};
 state=run(state,'receipt',{receipt:correction});assert.equal(state.events.length,1);assert.equal(personalMoney(state,'sam').contribution,8000);
 assert.deepEqual(receiptRequiredMembers(state.receipts[0],['sam','alex','maya','chris']),['sam','alex','maya']);state=approve(state);
 assert.deepEqual(state.events[0],original);assert.equal(state.events[1].amount,-2000);assert.equal(Object.values(state.events[1].shares).reduce((a,b)=>a+b,0),-2000);
 assert.equal(Object.values(state.events[1].contributions).reduce((a,b)=>a+b,0),-2000);assert.equal(personalMoney(state,'sam').contribution,0);assert.equal(personalMoney(state,'maya').contribution,6000);
 const second={...state.receipts[0],total:7000,rows:[{id:'meal',name:'Amended meal',amount:7000,claims:['alex']}],correctionReason:'Documented extra charge.'};state=approve(run(state,'receipt',{receipt:second}));
 assert.equal(state.events[2].amount,1000);assert.equal(personalMoney(state,'maya').contribution,7000);assert.equal(personalMoney(state,'alex').cost,7000);
});
check('Receipt line allocations support exact amounts, weights and percentages with exact reconciliation',()=>{
 for(const [allocation,values,expected]of [['fixed',{sam:125,alex:876},{sam:125,alex:876}],['weight',{sam:1,alex:3},{sam:250,alex:751}],['percent',{sam:20,alex:80},{sam:200,alex:801}]]){
  const result=splitReceipt({rows:[{id:'meal',name:'Meal',amount:1001,claims:['sam','alex'],allocation,values}],tax:0,tip:0,discount:0,total:1001,tipRule:'proportional'},['sam','alex']);assert.deepEqual(result,expected);
 }
 assert.throws(()=>splitReceipt({rows:[{id:'meal',name:'Meal',amount:1000,claims:['sam','alex'],allocation:'fixed',values:{sam:500,alex:499}}],tax:0,tip:0,discount:0,total:1000,tipRule:'equal'},['sam','alex']),/exact total/);
 let state=run(blank(),'receipt',{receipt:receipt(blank())});assert.equal(receiptDuplicateCandidates(state,receipt(state)).length,1);assert.throws(()=>run(state,'receipt',{receipt:receipt(state)}),/matching receipt/);
 assert.throws(()=>run(state,'receipt',{receipt:receipt(state,{linkedItemId:'missing-purchase',merchant:'Other'})}),/existing purchase/);
});

check('An already approved separate receipt can reconcile a later selected estimate without moving financial facts',()=>{
 let state=approve(run(blank(),'receipt',{receipt:receipt(blank())}));const original=structuredClone(state.events[0]);
 state=run(state,'add_item',{name:'Unreconciled meal estimate',category:'Meal',start:'2026-10-17T18:00:00-04:00',duration:60,price:10000,participants:['sam','alex']});const itemId=state.items[0].id;
 state=run(state,'receipt',{receipt:{...state.receipts[0],linkedItemId:itemId}});assert.equal(personalMoney(state,'sam').projected,9000);
 state=approve(state);assert.equal(personalMoney(state,'sam').projected,4000);assert.equal(state.events.length,1);assert.deepEqual(state.events[0],original);
 assert.equal(state.receipts[0].accountingItemId,original.itemId);assert.equal(state.receipts[0].linkedItemId,itemId);
});

check('Client accounting metadata cannot forge a paid baseline or bypass the payer approval',()=>{
 let state=run(blank(),'receipt',{receipt:receipt(blank(),{payer:'maya',previousShares:{sam:0},previousTotal:0,previousContributions:{maya:0},recordedEventIds:[],accountingItemId:'other-payment',reconciledItemId:'other-purchase'})});
 const current=state.receipts[0];assert.equal(current.previousShares,undefined);assert.equal(current.reconciledItemId,null);assert.equal(current.accountingItemId,current.id);
 for(const actor of ['sam','alex'])state=run(state,'approve_receipt',{receiptId:current.id,revision:current.revision},actor);
 assert.equal(state.events.length,0);state=run(state,'approve_receipt',{receiptId:current.id,revision:current.revision},'maya');assert.equal(state.events[0].contributions.maya,8000);
});

check('An older open receipt editor cannot overwrite a newly saved review',()=>{
 let state=run(blank(),'receipt',{receipt:receipt(blank())});const stale=structuredClone(state.receipts[0]);
 state=run(state,'receipt',{receipt:{...stale,merchant:'Corrected merchant'}});
 assert.throws(()=>run(state,'receipt',{receipt:stale}),/revision changed/);assert.equal(state.receipts[0].merchant,'Corrected merchant');
});

check('Committed receipt aliases remain visible to later approvals, refunds and allocation corrections',()=>{
 let state=approve(run(blank(),'receipt',{receipt:receipt(blank())}));const originalItemId=state.events[0].itemId;
 state=run(state,'add_item',{name:'Later linked merchant purchase',category:'Meal',start:'2026-10-17T18:00:00-04:00',duration:60,price:8000,participants:['sam','alex']});const itemId=state.items[0].id;
 state.items[0].source='Fictional demo merchant · sandbox';
 state=run(state,'receipt',{receipt:{...state.receipts[0],linkedItemId:itemId}});assert.deepEqual(accountingItemIds(state,itemId),[itemId]);state=approve(state);
 assert.deepEqual(accountingItemIds(state,itemId),[itemId,originalItemId]);
 for(const actor of ['sam','alex'])state=run(state,'approve_item',{itemId,revision:state.items[0].revision},actor);
 assert.equal(state.items[0].status,'scheduled','The recorded receipt must prevent reopening merchant checkout.');
 state.events.push({id:'later-allocation',itemId,kind:'adjustment',amount:0,shares:{sam:-100,alex:100},contributions:{},status:'confirmed',mode:'manual',label:'Later reviewed shares',evidence:'Reviewed',created:'2026-10-10T00:00:00Z'});
 assert.equal(purchaseEvents(state,itemId).length,3);
 state=approve(run(state,'receipt',{receipt:state.receipts[0]}));assert.equal(personalMoney(state,'sam').cost,4000);assert.equal(personalMoney(state,'alex').cost,4000);
 assert.deepEqual(state.events.at(-1).shares,{sam:100,alex:-100,maya:0,chris:0});
});

check('A late independently recorded target payment prevents committing a reviewed receipt alias',()=>{
 let state=approve(run(blank(),'receipt',{receipt:receipt(blank())}));
 state=run(state,'add_item',{name:'Target purchase',category:'Meal',start:'2026-10-17T18:00:00-04:00',duration:60,price:8000,participants:['sam','alex']});const itemId=state.items[0].id;
 state=run(state,'receipt',{receipt:{...state.receipts[0],linkedItemId:itemId}});
 state.events.push({...state.events[0],id:'late-separate-purchase',itemId});
 assert.throws(()=>approve(state),/now has another recorded payment/);
});

const correctionDatabase=createTestD1();
try{
 const owner='receipt-correction-owner',repository=new PlanRepository(correctionDatabase),state=blank();
 await correctionDatabase.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(owner,JSON.stringify(state),new Date().toISOString()).run();await repository.importWorkspace(owner,state);
 let current=approve(run(state,'receipt',{receipt:receipt(state)}));current=await repository.saveWorkspace(owner,current,state.version);
 const facts=await correctionDatabase.prepare('SELECT facts FROM financial_events WHERE event_id=?').bind(current.events[0].id).first('facts');
 current=approve(run(current,'receipt',{receipt:{...current.receipts[0],total:7000,rows:[{id:'meal',name:'Corrected meal',amount:7000,claims:['sam','alex']}],correctionReason:'Corrected source total.'}}));
 current=await repository.saveWorkspace(owner,current,current.version);
 assert.equal(await correctionDatabase.prepare('SELECT facts FROM financial_events WHERE event_id=?').bind(current.events[0].id).first('facts'),facts);
 assert.equal(await correctionDatabase.prepare('SELECT COUNT(*) AS n FROM financial_events').first('n'),2);assert.equal(current.events[1].amount,-1000);
 assert.equal(personalMoney(current,'sam').cost,3500);assert.equal(personalMoney(current,'sam').contribution,7000);
 checks++;console.log('PASS Repository receipt total correction preserves immutable original financial facts and saves the approved signed delta');
}finally{correctionDatabase.close();}

const claimDatabase=createTestD1();
try{
 const owner='receipt-alias-claim',repository=new PlanRepository(claimDatabase),state=blank();
 await claimDatabase.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(owner,JSON.stringify(state),new Date().toISOString()).run();await repository.importWorkspace(owner,state);
 let current=approve(run(state,'receipt',{receipt:receipt(state)}));current=await repository.saveWorkspace(owner,current,current.version);
 current=run(current,'add_item',{name:'Target checkout',category:'Meal',start:'2026-10-17T18:00:00-04:00',duration:60,price:8000,participants:['sam','alex']});const itemId=current.items[0].id;
 current=run(current,'receipt',{receipt:{...current.receipts[0],linkedItemId:itemId}});current=await repository.saveWorkspace(owner,current,current.version);
 const approved=approve(current);
 await claimDatabase.prepare("INSERT INTO payment_funding_claims(owner,plan_id,item_id,revision,member_id,channel,reference_id,created) VALUES (?,?,?,1,'sam','order','new-checkout-claim','now')").bind(owner,current.plan.id,itemId).run();
 await assert.rejects(repository.saveWorkspace(owner,approved,current.version),error=>error.code==='VERSION_CONFLICT');
 const retained=await repository.loadWorkspace(owner);assert.equal(retained.receipts[0].status,'review');assert.equal(retained.receipts[0].reconciledItemId,null);assert.equal(retained.events.length,1);
 checks++;console.log('PASS A reserved checkout inserted after receipt review fences alias commitment in the repository transaction');
}finally{claimDatabase.close();}

const database=createTestD1();
try{
 const owner='paid-plan-restore',repository=new PlanRepository(database),state=initialState();state.plan.id='paid-plan-original';state.events=[];
 await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(owner,JSON.stringify(state),new Date().toISOString()).run();await repository.importWorkspace(owner,state);
 const capture={id:'restore-capture',itemId:'hike',kind:'expense',amount:9000,shares:{sam:9000},contributions:{sam:9000},status:'confirmed',mode:'sandbox',providerId:'CAPTURE-RESTORE',label:'Paid before deletion',evidence:'Canonical provider evidence',created:'2026-10-10T00:00:00Z'};
 await commitFinancialEffect(database,{owner,planId:state.plan.id,event:capture});
 await database.prepare(`INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES ('restore-operation',?,'hike','sam',1,'order',9000,'ORDER-RESTORE','captured',?)`).bind(owner,JSON.stringify({planrecoverTripId:state.plan.id})).run();
 await database.prepare(`INSERT INTO provider_request_intents(operation_id,owner,plan_id,path,method,request_body,request_key,fingerprint,created,replay_before) VALUES ('restore-operation',?,?,'/order','POST','{}','restore-key','restore-fingerprint',?,?)`).bind(owner,state.plan.id,'2026-10-10T00:00:00Z','2026-10-10T05:00:00Z').run();
 await database.prepare(`INSERT INTO plan_invoices(id,owner,plan_id,item_id,member_id,revision,request_id,terms,amount,minimum,paid,provider_id,status,created,updated) VALUES ('restore-invoice',?,?,'hike','sam',1,'restore-invoice-request','{}',9000,9000,9000,'INV2-RESTORE','paid',?,?)`).bind(owner,state.plan.id,'2026-10-10T00:00:00Z','2026-10-10T00:00:00Z').run();
 const link=()=>database.prepare(`INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created) VALUES ('restore-link','restore-link-token',?,?,'editor',?)`).bind(owner,state.plan.id,new Date().toISOString()).run();await link();
 let current=await repository.loadWorkspace(owner);current=await repository.saveWorkspace(owner,run(current,'delete_trip',{deleteTripId:state.plan.id,confirmed:true}),current.version);
 assert.equal(await database.prepare('SELECT COUNT(*) AS n FROM trip_links').first('n'),0);
 // Legacy exports may still carry a deleted plan's invitation; restore must revoke it too.
 await link();const restored=run(current,'restore_trip',{deletedTripId:state.plan.id});assert.equal(restored.plan.id,state.plan.id);
 current=await repository.saveWorkspace(owner,restored,current.version);assert.deepEqual(current.events,[capture]);assert.equal(await database.prepare('SELECT COUNT(*) AS n FROM trip_links').first('n'),0);
 assert.equal(await database.prepare('SELECT plan_id FROM plan_invoices WHERE id=?').bind('restore-invoice').first('plan_id'),state.plan.id);
 assert.equal(await database.prepare('SELECT plan_id FROM provider_request_intents WHERE operation_id=?').bind('restore-operation').first('plan_id'),state.plan.id);
 assert.equal(JSON.parse(await database.prepare('SELECT payload FROM provider_operations WHERE id=?').bind('restore-operation').first('payload')).planrecoverTripId,state.plan.id);
 const refund={...capture,id:'restore-refund',providerId:'REFUND-RESTORE',kind:'refund',amount:-1000,shares:{sam:-1000},contributions:{sam:-1000}};
 await commitFinancialEffect(database,{owner,planId:state.plan.id,event:refund});await commitFinancialEffect(database,{owner,planId:state.plan.id,event:refund});
 assert.equal((await repository.loadWorkspace(owner)).events.length,2);assert.equal(await database.prepare('SELECT COUNT(*) AS n FROM financial_events').first('n'),2);
 checks++;console.log('PASS Repository delete/restore retains original financial identity, invoices, request/refund authority and revokes invitations without duplicate effects');
}finally{database.close();}
check('Split-tender receipt retains every original contributor separately from consumption shares',()=>{let state=run(blank(),'receipt',{receipt:receipt(blank(),{payer:'sam',contributions:{sam:3000,maya:5000}})});assert.deepEqual(receiptRequiredMembers(state.receipts[0],['sam','alex','maya','chris']),['sam','alex','maya']);const current=state.receipts[0];for(const actor of ['sam','alex'])state=run(state,'approve_receipt',{receiptId:current.id,revision:current.revision},actor);assert.equal(state.events.length,0);state=run(state,'approve_receipt',{receiptId:current.id,revision:current.revision},'maya');assert.deepEqual(state.events[0].contributions,{sam:3000,maya:5000});assert.deepEqual(state.events[0].shares,{sam:4000,alex:4000,maya:0,chris:0});assert.deepEqual(state.receipts[0].originalContributions,{sam:3000,maya:5000});assert.equal(personalMoney(state,'maya').contribution,5000);assert.equal(personalMoney(state,'maya').cost,0);});
check('Split-tender corrections require exact totals, retain original payer identities and append approved deltas',()=>{let state=approve(run(blank(),'receipt',{receipt:receipt(blank(),{contributions:{sam:3000,maya:5000}})}));const original=structuredClone(state.events[0]),current=state.receipts[0];assert.throws(()=>run(state,'receipt',{receipt:{...current,contributions:{sam:3000,maya:4000}}}),/exact receipt total/);assert.throws(()=>run(state,'receipt',{receipt:{...current,payer:'chris',contributions:{sam:3000,chris:5000}}}),/original payer identities/);assert.throws(()=>run(state,'receipt',{receipt:{...current,contributions:{sam:-1,maya:8001}}}),/exact receipt total/);state=approve(run(state,'receipt',{receipt:{...current,total:6000,rows:[{id:'meal',name:'Corrected tender total',amount:6000,claims:['sam','alex']}],contributions:{sam:2000,maya:4000},correctionReason:'The original merchant tender record shows a smaller exact charge.'}}));assert.deepEqual(state.events[0],original);assert.equal(state.events[1].amount,-2000);assert.deepEqual(state.events[1].contributions,{sam:-1000,alex:0,maya:-1000,chris:0});assert.deepEqual(state.receipts[0].originalContributions,{sam:3000,maya:5000});assert.equal(personalMoney(state,'sam').contribution,2000);assert.equal(personalMoney(state,'maya').contribution,4000);});
check('Unapproved split-tender reviews can be corrected but forged original payer metadata is discarded',()=>{let state=run(blank(),'receipt',{receipt:receipt(blank(),{contributions:{sam:3000,maya:5000},originalContributions:{chris:8000}})});assert.deepEqual(state.receipts[0].originalContributions,{sam:3000,maya:5000});state=run(state,'receipt',{receipt:{...state.receipts[0],payer:'alex',contributions:{alex:2000,chris:6000}}});assert.deepEqual(state.receipts[0].originalContributions,{alex:2000,chris:6000});assert.equal(state.events.length,0);assert.equal(state.receipts[0].revision,2);});
check('Provider-linked receipt evidence cannot replace original split or whole-group capture contributions',()=>{let state=blank();const item=initialState().items[2];item.price=8000;item.shares={sam:4000,alex:4000};item.participants=['sam','alex'];state.items=[item];state.events=[{id:'tender-sam',itemId:item.id,kind:'expense',amount:3000,shares:{sam:1500,alex:1500},contributions:{sam:3000},status:'confirmed',mode:'sandbox',providerId:'CAPTURE-SAM',label:'Original tender',evidence:'Verified'},{id:'tender-maya',itemId:item.id,kind:'expense',amount:5000,shares:{sam:2500,alex:2500},contributions:{maya:5000},status:'confirmed',mode:'sandbox',providerId:'CAPTURE-MAYA',label:'Original tender',evidence:'Verified'}];const original=structuredClone(state.events);state=approve(run(state,'receipt',{receipt:receipt(state,{linkedItemId:item.id,recording:'evidence',payer:'chris',contributions:{chris:8000}})}));assert.deepEqual(state.events,original);assert.deepEqual(state.receipts[0].contributions,{sam:3000,maya:5000});assert.deepEqual(state.receipts[0].originalContributions,{sam:3000,maya:5000});});
console.log(`${checks} receipt accounting and paid-plan restoration checks passed.`);
