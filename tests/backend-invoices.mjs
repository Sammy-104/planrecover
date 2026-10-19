import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {PlanInvoiceRepository,invoiceFinancialEffects,invoiceCreateRequest,reconcilePendingPlanInvoices} from '../lib/plan-invoices.ts';
import {applyAction,personalMoney} from '../lib/model.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {claimPaymentFunding} from '../lib/financial-history.ts';
import {InvoiceRefundService} from '../lib/invoice-refund-service.ts';
import {PlanChangeService} from '../lib/plan-changes.ts';
import {RecoveryService,cancelRecoveredBooking,finalizeConfirmedRecoveries} from '../lib/recovery-service.ts';
import {commitFinancialEffect} from '../lib/financial-history.ts';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-invoices-'));
globalThis.backendTestEnv={DB:undefined};globalThis.fetch=async()=>{throw Error('No invoice route may call a live provider during this test.');};
const routes={};
for(const [name,path] of Object.entries({list:'app/api/plans/[planId]/invoices/route.ts',action:'app/api/plans/[planId]/invoices/[invoiceId]/route.ts'})){
 const outfile=join(directory,`${name}.mjs`);
 await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
  plugins:[{name:'binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));
   builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.backendTestEnv;',loader:'js'}));}}]});
 routes[name]=await import(pathToFileURL(outfile).href);
}
let passed=0;
async function check(name,run){
 const database=createTestD1(),plans=new PlanRepository(database),owner='invoice-owner',identity={id:await accountPersonId(owner),name:'Owner'},
  buyer={id:await accountPersonId('invoice-buyer'),name:'Buyer'},other={id:await accountPersonId('invoice-other'),name:'Other'};
 globalThis.backendTestEnv.DB=database;
 const record=await plans.createPlan(owner,identity,{kind:'day-out',name:'Invoice test',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:20000});
 const workspace=await plans.loadWorkspace(owner);addPerson(workspace,buyer,'editor');addPerson(workspace,other,'editor');
 workspace.items.push({id:'rental',name:'Fictional rental',category:'Activity',start:'2027-04-04T14:00:00-04:00',duration:60,
  price:10000,participants:[buyer.id],shares:{[buyer.id]:10000},allocation:'equal',values:{},revision:1,approvals:[buyer.id],required:[buyer.id],
  status:'awaiting-payment',booking:'unconfirmed',policy:'Fictional merchant refundable rental.',source:'Fictional demo merchant · sandbox',expires:null,
  deadline:null,depends:[],paid:[],location:'Toronto'});
 await plans.saveWorkspace(owner,workspace,workspace.version);
 const providerInvoices=new Map(),calls=[],failures={get:0},hooks={};
 const provider=async(path,method='GET',body,key)=>{
  calls.push({path,method,body,key});if(hooks.call)await hooks.call(path,method);
  if(path==='/v2/invoicing/invoices'&&method==='POST'){
   const id='INV2-TEST-0001',invoice={...structuredClone(body),id,status:'DRAFT',amount:{currency_code:'CAD',value:'100.00'},due_amount:{currency_code:'CAD',value:'100.00'}};
   invoice.detail.metadata={recipient_view_url:'https://www.sandbox.paypal.com/invoice/p/#TEST0001'};
   providerInvoices.set(id,invoice);return {id};
  }
  const id=path.split('/')[4],invoice=providerInvoices.get(id);if(!invoice)throw Error('Missing fixture invoice');
  if(method==='GET'){if(failures.get-->0)throw Error('Temporary fixture timeout');return structuredClone(invoice);}
  if(path.endsWith('/send')&&method==='POST'){invoice.status='SENT';return {};}
  if(path.endsWith('/cancel')&&method==='POST'){invoice.status='CANCELLED';return {};}
  if(method==='DELETE'){providerInvoices.delete(id);return {};}
  throw Error(`Unsupported fixture provider request ${method} ${path}`);
 };
 const invoices=new PlanInvoiceRepository(database,provider,invoiceFinancialEffects(database)),id=record.state.plan.id;
 const scope=async person=>({record:await plans.getPlan(id,person),memberId:person.id});
 const input=async()=>({version:(await scope(identity)).record.version,requestId:'11111111-1111-4111-8111-111111111111',
  itemId:'rental',revision:1,memberId:buyer.id,email:'buyer@example.test',due:'2027-04-04',dueAt:'2027-04-04T18:00:00-04:00',allowPartial:true,minimum:2500});
 const action=async(invoice,kind,person=identity,confirm=true)=>invoices.act(await scope(person),invoice.id,
  {version:(await scope(person)).record.version,invoiceVersion:invoice.version,action:kind,confirm});
 const pay=(amounts,status)=>{const invoice=providerInvoices.get('INV2-TEST-0001');invoice.status=status;
  const total=amounts.reduce((sum,a)=>sum+a,0);invoice.payments={paid_amount:{currency_code:'CAD',value:(total/100).toFixed(2)},
   transactions:amounts.map((amount,index)=>({type:'PAYPAL',method:'PAYPAL',payment_id:`INV-PAYMENT-${index+1}`,amount:{currency_code:'CAD',value:(amount/100).toFixed(2)}}))};
  invoice.due_amount={currency_code:'CAD',value:((10000-total)/100).toFixed(2)};};
 try{await run({database,plans,scope,identity,buyer,other,invoices,input,action,pay,provider,providerInvoices,calls,failures,hooks,id});passed++;console.log(`PASS ${name}`);}
 finally{database.close();globalThis.backendTestEnv.DB=undefined;}
}
try{
 await check('Invoice creation is a plan-linked unpaid draft with no payment or notification',async t=>{
  const invoice=await t.invoices.create(await t.scope(t.identity),await t.input());assert.equal(invoice.amount,10000);assert.equal(invoice.minimum,2500);
  assert.equal(invoice.outstanding,10000);assert.equal(invoice.status,'draft');assert.deepEqual(invoice.approvedMembers,[]);
  assert.equal(t.calls.filter(c=>c.method==='POST').length,1);assert.equal(t.calls.filter(c=>c.path.endsWith('/send')).length,0);
  assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,0);
 });
 await check('Stable request IDs reject altered private terms and never create a second invoice',async t=>{
  const body=await t.input(),first=await t.invoices.create(await t.scope(t.identity),body);
  const again=await t.invoices.create(await t.scope(t.identity),body);assert.equal(again.id,first.id);
  await assert.rejects(t.invoices.create(await t.scope(t.identity),{...body,email:'different@example.test'}),e=>e.code==='INVOICE_IDEMPOTENCY');
  assert.equal(t.calls.filter(c=>c.method==='POST').length,1);
 });
 await check('Interrupted details lookup retains provider ID and resumes by canonical GET only',async t=>{
  t.failures.get=1;const body=await t.input();await assert.rejects(t.invoices.create(await t.scope(t.identity),body),/timeout/);
  const row=t.database.sqlite.prepare('SELECT provider_id,status,lease_token FROM plan_invoices').get();assert.equal(row.provider_id,'INV2-TEST-0001');assert.equal(row.status,'creating');assert.equal(row.lease_token,null);
  const invoice=await t.invoices.create(await t.scope(t.identity),body);assert.equal(invoice.status,'draft');assert.equal(t.calls.filter(c=>c.method==='POST').length,1);
 });
 await check('Owners see all invoices, recipients see theirs, other members cannot see email or issue invoices',async t=>{
  const invoice=await t.invoices.create(await t.scope(t.identity),await t.input());assert.equal((await t.invoices.list(await t.scope(t.buyer))).length,1);
  assert.deepEqual(await t.invoices.list(await t.scope(t.other)),[]);await assert.rejects(t.invoices.get(await t.scope(t.other),invoice.id),e=>e.status===404);
  await assert.rejects(t.invoices.create(await t.scope(t.buyer),await t.input()),e=>e.status===403);
  await assert.rejects(t.action(invoice,'send',t.buyer),e=>e.status===403);
 });
 await check('Member review of due date and partial terms precedes an explicitly confirmed owner send',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());
  await assert.rejects(t.action(invoice,'send'),e=>e.code==='INVOICE_APPROVAL_REQUIRED');
  invoice=await t.action(invoice,'approve',t.buyer);assert.deepEqual(invoice.approvedMembers,[t.buyer.id]);
  await assert.rejects(t.action(invoice,'send',t.identity,false),e=>e.code==='INVOICE_CONFIRM');
  invoice=await t.action(invoice,'send');assert.equal(invoice.status,'sent');assert.equal(t.calls.filter(c=>c.path.endsWith('/send')).length,1);
  assert.equal(invoice.paymentUrl,'https://www.sandbox.paypal.com/invoice/p/#TEST0001');assert.equal((await t.invoices.get(await t.scope(t.buyer),invoice.id)).paymentUrl,invoice.paymentUrl);
  assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,0);
 });
 await check('Partial payments reconcile exactly once and final payment completes the approved share',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());t.pay([2500],'PARTIALLY_PAID');
  invoice=await t.action(invoice,'reconcile',t.buyer);assert.equal(invoice.paid,2500);assert.equal(invoice.outstanding,7500);assert.equal(invoice.status,'partially-paid');
  invoice=await t.action(invoice,'reconcile',t.buyer);assert.equal(invoice.paid,2500);
  let state=(await t.plans.getPlan(t.id,t.identity)).state;assert.equal(state.events.length,1);assert.equal(state.events[0].shares[t.buyer.id],2500);assert.equal(state.events[0].contributions[t.buyer.id],2500);assert.deepEqual(state.items[0].paid,[]);
  const money=personalMoney((await t.plans.loadWorkspace('invoice-owner')),t.buyer.id);assert.equal(money.cost,2500);assert.equal(money.planned,7500);assert.equal(money.projected,10000);
  t.pay([2500,7500],'PAID');invoice=await t.action(invoice,'reconcile',t.buyer);assert.equal(invoice.status,'paid');assert.equal(invoice.outstanding,0);
  state=(await t.plans.getPlan(t.id,t.identity)).state;assert.equal(state.events.length,2);assert.deepEqual(state.items[0].paid,[t.buyer.id]);assert.equal(state.items[0].status,'scheduled');
  const rows=t.database.sqlite.prepare('SELECT amount FROM plan_invoice_payments').all();assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),10000);
  const body=await t.input();assert.equal((await t.invoices.create(await t.scope(t.identity),body)).status,'paid');
 });
 await check('Unverified invoice changes and external marked payments cannot create financial events',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());t.pay([2500],'PARTIALLY_PAID');
  const provider=t.providerInvoices.get('INV2-TEST-0001'),original=structuredClone(provider);
  for(const mutate of [p=>p.amount.value='99.99',p=>p.amount.currency_code='USD',p=>p.items[0].name='Another item',p=>p.primary_recipients[0].billing_info.email_address='someone@example.test',
   p=>p.configuration.partial_payment.minimum_amount_due.value='1.00',p=>p.payments.transactions[0].type='EXTERNAL',p=>p.payments.paid_amount.value='26.00']){
   Object.keys(provider).forEach(k=>delete provider[k]);Object.assign(provider,structuredClone(original));mutate(provider);
   await assert.rejects(t.action(invoice,'reconcile'),e=>e.code==='INVOICE_EVIDENCE');invoice=await t.invoices.get(await t.scope(t.identity),invoice.id);
   assert.equal(invoice.status,'needs-review');assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,0);assert.equal(invoice.paid,0);
  }
 });
 await check('Revision changes invalidate invoice approval and sending while canonical payments remain recordable',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());invoice=await t.action(invoice,'approve',t.buyer);
  const workspace=await t.plans.loadWorkspace('invoice-owner');workspace.items[0].revision=2;workspace.items[0].approvals=[];workspace.items[0].status='draft';
  await t.plans.saveWorkspace('invoice-owner',workspace,workspace.version);
  await assert.rejects(t.action(invoice,'send'),e=>e.code==='INVOICE_APPROVAL_CHANGED');assert.equal(t.calls.filter(c=>c.path.endsWith('/send')).length,0);
  t.pay([10000],'PAID');invoice=await t.action(invoice,'reconcile');assert.equal(invoice.paid,10000);
  const state=(await t.plans.getPlan(t.id,t.identity)).state;assert.deepEqual(state.items[0].paid,[]);assert.equal(state.events.length,1);
 });
 await check('An existing checkout funding claim blocks invoice collection for the same share',async t=>{
  await claimPaymentFunding(t.database,{owner:'invoice-owner',planId:t.id,itemId:'rental',revision:1,memberId:t.buyer.id,channel:'order',referenceId:'existing-order'});
  await assert.rejects(t.invoices.create(await t.scope(t.identity),await t.input()),e=>e.code==='PAYMENT_CHANNEL_CONFLICT');assert.equal(t.calls.length,0);
 });
 await check('Server recovery reads existing IDs only and records late payments for deleted plans',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());invoice=await t.action(invoice,'approve',t.buyer);invoice=await t.action(invoice,'send');
  const rootState=await t.plans.loadWorkspace('invoice-owner');const deleted=applyAction(rootState,{type:'delete_trip',deleteTripId:t.id,confirmed:true,actor:t.identity.id});
  await t.plans.saveWorkspace('invoice-owner',deleted,rootState.version);t.pay([10000],'PAID');
  const count=t.calls.length,result=await reconcilePendingPlanInvoices(t.database,t.provider,{owner:'invoice-owner'});assert.equal(result.results[0].status,'paid');
  assert.ok(t.calls.slice(count).every(call=>call.method==='GET'));const stored=t.database.sqlite.prepare('SELECT paid,status FROM plan_invoices WHERE id=?').get(invoice.id);
  assert.equal(stored.paid,10000);assert.equal(stored.status,'paid');
  const workspace=await t.plans.loadWorkspace('invoice-owner');const tombstone=workspace.deletedTrips.find(value=>value.id===t.id);assert.equal(tombstone.workspace.events.length,1);
  const another=await reconcilePendingPlanInvoices(t.database,t.provider,{owner:'unrelated'});assert.equal(another.scanned,0);
 });
 await check('Viewer invoices can be read but deadline mismatches and stale versions cannot create provider effects',async t=>{
  await assert.rejects(t.invoices.create(await t.scope(t.identity),{...await t.input(),dueAt:'2027-04-05T18:00:00-04:00'}),e=>e.code==='INVOICE_DEADLINE');assert.equal(t.calls.length,0);
  const invalid=await t.input();invalid.dueAt='2027-04-05T02:00:00+00:00'; // still Apr 4 in Toronto
  assert.equal((await t.invoices.create(await t.scope(t.identity),invalid)).status,'draft');
  const invoice=(await t.invoices.list(await t.scope(t.identity)))[0];
  await assert.rejects(t.invoices.act(await t.scope(t.identity),invoice.id,{version:(await t.scope(t.identity)).record.version,invoiceVersion:invoice.version+1,action:'reconcile'}),e=>e.code==='VERSION_CONFLICT');
  const old=t.database.sqlite.prepare("SELECT body FROM plans WHERE owner=? AND id=?").get('invoice-owner',t.id);
  const parsed=JSON.parse(old.body);parsed.items[0].expires='2000-01-01T00:00:00Z';t.database.sqlite.prepare('UPDATE plans SET body=? WHERE owner=? AND id=?').run(JSON.stringify(parsed),'invoice-owner',t.id);
  const again=await t.invoices.create(await t.scope(t.identity),invalid);assert.equal(again.id,invoice.id);
 });
 await check('A plan edit during provider lookup fences a stale invoice notification',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());invoice=await t.action(invoice,'approve',t.buyer);
  t.hooks.call=async(path,method)=>{if(method==='GET'){t.hooks.call=null;const workspace=await t.plans.loadWorkspace('invoice-owner');workspace.plan.name='Changed while reading provider';await t.plans.saveWorkspace('invoice-owner',workspace,workspace.version);}};
  await assert.rejects(t.action(invoice,'send'),e=>e.code==='VERSION_CONFLICT');assert.equal(t.calls.filter(call=>call.path.endsWith('/send')).length,0);
 });
 await check('Cancellation is explicit, does not create a refund, and rejects paid invoices',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());invoice=await t.action(invoice,'cancel');assert.equal(invoice.status,'cancelled');
  assert.equal(t.calls.filter(c=>c.method==='DELETE').length,1);assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,0);
 });
 await check('Invoice payment and domain state roll back together on an atomic ledger failure',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());t.pay([2500],'PARTIALLY_PAID');
  const original=t.database.batch.bind(t.database);t.database.batch=async statements=>{
   if(statements.some(s=>s.sql.includes('UPDATE plan_invoices SET paid=paid+'))){
    return original([...statements,t.database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES ('forced-invoice-failure',0)")]);
   }return original(statements);
  };
  await assert.rejects(t.action(invoice,'reconcile'));t.database.batch=original;
  assert.equal((await t.invoices.get(await t.scope(t.identity),invoice.id)).paid,0);assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,0);
  assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) AS count FROM plan_invoice_payments').get().count,0);
  invoice=await t.action(invoice,'reconcile');assert.equal(invoice.paid,2500);
 });
 await check('An interrupted final invoice status update safely resumes an already committed payment',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());t.pay([2500],'PARTIALLY_PAID');
  const original=t.database.batch.bind(t.database);t.database.batch=async statements=>{
   if(statements.some(s=>s.sql.includes('UPDATE plan_invoices SET status=?,lifecycle_status=?,provider_status=?,provider_url=')))throw Error('Fixture metadata write timeout');
   return original(statements);
  };
  await assert.rejects(t.action(invoice,'reconcile'),/metadata write timeout/);t.database.batch=original;
  invoice=await t.invoices.get(await t.scope(t.identity),invoice.id);assert.equal(invoice.paid,2500);assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,1);
  invoice=await t.action(invoice,'reconcile');assert.equal(invoice.paid,2500);assert.equal((await t.plans.getPlan(t.id,t.identity)).state.events.length,1);
 });
 await check('HTTP invoice routes enforce identity, origins, private views and bounded strict input before provider calls',async t=>{
  const origin='https://planrecover.test',context={params:Promise.resolve({planId:t.id})};
  const request=(method,account='invoice-owner',body,requestOrigin=origin)=>new Request(`${origin}/api/plans/${t.id}/invoices`,{method,
   headers:{...(account?{'oai-authenticated-user-id':account}:{}),origin:requestOrigin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await routes.list.GET(request('GET',null),context)).status,401);
  assert.equal((await routes.list.GET(request('GET','unrelated'),context)).status,404);
  assert.equal((await routes.list.POST(request('POST','invoice-owner',await t.input(),'https://other.test'),context)).status,400);
  assert.equal((await routes.list.POST(request('POST','invoice-owner',{...await t.input(),amount:1}),context)).status,400);
  assert.equal((await routes.list.POST(request('POST','invoice-owner',{padding:'x'.repeat(11000)}),context)).status,413);
  assert.equal(invoiceCreateRequest.safeParse({...await t.input(),due:'2027-02-30'}).success,false);
  assert.equal(invoiceCreateRequest.safeParse({...await t.input(),minimum:0.5}).success,false);
  const invoice=await t.invoices.create(await t.scope(t.identity),await t.input());
  const other=await routes.list.GET(request('GET','invoice-other'),context);assert.equal(other.headers.get('cache-control'),'private, no-store');assert.deepEqual(await other.json(),{invoices:[]});
  const own=await routes.list.GET(request('GET','invoice-buyer'),context);const parsed=await own.json();assert.equal(parsed.invoices[0].id,invoice.id);
  const viewer=t.database.sqlite.prepare("UPDATE plan_members SET role='viewer' WHERE owner=? AND plan_id=? AND member_id=?");viewer.run('invoice-owner',t.id,t.buyer.id);
  const actionContext={params:Promise.resolve({planId:t.id,invoiceId:invoice.id})};
  assert.equal((await routes.action.POST(request('POST','invoice-buyer',{version:(await t.scope(t.buyer)).record.version,invoiceVersion:invoice.version,action:'reconcile'}),actionContext)).status,403);
 });
 await check('Invoice refunds require owner and payer review, import genuine canonical evidence once, and retain gross payments',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());invoice=await t.action(invoice,'approve',t.buyer);invoice=await t.action(invoice,'send');t.pay([10000],'PAID');invoice=await t.action(invoice,'reconcile');
  const refunds=new InvoiceRefundService(t.database),request=await refunds.act(t.id,t.identity,{action:'prepare',invoiceId:invoice.id,requestId:crypto.randomUUID(),amount:3000,reason:'Approved partial cancellation',version:(await t.scope(t.identity)).record.version});
  await assert.rejects(refunds.act(t.id,t.identity,{action:'handoff',id:request.id,confirm:true}),e=>e.code==='REFUND_APPROVALS');await refunds.act(t.id,t.identity,{action:'approve',id:request.id,confirm:true});await refunds.act(t.id,t.buyer,{action:'approve',id:request.id,confirm:true});
  const before=t.calls.length,handoff=await refunds.act(t.id,t.identity,{action:'handoff',id:request.id,confirm:true});assert.equal(handoff.status,'awaiting-merchant');assert.equal(t.calls.length,before);assert.deepEqual(await refunds.list(t.id,t.other),[]);
  const provider=t.providerInvoices.get('INV2-TEST-0001');provider.status='PARTIALLY_REFUNDED';provider.refunds={refund_amount:{currency_code:'CAD',value:'30.00'},transactions:[{type:'PAYPAL',refund_id:'INVOICE-REFUND-1',amount:{currency_code:'CAD',value:'30.00'}}]};provider.due_amount.value='0.00';invoice=await t.action(invoice,'reconcile');invoice=await t.action(invoice,'reconcile');
  const state=(await t.scope(t.buyer)).record.state;assert.equal(personalMoney(state,t.buyer.id).cost,7000);assert.equal(state.events.filter(e=>e.kind==='refund').length,1);assert.equal(t.database.sqlite.prepare('SELECT paid FROM plan_invoices').get().paid,10000);assert.equal(t.database.sqlite.prepare('SELECT status FROM invoice_refund_requests').get().status,'completed');
  provider.refunds.transactions[0].amount.value='40.00';await assert.rejects(t.action(invoice,'reconcile'),e=>e.code==='INVOICE_EVIDENCE');assert.equal((await t.scope(t.buyer)).record.state.events.filter(e=>e.kind==='refund').length,1);
 });
 await check('Concurrent approved invoice refund intents consume distinct evidence and reserve only their unrefunded remainder',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());t.pay([10000],'PAID');invoice=await t.action(invoice,'reconcile');
  const service=new InvoiceRefundService(t.database),inputs=[];
  for(let index=0;index<2;index++){
   const input={action:'prepare',invoiceId:invoice.id,requestId:crypto.randomUUID(),amount:1000,reason:`Reviewed refund ${index+1}`,version:(await t.scope(t.identity)).record.version};inputs.push(input);
   const request=await service.act(t.id,t.identity,input);for(const member of [t.identity,t.buyer])await service.act(t.id,member,{action:'approve',id:request.id,confirm:true});await service.act(t.id,t.identity,{action:'handoff',id:request.id,confirm:true});
  }
  // Simulate pre-migration request progress that claimed completion without a
  // finite allocation. Projection and handoff must not trust that old status.
  t.database.sqlite.exec("UPDATE invoice_refund_requests SET status='completed'");
  assert.ok((await service.list(t.id,t.identity)).every(request=>request.status==='awaiting-merchant'));
  assert.equal((await service.act(t.id,t.identity,{action:'handoff',id:inputs[0].requestId,confirm:true})).status,'awaiting-merchant');
  const provider=t.providerInvoices.get('INV2-TEST-0001');provider.status='PARTIALLY_REFUNDED';provider.due_amount.value='0.00';provider.refunds={refund_amount:{currency_code:'CAD',value:'10.00'},transactions:[{type:'PAYPAL',refund_id:'UNIQUE-REFUND-1',amount:{currency_code:'CAD',value:'10.00'}}]};
  invoice=await t.action(invoice,'reconcile');invoice=await t.action(invoice,'reconcile');assert.equal(t.database.sqlite.prepare("SELECT COUNT(*) n FROM invoice_refund_requests WHERE status='completed'").get().n,1);
  provider.refunds.transactions.push({type:'PAYPAL',refund_id:'UNIQUE-REFUND-2',amount:{currency_code:'CAD',value:'5.00'}});provider.refunds.refund_amount.value='15.00';invoice=await t.action(invoice,'reconcile');
  await service.act(t.id,t.identity,{action:'prepare',invoiceId:invoice.id,requestId:crypto.randomUUID(),amount:8000,reason:'Reserve the remaining refundable balance',version:(await t.scope(t.identity)).record.version});
  assert.equal(t.database.sqlite.prepare('SELECT SUM(amount) n FROM invoice_refund_allocations').get().n,1500);
  assert.equal((await service.act(t.id,t.identity,{...inputs[0],version:(await t.scope(t.identity)).record.version})).id,inputs[0].requestId);
  provider.refunds.transactions.push({type:'PAYPAL',refund_id:'UNIQUE-REFUND-3',amount:{currency_code:'CAD',value:'5.00'}});provider.refunds.refund_amount.value='20.00';invoice=await t.action(invoice,'reconcile');invoice=await t.action(invoice,'reconcile');
  assert.equal(t.database.sqlite.prepare("SELECT COUNT(*) n FROM invoice_refund_requests WHERE status='completed'").get().n,2);assert.equal(t.database.sqlite.prepare('SELECT SUM(amount) n FROM invoice_refund_allocations').get().n,2000);assert.equal((await t.scope(t.buyer)).record.state.events.filter(e=>e.kind==='refund').length,3);
 });
 await check('A partial invoice closes only after approved merchant revision; departure retains deposit and bills only the unpaid balance',async t=>{
  const root=await t.plans.loadWorkspace('invoice-owner'),item=root.items[0];item.price=20000;item.participants=[t.identity.id,t.buyer.id];item.shares={[t.identity.id]:10000,[t.buyer.id]:10000};item.required=[t.identity.id,t.buyer.id];item.approvals=[t.identity.id,t.buyer.id];item.revision++;await t.plans.saveWorkspace('invoice-owner',root,root.version);
  let invoice=await t.invoices.create(await t.scope(t.identity),{...await t.input(),revision:2});invoice=await t.action(invoice,'approve',t.buyer);invoice=await t.action(invoice,'send');t.pay([2500],'PARTIALLY_PAID');invoice=await t.action(invoice,'reconcile');
  const service=new PlanChangeService(t.database),record=(await t.scope(t.identity)).record,change=await service.propose(t.id,t.identity,{type:'departure',version:record.version,memberId:t.buyer.id});for(const member of [t.identity,t.buyer])await service.act(t.id,member,{type:'approve',changeId:change.id,version:record.version,confirm:true});
  await assert.rejects(service.act(t.id,t.identity,{type:'apply',changeId:change.id,version:record.version,confirm:true}),e=>e.code==='CHANGE_PAYMENTS');
  await new InvoiceRefundService(t.database).act(t.id,t.identity,{action:'close-collection',invoiceId:invoice.id,changeId:change.id,confirm:true});
  // Reading the unchanged partial invoice cannot falsely verify closure.
  invoice=await t.action(invoice,'reconcile');assert.equal(invoice.status,'partially-paid');assert.equal(t.database.sqlite.prepare('SELECT status FROM invoice_collection_closures').get().status,'awaiting-merchant');
  const provider=t.providerInvoices.get('INV2-TEST-0001');provider.items[0].unit_amount.value='25.00';provider.amount.value='25.00';provider.due_amount.value='0.00';provider.status='PAID';provider.configuration.partial_payment={allow_partial_payment:false};invoice=await t.action(invoice,'reconcile');assert.equal(invoice.status,'closed');assert.equal(invoice.outstanding,0);
  await service.act(t.id,t.identity,{type:'apply',changeId:change.id,version:(await t.scope(t.identity)).record.version,confirm:true});const after=(await t.scope(t.identity)).record.state;assert.equal(after.items[0].collection.due[t.identity.id],17500);assert.equal(after.events.filter(e=>e.kind==='expense').length,1);assert.equal(after.events[0].contributions[t.buyer.id],2500);assert.equal(personalMoney(after,t.identity.id).projected,20000);
 });
 await check('Invoice recovery cannot close from aggregate refunds allocated to a different legacy intent',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());t.pay([10000],'PAID');invoice=await t.action(invoice,'reconcile');
  const disabled=async()=>{throw Error('Invoice refunds never use a capture refund API');},service=new RecoveryService({database:t.database,fetchOrder:disabled,fetchCapture:disabled,fetchRefund:disabled,createRefund:disabled,commitRefund:input=>commitFinancialEffect(t.database,{owner:input.owner,planId:input.planId,event:input.event,statements:input.statements}),cancelBooking:input=>cancelRecoveredBooking(t.database,input)}),scope={owner:'invoice-owner',planId:t.id,memberId:t.identity.id};
  const policy=await service.registerPolicy(scope,{type:'register-policy',version:(await t.scope(t.identity)).record.version,itemId:'rental',revision:1,policy:{merchant:'fictional-sandbox',merchantName:'Fictional merchant',confirmedTerms:true,terms:'80 percent refundable',evidence:'Checked fictional terms',sourceUrl:'https://merchant.example.com/terms',refundableBps:8000,cancellationFeeUnits:0,cutoff:null}});
  let recovery=await service.propose(scope,{type:'propose',version:(await t.scope(t.identity)).record.version,policyId:policy.id,reason:'Approved cancellation'});recovery=await service.approve({...scope,memberId:t.buyer.id},{type:'approve',proposalId:recovery.id,version:recovery.version,planVersion:(await t.scope(t.buyer)).record.version});
  const execute=()=>service.execute(scope,{type:'execute',proposalId:recovery.id,version:recovery.version,planVersion:t.database.sqlite.prepare('SELECT version FROM plans WHERE owner=? AND id=?').get('invoice-owner',t.id).version,confirmSandboxRefunds:true});assert.ok((await execute()).invoiceRefundRequired);
  // A legacy progress claim predating this recovery shares its refund baseline.
  await t.database.prepare("INSERT INTO invoice_refund_requests(id,owner,plan_id,invoice_id,member_id,amount,currency,terms,status,created,approved_owner,approved_member) VALUES (?,'invoice-owner',?,?,?,1000,'CAD',?,'completed','2000-01-01T00:00:00Z',1,1)").bind(crypto.randomUUID(),t.id,invoice.id,t.buyer.id,JSON.stringify({previousRefunds:[]})).run();
  const provider=t.providerInvoices.get('INV2-TEST-0001');provider.status='PARTIALLY_REFUNDED';provider.due_amount.value='0.00';provider.refunds={refund_amount:{currency_code:'CAD',value:'80.00'},transactions:[{type:'PAYPAL',refund_id:'LEGACY-SHARED-REFUND',amount:{currency_code:'CAD',value:'80.00'}}]};invoice=await t.action(invoice,'reconcile');
  assert.equal(t.database.sqlite.prepare('SELECT SUM(amount) n FROM invoice_refunds').get().n,8000);assert.equal(t.database.sqlite.prepare('SELECT SUM(amount) n FROM invoice_refund_allocations WHERE request_id=?').get(recovery.snapshot.invoiceRefunds[0].id).n,7000);
  assert.ok((await execute()).invoiceRefundRequired);await finalizeConfirmedRecoveries(t.database,{owner:'invoice-owner'});assert.notEqual((await t.scope(t.identity)).record.state.items[0].status,'cancelled');
 });
 await check('Invoice-funded recovery pauses at merchant refund, survives background checks, then completes from verified invoice refunds',async t=>{
  let invoice=await t.invoices.create(await t.scope(t.identity),await t.input());invoice=await t.action(invoice,'approve',t.buyer);invoice=await t.action(invoice,'send');t.pay([10000],'PAID');invoice=await t.action(invoice,'reconcile');
  const forbiddenProvider=async()=>{throw Error('Invoice refunds must not use a checkout capture API');},service=new RecoveryService({database:t.database,fetchOrder:forbiddenProvider,fetchCapture:forbiddenProvider,fetchRefund:forbiddenProvider,createRefund:forbiddenProvider,commitRefund:input=>commitFinancialEffect(t.database,{owner:input.owner,planId:input.planId,event:input.event,statements:input.statements}),cancelBooking:input=>cancelRecoveredBooking(t.database,input)}),scope={owner:'invoice-owner',planId:t.id,memberId:t.identity.id};
  const policy=await service.registerPolicy(scope,{type:'register-policy',version:(await t.scope(t.identity)).record.version,itemId:'rental',revision:1,policy:{merchant:'fictional-sandbox',merchantName:'Fictional merchant',confirmedTerms:true,terms:'80 percent refundable',evidence:'Checked fictional terms',sourceUrl:'https://merchant.example.com/terms',refundableBps:8000,cancellationFeeUnits:0,cutoff:null}});
  let recovery=await service.propose(scope,{type:'propose',version:(await t.scope(t.identity)).record.version,policyId:policy.id,reason:'Approved cancellation'});assert.equal(recovery.snapshot.invoiceRefunds[0].amount,8000);
  recovery=await service.approve({...scope,memberId:t.buyer.id},{type:'approve',proposalId:recovery.id,version:recovery.version,planVersion:(await t.scope(t.buyer)).record.version});const execute=()=>service.execute(scope,{type:'execute',proposalId:recovery.id,version:recovery.version,planVersion:t.database.sqlite.prepare('SELECT version FROM plans WHERE owner=? AND id=?').get('invoice-owner',t.id).version,confirmSandboxRefunds:true});
  const waiting=await execute();assert.ok(waiting.invoiceRefundRequired);await finalizeConfirmedRecoveries(t.database,{owner:'invoice-owner'});assert.notEqual((await t.scope(t.identity)).record.state.items[0].status,'cancelled');
  const provider=t.providerInvoices.get('INV2-TEST-0001');provider.status='PARTIALLY_REFUNDED';provider.due_amount.value='0.00';provider.refunds={refund_amount:{currency_code:'CAD',value:'80.00'},transactions:[{type:'PAYPAL',refund_id:'RECOVERY-INVOICE-REFUND',amount:{currency_code:'CAD',value:'80.00'}}]};invoice=await t.action(invoice,'reconcile');
  assert.equal((await execute()).status,'completed');assert.equal((await execute()).status,'completed');const state=(await t.scope(t.identity)).record.state;assert.equal(state.items[0].status,'cancelled');assert.equal(personalMoney(state,t.buyer.id).cost,2000);assert.equal(state.events.filter(e=>e.kind==='refund').length,1);
 });
 console.log(`Backend invoices: ${passed} checks passed.`);
}finally{rmSync(directory,{recursive:true,force:true});}
