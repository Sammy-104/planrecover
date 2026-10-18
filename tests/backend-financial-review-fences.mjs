import assert from 'node:assert/strict';
import {createTestD1,applyMigrations} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {PlanChangeService} from '../lib/plan-changes.ts';
import {ExternalRecoveryService,externalRecoveryRequest} from '../lib/external-recovery-service.ts';
import {invoiceRefundEvidenceWrites,invoiceRefundRequestView} from '../lib/invoice-refund-evidence.ts';
import {createPlanCheckout} from '../lib/plan-checkout.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {personalMoney} from '../lib/model.ts';
import {claimPaymentFunding} from '../lib/financial-history.ts';

let checks=0;
const owner='financial-review-owner',alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId('financial-review-bob'),name:'Bob'},outsider={id:'unrelated',name:'Unrelated'};
async function check(name,run){const database=createTestD1();try{
 const repository=new PlanRepository(database),record=await repository.createPlan(owner,alice,{name:'Reviewed financial fixes',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:10000}),planId=record.state.plan.id;
 const root=await repository.loadWorkspace(owner);addPerson(root,bob,'editor');root.items.push({id:'venue',name:'Venue',category:'Activity',start:'2027-04-04T10:00:00-04:00',duration:60,price:2000,participants:[alice.id,bob.id],shares:{[alice.id]:1000,[bob.id]:1000},allocation:'equal',values:{},revision:1,approvals:[alice.id,bob.id],required:[alice.id,bob.id],status:'awaiting-payment',booking:'unconfirmed',policy:'Reviewed venue terms',source:'Fictional demo merchant · sandbox',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'});await repository.saveWorkspace(owner,root,root.version);
 const current=()=>repository.getPlan(planId,alice),changes=new PlanChangeService(database),external=new ExternalRecoveryService(database);
 await run({database,repository,planId,current,changes,external});checks++;console.log('PASS '+name);
}finally{database.close();}}
async function request(database,id,amount=1000,{previous=[],approved=true}={}){await database.prepare("INSERT INTO invoice_refund_requests(id,owner,plan_id,invoice_id,member_id,amount,currency,terms,status,created,approved_owner,approved_member) VALUES (?,'owner','plan','invoice','buyer',?,'CAD',?,'awaiting-merchant',?,?,?)").bind(id,amount,JSON.stringify({previousRefunds:previous}),`2027-01-01T00:00:0${id==='first'?0:1}Z`,approved?1:0,approved?1:0).run();}
async function evidence(database,id,amount){await database.prepare("INSERT INTO invoice_refunds(refund_id,invoice_id,owner,plan_id,amount,body,created) VALUES (?,'invoice','owner','plan',?,'{}',?)").bind(id,amount,`2027-01-02T00:00:00Z`).run();}
async function allocateEvidence(database){await database.batch(await invoiceRefundEvidenceWrites(database,'invoice','2027-01-03T00:00:00Z'));}
await check('One canonical invoice refund cannot complete two intents; partial evidence and repeated reads remain exact',async({database})=>{
 await request(database,'first');await request(database,'second');await evidence(database,'refund-1',1000);await allocateEvidence(database);await allocateEvidence(database);
 assert.deepEqual(database.sqlite.prepare('SELECT status FROM invoice_refund_requests ORDER BY created,id').all().map(r=>r.status),['completed','awaiting-merchant']);
 await evidence(database,'refund-2',500);await allocateEvidence(database);assert.equal(database.sqlite.prepare("SELECT status FROM invoice_refund_requests WHERE id='second'").get().status,'awaiting-merchant');
 await evidence(database,'refund-3',500);await allocateEvidence(database);await allocateEvidence(database);
 assert.equal(database.sqlite.prepare("SELECT status FROM invoice_refund_requests WHERE id='second'").get().status,'completed');assert.equal(database.sqlite.prepare('SELECT SUM(amount) n FROM invoice_refund_allocations').get().n,2000);
 assert.throws(()=>database.sqlite.prepare("INSERT INTO invoice_refund_allocations VALUES ('second','refund-1',1,'now')").run(),/capacity/);
 assert.throws(()=>database.sqlite.prepare('DELETE FROM invoice_refund_allocations').run(),/retained/);
});
await check('A combined refund supplies distinct evidence segments and never consumes old or unapproved evidence',async({database})=>{
 await evidence(database,'old-refund',1000);await request(database,'first',1000,{previous:['old-refund']});await request(database,'second',1000,{previous:['old-refund']});await request(database,'unapproved',500,{approved:false});
 await evidence(database,'combined-refund',2000);await allocateEvidence(database);
 assert.deepEqual(database.sqlite.prepare('SELECT request_id,refund_id,amount FROM invoice_refund_allocations ORDER BY request_id').all().map(r=>({...r})),[{request_id:'first',refund_id:'combined-refund',amount:1000},{request_id:'second',refund_id:'combined-refund',amount:1000}]);
 assert.equal(database.sqlite.prepare("SELECT status FROM invoice_refund_requests WHERE id='unapproved'").get().status,'awaiting-merchant');
});
{
 const database=createTestD1({migrations:{through:'0017_connected_workflows.sql'}});try{await request(database,'first');await request(database,'second');await evidence(database,'old-shared-proof',1000);database.sqlite.exec("UPDATE invoice_refund_requests SET status='completed'");const before=database.sqlite.prepare('SELECT * FROM invoice_refund_requests ORDER BY created,id').all();applyMigrations(database);assert.deepEqual(database.sqlite.prepare('SELECT * FROM invoice_refund_requests ORDER BY created,id').all(),before);assert.ok(before.every(row=>invoiceRefundRequestView(row).status==='awaiting-merchant'));await allocateEvidence(database);assert.deepEqual(database.sqlite.prepare('SELECT status FROM invoice_refund_requests ORDER BY created,id').all().map(r=>r.status),['completed','awaiting-merchant']);checks++;console.log('PASS Schema-only migration preserves populated legacy rows; bounded runtime rechecks distinct refund proof');}finally{database.close();}
}
async function approveDeparture(t){const r=await t.current(),change=await t.changes.propose(t.planId,alice,{type:'departure',version:r.version,memberId:alice.id});for(const who of [alice,bob])await t.changes.act(t.planId,who,{type:'approve',changeId:change.id,version:r.version,confirm:true});return {record:r,change};}
await check('A checkout inserted after change prechecks is fenced by the final change transaction',async t=>{
 const {record,change}=await approveDeparture(t),original=t.database.batch.bind(t.database);let raced=false,posts=0;
 t.database.batch=async statements=>{if(!raced&&statements.some(s=>s.sql.includes("UPDATE plan_changes SET status='applied'"))){raced=true;const r=await t.current();await createPlanCheckout(r,alice,{itemId:'venue',revision:1,version:r.version},{database:t.database,provider:async()=>{posts++;return {id:'RACEORDER'};},reconcileCapture:async()=>{throw Error('No capture');}});}return original(statements);};
 await assert.rejects(t.changes.act(t.planId,alice,{type:'apply',changeId:change.id,version:record.version,confirm:true}),e=>e.code==='VERSION_CONFLICT');
 assert.equal(raced,true);assert.equal(posts,1);assert.deepEqual((await t.current()).state.items[0].participants,[alice.id,bob.id]);assert.equal((await t.changes.get(t.planId,alice,change.id)).status,'review');assert.equal((await t.current()).state.events.length,0);
});
await check('A change committed before a stale checkout fences the funding claim before any provider call',async t=>{
 const {record,change}=await approveDeparture(t);await t.changes.act(t.planId,alice,{type:'apply',changeId:change.id,version:record.version,confirm:true});let posts=0;
 await assert.rejects(createPlanCheckout(record,alice,{itemId:'venue',revision:1,version:record.version},{database:t.database,provider:async()=>{posts++;return {id:'STALEORDER'};},reconcileCapture:async()=>{throw Error('No capture');}}),e=>e.code==='VERSION_CONFLICT');assert.equal(posts,0);assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM payment_funding_claims').get().n,0);
});
await check('A reserved checkout claim also fences the pre-operation crash window',async t=>{
 const {record,change}=await approveDeparture(t),original=t.database.batch.bind(t.database);let raced=false;
 t.database.batch=async statements=>{if(!raced&&statements.some(s=>s.sql.includes("UPDATE plan_changes SET status='applied'"))){raced=true;await t.database.prepare("INSERT INTO payment_funding_claims(owner,plan_id,item_id,revision,member_id,channel,reference_id,created) VALUES (?,?,'venue',1,?,'order','not-yet-written','now')").bind(owner,t.planId,alice.id).run();}return original(statements);};
 await assert.rejects(t.changes.act(t.planId,alice,{type:'apply',changeId:change.id,version:record.version,confirm:true}),e=>e.code==='VERSION_CONFLICT');assert.equal((await t.current()).state.items[0].revision,1);
});
async function manualPurchase(t,contributions={[alice.id]:2000}){const root=await t.repository.loadWorkspace(owner),item=root.items[0];item.source='Outside venue booking';item.revision++;item.status='scheduled';item.booking='confirmed';item.paid=[alice.id,bob.id];root.events.push({id:'manual-original',itemId:'venue',kind:'expense',amount:2000,shares:{[alice.id]:1000,[bob.id]:1000},contributions,label:'Original outside booking',status:'confirmed',mode:'manual',created:'2027-01-01T00:00:00Z',evidence:'Receipt approved by both members'});await t.repository.saveWorkspace(owner,root,root.version);return (await t.current()).state.events[0];}
async function prepareExternal(t,overrides={}){return t.external.act(t.planId,alice,externalRecoveryRequest.parse({action:'prepare',version:(await t.current()).version,requestId:crypto.randomUUID(),itemId:'venue',refundAmount:1500,evidence:'Supplier cancelled the venue and the CAD15 refund was received by the original payer.',sourceUrl:'https://supplier.example.test/cancellation',reference:'OUTSIDE-REFUND-1',...overrides}));}
await check('Manual closure retains obligations until all affected people approve actual refund evidence and is idempotent',async t=>{
 const original=structuredClone(await manualPurchase(t)),resolution=await prepareExternal(t);assert.equal(resolution.terms.retainedCost,500);assert.deepEqual(resolution.terms.refundContributions,{[alice.id]:1500});
 assert.equal((await t.current()).state.items[0].status,'scheduled');assert.equal(personalMoney((await t.current()).state,bob.id).cost,1000);
 await assert.rejects(t.external.list(t.planId,outsider));await assert.rejects(t.external.act(t.planId,bob,{action:'apply',version:(await t.current()).version,id:resolution.id,confirm:true}),e=>e.code==='EXTERNAL_RECOVERY_APPROVALS');
 for(const who of [alice,bob])await t.external.act(t.planId,who,{action:'approve',version:(await t.current()).version,id:resolution.id,confirm:true});
 const version=(await t.current()).version;await t.external.act(t.planId,alice,{action:'apply',version,id:resolution.id,confirm:true});await t.external.act(t.planId,alice,{action:'apply',version,id:resolution.id,confirm:true});
 const after=(await t.current()).state;assert.deepEqual(after.events[0],original);assert.equal(after.events.length,2);assert.equal(after.events[1].amount,-1500);assert.deepEqual(after.events[1].contributions,{[alice.id]:-1500});assert.equal(after.events[1].mode,'manual');assert.equal(after.items[0].status,'cancelled');assert.equal(after.items[0].booking,'cancelled');assert.equal(personalMoney(after,bob.id).cost,250);
 assert.throws(()=>t.database.sqlite.prepare("UPDATE external_recovery_resolutions SET body='{}'").run(),/immutable/);assert.throws(()=>t.database.sqlite.prepare('DELETE FROM external_recovery_approvals').run(),/retained/);
});
await check('Manual closure rejects provider money and changed facts and preserves state on an atomic storage failure',async t=>{
 await manualPurchase(t);await assert.rejects(prepareExternal(t,{refundAmount:2001}),e=>e.code==='EXTERNAL_RECOVERY_INVALID');let resolution=await prepareExternal(t);for(const who of [alice,bob])await t.external.act(t.planId,who,{action:'approve',version:(await t.current()).version,id:resolution.id,confirm:true});
 const original=t.database.batch.bind(t.database);t.database.batch=statements=>original(statements.some(s=>s.sql.includes("UPDATE external_recovery_resolutions SET status='completed'"))?[...statements,t.database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES ('manual-fault',0)")]:statements);
 await assert.rejects(t.external.act(t.planId,alice,{action:'apply',version:(await t.current()).version,id:resolution.id,confirm:true}));assert.equal((await t.current()).state.events.length,1);assert.equal((await t.external.list(t.planId,alice))[0].status,'review');t.database.batch=original;
 const root=await t.repository.loadWorkspace(owner);root.items[0].revision++;root.items[0].approvals=[];await t.repository.saveWorkspace(owner,root,root.version);await assert.rejects(t.external.act(t.planId,alice,{action:'apply',version:(await t.current()).version,id:resolution.id,confirm:true}),e=>e.code==='VERSION_CONFLICT');
 const edited=await t.repository.loadWorkspace(owner);edited.events.push({id:'provider-event',itemId:'venue',kind:'expense',amount:100,shares:{[alice.id]:100},contributions:{[alice.id]:100},label:'Provider capture',status:'confirmed',mode:'sandbox',providerId:'REAL-PROVIDER-ID',created:'2027-01-02T00:00:00Z',evidence:'Canonical provider evidence'});await t.repository.saveWorkspace(owner,edited,edited.version);await assert.rejects(prepareExternal(t),e=>e.code==='EXTERNAL_RECOVERY_INVALID');
});
await check('Split manual payments require exact received cash recipients within original contribution limits',async t=>{
 await manualPurchase(t,{[alice.id]:1500,[bob.id]:500});await assert.rejects(prepareExternal(t),e=>e.code==='EXTERNAL_RECOVERY_INVALID');
 await assert.rejects(prepareExternal(t,{refundContributions:{[bob.id]:1500}}),e=>e.code==='EXTERNAL_RECOVERY_INVALID');
 const resolution=await prepareExternal(t,{refundContributions:{[alice.id]:1500,[bob.id]:0}});for(const who of [alice,bob])await t.external.act(t.planId,who,{action:'approve',version:(await t.current()).version,id:resolution.id,confirm:true});await t.external.act(t.planId,alice,{action:'apply',version:(await t.current()).version,id:resolution.id,confirm:true});
 const after=(await t.current()).state;assert.deepEqual(after.events[0].contributions,{[alice.id]:1500,[bob.id]:500});assert.deepEqual(after.events[1].contributions,{[alice.id]:-1500,[bob.id]:0});assert.deepEqual(after.events[1].shares,{[alice.id]:-750,[bob.id]:-750});
});
await check('A removed prerequisite remains blocked by a pending group review on another item',async t=>{
 await manualPurchase(t);const root=await t.repository.loadWorkspace(owner);root.items.push({...structuredClone(root.items[0]),id:'pending-dependent',price:0,shares:{[bob.id]:0},participants:[bob.id],required:[bob.id],approvals:[],paid:[],revision:1,status:'draft',depends:[],dependencyReviewPending:{affected:['venue','pending-dependent']}});await t.repository.saveWorkspace(owner,root,root.version);
 await assert.rejects(prepareExternal(t),/Complete group approval/);await assert.rejects(t.changes.propose(t.planId,alice,{type:'recovery',version:(await t.current()).version,itemIds:['venue'],option:'cancel',replacements:[]}),/Complete group approval/);assert.equal((await t.current()).state.items[0].status,'scheduled');assert.equal((await t.current()).state.events.length,1);
});
async function aliasedReceipt(t,{outside=true,actual=2000,unrelatedViewer=false}={}){
 const root=await t.repository.loadWorkspace(owner),item=root.items[0];if(outside){item.source='Outside venue booking';item.revision++;}item.status=outside?'scheduled':'awaiting-payment';item.booking='confirmed';item.paid=outside?[alice.id,bob.id]:[];
 if(unrelatedViewer)addPerson(root,{id:'zero-share-viewer',name:'Unrelated viewer'},'viewer');
 root.events.push({id:'original-receipt-expense',itemId:'receipt-origin',kind:'expense',amount:actual,shares:{[alice.id]:actual/2,[bob.id]:actual/2,...(unrelatedViewer?{'zero-share-viewer':0}:{})},contributions:{[alice.id]:actual,...(unrelatedViewer?{'zero-share-viewer':0}:{})},label:'Previously separate receipt',status:'confirmed',mode:'manual',created:'2027-01-01T00:00:00Z',evidence:'Original reviewed receipt payment'});
 root.receipts.push({id:'receipt-origin',merchant:'Venue receipt',date:'2027-04-04',rows:[{id:'row',name:'Venue',amount:actual,claims:[alice.id,bob.id]}],tax:0,tip:0,discount:0,total:actual,payer:alice.id,paymentConfirmed:true,tipRule:'equal',shares:{[alice.id]:actual/2,[bob.id]:actual/2},revision:2,approvals:[alice.id,bob.id],status:'approved',source:'Manual reviewed receipt',linkedItemId:'venue',accountingItemId:'receipt-origin',reconciledItemId:'venue',recording:'expense'});
 await t.repository.saveWorkspace(owner,root,root.version);return structuredClone((await t.current()).state.events[0]);
}
await check('A separately recorded receipt reconciled later still requires paid recovery and supports exact outside closure',async t=>{
 const original=await aliasedReceipt(t),record=await t.current(),change=await t.changes.propose(t.planId,alice,{type:'recovery',version:record.version,itemIds:['venue'],option:'cancel',replacements:[]});for(const who of [alice,bob])await t.changes.act(t.planId,who,{type:'approve',version:record.version,changeId:change.id,confirm:true});
 assert.equal((await t.changes.act(t.planId,alice,{type:'apply',version:record.version,changeId:change.id,confirm:true})).status,'awaiting-cancellations');
 const resolution=await prepareExternal(t,{refundAmount:1000});for(const who of [alice,bob])await t.external.act(t.planId,who,{action:'approve',version:(await t.current()).version,id:resolution.id,confirm:true});await t.external.act(t.planId,alice,{action:'apply',version:(await t.current()).version,id:resolution.id,confirm:true});
 await t.changes.act(t.planId,alice,{type:'apply',version:(await t.current()).version,changeId:change.id,confirm:true});const after=(await t.current()).state;assert.deepEqual(after.events[0],original);assert.equal(after.events[1].itemId,'venue');assert.equal(after.events[1].amount,-1000);assert.equal(personalMoney(after,bob.id).projected,500);assert.equal((await t.changes.get(t.planId,alice,change.id)).status,'applied');
});
await check('A committed receipt alias cannot reopen merchant checkout or invoice collection',async t=>{
 await aliasedReceipt(t,{outside:false});const record=await t.current();let posts=0;
 await assert.rejects(createPlanCheckout(record,alice,{itemId:'venue',revision:1,version:record.version},{database:t.database,provider:async()=>{posts++;return {id:'DUPLICATE'};},reconcileCapture:async()=>{throw Error('No capture');}}),e=>e.code==='PAYMENT_ALREADY_RECORDED');assert.equal(posts,0);
 await assert.rejects(claimPaymentFunding(t.database,{owner,planId:t.planId,itemId:'venue',revision:1,memberId:alice.id,channel:'invoice',referenceId:'duplicate-invoice',version:record.version}),e=>e.code==='PAYMENT_ALREADY_RECORDED');assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM payment_funding_claims').get().n,0);
});
await check('Departure reallocates the finalized actual receipt rather than treating its lower total as a deposit',async t=>{
 const original=await aliasedReceipt(t,{actual:1600}),record=await t.current(),change=await t.changes.propose(t.planId,alice,{type:'departure',version:record.version,memberId:bob.id});
 assert.equal(change.terms.figures.finalTotal,1600);assert.equal(change.terms.updates[0].price,1600);assert.deepEqual(change.terms.updates[0].shares,{[alice.id]:1600});assert.equal(change.terms.figures.perMember[alice.id],800);assert.equal(change.terms.figures.perMember[bob.id],-800);assert.ok(!change.terms.warnings.some(w=>w.includes('collected deposit')));
 for(const who of [alice,bob])await t.changes.act(t.planId,who,{type:'approve',version:record.version,changeId:change.id,confirm:true});await t.changes.act(t.planId,alice,{type:'apply',version:record.version,changeId:change.id,confirm:true});
 const after=(await t.current()).state;assert.deepEqual(after.events[0],original);assert.equal(after.items[0].price,1600);assert.equal(after.items[0].collection,undefined);assert.equal(after.items[0].status,'scheduled');assert.equal(personalMoney(after,alice.id).projected,1600);assert.equal(personalMoney(after,alice.id).merchantDue,0);assert.equal(personalMoney(after,bob.id).projected,0);
});
await check('Zero financial entries for an unrelated viewer never become required money approvers',async t=>{
 await aliasedReceipt(t,{actual:1600,unrelatedViewer:true});const record=await t.current(),change=await t.changes.propose(t.planId,alice,{type:'departure',version:record.version,memberId:bob.id});assert.deepEqual(change.terms.required.sort(),[alice.id,bob.id].sort());
 const resolution=await prepareExternal(t,{refundAmount:800});assert.deepEqual(resolution.terms.required.sort(),[alice.id,bob.id].sort());for(const who of [alice,bob])await t.external.act(t.planId,who,{action:'approve',version:record.version,id:resolution.id,confirm:true});await t.external.act(t.planId,alice,{action:'apply',version:record.version,id:resolution.id,confirm:true});assert.equal((await t.current()).state.events.length,2);
});
await check('Financial approval totals retain separate receipt spending exactly once when another item changes',async t=>{
 const root=await t.repository.loadWorkspace(owner);root.events.push({id:'unlinked-purchase',itemId:'separate-receipt',kind:'expense',amount:500,shares:{[alice.id]:500},contributions:{[alice.id]:500},status:'confirmed',mode:'manual',label:'Separate purchase',created:'2027-01-01T00:00:00Z',evidence:'Approved separate purchase'});await t.repository.saveWorkspace(owner,root,root.version);const record=await t.current();
 assert.equal(personalMoney(record.state,alice.id).projected+personalMoney(record.state,bob.id).projected,2500);
 const keep=await t.changes.propose(t.planId,alice,{type:'recovery',version:record.version,itemIds:['venue'],option:'keep',replacements:[]});assert.equal(keep.terms.figures.finalTotal,2500);
 const cancel=await t.changes.propose(t.planId,alice,{type:'recovery',version:record.version,itemIds:['venue'],option:'cancel',replacements:[]});assert.equal(cancel.terms.figures.finalTotal,500);
});
await check('Zero-refund outside cancellation retains the original paid cost and permits the approved parent recovery to finish',async t=>{
 await manualPurchase(t);const current=await t.current(),change=await t.changes.propose(t.planId,alice,{type:'recovery',version:current.version,itemIds:['venue'],option:'cancel',replacements:[]});for(const who of [alice,bob])await t.changes.act(t.planId,who,{type:'approve',version:current.version,changeId:change.id,confirm:true});assert.equal((await t.changes.act(t.planId,alice,{type:'apply',version:current.version,changeId:change.id,confirm:true})).status,'awaiting-cancellations');
 const resolution=await prepareExternal(t,{refundAmount:0,evidence:'Supplier confirms cancellation and the prepaid venue fee is fully nonrefundable.'});for(const who of [alice,bob])await t.external.act(t.planId,who,{action:'approve',version:(await t.current()).version,id:resolution.id,confirm:true});await t.external.act(t.planId,alice,{action:'apply',version:(await t.current()).version,id:resolution.id,confirm:true});
 await t.changes.act(t.planId,alice,{type:'apply',version:(await t.current()).version,changeId:change.id,confirm:true});const after=(await t.current()).state;assert.equal(after.events.length,1);assert.equal(personalMoney(after,bob.id).projected,1000);assert.equal((await t.changes.get(t.planId,alice,change.id)).status,'applied');
});
console.log(`${checks} financial review fence checks passed using migrated SQLite and fixture providers only.`);
