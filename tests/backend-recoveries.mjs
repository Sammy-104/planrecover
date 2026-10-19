import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1,applyMigrations} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,makePerson} from '../lib/people.ts';
import {commitFinancialEffect} from '../lib/financial-history.ts';
import {freezeMerchantFunding} from '../lib/merchant-funding.ts';
import {RecoveryService,maximumCaptureRefund,recoveryRequest,cancelRecoveredBooking,reserveCaptureRefund,
  confirmCaptureRefund,reconcileRecoveryRefund,finalizeConfirmedRecoveries,recoveryRefundBody} from '../lib/recovery-service.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const temp=mkdtempSync(join(root,'build','backend-recoveries-'));
const origin='https://planrecover.test',owner='recovery-alice-account',other='recovery-bob-account';
const alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId(other),name:'Bob'};
globalThis.recoveryTestEnv={DB:undefined,PAYPAL_CLIENT_ID:'fixture-client',PAYPAL_CLIENT_SECRET:'fixture-secret'};
let checks=0,route,networkCalls=[];
const originalFetch=globalThis.fetch;
try{
  const outfile=join(temp,'route.mjs');
  await build({entryPoints:[resolve(root,'app/api/plans/[planId]/recoveries/route.ts')],outfile,bundle:true,
    platform:'node',format:'esm',target:'node24',packages:'external',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',
    plugins:[{name:'recovery-fixture-bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'bindings',namespace:'recovery-tests'}));
      builder.onLoad({filter:/.*/,namespace:'recovery-tests'},()=>({contents:'export const env=globalThis.recoveryTestEnv;',loader:'js'}));}}]});
  route=await import(pathToFileURL(outfile).href);
  const order=(operation,captureId)=>({id:operation.provider_id,status:'COMPLETED',purchase_units:[{reference_id:operation.item_id,
    custom_id:operation.id,payments:{captures:[{id:captureId,status:'COMPLETED',amount:{currency_code:'CAD',value:(operation.amount/100).toFixed(2)}}]}}]});
  const capture=(id,amount)=>({id,status:'COMPLETED',amount:{currency_code:'CAD',value:(amount/100).toFixed(2)}});
  const refund=(id,captureId,amount,status='COMPLETED')=>({id,status,amount:{currency_code:'CAD',value:(amount/100).toFixed(2)},
    links:[{rel:'up',href:`https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`}]});
  async function check(name,callback,additionalMembers=0,wholeGroup=false){const database=createTestD1();globalThis.recoveryTestEnv.DB=database;networkCalls=[];
    try{const fixture=await seed(database,additionalMembers,wholeGroup);await callback(fixture);checks++;console.log(`PASS ${name}`);}finally{database.close();}}
  async function seed(database,additionalMembers=0,wholeGroup=false){
    const repository=new PlanRepository(database),record=await repository.createPlan(owner,alice,{kind:'day-out',name:'Recovery tests',
      destination:'Toronto, Ontario, Canada',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000});
    const state=await repository.loadWorkspace(owner);state.people=[makePerson(alice.id,'Alice','owner'),makePerson(bob.id,'Bob','editor')];
    const allocationRows=[[0,alice.id,6000],[1,bob.id,4000]];
    for(let index=2;index<2+additionalMembers;index++){const id=await accountPersonId(`recovery-extra-account-${index}`);
      state.people.push(makePerson(id,`Member ${index}`,'editor'));allocationRows.push([index,id,1000]);}
    const participants=allocationRows.map(row=>row[1]),shares=Object.fromEntries(allocationRows.map(row=>[row[1],row[2]])),captureRows=wholeGroup?[[0,alice.id,allocationRows.reduce((sum,row)=>sum+row[2],0)]]:allocationRows;
    state.items=[{id:'museum',name:'Fictional museum tour',category:'Activity',start:'2027-04-04T12:00:00-04:00',duration:60,
      price:captureRows.reduce((sum,row)=>sum+row[2],0),participants,shares,allocation:'fixed',values:{...shares},
      revision:1,approvals:[...participants],status:'scheduled',booking:'demo-confirmed',policy:'Fictional confirmed source terms',
      source:'Fictional demo merchant · synthetic museum catalog',expires:null,deadline:null,depends:[],paid:[...participants],location:'Toronto'}];
    if(wholeGroup)state.items[0].merchantFunding={mode:'whole-group',payerId:alice.id};
    state.events=[];if(wholeGroup)state.version=(await repository.saveWorkspace(owner,state,state.version)).version;const orders=new Map(),captures=new Map(),refunds=new Map(),created=[];
    for(const [index,member,amount]of captureRows){
      const operation={id:`ORDEROP${index}`,owner,item_id:'museum',member,revision:1,kind:'order',amount,provider_id:`ORDER${index}`,status:'captured'};
      const canonical=order(operation,`CAPTURE${index}`);orders.set(operation.provider_id,canonical);captures.set(`CAPTURE${index}`,capture(`CAPTURE${index}`,amount));
      operation.payload=JSON.stringify({...canonical,planrecoverTripId:record.state.plan.id,planrecoverCurrency:'CAD',...(wholeGroup?{planrecoverFunding:freezeMerchantFunding(state.items[0])}:{})});
      await database.prepare('INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(operation.id,owner,operation.item_id,member,1,'order',amount,operation.provider_id,'captured',operation.payload).run();
      state.events.push({id:`paypal-CAPTURE${index}`,providerId:`CAPTURE${index}`,itemId:'museum',kind:'expense',amount,
        shares:wholeGroup?{...shares}:{[member]:amount},contributions:{[member]:amount},status:'confirmed',mode:'sandbox',label:'Verified fixture sandbox capture',
        evidence:'Canonical injected provider fixture; no live transaction.',created:'2026-10-14T12:00:00Z'});
    }
    await repository.saveWorkspace(owner,state,state.version);
    let clock=new Date('2026-10-14T12:00:00Z'),providerMode='COMPLETED',throwMutation=false,wrongRefund=false,beforeMutation;
    const scope={owner,planId:record.state.plan.id,memberId:alice.id},bobScope={...scope,memberId:bob.id};
    const dependencies={database,now:()=>clock,
      fetchOrder:async id=>structuredClone(orders.get(id)),fetchCapture:async id=>structuredClone(captures.get(id)),
      fetchRefund:async id=>structuredClone(refunds.get(id)),createRefund:async(captureId,amount,currency,key)=>{
        assert.equal(currency,'CAD');assert.ok(key.length<=38);assert.ok(['reserved','manual-review'].includes(database.sqlite.prepare('SELECT status FROM refund_reservations WHERE id=?').get(key).status));
        const intent=database.sqlite.prepare('SELECT path,request_body,request_key FROM provider_request_intents WHERE operation_id=?').get(key);
        assert.equal(intent.path,`/v2/payments/captures/${captureId}/refund`);assert.equal(intent.request_key,key);
        assert.deepEqual(JSON.parse(intent.request_body),recoveryRefundBody(amount,currency));
        created.push({captureId,amount,key});if(beforeMutation)await beforeMutation();if(throwMutation)throw Error('fixture-secret-provider-message');
        const result=refund(`REFUND${created.length}`,wrongRefund?'OTHER':captureId,amount,providerMode);refunds.set(result.id,result);return result;},
      commitRefund:input=>commitFinancialEffect(database,{owner:input.owner,planId:input.planId,event:input.event,statements:input.statements}),
      cancelBooking:input=>cancelRecoveredBooking(database,input)};
    const service=new RecoveryService(dependencies);
    const currentVersion=async()=>(await repository.getPlan(scope.planId,alice)).version;
    const policyInput=async(overrides={})=>({type:'register-policy',version:await currentVersion(),itemId:'museum',revision:1,policy:{merchant:'fictional-sandbox',
      merchantName:'Fictional museum',confirmedTerms:true,terms:'Fictional supplier permits an 80 percent refund minus the allocated cancellation fee.',
      evidence:'Owner reviewed the synthetic supplier confirmation for this exact booking revision.',sourceUrl:'https://supplier.example/terms',
      refundableBps:8000,cancellationFeeUnits:1000,cutoff:'2027-04-03T18:00:00-04:00',...overrides}});
    async function proposal(overrides={}){const policy=await service.registerPolicy(scope,await policyInput(overrides));
      return service.propose(scope,{type:'propose',version:await currentVersion(),policyId:policy.id,reason:'The group reviewed a documented cancellation request.'});}
    async function approve(proposal){for(const person of participants.map(memberId=>({...scope,memberId})))await service.approve(person,{type:'approve',proposalId:proposal.id,
      version:proposal.version,planVersion:await currentVersion()});return service.get(scope,proposal.id);}
    async function execute(proposal){return service.execute(scope,{type:'execute',proposalId:proposal.id,version:proposal.version,
      planVersion:await currentVersion(),confirmSandboxRefunds:true});}
    return {database,repository,scope,bobScope,service,dependencies,orders,captures,refunds,created,currentVersion,policyInput,proposal,approve,execute,
      setClock:value=>clock=new Date(value),setMode:value=>providerMode=value,setThrow:value=>throwMutation=value,setWrong:value=>wrongRefund=value,
      setBeforeMutation:value=>beforeMutation=value};
  }
  await check('Partial-refund arithmetic stays exact and source confirmation rejects forged actors',async({policyInput})=>{
    assert.equal(maximumCaptureRefund(6000,8000,600),4200);assert.equal(maximumCaptureRefund(1_000_000_000_000,9999,1),999899999999);
    assert.equal(maximumCaptureRefund(1,9999,0),0);assert.throws(()=>maximumCaptureRefund(1,10001,0));
    assert.equal(recoveryRequest.safeParse({...await policyInput(),actor:bob.id}).success,false);
    assert.equal(recoveryRequest.safeParse(await policyInput({confirmedTerms:false})).success,false);
    assert.equal(recoveryRequest.safeParse(await policyInput({sourceUrl:'https://user:secret@supplier.example/terms'})).success,false);
  });
  await check('Only the authenticated owner confirms immutable policies; external source cannot claim merchant checkout',async({service,scope,bobScope,policyInput,repository})=>{
    await assert.rejects(service.registerPolicy(bobScope,await policyInput()),error=>error.status===403);
    const policy=await service.registerPolicy(scope,await policyInput());assert.equal(policy.confirmedBy,alice.id);assert.equal(policy.currency,'CAD');
    const state=await repository.loadWorkspace(owner);state.items[0].source='Public listing · external supplier';state.items[0].revision++;
    state.items[0].approvals=[];await repository.saveWorkspace(owner,state,state.version);
    await assert.rejects(service.registerPolicy(scope,{...await policyInput(),revision:2}),error=>error.code==='INVALID_RECOVERY');
  });
  await check('Proposals snapshot canonical per-payer capture allocations and require every affected approval',async({proposal,approve,execute,created,service,bobScope,currentVersion,database})=>{
    let value=await proposal();assert.deepEqual(value.snapshot.allocations.map(row=>row.amount),[4200,2800]);assert.equal(value.fullyApproved,false);
    await assert.rejects(execute(value),error=>error.code==='RECOVERY_APPROVALS');assert.equal(created.length,0);
    await assert.rejects(service.approve(bobScope,{type:'approve',proposalId:value.id,version:2,planVersion:await currentVersion()}),error=>error.status===409);
    value=await approve(value);assert.equal(value.fullyApproved,true);
    assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM financial_events WHERE kind=?').get('refund').count,0);
  });
  await check('Confirmed partial refunds atomically update history, operation and capacity; exact retries add nothing',async({proposal,approve,execute,database,repository,created,scope})=>{
    const value=await approve(await proposal()),completed=await execute(value);assert.equal(completed.status,'completed');assert.equal(created.length,2);
    assert.deepEqual(database.sqlite.prepare('SELECT captured,reserved,refunded FROM capture_refund_capacity ORDER BY capture_id').all()
      .map(row=>({...row})),[{captured:6000,reserved:0,refunded:4200},{captured:4000,reserved:0,refunded:2800}]);
    const state=await repository.getPlan(scope.planId,alice);assert.equal(state.state.items[0].status,'cancelled');
    assert.equal(state.state.events.filter(event=>event.kind==='refund').reduce((sum,event)=>sum+event.amount,0),-7000);
    assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM financial_events WHERE kind=?').get('refund').count,2);
    await execute(completed);assert.equal(created.length,2);assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM refund_reservations').get().count,2);
  });
  await check('Pending refunds remain reserved and upgrade the same immutable financial event on canonical reconciliation',async({proposal,approve,execute,setMode,database,refunds,created,repository,scope})=>{
    setMode('PENDING');const value=await approve(await proposal()),pending=await execute(value);assert.equal(pending.status,'executing');
    assert.deepEqual(database.sqlite.prepare('SELECT reserved,refunded FROM capture_refund_capacity ORDER BY capture_id').all().map(row=>({...row})),
      [{reserved:4200,refunded:0},{reserved:2800,refunded:0}]);
    assert.equal((await repository.getPlan(scope.planId,alice)).state.items[0].status,'scheduled');
    for(const result of refunds.values())result.status='COMPLETED';
    for(const operation of await database.prepare("SELECT * FROM provider_operations WHERE kind='refund'").all().then(result=>result.results))
      await reconcileRecoveryRefund(database,operation,refunds.get(operation.provider_id));
    assert.equal(created.length,2);assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM financial_events WHERE kind='refund'").get().count,2);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM financial_event_history WHERE status='pending' AND event_id LIKE 'paypal-refund-%'").get().count,2);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM financial_event_history WHERE status='confirmed' AND event_id LIKE 'paypal-refund-%'").get().count,2);
    const finalized=await finalizeConfirmedRecoveries(database,{owner});assert.deepEqual(finalized.proposals,[{proposalId:pending.id,status:'completed'}]);
    assert.equal(finalized.providerMutations,false);assert.equal(created.length,2);
    assert.equal((await repository.getPlan(scope.planId,alice)).state.items[0].status,'cancelled');
    assert.equal((await execute(pending)).status,'completed');assert.equal(created.length,2);
  });
  await check('Read-only completion skips unconfirmed reservations and finishes explicitly started zero-refund cancellations',async({proposal,approve,execute,setMode,database,dependencies,repository,scope})=>{
    setMode('PENDING');const pending=await approve(await proposal());await execute(pending);
    assert.deepEqual((await finalizeConfirmedRecoveries(database,{owner})).proposals,[]);
    assert.deepEqual((await finalizeConfirmedRecoveries(database,{owner:'other-owner'})).proposals,[]);
    // No refund is possible under this separately confirmed nonrefundable policy.
    const zero=await approve(await proposal({refundableBps:0,cancellationFeeUnits:0}));
    dependencies.cancelBooking=async()=>{throw Error('Injected crash before cancellation commit.');};
    await assert.rejects(execute(zero),/Injected crash/);
    const result=await finalizeConfirmedRecoveries(database,{owner});assert.deepEqual(result.proposals,[{proposalId:zero.id,status:'completed'}]);
    assert.equal(result.providerMutations,false);assert.equal((await repository.getPlan(scope.planId,alice)).state.items[0].status,'cancelled');
    assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM refund_reservations WHERE proposal_id=?').get(zero.id).count,0);
    await assert.rejects(finalizeConfirmedRecoveries(database,{owner,limit:21}),error=>error.code==='INVALID_RECOVERY');
  });
  await check('Read-only completion preserves a changed booking for review after all refunds have completed',async({proposal,approve,execute,database,dependencies,repository,scope,created})=>{
    const value=await approve(await proposal());dependencies.cancelBooking=async()=>{throw Error('Injected crash before cancellation commit.');};
    await assert.rejects(execute(value),/Injected crash/);assert.equal(created.length,2);
    const state=await repository.loadWorkspace(owner);state.items[0].name='Changed booking';state.items[0].revision++;state.items[0].approvals=[];
    await repository.saveWorkspace(owner,state,state.version);
    const result=await finalizeConfirmedRecoveries(database,{owner});assert.deepEqual(result.proposals,[{proposalId:value.id,status:'requires-review'}]);
    assert.equal((await repository.getPlan(scope.planId,alice)).state.items[0].status,'scheduled');assert.equal(created.length,2);
  });
  await check('A stale completion candidate rotates without changing approved facts so a later ready booking finishes',async({proposal,approve,execute,database,dependencies,repository,scope,service,policyInput,currentVersion,created})=>{
    const stale=await approve(await proposal({refundableBps:0,cancellationFeeUnits:0}));
    dependencies.cancelBooking=async()=>{throw Error('Injected crash before cancellation commit.');};
    await assert.rejects(execute(stale),/Injected crash/);
    const state=await repository.loadWorkspace(owner),next=structuredClone(state.items[0]);next.id='other-booking';next.name='Other reviewed booking';
    state.items.push(next);state.items[0].name='Edited original booking';state.items[0].revision++;state.items[0].approvals=[];
    await repository.saveWorkspace(owner,state,state.version);
    const policy=await service.registerPolicy(scope,{...await policyInput({refundableBps:0,cancellationFeeUnits:0}),itemId:next.id});
    const ready=await approve(await service.propose(scope,{type:'propose',version:await currentVersion(),policyId:policy.id,
      reason:'The group reviewed this separate nonrefundable booking cancellation.'}));
    await assert.rejects(execute(ready),/Injected crash/);
    await database.prepare("UPDATE recovery_proposals SET updated='2026-10-12T12:00:00Z' WHERE id=?").bind(stale.id).run();
    await database.prepare("UPDATE recovery_proposals SET updated='2026-10-13T12:00:00Z' WHERE id=?").bind(ready.id).run();
    const before=await database.prepare('SELECT body,version,status FROM recovery_proposals WHERE id=?').bind(stale.id).first();
    const approvals=await database.prepare('SELECT * FROM recovery_approvals WHERE proposal_id=? ORDER BY member_id').bind(stale.id).all();
    const events=await database.prepare('SELECT * FROM financial_events ORDER BY event_id').all();
    const first=await finalizeConfirmedRecoveries(database,{owner,limit:1});
    assert.deepEqual(first.proposals,[{proposalId:stale.id,status:'requires-review'}]);assert.equal(first.moreMayRemain,true);
    assert.deepEqual(await database.prepare('SELECT body,version,status FROM recovery_proposals WHERE id=?').bind(stale.id).first(),before);
    assert.deepEqual(await database.prepare('SELECT * FROM recovery_approvals WHERE proposal_id=? ORDER BY member_id').bind(stale.id).all(),approvals);
    assert.deepEqual(await database.prepare('SELECT * FROM financial_events ORDER BY event_id').all(),events);
    const second=await finalizeConfirmedRecoveries(database,{owner,limit:1});assert.deepEqual(second.proposals,[{proposalId:ready.id,status:'completed'}]);
    const result=await repository.getPlan(scope.planId,alice);
    assert.equal(result.state.items.find(item=>item.id==='other-booking').status,'cancelled');
    assert.equal(result.state.items.find(item=>item.id==='museum').status,'scheduled');assert.equal(created.length,0);
  });
  await check('Provider uncertainty and mismatched canonical refunds retain capacity without exposing provider messages',async({proposal,approve,execute,setThrow,setClock,database,created,setWrong})=>{
    const value=await approve(await proposal());setThrow(true);let result=await execute(value);
    assert.equal(result.status,'manual-review');assert.equal(result.reservations[0].status,'manual-review');assert.equal(created.length,1);
    assert.ok(!JSON.stringify(result).includes('fixture-secret-provider-message'));
    assert.equal(database.sqlite.prepare("SELECT reserved FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").get().reserved,4200);
    setClock('2026-10-14T18:00:00Z');setThrow(false);setWrong(true);result=await execute(result);assert.equal(created.length,1);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM financial_events WHERE kind='refund'").get().count,0);
  });
  await check('A canonical refund attached to a different capture never reaches the financial ledger',async({proposal,approve,execute,setWrong,database,created})=>{
    const value=await approve(await proposal());setWrong(true);const result=await execute(value);
    assert.equal(result.status,'manual-review');assert.equal(created.length,1);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM financial_events WHERE kind='refund'").get().count,0);
    assert.equal(database.sqlite.prepare("SELECT reserved,refunded FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").get().reserved,4200);
    assert.equal(database.sqlite.prepare("SELECT refund_id FROM refund_reservations WHERE capture_id='CAPTURE0'").get().refund_id,'REFUND1');
  });
  await check('Two concurrent approved recoveries cannot reserve more than the original captured amount',async({proposal,approve,execute,setBeforeMutation,database})=>{
    const first=await approve(await proposal()),second=await approve(await proposal());let enteredResolve,releaseResolve;
    const entered=new Promise(resolve=>enteredResolve=resolve),release=new Promise(resolve=>releaseResolve=resolve);
    let firstCall=true;setBeforeMutation(async()=>{if(firstCall){firstCall=false;enteredResolve();await release;}});
    const execution=execute(first);await entered;
    await assert.rejects(execute(second),error=>error.code==='REFUND_CAPACITY');
    assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM refund_reservations WHERE proposal_id=?').get(second.id).count,0);
    releaseResolve();assert.equal((await execution).status,'completed');
  });
  await check('Overlapping executions of one proposal use one lease and submit each refund once',async({proposal,approve,execute,setBeforeMutation,database,created})=>{
    const value=await approve(await proposal());let enteredResolve,releaseResolve;
    const entered=new Promise(resolve=>enteredResolve=resolve),release=new Promise(resolve=>releaseResolve=resolve);
    let first=true;setBeforeMutation(async()=>{if(first){first=false;enteredResolve();await release;}});
    const running=execute(value);await entered;
    try{await assert.rejects(execute(value),error=>error.code==='RECOVERY_BUSY');assert.equal(created.length,1);}
    finally{releaseResolve();}
    assert.equal((await running).status,'completed');assert.equal(created.length,2);
    assert.deepEqual(await database.prepare('SELECT execution_token,execution_until FROM recovery_proposals WHERE id=?').bind(value.id).first(),
      {execution_token:null,execution_until:0});
  });
  await check('An expired executor keeps the returned refund identity and cannot overwrite a new lease',async({proposal,approve,execute,setBeforeMutation,setClock,database,created,service,scope})=>{
    const value=await approve(await proposal());let first=true;
    setBeforeMutation(async()=>{if(first){first=false;setClock('2026-10-14T12:02:00Z');
      await database.prepare('UPDATE recovery_proposals SET execution_token=?,execution_until=? WHERE id=?')
        .bind('new-executor',Date.parse('2026-10-14T12:03:00Z'),value.id).run();}});
    await assert.rejects(execute(value),error=>error.code==='RECOVERY_EXECUTION_CHANGED');
    assert.equal(created.length,1);
    assert.equal((await database.prepare('SELECT execution_token FROM recovery_proposals WHERE id=?').bind(value.id).first()).execution_token,'new-executor');
    assert.equal((await database.prepare('SELECT refund_id FROM refund_reservations WHERE proposal_id=? AND capture_id=?').bind(value.id,'CAPTURE0').first()).refund_id,'REFUND1');
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM financial_events WHERE kind='refund'").first()).count,0);
    setClock('2026-10-14T12:04:00Z');assert.equal((await execute(await service.get(scope,value.id))).status,'completed');
    assert.equal(created.length,2);assert.equal(new Set(created.map(row=>row.captureId)).size,2);
  });
  await check('A crashed reserved refund with an expired immutable intent is never resubmitted',async({proposal,approve,execute,setThrow,setClock,database,created})=>{
    const value=await approve(await proposal());setThrow(true);await execute(value);assert.equal(created.length,1);
    // Simulate death after POST but before the catch handler persisted uncertainty.
    await database.prepare("UPDATE refund_reservations SET status='reserved' WHERE proposal_id=?").bind(value.id).run();
    await database.prepare("UPDATE recovery_proposals SET status='executing' WHERE id=?").bind(value.id).run();
    setThrow(false);setClock('2026-10-14T18:00:00Z');const result=await execute(value);
    assert.equal(result.status,'manual-review');assert.equal(created.length,1);
    assert.equal((await database.prepare("SELECT reserved FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").first()).reserved,4200);
  });
  await check('A bounded retry preserves its original request and known refunds reconcile after replay expiry',async({proposal,approve,execute,setThrow,setClock,setMode,database,created,refunds})=>{
    const value=await approve(await proposal());setThrow(true);await execute(value);
    const firstIntent=await database.prepare('SELECT * FROM provider_request_intents WHERE operation_id=?').bind(created[0].key).first();
    setThrow(false);setMode('PENDING');setClock('2026-10-14T13:00:00Z');const pending=await execute(value);
    assert.equal(created[0].key,created[1].key);assert.equal(created.length,3);
    assert.deepEqual(await database.prepare('SELECT * FROM provider_request_intents WHERE operation_id=?').bind(created[0].key).first(),firstIntent);
    for(const refund of refunds.values())refund.status='COMPLETED';
    setClock('2026-10-15T12:00:00Z');assert.equal((await execute(pending)).status,'completed');assert.equal(created.length,3);
  });
  await check('A booking edited during canonical capture reads stops the next POST',async({proposal,approve,execute,dependencies,repository,created})=>{
    const value=await approve(await proposal()),original=dependencies.fetchCapture;let reads=0;
    dependencies.fetchCapture=async id=>{const result=await original(id);
      // Two initial verification reads precede reservation; the third precedes POST.
      if(++reads===3){const state=await repository.loadWorkspace(owner);state.items[0].name='Edited during verification';state.items[0].revision++;
        state.items[0].approvals=[];await repository.saveWorkspace(owner,state,state.version);}return result;};
    const result=await execute(value);assert.equal(result.status,'manual-review');assert.equal(created.length,0);
  });
  await check('A cutoff crossed during capture verification blocks the refund POST while known refunds remain reconcilable',async({proposal,approve,execute,dependencies,setClock,created,database})=>{
    const value=await approve(await proposal()),original=dependencies.fetchCapture;let reads=0;
    setClock('2027-04-03T21:59:50Z');
    dependencies.fetchCapture=async id=>{const result=await original(id);if(++reads===3)setClock('2027-04-03T22:00:01Z');return result;};
    const result=await execute(value);assert.equal(result.status,'manual-review');assert.equal(created.length,0);
    assert.equal((await database.prepare("SELECT reserved FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").first()).reserved,4200);
  });
  await check('New dependencies between payer refunds stop further provider submissions',async({proposal,approve,execute,setBeforeMutation,repository,created,database})=>{
    const value=await approve(await proposal());let first=true;
    setBeforeMutation(async()=>{if(first){first=false;const state=await repository.loadWorkspace(owner);
      state.items.push({...structuredClone(state.items[0]),id:'new-transfer',name:'New dependent transfer',price:0,
        shares:{[alice.id]:0,[bob.id]:0},values:{[alice.id]:0,[bob.id]:0},depends:['museum'],paid:[],approvals:[]});
      await repository.saveWorkspace(owner,state,state.version);}});
    const result=await execute(value);assert.equal(result.status,'manual-review');assert.equal(created.length,1);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM financial_events WHERE kind='refund'").first()).count,1);
    assert.equal((await repository.loadWorkspace(owner)).items[0].status,'scheduled');
  });
  await check('Supplier terms and member consent cannot be rewritten while execution state remains mutable',async({proposal,approve,database})=>{
    const value=await approve(await proposal());
    await assert.rejects(database.prepare('UPDATE booking_policies SET body=? WHERE id=?').bind('{}',value.snapshot.policy.id).run(),/immutable/);
    await assert.rejects(database.prepare('DELETE FROM booking_policies WHERE id=?').bind(value.snapshot.policy.id).run(),/immutable/);
    await assert.rejects(database.prepare('UPDATE recovery_proposals SET body=? WHERE id=?').bind('{}',value.id).run(),/immutable/);
    await assert.rejects(database.prepare('UPDATE recovery_proposals SET version=2 WHERE id=?').bind(value.id).run(),/immutable/);
    await assert.rejects(database.prepare('DELETE FROM recovery_proposals WHERE id=?').bind(value.id).run(),/immutable/);
    await assert.rejects(database.prepare('UPDATE recovery_approvals SET member_id=? WHERE proposal_id=?').bind('forged',value.id).run(),/immutable/);
    await assert.rejects(database.prepare('DELETE FROM recovery_approvals WHERE proposal_id=?').bind(value.id).run(),/immutable/);
    await database.prepare('UPDATE recovery_proposals SET execution_until=1 WHERE id=?').bind(value.id).run();
  });
  await check('The additive execution migration preserves existing approved recoveries',async()=>{
    const legacy=createTestD1({migrations:{through:'0013_planning_evidence_jobs_cursor.sql'}});
    try{const fixture=await seed(legacy),value=await fixture.approve(await fixture.proposal());
      const before=await fixture.service.get(fixture.scope,value.id);applyMigrations(legacy);
      assert.deepEqual(await fixture.service.get(fixture.scope,value.id),before);
      assert.equal((await fixture.execute(value)).status,'completed');assert.equal(fixture.created.length,2);
    }finally{legacy.close();}
  });
  await check('A lease that expires during verification cannot reserve or submit money',async({proposal,approve,execute,dependencies,setClock,database,created})=>{
    const value=await approve(await proposal()),original=dependencies.fetchCapture;
    dependencies.fetchCapture=async id=>{const result=await original(id);setClock('2026-10-14T12:02:00Z');return result;};
    await assert.rejects(execute(value),error=>error.code==='RECOVERY_EXECUTION_CHANGED');assert.equal(created.length,0);
    assert.equal((await database.prepare('SELECT COUNT(*) count FROM refund_reservations').first()).count,0);
    assert.equal((await database.prepare('SELECT execution_token FROM recovery_proposals WHERE id=?').bind(value.id).first()).execution_token,null);
  });
  await check('Large recoveries resume after five refunds and untouched reservations get their own replay window',async({database,proposal,approve,execute,created,setClock})=>{
    let value=await approve(await proposal());
    value=await execute(value);assert.equal(value.status,'executing');assert.equal(created.length,5);
    assert.equal(value.reservations.filter(row=>row.status==='confirmed').length,5);
    const waiting=value.reservations.find(row=>row.status==='reserved');
    assert.equal(await database.prepare('SELECT operation_id FROM provider_request_intents WHERE operation_id=?').bind(waiting.id).first(),null);
    setClock('2026-10-15T12:00:00Z');value=await execute(value);assert.equal(value.status,'completed');assert.equal(created.length,6);
    assert.equal(new Set(created.map(row=>row.captureId)).size,6);
    assert.equal((await database.prepare("SELECT SUM(json_extract(facts,'$.amount')) amount FROM financial_events WHERE kind='refund'").first()).amount,-10200);
  },4);
  await check('Several partial proposals cannot cumulatively exceed source terms even below the captured total',async({scope,service,policyInput,currentVersion,approve,execute,setBeforeMutation,database,orders,captures})=>{
    const policy=await service.registerPolicy(scope,await policyInput());
    async function proposeAmounts(refundAmounts){return service.propose(scope,{type:'propose',version:await currentVersion(),policyId:policy.id,
      reason:'The group reviewed a partial cancellation allocation.',refundAmounts});}
    const first=await approve(await proposeAmounts({CAPTURE0:2000,CAPTURE1:0}));
    const second=await approve(await proposeAmounts({CAPTURE0:3000,CAPTURE1:0}));let enteredResolve,releaseResolve;
    const entered=new Promise(resolve=>enteredResolve=resolve),release=new Promise(resolve=>releaseResolve=resolve);
    setBeforeMutation(async()=>{enteredResolve();await release;});const execution=execute(first);await entered;
    await assert.rejects(execute(second),error=>error.code==='REFUND_CAPACITY');
    assert.equal(database.sqlite.prepare("SELECT reserved FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").get().reserved,2000);
    releaseResolve();assert.equal((await execution).status,'completed');
    orders.get('ORDER0').purchase_units[0].payments.captures[0].status='PARTIALLY_REFUNDED';captures.get('CAPTURE0').status='PARTIALLY_REFUNDED';
    await assert.rejects(proposeAmounts({CAPTURE0:3000,CAPTURE1:0}),error=>error.code==='INVALID_RECOVERY');
    const remaining=await service.propose(scope,{type:'propose',version:await currentVersion(),policyId:policy.id,reason:'The group reviewed the remaining authorized refund.'});
    assert.deepEqual(remaining.snapshot.allocations.map(row=>row.amount),[2200,2800]);
  });
  await check('Legacy pending refunds backfill exactly once, retries do not consume capacity twice, completion is idempotent',async({database,scope})=>{
    await database.prepare("INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,?,1,'refund',?,'refund-pending',?)")
      .bind('LEGACY',owner,'museum',alice.id,2000,JSON.stringify({planrecoverTripId:scope.planId,planrecoverCaptureId:'CAPTURE0'})).run();
    const input={reservationId:'LEGACY',owner,planId:scope.planId,itemId:'museum',memberId:alice.id,captureId:'CAPTURE0',currency:'CAD',captured:6000,amount:2000};
    await database.batch(await reserveCaptureRefund(database,input));await database.batch(await reserveCaptureRefund(database,input));
    assert.equal(database.sqlite.prepare("SELECT reserved FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").get().reserved,2000);
    await database.batch(confirmCaptureRefund(database,{reservationId:'LEGACY',captureId:'CAPTURE0',amount:2000}));
    await database.batch(confirmCaptureRefund(database,{reservationId:'LEGACY',captureId:'CAPTURE0',amount:2000}));
    assert.deepEqual({...database.sqlite.prepare("SELECT reserved,refunded FROM capture_refund_capacity WHERE capture_id='CAPTURE0'").get()},{reserved:0,refunded:2000});
    await assert.rejects(database.batch(await reserveCaptureRefund(database,{...input,reservationId:'TOOMUCH',amount:5000})),/CHECK constraint failed/);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM capture_refund_claims WHERE id='TOOMUCH'").get().count,0);
  });
  await check('Booking edits, expired cutoff and unresolved dependencies stop execution before provider mutation',async({proposal,approve,execute,repository,setClock,created})=>{
    const value=await approve(await proposal());setClock('2027-04-04T12:00:00Z');await assert.rejects(execute(value),error=>error.code==='CANCELLATION_CUTOFF');
    setClock('2026-10-14T12:00:00Z');const state=await repository.loadWorkspace(owner);state.items[0].revision++;state.items[0].approvals=[];
    await repository.saveWorkspace(owner,state,state.version);await assert.rejects(execute(value),error=>error.status===409);assert.equal(created.length,0);
  });
  await check('Dependent bookings retain their own terms and must be reviewed before a parent cancellation',async({proposal,approve,execute,repository,created})=>{
    const state=await repository.loadWorkspace(owner);state.items.push({...structuredClone(state.items[0]),id:'transport',name:'Dependent return transfer',
      price:0,shares:{[alice.id]:0,[bob.id]:0},values:{[alice.id]:0,[bob.id]:0},depends:['museum'],paid:[],approvals:[]});
    await repository.saveWorkspace(owner,state,state.version);const value=await approve(await proposal());
    assert.equal(value.snapshot.dependentItems[0].id,'transport');
    await assert.rejects(execute(value),error=>error.code==='RECOVERY_DEPENDENCIES');assert.equal(created.length,0);
  });
  await check('Read-only canonical reconciliation retains approved refunds when the plan leaves the workspace',async({proposal,approve,execute,setMode,refunds,database,repository,scope})=>{
    setMode('PENDING');const value=await approve(await proposal());await execute(value);
    const root=await repository.loadWorkspace(owner),otherPlan=await repository.createPlan(owner,alice,{kind:'day-out',name:'Another plan',
      destination:'Ottawa, Ontario, Canada',start:'2027-05-01',end:'2027-05-01',timezone:'America/Toronto',currency:'CAD',budget:10000});
    const workspace=await repository.loadWorkspace(owner);workspace.archives=workspace.archives.filter(entry=>entry.workspace.plan.id!==scope.planId);
    await repository.saveWorkspace(owner,workspace,workspace.version);
    assert.equal(database.sqlite.prepare('SELECT status FROM plans WHERE owner=? AND id=?').get(owner,scope.planId).status,'deleted');
    const operations=await database.prepare("SELECT * FROM provider_operations WHERE kind='refund' ORDER BY id").all();
    for(const operation of operations.results){const canonical=refunds.get(operation.provider_id);canonical.status='COMPLETED';await reconcileRecoveryRefund(database,operation,canonical);}
    const canonical=refunds.get(operations.results[0].provider_id);
    const retained=JSON.parse(database.sqlite.prepare('SELECT body FROM plans WHERE owner=? AND id=?').get(owner,scope.planId).body);
    assert.equal(retained.events.find(event=>event.providerId===canonical.id).status,'confirmed');
    await assert.rejects(repository.getPlan(scope.planId,alice),error=>error.status===404);
    assert.equal((await repository.getPlan(otherPlan.state.plan.id,alice)).state.plan.name,'Another plan');
    const before=database.sqlite.prepare('SELECT body,version,status FROM plans WHERE owner=? AND id=?').get(owner,scope.planId);
    const finalized=await finalizeConfirmedRecoveries(database,{owner});assert.deepEqual(finalized.proposals,[{proposalId:value.id,status:'completed'}]);
    assert.deepEqual(database.sqlite.prepare('SELECT body,version,status FROM plans WHERE owner=? AND id=?').get(owner,scope.planId),before);
    await assert.rejects(repository.getPlan(scope.planId,alice),error=>error.status===404);
  });
  await check('External bookings permit review and approvals but never call the PayPal merchant refund adapter',async({proposal,approve,execute,created})=>{
    const value=await approve(await proposal({merchant:'external-manual'}));assert.deepEqual(value.snapshot.allocations,[]);
    await assert.rejects(execute(value),error=>error.code==='EXTERNAL_BOOKING');assert.equal(created.length,0);
  });
  await check('Recovery routes protect identity, ownership, JSON limits and actor binding',async({scope,currentVersion,policyInput})=>{
    const context={params:Promise.resolve({planId:scope.planId})};
    function request(method,body,{account=owner,originHeader=origin}={}){const headers=new Headers();if(account)headers.set('oai-authenticated-user-id',account);
      if(method!=='GET'){headers.set('origin',originHeader);headers.set('content-type','application/json');}
      return new Request(`${origin}/api/plans/${scope.planId}/recoveries`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});}
    assert.equal((await route.GET(request('GET',undefined,{account:null}),context)).status,401);
    const response=await route.GET(request('GET'),context);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
    assert.equal((await route.POST(request('POST',await policyInput(),{account:other}),context)).status,403);
    assert.equal((await route.POST(request('POST',{...await policyInput(),actor:bob.id}),context)).status,400);
    assert.equal((await route.POST(request('POST',await policyInput(),{originHeader:'https://attacker.example'}),context)).status,400);
    assert.equal((await route.POST(request('POST',{type:'register-policy',version:await currentVersion(),padding:'x'.repeat(21_000)}),context)).status,413);
    const registered=await route.POST(request('POST',await policyInput()),context);assert.equal(registered.status,200);
    assert.equal(networkCalls.length,0);
  });
  await check('The real recovery route completes an approved partial refund using only injected sandbox endpoints',async({scope,currentVersion,policyInput,orders,captures,refunds,database})=>{
    const context={params:Promise.resolve({planId:scope.planId})};let nextRefund=0;
    globalThis.fetch=async(url,options={})=>{const target=new URL(url);assert.equal(target.origin,'https://api-m.sandbox.paypal.com');
      if(target.pathname==='/v1/oauth2/token')return Response.json({access_token:'fixture-oauth-token'});
      networkCalls.push({path:target.pathname,method:options.method});
      const orderMatch=/^\/v2\/checkout\/orders\/([^/]+)$/.exec(target.pathname);if(orderMatch)return Response.json(orders.get(orderMatch[1]));
      const captureMatch=/^\/v2\/payments\/captures\/([^/]+)$/.exec(target.pathname);if(captureMatch)return Response.json(captures.get(captureMatch[1]));
      const refundMatch=/^\/v2\/payments\/refunds\/([^/]+)$/.exec(target.pathname);if(refundMatch)return Response.json(refunds.get(refundMatch[1]));
      const createMatch=/^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(target.pathname);
      if(createMatch){assert.equal(options.method,'POST');assert.ok(options.headers['PayPal-Request-Id'].length<=38);
        const body=JSON.parse(options.body);assert.equal(body.amount.currency_code,'CAD');
        const value=refund(`ROUTEREFUND${++nextRefund}`,createMatch[1],Number(body.amount.value.replace('.','')));refunds.set(value.id,value);return Response.json(value);}
      throw Error('Unexpected provider endpoint.');};
    async function post(body,account=owner){const response=await route.POST(new Request(`${origin}/api/plans/${scope.planId}/recoveries`,{
      method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':account},body:JSON.stringify(body)}),context);
      const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
    const {policy}=await post(await policyInput());const {proposal}=await post({type:'propose',version:await currentVersion(),policyId:policy.id,
      reason:'Group approved the verified fictional supplier cancellation terms.'});
    for(const account of [owner,other])await post({type:'approve',proposalId:proposal.id,version:proposal.version,planVersion:await currentVersion()},account);
    const result=await post({type:'execute',proposalId:proposal.id,version:proposal.version,planVersion:await currentVersion(),confirmSandboxRefunds:true});
    assert.equal(result.proposal.status,'completed');assert.equal(nextRefund,2);
    assert.equal(database.sqlite.prepare("SELECT SUM(json_extract(facts,'$.amount')) amount FROM financial_events WHERE kind='refund'").get().amount,-7000);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM financial_events WHERE kind='refund'").get().count,2);
    globalThis.fetch=originalFetch;
  });
  await check('Departure retains original capture authority and refunds original payers while reversing the revised cost allocation',async f=>{
    const {PlanChangeService}=await import('../lib/plan-changes.ts');const changes=new PlanChangeService(f.database);
    const change=await changes.propose(f.scope.planId,alice,{type:'departure',version:await f.currentVersion(),memberId:alice.id});
    for(const person of [alice,bob])await changes.act(f.scope.planId,person,{type:'approve',changeId:change.id,version:await f.currentVersion(),confirm:true});
    await changes.act(f.scope.planId,alice,{type:'apply',changeId:change.id,version:await f.currentVersion(),confirm:true});
    const state=(await f.repository.getPlan(f.scope.planId,alice)).state,item=state.items[0];assert.equal(item.funding.revision,1);assert.deepEqual(item.shares,{[bob.id]:10000});
    const input=await f.policyInput();input.revision=item.revision;const policy=await f.service.registerPolicy(f.scope,input);
    let proposal=await f.service.propose(f.scope,{type:'propose',version:await f.currentVersion(),policyId:policy.id,reason:'The group reviewed cancellation after the participation change.'});proposal=await f.approve(proposal);
    assert.equal(proposal.snapshot.allocations.reduce((n,a)=>n+a.amount,0),7000);await f.execute(proposal);
    const final=(await f.repository.getPlan(f.scope.planId,alice)).state,refunds=final.events.filter(e=>e.kind==='refund');
    assert.equal(refunds.reduce((n,e)=>n+(e.shares[alice.id]??0),0),0);assert.equal(refunds.reduce((n,e)=>n+(e.shares[bob.id]??0),0),-7000);
    assert.equal(refunds.reduce((n,e)=>n+(e.contributions[alice.id]??0),0),-4200);assert.equal(refunds.reduce((n,e)=>n+(e.contributions[bob.id]??0),0),-2800);
    assert.equal(final.items[0].status,'cancelled');
  });
  await check('Whole-group recovery refunds only the original funder and reverses approved consumption shares exactly',async f=>{let proposal=await f.approve(await f.proposal());assert.equal(proposal.snapshot.allocations.length,1);assert.equal(proposal.snapshot.allocations[0].memberId,alice.id);assert.equal(proposal.snapshot.allocations[0].captured,10000);assert.equal(proposal.snapshot.allocations[0].amount,7000);assert.deepEqual(proposal.snapshot.allocations[0].costShares,{[alice.id]:4200,[bob.id]:2800});await f.execute(proposal);const state=(await f.repository.getPlan(f.scope.planId,alice)).state,refunds=state.events.filter(event=>event.kind==='refund');assert.equal(refunds.length,1);assert.deepEqual(refunds[0].contributions,{[alice.id]:-7000});assert.deepEqual(refunds[0].shares,{[alice.id]:-4200,[bob.id]:-2800});await f.execute(proposal);assert.equal(f.created.length,1);},0,true);
  await check('Departure of the whole-group funder retains their original capture and refund identity',async f=>{const {PlanChangeService}=await import('../lib/plan-changes.ts'),changes=new PlanChangeService(f.database),change=await changes.propose(f.scope.planId,alice,{type:'departure',version:await f.currentVersion(),memberId:alice.id});for(const person of [alice,bob])await changes.act(f.scope.planId,person,{type:'approve',changeId:change.id,version:await f.currentVersion(),confirm:true});await changes.act(f.scope.planId,alice,{type:'apply',changeId:change.id,version:await f.currentVersion(),confirm:true});const state=(await f.repository.getPlan(f.scope.planId,alice)).state,item=state.items[0],input=await f.policyInput();assert.deepEqual(item.participants,[bob.id]);assert.deepEqual(state.events[0].contributions,{[alice.id]:10000});input.revision=item.revision;const policy=await f.service.registerPolicy(f.scope,input);let proposal=await f.service.propose(f.scope,{type:'propose',version:await f.currentVersion(),policyId:policy.id,reason:'Cancellation after the designated payer leaves the activity.'});proposal=await f.approve(proposal);await f.execute(proposal);const final=(await f.repository.getPlan(f.scope.planId,alice)).state,refund=final.events.find(event=>event.kind==='refund');assert.deepEqual(refund.contributions,{[alice.id]:-7000});assert.deepEqual(refund.shares,{[bob.id]:-7000});},0,true);
  await check('A paid whole-group allocation revision preserves original capture authority for refund review',async f=>{const initial=await f.repository.getPlan(f.scope.planId,alice);await f.repository.updatePlan(f.scope.planId,alice,initial.version,{type:'item_edit',actor:alice.id,itemId:'museum',participants:[alice.id,bob.id],price:10000,allocation:'fixed',values:{[alice.id]:2000,[bob.id]:8000}});for(const person of [alice,bob]){const record=await f.repository.getPlan(f.scope.planId,person);await f.repository.updatePlan(f.scope.planId,person,record.version,{type:'approve_item',actor:person.id,itemId:'museum',revision:2});}const current=(await f.repository.getPlan(f.scope.planId,alice)).state;assert.equal(current.items[0].funding.revision,1);const input=await f.policyInput();input.revision=2;const policy=await f.service.registerPolicy(f.scope,input);let proposal=await f.service.propose(f.scope,{type:'propose',version:await f.currentVersion(),policyId:policy.id,reason:'The approved allocation changed while original merchant funding was retained.'});proposal=await f.approve(proposal);assert.equal(proposal.snapshot.allocations[0].memberId,alice.id);assert.deepEqual(proposal.snapshot.allocations[0].costShares,{[alice.id]:1400,[bob.id]:5600});await f.execute(proposal);const final=(await f.repository.getPlan(f.scope.planId,alice)).state;assert.deepEqual(final.events.find(e=>e.kind==='refund').contributions,{[alice.id]:-7000});},0,true);
  console.log(`${checks} generalized recovery checks passed.`);
}finally{globalThis.fetch=originalFetch;rmSync(temp,{recursive:true,force:true});}
