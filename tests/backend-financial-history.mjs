import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {initialState} from '../lib/model.ts';
import {PlanRepository} from '../lib/plan-repository.ts';
import {commitFinancialEffect,claimPaymentFunding,approvedItemSnapshot,saveProviderRequestIntent} from '../lib/financial-history.ts';

let checks=0;
const created='2026-10-14T12:00:00Z';
const expense=(overrides={})=>({id:'effect-capture-a',itemId:'hike',kind:'expense',amount:9000,
 shares:{sam:9000},contributions:{sam:9000},mode:'sandbox',providerId:'CAPTURE-HISTORY-A',status:'confirmed',
 label:'Verified sandbox capture',evidence:'Canonical provider amount verified.',created,...overrides});
const refund=(overrides={})=>({id:'effect-refund-a',itemId:'hike',kind:'refund',amount:-9000,
 shares:{sam:-9000},contributions:{sam:-9000},mode:'sandbox',providerId:'REFUND-HISTORY-A',status:'pending',
 label:'Verified sandbox refund',evidence:'Canonical refund; bank availability unknown.',created,...overrides});
async function count(database,table,where='',values=[]){return database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).bind(...values).first('count');}
async function seed(database,{owner='history-owner-a',planId='history-plan-a'}={}){
 const state=initialState();state.plan.id=planId;state.events=[];
 const hike=state.items.find(item=>item.id==='hike');hike.paid=[];hike.status='awaiting-payment';
 await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(owner,JSON.stringify(state),created).run();
 const repository=new PlanRepository(database);await repository.importWorkspace(owner,state);
 const operationId=`operation-${owner}`;
 await database.prepare(`INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload)
  VALUES (?,?,?,'sam',1,'order',9000,'ORDER-HISTORY-A','created',?)`)
  .bind(operationId,owner,'hike',JSON.stringify({planrecoverTripId:planId})).run();
 return {repository,owner,planId,operationId};
}
async function check(name,run){const database=createTestD1();try{await run(database,await seed(database));checks++;console.log(`PASS ${name}`);}finally{database.close();}}
await check('Captured expense, paid projection, provider state and immutable history commit together',async(database,t)=>{
 const event=expense(),result=await commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event,
  operation:{id:t.operationId,status:'captured',providerId:'ORDER-HISTORY-A',payload:'{"canonical":true}'},
  markPaid:{memberId:'sam',revision:1,amount:9000}});
 assert.equal(result.duplicate,false);const state=await t.repository.loadWorkspace(t.owner);
 assert.equal(state.events.length,1);assert.deepEqual(state.items.find(item=>item.id==='hike').paid,['sam']);
 assert.equal(await count(database,'financial_events'),1);assert.equal(await count(database,'financial_event_history'),1);
 assert.equal((await database.prepare('SELECT status,payload FROM provider_operations WHERE id=?').bind(t.operationId).first()).status,'captured');
});
await check('A SQL failure after operation update rolls back the entire financial batch before safe retry',async(database,t)=>{
 const original=database.batch.bind(database);let fault=true;
 database.batch=statements=>fault&&statements.some(statement=>statement.sql.startsWith('UPDATE provider_operations SET status'))
  ?original([...statements,database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES ('financial-rollback-fault',0)")]):original(statements);
 const input={owner:t.owner,planId:t.planId,event:expense(),operation:{id:t.operationId,status:'captured',payload:'{}'}};
 await assert.rejects(commitFinancialEffect(database,input),error=>error.code==='VERSION_CONFLICT');
 const before=await t.repository.loadWorkspace(t.owner);assert.equal(before.events.length,0);assert.equal(before.version,0);
 assert.equal(await count(database,'financial_events'),0);assert.equal(await count(database,'financial_event_history'),0);
 assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(t.operationId).first()).status,'created');
 fault=false;await commitFinancialEffect(database,input);assert.equal((await t.repository.loadWorkspace(t.owner)).events.length,1);
 assert.equal(await count(database,'financial_events'),1);assert.equal(await count(database,'financial_event_history'),1);
});
await check('Duplicate evidence runs idempotent domain statements without repeating cash or plan edits',async(database,t)=>{
 const input={owner:t.owner,planId:t.planId,event:expense()};await commitFinancialEffect(database,input);
 const version=(await t.repository.loadWorkspace(t.owner)).version;
 const statement=()=>database.prepare("UPDATE provider_operations SET status='captured',payload='{}' WHERE id=? AND owner=?").bind(t.operationId,t.owner);
 for(let n=0;n<2;n++)assert.equal((await commitFinancialEffect(database,{...input,statements:[statement()]})).duplicate,true);
 const state=await t.repository.loadWorkspace(t.owner);assert.equal(state.events.length,1);assert.equal(state.version,version);
 assert.equal(await count(database,'financial_events'),1);assert.equal(await count(database,'financial_event_history'),1);
 assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(t.operationId).first()).status,'captured');
});
await check('Changed amount, allocation or payer cannot rewrite provider financial facts',async(database,t)=>{
 await commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event:expense()});
 const original=await database.prepare('SELECT facts,body FROM financial_events').first();
 for(const changed of [expense({amount:9100,shares:{sam:9100},contributions:{sam:9100}}),expense({shares:{alex:9000}}),expense({contributions:{alex:9000}})])
  await assert.rejects(commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event:changed}),error=>error.code==='FINANCIAL_EFFECT_CONFLICT');
 const changed=await t.repository.loadWorkspace(t.owner);changed.events[0].amount=9100;
 await assert.rejects(t.repository.saveWorkspace(t.owner,changed,changed.version),error=>error.code==='VERSION_CONFLICT');
 assert.deepEqual(await database.prepare('SELECT facts,body FROM financial_events').first(),original);
 assert.equal((await t.repository.loadWorkspace(t.owner)).events[0].amount,9000);
});
await check('Pending to confirmed appends a transition and confirmed evidence cannot regress',async(database,t)=>{
 const input={owner:t.owner,planId:t.planId,event:refund()};await commitFinancialEffect(database,input);
 const first=await database.prepare('SELECT facts,body FROM financial_events').first();
 await commitFinancialEffect(database,{...input,event:refund({status:'confirmed',evidence:'Canonical refund completed.'})});
 assert.equal(await count(database,'financial_events'),1);assert.equal(await count(database,'financial_event_history'),2);
 assert.deepEqual(await database.prepare('SELECT facts,body FROM financial_events').first(),first);
 assert.deepEqual((await database.prepare('SELECT status FROM financial_event_history ORDER BY rowid').all()).results.map(row=>row.status),['pending','confirmed']);
 await assert.rejects(commitFinancialEffect(database,input),error=>error.code==='FINANCIAL_STATUS_CONFLICT');
 assert.equal((await t.repository.loadWorkspace(t.owner)).events[0].status,'confirmed');assert.equal(await count(database,'financial_event_history'),2);
});
await check('Recorded approval terms are immutable within a revision and new revisions retain old approvals',async(database,t)=>{
 const before=await t.repository.loadWorkspace(t.owner),item=before.items.find(item=>item.id==='hike');
 const snapshot=approvedItemSnapshot(item),saved=await database.prepare("SELECT snapshot FROM approval_revisions WHERE owner=? AND plan_id=? AND item_id='hike' AND revision=1").bind(t.owner,t.planId).first();
 assert.equal(saved.snapshot,snapshot);
 const edited=structuredClone(before);edited.items.find(item=>item.id==='hike').price=37000;
 await assert.rejects(t.repository.saveWorkspace(t.owner,edited,edited.version),error=>error.code==='VERSION_CONFLICT');
 assert.equal((await t.repository.loadWorkspace(t.owner)).items.find(item=>item.id==='hike').price,36000);
 const next=await t.repository.loadWorkspace(t.owner),revised=next.items.find(item=>item.id==='hike');revised.revision++;revised.approvals=[];revised.price=37000;revised.shares={sam:9250,alex:9250,maya:9250,chris:9250};
 await t.repository.saveWorkspace(t.owner,next,next.version);const approve=await t.repository.loadWorkspace(t.owner);approve.items.find(item=>item.id==='hike').approvals=['sam'];
 await t.repository.saveWorkspace(t.owner,approve,approve.version);
 assert.equal(await count(database,'approval_revisions',"WHERE owner=? AND plan_id=? AND item_id='hike'",[t.owner,t.planId]),2);
 assert.equal((await database.prepare("SELECT snapshot FROM approval_revisions WHERE owner=? AND plan_id=? AND item_id='hike' AND revision=1").bind(t.owner,t.planId).first()).snapshot,snapshot);
 assert.equal(await count(database,'approval_members',"WHERE owner=? AND plan_id=? AND item_id='hike' AND revision=1",[t.owner,t.planId]),4);
});
await check('Projection edits use append-only history writes and preserve removed projection facts',async(database,t)=>{
 const calls=[],original=database.batch.bind(database);database.batch=statements=>{calls.push(...statements.map(s=>s.sql));return original(statements);};
 await commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event:expense()});
 const state=await t.repository.loadWorkspace(t.owner);state.events=[];state.items.find(item=>item.id==='hike').approvals=[];
 await t.repository.saveWorkspace(t.owner,state,state.version);
 assert.equal(await count(database,'financial_events'),1);assert.equal(await count(database,'financial_event_history'),1);
 assert.equal(await count(database,'approval_members',"WHERE owner=? AND plan_id=? AND item_id='hike' AND revision=1",[t.owner,t.planId]),4);
 assert.equal(calls.some(sql=>/^\s*(?:UPDATE|DELETE\s+FROM)\s+(?:financial_events|financial_event_history|approval_revisions|approval_members)\b/i.test(sql)),false);
});
await check('Checkout and invoice claims exclude dual collection while safe same-reference retries succeed',async(database,t)=>{
 const claim={owner:t.owner,planId:t.planId,itemId:'hike',revision:1,memberId:'sam',channel:'order',referenceId:'order-claim'};
 await claimPaymentFunding(database,claim);await claimPaymentFunding(database,claim);
 assert.equal(await count(database,'payment_funding_claims'),1);
 await assert.rejects(claimPaymentFunding(database,{...claim,channel:'invoice',referenceId:'invoice-claim'}),error=>error.code==='PAYMENT_CHANNEL_CONFLICT');
 await assert.rejects(claimPaymentFunding(database,{...claim,referenceId:'different-order'}),error=>error.code==='PAYMENT_CHANNEL_CONFLICT');
 await claimPaymentFunding(database,{...claim,memberId:'alex',channel:'invoice',referenceId:'alex-invoice'});assert.equal(await count(database,'payment_funding_claims'),2);
});
await check('The same canonical provider effect cannot be credited to another owner or plan',async(database,t)=>{
 await commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event:expense()});
 const foreign=await seed(database,{owner:'history-owner-b',planId:'history-plan-b'});
 await assert.rejects(commitFinancialEffect(database,{owner:foreign.owner,planId:foreign.planId,event:expense({id:'foreign-event'}),
  operation:{id:foreign.operationId,status:'captured',payload:'{}'}}),error=>error.code==='VERSION_CONFLICT');
 assert.equal((await foreign.repository.loadWorkspace(foreign.owner)).events.length,0);assert.equal(await count(database,'financial_events'),1);
 assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(foreign.operationId).first()).status,'created');
});
await check('Financial compare-and-swap retries preserve a concurrent nonfinancial plan edit',async(database,t)=>{
 const original=database.batch.bind(database);let raced=false;
 database.batch=async statements=>{
  if(!raced&&statements.some(statement=>statement.sql.startsWith('UPDATE provider_operations SET status'))){
   raced=true;const current=await t.repository.loadWorkspace(t.owner);current.plan.name='Concurrent saved name';await t.repository.saveWorkspace(t.owner,current,current.version);
  }return original(statements);
 };
 await commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event:expense(),operation:{id:t.operationId,status:'captured',payload:'{}'}});
 const after=await t.repository.loadWorkspace(t.owner);assert.equal(raced,true);assert.equal(after.plan.name,'Concurrent saved name');assert.equal(after.events.length,1);
 assert.equal(after.version,2);assert.equal(await count(database,'financial_event_history'),1);
});
await check('Expired deleted plans retain money and operation history without being restored',async(database,t)=>{
 const state=await t.repository.loadWorkspace(t.owner),snapshot=structuredClone(state);delete snapshot.archives;delete snapshot.deletedTrips;
 state.plan.id='history-other-plan';state.deletedTrips=[{id:t.planId,deletedAt:'2025-12-01T00:00:00Z',expiresAt:'2026-01-01T00:00:00Z',workspace:snapshot}];
 await t.repository.saveWorkspace(t.owner,state,state.version);
 const cleared=await t.repository.loadWorkspace(t.owner);cleared.deletedTrips=[];await t.repository.saveWorkspace(t.owner,cleared,cleared.version);
 await commitFinancialEffect(database,{owner:t.owner,planId:t.planId,event:expense(),operation:{id:t.operationId,status:'captured',payload:'{}'}});
 const workspace=await t.repository.loadWorkspace(t.owner);assert.equal(workspace.plan.id,'history-other-plan');assert.equal(workspace.events.length,0);assert.deepEqual(workspace.deletedTrips,[]);
 const retained=await database.prepare('SELECT body,status FROM plans WHERE owner=? AND id=?').bind(t.owner,t.planId).first();assert.equal(retained.status,'deleted');assert.equal(JSON.parse(retained.body).events.length,1);
 assert.equal(await count(database,'financial_events','WHERE owner=? AND plan_id=?',[t.owner,t.planId]),1);
 assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(t.operationId).first()).status,'captured');
});
await check('Provider intent replays retain the original immutable request and expiry',async(database,t)=>{
 const input={operationId:t.operationId,owner:t.owner,planId:t.planId,path:'/v2/checkout/orders',body:{intent:'CAPTURE',amount:'90.00'},requestKey:'stable-key'};
 await saveProviderRequestIntent(database,input);const first=await database.prepare('SELECT * FROM provider_request_intents WHERE operation_id=?').bind(t.operationId).first();
 await saveProviderRequestIntent(database,input);assert.deepEqual(await database.prepare('SELECT * FROM provider_request_intents WHERE operation_id=?').bind(t.operationId).first(),first);
 await assert.rejects(saveProviderRequestIntent(database,{...input,body:{intent:'CAPTURE',amount:'91.00'}}),error=>error.code==='PAYMENT_INTENT_CHANGED');
 assert.ok(Date.parse(first.replay_before)>Date.parse(first.created));assert.equal(Date.parse(first.replay_before)-Date.parse(first.created),5*60*60_000);
});
console.log(`${checks} atomic financial history checks passed.`);
