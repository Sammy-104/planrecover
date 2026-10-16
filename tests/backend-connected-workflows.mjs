import assert from 'node:assert/strict';
import {createTestD1,applyMigrations} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {PlanChangeService} from '../lib/plan-changes.ts';
import {syncChangeWorkflow,replacementId} from '../lib/change-workflow.ts';
import {projectSupplierBooking} from '../lib/supplier-bookings.ts';
import {runSupplierOperation,reconcileSupplierOperations} from '../lib/supplier-adapter.ts';
import {executeAgentTool,AgentProposalRepository} from '../lib/agent-tools.ts';
import {ConversationRepository} from '../lib/conversations.ts';
import {reviewPlanning} from '../lib/planning-review.ts';
import {commitFinancialEffect} from '../lib/financial-history.ts';
import {createPlanCheckout,capturePlanCheckout} from '../lib/plan-checkout.ts';
import {closeUnpaidCheckout} from '../lib/collection-resolution.ts';
import {personalMoney} from '../lib/model.ts';
import {syncPlanReminders,ReminderRepository,runDueReminderJobs} from '../lib/reminder-jobs.ts';
let passed=0;
async function check(name,run){const database=createTestD1(),repository=new PlanRepository(database),owner='connected-owner',alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId('connected-bob'),name:'Bob'};try{
 const first=await repository.createPlan(owner,alice,{name:'Connected workflow',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000}),planId=first.state.plan.id;
 const root=await repository.loadWorkspace(owner);addPerson(root,bob,'editor');root.items.push({id:'venue',name:'Venue',category:'Activity',start:'2027-04-04T10:00:00-04:00',duration:60,price:2000,participants:[alice.id,bob.id],shares:{[alice.id]:1000,[bob.id]:1000},allocation:'equal',values:{},revision:1,approvals:[alice.id,bob.id],required:[alice.id,bob.id],status:'awaiting-payment',booking:'unconfirmed',policy:'Reviewed fictional quote',source:'Fictional demo merchant · sandbox',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'});await repository.saveWorkspace(owner,root,root.version);
 const current=()=>repository.getPlan(planId,alice),changes=new PlanChangeService(database);await run({database,repository,owner,alice,bob,planId,current,changes});passed++;console.log('PASS '+name);
}finally{database.close();}}
const event=(id,itemId,member,amount)=>({id,itemId,kind:'expense',label:'Injected sandbox proof',amount,shares:{[member]:amount},contributions:{[member]:amount},status:'confirmed',mode:'sandbox',providerId:id,evidence:'Fixture evidence only',created:new Date().toISOString()});
await check('Private affordability rejects CAD105 now against CAD100 while preserving unknown member input',async t=>{
 const pref=await t.repository.getPreferences(t.planId,t.alice);await t.repository.updatePreferences(t.planId,t.alice,{...pref.preferences,cash:10000,reserve:0,budget:100000},pref.version);
 const record=await t.current(),review=await reviewPlanning(t.database,record,t.alice.id,[{name:'Replacement',category:'Activity',start:'2027-04-04T12:00:00-04:00',duration:60,price:10500,participants:[t.alice.id,t.bob.id]}],{removeIds:['venue'],finalChange:1500,newPaymentNow:10500});
 assert.equal(review.affordability.withinCash,false);assert.equal(review.affordability.status,'exceeds-limit');assert.ok(!JSON.stringify(review).includes('100000'));assert.ok(!review.issues.some(i=>i.memberId===t.bob.id));assert.match(review.otherMembers,/own private/);
});
await check('Partial departure retains deposit contributions, credits revised shares, and collects only the balance',async t=>{
 await commitFinancialEffect(t.database,{owner:t.owner,planId:t.planId,event:event('DEPOSIT','venue',t.alice.id,1000)});
 const before=await t.current(),change=await t.changes.propose(t.planId,t.alice,{type:'departure',version:before.version,memberId:t.alice.id});
 for(const person of [t.alice,t.bob])await t.changes.act(t.planId,person,{type:'approve',changeId:change.id,version:before.version,confirm:true});
 await t.changes.act(t.planId,t.alice,{type:'apply',changeId:change.id,version:before.version,confirm:true});const after=await t.repository.getPlan(t.planId,t.bob),item=after.state.items[0];
 assert.equal(item.collection.due[t.bob.id],1000);assert.equal(item.shares[t.bob.id],2000);assert.equal(personalMoney(after.state,t.bob.id).projected,2000);assert.equal(personalMoney(after.state,t.bob.id).planned,1000);assert.equal(after.state.events[0].contributions[t.alice.id],1000);
 let amount;const result=await createPlanCheckout(after,t.bob,{itemId:'venue',revision:item.revision,version:after.version},{database:t.database,provider:async(path,method,body)=>{amount=body.purchase_units[0].amount.value;return {id:'BALANCEORDER'};},reconcileCapture:async()=>{throw Error('No capture allowed');}});
 assert.equal(amount,'10.00');assert.equal(result.orderId,'BALANCEORDER');assert.equal(after.state.events.filter(e=>e.kind==='expense').length,1);
});
await check('Replacement links and progress survive service reconstruction and expose paid booking failure',async t=>{
 const initial=await t.current(),change=await t.changes.propose(t.planId,t.alice,{type:'recovery',version:initial.version,itemIds:['venue'],option:'replace',replacements:[{name:'Replacement',category:'Activity',start:'2027-04-04T12:00:00-04:00',duration:60,price:1000,participants:[t.alice.id],location:'Toronto'}]});
 for(const person of [t.alice,t.bob])await t.changes.act(t.planId,person,{type:'approve',changeId:change.id,version:initial.version,confirm:true});
 await t.changes.act(t.planId,t.alice,{type:'apply',changeId:change.id,version:initial.version,confirm:true});const id=replacementId(change.id,0),saved=await new PlanChangeService(t.database).get(t.planId,t.alice,change.id);assert.equal(saved.workflow.status,'awaiting-payments');assert.ok(!saved.review.issues.some(i=>i.code==='SCHEDULE_CONFLICT'));assert.equal(saved.review.affordability.newPaymentNow,1000);assert.equal(saved.workflow.steps.find(s=>s.kind==='replacement').itemId,id);
 const root=await t.repository.loadWorkspace(t.owner),item=root.items.find(i=>i.id===id);item.approvals=[t.alice.id];item.status='awaiting-payment';await t.repository.saveWorkspace(t.owner,root,root.version);
 await commitFinancialEffect(t.database,{owner:t.owner,planId:t.planId,event:event('REPLACEMENTPAY',id,t.alice.id,1000)});
 await projectSupplierBooking(t.database,t.planId,t.alice,id,1,'booking-fixture',{sandbox:true,requestId:'booking-fixture',bookingId:'BOOKING1',quoteId:'QUOTE1',status:'failed',amount:1000,currency:'CAD'});
 const progress=await syncChangeWorkflow(t.database,change.id);assert.equal(progress.status,'review-required');assert.equal((await t.changes.get(t.planId,t.alice,change.id)).review.affordability.newPaymentNow,0);assert.ok(progress.steps.some(s=>s.kind==='compensation-review'&&s.detail.automaticRefund===false));assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM supplier_disruptions').get().n,1);assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_change_steps WHERE change_id=?').get(change.id).n,6);
});
await check('Supplier identities are bound, status projection is idempotent, and payment stays independent',async t=>{
 const response={sandbox:true,requestId:'request',bookingId:'BOOK1',quoteId:'QUOTE1',status:'confirmed',amount:2000,currency:'CAD'};
 await projectSupplierBooking(t.database,t.planId,t.alice,'venue',1,'book-op',response);const first=await t.current();assert.equal(first.state.items[0].booking,'confirmed');assert.equal(first.state.items[0].bookingReference,'BOOK1');assert.equal(first.state.events.length,0);
 await projectSupplierBooking(t.database,t.planId,t.alice,'venue',1,'book-op',response);assert.equal((await t.current()).version,first.version);
 await assert.rejects(projectSupplierBooking(t.database,t.planId,t.alice,'venue',1,'other',{...response,bookingId:'OTHER'}));
 await assert.rejects(projectSupplierBooking(t.database,t.planId,t.bob,'venue',1,'other',response));
});
await check('Read-only supplier reconciliation recovers an uncertain booking by original request and validates its quote',async t=>{
 const stamp=new Date().toISOString(),qid=crypto.randomUUID(),bid=crypto.randomUUID();
 await t.database.prepare("INSERT INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,response,status,created,updated) VALUES (?,?,?,?,'supplier','quote',?,?,'completed',?,?)").bind(qid,t.owner,t.planId,t.alice.id,JSON.stringify({itemId:'venue',revision:1}),JSON.stringify({sandbox:true,quoteId:'QUOTE1',itemId:'venue',revision:1,amount:2000,currency:'CAD',expiresAt:'2029-01-01T00:00:00Z',available:true,terms:'Checked',sourceUrl:'https://supplier.example.com/terms'}),stamp,stamp).run();
 await t.database.prepare("INSERT INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,status,created,updated) VALUES (?,?,?,?,'supplier','book',?,'uncertain',?,?)").bind(bid,t.owner,t.planId,t.alice.id,JSON.stringify({itemId:'venue',revision:1,quoteOperationId:qid}),stamp,stamp).run();
 let calls=0;const result=await reconcileSupplierOperations(t.database,{SUPPLIER_ORIGIN:'https://supplier.example.com',SUPPLIER_TOKEN:'fixture',SUPPLIER_MODE:'sandbox'},t.owner,async(url,init)=>{calls++;assert.ok(url.endsWith('/status'));const body=JSON.parse(init.body);assert.equal(body.originalRequestId,bid);return Response.json({sandbox:true,requestId:body.requestId,bookingId:'RECOVERED',quoteId:'QUOTE1',status:'confirmed',amount:2000,currency:'CAD'});});assert.equal(result.checked,1);assert.equal(calls,1);assert.equal((await t.current()).state.items[0].booking,'confirmed');
 const disruption=await reconcileSupplierOperations(t.database,{SUPPLIER_ORIGIN:'https://supplier.example.com',SUPPLIER_TOKEN:'fixture',SUPPLIER_MODE:'sandbox'},t.owner,async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.bookingId,'RECOVERED');return Response.json({sandbox:true,requestId:body.requestId,bookingId:'RECOVERED',quoteId:'QUOTE1',status:'cancelled',amount:2000,currency:'CAD'});});assert.equal(disruption.checked,1);const cancelled=await t.current();assert.equal(cancelled.state.items[0].booking,'cancelled');assert.equal(cancelled.state.items[0].status,'awaiting-payment');assert.equal(cancelled.state.events.length,0);assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM supplier_disruptions').get().n,1);
});
await check('A lost tool-result checkpoint reuses the persisted preview instead of duplicating it',async t=>{
 const conversations=new ConversationRepository(t.database),conversation=await conversations.create(t.owner,t.alice,t.planId),requestId=crypto.randomUUID(),context={database:t.database,repository:t.repository,owner:t.owner,identity:t.alice,turn:{conversationId:conversation.id,requestId}},input={plan:{name:'A new plan',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD'}};
 t.database.sqlite.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON agent_tool_calls BEGIN SELECT RAISE(ABORT,'injected checkpoint loss'); END;");await assert.rejects(executeAgentTool(context,'prepare_plan',input));assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n,1);
 t.database.sqlite.exec('DROP TRIGGER fail_checkpoint');const prepared=await executeAgentTool(context,'prepare_plan',input),again=await executeAgentTool(context,'prepare_plan',input);assert.equal(prepared.proposalId,again.proposalId);assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n,1);assert.equal((await conversations.read(t.owner,t.alice,conversation.id)).prepared.length,1);assert.equal((await new AgentProposalRepository(t.database).list(t.owner,t.alice)).length,1);assert.deepEqual(await new AgentProposalRepository(t.database).list(t.owner,t.bob),[]);
});
await check('Canonical quote expiry, policy cutoff and unpaid-share reminders deduplicate and revoke obsolete policy jobs',async t=>{
 const now=Date.now(),future=new Date(now+60000).toISOString(),root=await t.repository.loadWorkspace(t.owner);root.items[0].expires=future;root.items[0].deadline=future;root.items[0].revision++;await t.repository.saveWorkspace(t.owner,root,root.version);
 const policy={itemId:'venue',itemRevision:2,cutoff:future};await t.database.prepare('INSERT INTO booking_policies(id,owner,plan_id,item_id,revision,body,confirmed_by,created) VALUES (?,?,?,?,2,?,?,?)').bind('policy1',t.owner,t.planId,'venue',JSON.stringify(policy),t.alice.id,new Date(now).toISOString()).run();
 await syncPlanReminders(t.database,t.owner,{plan:{id:t.planId}},{now});await syncPlanReminders(t.database,t.owner,{plan:{id:t.planId}},{now});const kinds=t.database.sqlite.prepare('SELECT DISTINCT COALESCE(source_type,source_kind) AS source_kind FROM reminder_jobs').all().map(r=>r.source_kind);for(const kind of ['quote-expiry','policy-cutoff','unpaid-share'])assert.ok(kinds.includes(kind));const before=t.database.sqlite.prepare('SELECT COUNT(*) n FROM reminder_jobs').get().n;await syncPlanReminders(t.database,t.owner,{plan:{id:t.planId}},{now});assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM reminder_jobs').get().n,before);
 await t.database.prepare('INSERT INTO booking_policies(id,owner,plan_id,item_id,revision,body,confirmed_by,created) VALUES (?,?,?,?,1,?,?,?)').bind('policy2',t.owner,t.planId,'venue',JSON.stringify({...policy,cutoff:new Date(now+120000).toISOString()}),t.alice.id,new Date(now+1).toISOString()).run();
 await runDueReminderJobs(t.database,{owner:t.owner,now});assert.equal(t.database.sqlite.prepare("SELECT COUNT(*) n FROM plan_notifications n JOIN reminder_jobs j ON j.id=n.job_id WHERE j.source_id='policy1'").get().n,0);
 const delivery=await new ReminderRepository(t.database,{NOTIFICATION_ORIGIN:'https://notify.example.com',NOTIFICATION_TOKEN:'fixture'}).list(t.planId,t.alice);assert.equal(delivery.delivery.email,'configured');
});
await check('An approved departure can close an unpaid checkout and its stale approval cannot capture',async t=>{
 const record=await t.repository.getPlan(t.planId,t.bob),order=await createPlanCheckout(record,t.bob,{itemId:'venue',revision:1,version:record.version},{database:t.database,provider:async()=>({id:'CLOSEORDER'}),reconcileCapture:async()=>{throw Error('No capture');}}),canonical={id:'CLOSEORDER',status:'APPROVED',purchase_units:[{reference_id:'venue',custom_id:order.operationId,amount:{currency_code:'CAD',value:'10.00'}}]};
 const before=await t.current(),change=await t.changes.propose(t.planId,t.alice,{type:'departure',version:before.version,memberId:t.alice.id});for(const person of [t.alice,t.bob])await t.changes.act(t.planId,person,{type:'approve',changeId:change.id,version:before.version,confirm:true});
 await closeUnpaidCheckout(t.database,t.planId,t.alice,{changeId:change.id,operationId:order.operationId},async()=>canonical);
 let posts=0;await assert.rejects(capturePlanCheckout(await t.repository.getPlan(t.planId,t.bob),t.bob,'CLOSEORDER',{database:t.database,provider:async(path,method)=>{if(method==='POST')posts++;return canonical;},reconcileCapture:async()=>{throw Error('No capture');}}),e=>e.code==='CHECKOUT_CLOSED');assert.equal(posts,0);
 await t.changes.act(t.planId,t.alice,{type:'apply',changeId:change.id,version:(await t.current()).version,confirm:true});assert.equal((await t.current()).state.items[0].status,'awaiting-payment');
});
await check('A change cancelled during canonical checkout lookup cannot close the saved order',async t=>{
 const record=await t.repository.getPlan(t.planId,t.bob),order=await createPlanCheckout(record,t.bob,{itemId:'venue',revision:1,version:record.version},{database:t.database,provider:async()=>({id:'RACEORDER'}),reconcileCapture:async()=>{throw Error('No capture');}});
 const before=await t.current(),change=await t.changes.propose(t.planId,t.alice,{type:'departure',version:before.version,memberId:t.alice.id});for(const person of [t.alice,t.bob])await t.changes.act(t.planId,person,{type:'approve',changeId:change.id,version:before.version,confirm:true});
 await assert.rejects(closeUnpaidCheckout(t.database,t.planId,t.alice,{changeId:change.id,operationId:order.operationId},async()=>{await t.changes.act(t.planId,t.alice,{type:'cancel',changeId:change.id,version:(await t.current()).version,confirm:true});return {id:'RACEORDER',status:'APPROVED',purchase_units:[{reference_id:'venue',custom_id:order.operationId,amount:{currency_code:'CAD',value:'10.00'}}]};}),e=>e.code==='CHECKOUT_REVIEW');
 assert.notEqual(t.database.sqlite.prepare('SELECT status FROM provider_operations WHERE id=?').get(order.operationId).status,'cancelled');
});
console.log(`${passed} connected-workflow checks passed with real SQLite and fixture providers only.`);
const legacy=createTestD1({migrations:false});try{
 applyMigrations(legacy,{through:'0016_conversation_context.sql'});const repository=new PlanRepository(legacy),owner='migration-owner',identity={id:await accountPersonId(owner),name:'Migration owner'},record=await repository.createPlan(owner,identity,{name:'Retained migration plan',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:2000});
 const before=legacy.sqlite.prepare('SELECT body FROM workspaces WHERE owner=?').get(owner).body,stamp=new Date().toISOString();
 legacy.sqlite.prepare("INSERT INTO plan_invoices(id,owner,plan_id,item_id,member_id,revision,request_id,terms,amount,minimum,paid,status,created,updated) VALUES ('legacy-invoice',?,?,?,?,1,'legacy-request','{}',1000,250,250,'partially-paid',?,?)").run(owner,record.state.plan.id,'legacy-item',identity.id,stamp,stamp);
 legacy.sqlite.prepare("INSERT INTO assistant_conversations(id,owner,member_id,plan_id,title,created,updated) VALUES ('legacy-chat',?,?,?,'Kept transcript',?,?)").run(owner,identity.id,record.state.plan.id,stamp,stamp);
 legacy.sqlite.prepare("INSERT INTO assistant_messages(id,conversation_id,request_id,role,text,mode,created,metadata) VALUES ('legacy-message','legacy-chat','legacy-input','user','Keep this message','interrupted',?,'{}')").run(stamp);
 applyMigrations(legacy,{after:'0016_conversation_context.sql'});
 assert.equal(legacy.sqlite.prepare('SELECT body FROM workspaces WHERE owner=?').get(owner).body,before);assert.equal(legacy.sqlite.prepare("SELECT paid FROM plan_invoices WHERE id='legacy-invoice'").get().paid,250);assert.equal(legacy.sqlite.prepare("SELECT text FROM assistant_messages WHERE id='legacy-message'").get().text,'Keep this message');assert.equal(legacy.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(legacy.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');console.log('PASS Additive migration preserves populated plans, partial invoices and conversation history.');
}finally{legacy.close();}
