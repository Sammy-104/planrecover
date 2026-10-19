import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {applyAction,personalMoney} from '../lib/model.ts';
import {PlanInvoiceRepository,invoiceFinancialEffects} from '../lib/plan-invoices.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-checkout-'));
const origin='https://planrecover.test',accounts={owner:'checkout-owner',buyer:'checkout-buyer',viewer:'checkout-viewer',other:'checkout-other'};
const people=Object.fromEntries(await Promise.all(Object.entries(accounts).map(async([name,account])=>[name,{id:await accountPersonId(account),name}])));
const planInput=name=>({kind:'day-out',name,destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:50000});
globalThis.checkoutTestEnv={DB:undefined,PAYPAL_CLIENT_ID:'fixture-client-id',PAYPAL_CLIENT_SECRET:'fixture-client-secret'};
let providerFixture,checks=0,networkCalls=0;

// No host other than the sandbox is accepted. All responses are local fixtures.
globalThis.fetch=async(url,options={})=>{
 networkCalls++;const parsed=new URL(String(url));assert.equal(parsed.origin,'https://api-m.sandbox.paypal.com','Live provider endpoints are prohibited.');
 if(parsed.pathname==='/v1/oauth2/token'){assert.equal(options.method,'POST');return Response.json({access_token:'fixture-access-token'});}
 assert.ok(providerFixture,'No fixture provider configured');return providerFixture(parsed.pathname,options);
};
const routes={};
try{
 for(const [name,path] of Object.entries({quote:'app/api/plans/[planId]/merchant-quotes/route.ts',checkout:'app/api/plans/[planId]/checkout/route.ts',legacy:'app/api/paypal/[action]/route.ts',plan:'app/api/plans/[planId]/route.ts',sharing:'app/api/trip-share/route.ts'})){
  const outfile=join(directory,`${name}.mjs`);await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),
   plugins:[{name:'binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.checkoutTestEnv;',loader:'js'}));}}]});
  routes[name]=await import(pathToFileURL(outfile).href);
 }
 const context=planId=>({params:Promise.resolve({planId})}),legacyContext=action=>({params:Promise.resolve({action})});
 function request(path,body,{account=accounts.owner,token,method='POST',requestOrigin=origin,raw}={}){
  return new Request(`${origin}${path}`,{method,headers:{'content-type':'application/json',origin:requestOrigin,...(account?{'oai-authenticated-user-id':account}:{}),...(token?{'x-trip-share':token}:{})},
   ...(method==='GET'?{}:{body:raw??JSON.stringify(body)})});
 }
 async function decoded(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));if(status<300)assert.match(response.headers.get('cache-control'),/private, no-store/);return data;}
 async function rejected(response){const data=await response.json();assert.ok(response.status>=400,JSON.stringify(data));assert.ok(data.error);return data;}
 async function fixture(){
  const database=createTestD1(),plans=new PlanRepository(database),record=await plans.createPlan(accounts.owner,people.owner,planInput('Checkout plan'));
  const workspace=await plans.loadWorkspace(accounts.owner);addPerson(workspace,people.buyer,'editor');addPerson(workspace,people.viewer,'viewer');addPerson(workspace,people.other,'editor');
  await plans.saveWorkspace(accounts.owner,workspace,workspace.version);
  const orders=new Map(),calls=[],hooks={},failures={captureResponse:0},id=record.state.plan.id;
  providerFixture=async(path,options)=>{
   const method=options.method??'GET',body=options.body===undefined?undefined:JSON.parse(options.body);calls.push({path,method,body,key:options.headers?.['PayPal-Request-Id']});
   if(hooks.provider)await hooks.provider(path,method,body);
   if(path==='/v2/checkout/orders'&&method==='POST'){
    const orderId=`ORDER${String(orders.size+1).padStart(6,'0')}`,order={id:orderId,status:'CREATED',purchase_units:structuredClone(body.purchase_units)};
    orders.set(orderId,order);return Response.json(order);
   }
   const match=/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/.exec(path);assert.ok(match,`Unsupported fixture path ${method} ${path}`);
   const order=orders.get(match[1]);assert.ok(order,'Missing local fixture order');
   if(method==='GET'&&!match[2]){if(hooks.orderGet)return Response.json(await hooks.orderGet(structuredClone(order)));return Response.json(order);}
   if(method==='POST'&&match[2]){
    assert.equal(order.status,'APPROVED');order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:`CAPTURE${match[1].slice(5)}`,status:'COMPLETED',amount:structuredClone(order.purchase_units[0].amount)}]};
    if(failures.captureResponse>0){failures.captureResponse--;throw Error('Fixture capture response was lost after provider success.');}
    return Response.json(order);
   }
   throw Error(`Unsupported fixture request ${method} ${path}`);
  };
  globalThis.checkoutTestEnv.DB=database;
  const current=async(person=people.owner)=>plans.getPlan(id,person);
  async function quote({participants=[people.owner.id,people.buyer.id],account=accounts.owner,bodyOverrides={}}={}){
   const before=await current(people[Object.entries(accounts).find(([,value])=>value===account)?.[0]??'owner']);
   return routes.quote.POST(request(`/api/plans/${id}/merchant-quotes`,{version:before.version,catalogId:'museum',start:'2027-04-04T14:00:00-04:00',participants,...bodyOverrides},{account}),context(id));
  }
  async function approvedQuote(participants=[people.owner.id,people.buyer.id]){
   const data=await decoded(await quote({participants})),item=data.state.items.at(-1);
   for(const memberId of participants){const person=Object.values(people).find(value=>value.id===memberId),account=accounts[person.name],latest=await current(person);
    await decoded(await routes.plan.PATCH(request(`/api/plans/${id}`,
     {version:latest.version,action:{type:'approve_item',itemId:item.id,revision:item.revision}},{account,method:'PATCH'}),context(id)));
   }
   return (await current()).state.items.find(value=>value.id===item.id);
  }
  async function create(item,person=people.owner,options={}){
   const before=await current(person),account=accounts[person.name];
   return routes.checkout.POST(request(`/api/plans/${id}/checkout`,{operation:'create',itemId:item.id,revision:item.revision,version:before.version,...options.bodyOverrides},{account,...options}),context(id));
  }
  const capture=(orderId,person=people.owner,options={})=>routes.checkout.POST(request(`/api/plans/${id}/checkout`,{operation:'capture',orderId,...options.bodyOverrides},{account:accounts[person.name],...options}),context(id));
  async function share(role='editor'){return decoded(await routes.sharing.POST(request('/api/trip-share',{tripId:id,operation:'create',role})));}
  const legacy=(action,body,person=people.owner,options={})=>routes.legacy.POST(request(`/api/paypal/${action}`,body,{account:accounts[person.name],...options}),legacyContext(action));
  return {database,plans,id,current,quote,approvedQuote,create,capture,share,legacy,orders,calls,hooks,failures};
 }
 async function check(name,run){const test=await fixture();try{await run(test);checks++;console.log(`PASS ${name}`);}finally{test.database.close();globalThis.checkoutTestEnv.DB=undefined;providerFixture=undefined;}}
 const capturePosts=test=>test.calls.filter(call=>call.path.endsWith('/capture')&&call.method==='POST');
 const orderPosts=test=>test.calls.filter(call=>call.path==='/v2/checkout/orders'&&call.method==='POST');
 async function approvedOrder(test,item,person=people.owner){const data=await decoded(await test.create(item,person));test.orders.get(data.orderId).status='APPROVED';return data;}
 async function captureHistory(test,captureId){return test.database.prepare('SELECT * FROM financial_event_history WHERE owner=? AND plan_id=? AND event_id=?').bind(accounts.owner,test.id,`paypal-${captureId}`).all();}
 async function groupQuote(test,payer=people.buyer){let item=await test.approvedQuote(),record=await test.current();const draft=await decoded(await routes.plan.PATCH(request(`/api/plans/${test.id}`,{version:record.version,action:{type:'item_funding',itemId:item.id,revision:item.revision,mode:'whole-group',payerId:payer.id,confirm:true}},{method:'PATCH'}),context(test.id)));item=draft.state.items.find(value=>value.id===item.id);assert.equal(item.revision,2);assert.deepEqual(item.approvals,[]);for(const person of [people.owner,people.buyer]){record=await test.current(person);await decoded(await routes.plan.PATCH(request(`/api/plans/${test.id}`,{version:record.version,action:{type:'approve_item',itemId:item.id,revision:item.revision}},{account:accounts[person.name],method:'PATCH'}),context(test.id)));}return(await test.current()).state.items.find(value=>value.id===item.id);}

 await check('Only owners create fictional quotes and quote creation preserves active, archived and deleted plans',async t=>{
  const archived=await t.plans.createPlan(accounts.owner,people.owner,planInput('Archive to preserve'));
  const deleted=await t.plans.createPlan(accounts.owner,people.owner,planInput('Deleted to preserve'));
  const active=await t.plans.createPlan(accounts.owner,people.owner,planInput('Current active'));
  let workspace=await t.plans.loadWorkspace(accounts.owner);workspace=applyAction(workspace,{type:'delete_trip',actor:people.owner.id,deleteTripId:deleted.state.plan.id,confirmed:true});
  await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);const before=await t.plans.loadWorkspace(accounts.owner),record=await t.current();
  const response=await decoded(await routes.quote.POST(request(`/api/plans/${t.id}/merchant-quotes`,{version:record.version,catalogId:'museum',start:'2027-04-04T14:00:00-04:00',participants:[people.owner.id,people.buyer.id]}),context(t.id)));
  const after=await t.plans.loadWorkspace(accounts.owner);assert.equal(after.plan.id,active.state.plan.id);assert.deepEqual(after.items,before.items);
  assert.deepEqual(after.deletedTrips,before.deletedTrips);assert.deepEqual(after.archives.find(value=>value.workspace.plan.id===archived.state.plan.id),before.archives.find(value=>value.workspace.plan.id===archived.state.plan.id));
  assert.equal(after.archives.find(value=>value.workspace.plan.id===t.id).workspace.items.length,1);assert.equal(response.state.items[0].price,3200);
  assert.match(response.state.items[0].source,/Explicit fictional sandbox quote/);assert.deepEqual(response.state.items[0].approvals,[]);assert.equal(t.calls.length,0);
  await decoded(await t.quote({account:accounts.buyer}),403);await decoded(await t.quote({account:accounts.viewer}),403);
  assert.equal(t.calls.length,0);
 });
 await check('Quote inputs cannot spoof prices or approvals and stale versions never change the plan',async t=>{
  const initial=await t.current();await rejected(await t.quote({bodyOverrides:{price:1,approvals:[people.owner.id]}}));
  await decoded(await t.quote({bodyOverrides:{version:initial.version+1}}),409);
  assert.deepEqual((await t.current()).state.items,[]);assert.equal(t.calls.length,0);
 });
 await check('New checkout rejects spoofed actors, viewer accounts and unpaid approvals before any provider call',async t=>{
  const item=await t.approvedQuote();
  await decoded(await t.create(item,people.owner,{bodyOverrides:{actor:people.viewer.id}}),400);
  await decoded(await t.create(item,people.viewer),403);
  const draft=await decoded(await t.quote({participants:[people.owner.id]}));await decoded(await t.create(draft.state.items.at(-1)),400);assert.equal(t.calls.length,0);
 });
 await check('Only the signed-in participating editor creates its exact approved share through the plan API',async t=>{
  const item=await t.approvedQuote(),created=await approvedOrder(t,item,people.buyer),op=await t.database.prepare('SELECT * FROM provider_operations WHERE id=?').bind(created.operationId).first();
  assert.equal(op.member,people.buyer.id);assert.equal(op.amount,1600);assert.equal(op.owner,accounts.owner);
  assert.equal(orderPosts(t)[0].body.purchase_units[0].amount.value,'16.00');assert.equal(orderPosts(t)[0].body.purchase_units[0].amount.currency_code,'CAD');
  await decoded(await t.create(item,people.other),400);await decoded(await t.capture(created.orderId,people.owner),404);
  assert.equal(capturePosts(t).length,0);
  const data=await decoded(await t.capture(created.orderId,people.buyer));assert.equal(data.captureId,'CAPTURE000001');
  const state=(await t.current(people.buyer)).state;assert.deepEqual(state.events[0].shares,{[people.buyer.id]:1600});assert.deepEqual(state.items[0].paid,[people.buyer.id]);assert.equal(state.items[0].booking,'unconfirmed');
 });
 await check('Sequential members each pay their own remaining share without recording the full item twice',async t=>{
  const item=await t.approvedQuote(),first=await approvedOrder(t,item,people.owner);
  await decoded(await t.capture(first.orderId,people.owner));
  let workspace=await t.plans.loadWorkspace(accounts.owner),currentItem=workspace.items.find(value=>value.id===item.id);
  assert.equal(currentItem.status,'awaiting-payment');assert.deepEqual(currentItem.paid,[people.owner.id]);
  assert.equal(personalMoney(workspace,people.owner.id).cost,1600);assert.equal(personalMoney(workspace,people.owner.id).merchantDue,0);
  assert.equal(personalMoney(workspace,people.buyer.id).cost,0);assert.equal(personalMoney(workspace,people.buyer.id).merchantDue,1600);
  const second=await approvedOrder(t,item,people.buyer);await decoded(await t.capture(second.orderId,people.buyer));
  workspace=await t.plans.loadWorkspace(accounts.owner);currentItem=workspace.items.find(value=>value.id===item.id);
  assert.equal(currentItem.status,'scheduled');assert.deepEqual([...currentItem.paid].sort(),[people.owner.id,people.buyer.id].sort());
  assert.equal(workspace.events.length,2);assert.equal(workspace.events.reduce((sum,event)=>sum+event.amount,0),item.price);
  assert.deepEqual(workspace.events.map(event=>event.amount),[1600,1600]);
  for(const member of [people.owner,people.buyer]){const money=personalMoney(workspace,member.id);assert.equal(money.cost,1600);assert.equal(money.contribution,1600);assert.equal(money.merchantDue,0);assert.equal(money.planned,0);}
  await decoded(await t.capture(first.orderId,people.owner));await decoded(await t.capture(second.orderId,people.buyer));
  assert.equal(capturePosts(t).length,2);assert.equal((await t.current()).state.events.length,2);
  assert.equal((await captureHistory(t,'CAPTURE000001')).results.length,1);assert.equal((await captureHistory(t,'CAPTURE000002')).results.length,1);
  assert.equal(await t.database.prepare("SELECT COUNT(*) AS count FROM financial_events WHERE owner=? AND plan_id=? AND kind='expense'").bind(accounts.owner,t.id).first('count'),2);
 });
 await check('A linked manual receipt cannot record another expense while the same item has an active checkout funding claim',async t=>{
  const item=await t.approvedQuote([people.owner.id]);await approvedOrder(t,item,people.owner);
  let record=await t.current();const receipt={merchant:'Fictional merchant manual receipt',date:'2027-04-04',rows:[{id:'line-1',name:item.name,amount:1600,claims:[people.owner.id]}],
   tax:0,tip:0,discount:0,total:1600,payer:people.owner.id,paymentConfirmed:true,tipRule:'equal',linkedItemId:item.id};
  const saved=await decoded(await routes.plan.PATCH(request(`/api/plans/${t.id}`,{version:record.version,action:{type:'receipt',receipt}},{method:'PATCH'}),context(t.id)));
  assert.equal(saved.state.receipts.length,1);assert.equal(saved.state.events.length,0);
  record=await t.current();const before=await t.plans.loadWorkspace(accounts.owner),pending=record.state.receipts[0];
  await decoded(await routes.plan.PATCH(request(`/api/plans/${t.id}`,{version:record.version,action:{type:'approve_receipt',receiptId:pending.id,revision:pending.revision}},{method:'PATCH'}),context(t.id)),409);
  assert.deepEqual(await t.plans.loadWorkspace(accounts.owner),before,'Receipt approval, ledger and plan version all roll back together');
  assert.equal((await t.current()).state.events.length,0);
  assert.equal(await t.database.prepare('SELECT COUNT(*) AS count FROM financial_event_history WHERE owner=? AND plan_id=?').bind(accounts.owner,t.id).first('count'),0);
  assert.equal(await t.database.prepare('SELECT COUNT(*) AS count FROM financial_events WHERE owner=? AND plan_id=?').bind(accounts.owner,t.id).first('count'),0);
  assert.equal(capturePosts(t).length,0);assert.equal(orderPosts(t).length,1);
 });
 await check('Legacy shared checkout binds the editor’s payer identity and denies actor spoofing and viewer links',async t=>{
  const item=await t.approvedQuote(),editor=await t.share('editor'),viewer=await t.share('viewer'),body={itemId:item.id,revision:item.revision,tripId:t.id};
  await decoded(await t.legacy('create',{...body,actor:people.owner.id},people.buyer,{token:editor.token}),403);
  await decoded(await t.legacy('create',body,people.buyer,{token:viewer.token}),403);assert.equal(t.calls.length,0);
  const created=await decoded(await t.legacy('create',body,people.buyer,{token:editor.token}));t.orders.get(created.orderId).status='APPROVED';
  const op=await t.database.prepare('SELECT * FROM provider_operations WHERE provider_id=?').bind(created.orderId).first();assert.equal(op.member,people.buyer.id);
  const paid=await decoded(await t.legacy('capture',{orderId:created.orderId,tripId:t.id},people.buyer,{token:editor.token}));assert.equal(paid.captureId,'CAPTURE000001');assert.equal(paid.state.plan.id,t.id);
  assert.equal(paid.state.events.length,1);assert.equal(paid.state.archives.length,0);assert.equal(paid.state.deletedTrips.length,0);
 });
 await check('Canonical GET verifies order ID, unit identity, currency, amount and approved status before capture POST',async t=>{
  const item=await t.approvedQuote(),created=await approvedOrder(t,item);
  for(const mutate of [order=>order.id='OTHERORDER',order=>order.status='CREATED',order=>order.purchase_units.push(structuredClone(order.purchase_units[0])),
   order=>order.purchase_units[0].reference_id='other-item',order=>order.purchase_units[0].custom_id='other-operation',
   order=>order.purchase_units[0].amount.currency_code='USD',order=>order.purchase_units[0].amount.value='15.99',order=>order.purchase_units[0].amount.value='16.000']){
   t.hooks.orderGet=order=>{mutate(order);return order;};await rejected(await t.capture(created.orderId));assert.equal(capturePosts(t).length,0);assert.equal((await t.current()).state.events.length,0);
  }
  delete t.hooks.orderGet;await decoded(await t.capture(created.orderId));
  const relevant=t.calls.filter(call=>call.path.includes(created.orderId));assert.equal(relevant.at(-2).method,'GET');assert.equal(relevant.at(-1).method,'POST');assert.ok(relevant.at(-1).key);
 });
 await check('Changed approval during canonical GET blocks a subsequent financial POST',async t=>{
  const item=await t.approvedQuote(),created=await approvedOrder(t,item);
  t.hooks.orderGet=async order=>{const workspace=await t.plans.loadWorkspace(accounts.owner);const changed=workspace.items.find(value=>value.id===item.id);changed.revision++;changed.approvals=[];changed.status='draft';await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);return order;};
  await decoded(await t.capture(created.orderId),409);assert.equal(capturePosts(t).length,0);assert.equal((await t.current()).state.events.length,0);
 });
 await check('Changed membership during canonical GET blocks capture through both plan and shared routes',async t=>{
  const item=await t.approvedQuote(),created=await approvedOrder(t,item,people.buyer),link=await t.share();
  t.hooks.orderGet=async order=>{const workspace=await t.plans.loadWorkspace(accounts.owner);workspace.people.find(person=>person.id===people.buyer.id).role='viewer';await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);return order;};
  await decoded(await t.capture(created.orderId,people.buyer),409);assert.equal(capturePosts(t).length,0);
  const restored=await t.plans.loadWorkspace(accounts.owner);restored.people.find(person=>person.id===people.buyer.id).role='editor';await t.plans.saveWorkspace(accounts.owner,restored,restored.version);
  await decoded(await t.legacy('capture',{orderId:created.orderId,tripId:t.id},people.buyer,{token:link.token}),409);
  assert.equal(capturePosts(t).length,0);assert.equal((await t.current()).state.events.length,0);
  await decoded(await t.capture(created.orderId,people.buyer),403);
 });
 await check('Invoice funding and checkout funding are mutually exclusive for the same approved share',async t=>{
  const item=await t.approvedQuote(),record=await t.current(),invoiceCalls=[];
  // Save an actual invoice draft with canonical local provider evidence.
  let canonicalInvoice;const invoices=new PlanInvoiceRepository(t.database,async(path,method='GET',body)=>{
   invoiceCalls.push({path,method});if(method==='POST'){canonicalInvoice={...structuredClone(body),id:'INV2-FIXTURE-ONE',status:'DRAFT',amount:{currency_code:'CAD',value:'16.00'},due_amount:{currency_code:'CAD',value:'16.00'}};return {id:canonicalInvoice.id};}return structuredClone(canonicalInvoice);
  },invoiceFinancialEffects(t.database));
  await invoices.create({record,memberId:people.owner.id},{version:record.version,requestId:'11111111-1111-4111-8111-111111111111',itemId:item.id,revision:item.revision,memberId:people.owner.id,email:'owner@example.test',due:'2027-04-04',dueAt:'2027-04-04T18:00:00-04:00',allowPartial:true,minimum:400});
  const denied=await decoded(await t.create(item),409);assert.equal(denied.code,'PAYMENT_CHANNEL_CONFLICT');assert.equal(t.calls.length,0);
  await approvedOrder(t,item,people.buyer);const current=await t.current();
  await assert.rejects(invoices.create({record:current,memberId:people.owner.id},{version:current.version,requestId:'22222222-2222-4222-8222-222222222222',itemId:item.id,revision:item.revision,memberId:people.buyer.id,email:'buyer@example.test',due:'2027-04-04',dueAt:'2027-04-04T18:00:00-04:00',allowPartial:true,minimum:400}),error=>error.code==='PAYMENT_CHANNEL_CONFLICT');
  assert.equal(invoiceCalls.filter(call=>call.method==='POST').length,1);
 });
 await check('A lost provider capture response repairs by GET only and records one expense, history and operation transition',async t=>{
  const item=await t.approvedQuote(),created=await approvedOrder(t,item);t.failures.captureResponse=1;
  await rejected(await t.capture(created.orderId));assert.equal(capturePosts(t).length,1);assert.equal((await t.current()).state.events.length,0);
  assert.equal(await t.database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(created.operationId).first('status'),'created');
  const paid=await decoded(await t.capture(created.orderId));await decoded(await t.capture(created.orderId));
  assert.equal(capturePosts(t).length,1);assert.equal((await t.current()).state.events.length,1);assert.equal((await captureHistory(t,paid.captureId)).results.length,1);
  assert.equal(await t.database.prepare('SELECT COUNT(*) AS count FROM financial_events WHERE owner=? AND plan_id=? AND provider_id=?').bind(accounts.owner,t.id,paid.captureId).first('count'),1);
  assert.equal(await t.database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(created.operationId).first('status'),'captured');
 });
 await check('Provider operation failure rolls back workspace and immutable financial history together, then GET repair commits once',async t=>{
  const item=await t.approvedQuote(),created=await approvedOrder(t,item),before=await t.plans.loadWorkspace(accounts.owner);
  t.database.sqlite.exec("CREATE TRIGGER reject_capture_effect BEFORE UPDATE OF status ON provider_operations WHEN NEW.status='captured' BEGIN SELECT RAISE(ABORT,'Fixture atomic capture failure'); END");
  await rejected(await t.capture(created.orderId));assert.deepEqual(await t.plans.loadWorkspace(accounts.owner),before);
  assert.equal((await captureHistory(t,'CAPTURE000001')).results.length,0);assert.equal(await t.database.prepare('SELECT COUNT(*) AS count FROM financial_events WHERE provider_id=?').bind('CAPTURE000001').first('count'),0);
  assert.equal(await t.database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(created.operationId).first('status'),'created');
  t.database.sqlite.exec('DROP TRIGGER reject_capture_effect');await decoded(await t.capture(created.orderId));assert.equal(capturePosts(t).length,1);
  assert.equal((await t.current()).state.events.length,1);assert.equal((await captureHistory(t,'CAPTURE000001')).results.length,1);
  assert.equal(await t.database.prepare('SELECT status FROM provider_operations WHERE id=?').bind(created.operationId).first('status'),'captured');
 });
 await check('Partial merchant payments show only the unrecorded remainder as merchant due',async t=>{
  const item=await t.approvedQuote([people.owner.id]),workspace=await t.plans.loadWorkspace(accounts.owner);
  workspace.events.push({id:'partial-invoice-expense',itemId:item.id,kind:'expense',label:'Sandbox partial invoice',shares:{[people.owner.id]:400},contributions:{[people.owner.id]:400},amount:400,status:'confirmed',mode:'sandbox',providerId:'INVOICEPARTIAL001',evidence:'Server fixture partial payment',created:new Date().toISOString()});
  await t.plans.saveWorkspace(accounts.owner,workspace,workspace.version);const money=personalMoney(await t.plans.loadWorkspace(accounts.owner),people.owner.id);
  assert.equal(money.cost,400);assert.equal(money.planned,1200);assert.equal(money.merchantDue,1200);assert.equal(money.projected,1600);
 });
 await check('Whole-group designated payer funds the exact total while all approved consumption shares stay separate',async t=>{
  const item=await groupQuote(t);await decoded(await t.create(item,people.owner),400);let state=(await t.current()).state;assert.equal(personalMoney(state,people.owner.id).merchantDue,0);assert.equal(personalMoney(state,people.buyer.id).merchantDue,3200);
  const invoices=new PlanInvoiceRepository(t.database,async()=>{throw Error('A whole-group invoice must never reach a provider');},invoiceFinancialEffects(t.database)),record=await t.current();await assert.rejects(invoices.create({record,memberId:people.owner.id},{version:record.version,requestId:'33333333-3333-4333-8333-333333333333',itemId:item.id,revision:item.revision,memberId:people.buyer.id,email:'buyer@example.test',due:'2027-04-04',dueAt:'2027-04-04T18:00:00-04:00',allowPartial:false,minimum:3200}),error=>error.code==='GROUP_FUNDING_CHANNEL');
  const created=await approvedOrder(t,item,people.buyer),operation=await t.database.prepare('SELECT * FROM provider_operations WHERE id=?').bind(created.operationId).first();assert.equal(operation.amount,3200);assert.equal(JSON.parse(operation.payload).planrecoverFunding.payerId,people.buyer.id);assert.deepEqual(JSON.parse(operation.payload).planrecoverFunding.shares,item.shares);const claims=await t.database.prepare('SELECT member_id,reference_id FROM payment_funding_claims WHERE owner=? AND plan_id=? AND item_id=?').bind(accounts.owner,t.id,item.id).all();assert.equal(claims.results.length,2);assert.ok(claims.results.every(row=>row.reference_id===created.operationId));
  await decoded(await t.capture(created.orderId,people.owner),404);await decoded(await t.capture(created.orderId,people.buyer));state=(await t.current()).state;assert.deepEqual(state.events[0].shares,item.shares);assert.deepEqual(state.events[0].contributions,{[people.buyer.id]:3200});assert.deepEqual([...state.items[0].paid].sort(),[people.owner.id,people.buyer.id].sort());assert.equal(state.items[0].status,'scheduled');assert.equal(personalMoney(state,people.owner.id).friendBalance,-1600);assert.equal(personalMoney(state,people.buyer.id).friendBalance,1600);assert.equal(personalMoney(state,people.buyer.id).merchantDue,0);await decoded(await t.capture(created.orderId,people.buyer));assert.equal(capturePosts(t).length,1);assert.equal((await t.current()).state.events.length,1);assert.ok(JSON.parse((await t.database.prepare('SELECT payload FROM provider_operations WHERE id=?').bind(created.operationId).first()).payload).planrecoverFunding);
 });
 await check('Funding mode cannot change after an open per-member checkout and whole-group invoices are rejected',async t=>{
  const item=await t.approvedQuote();await approvedOrder(t,item,people.owner);const before=await t.current();await decoded(await routes.plan.PATCH(request(`/api/plans/${t.id}`,{version:before.version,action:{type:'item_funding',itemId:item.id,revision:item.revision,mode:'whole-group',payerId:people.buyer.id,confirm:true}},{method:'PATCH'}),context(t.id)),409);assert.deepEqual((await t.current()).state.items,before.state.items);
 });
 await check('Whole-group checkout cannot be captured after its approved consumption terms change',async t=>{
  const item=await groupQuote(t),created=await approvedOrder(t,item,people.buyer);let changed=false;t.hooks.provider=async(path,method)=>{if(changed||method!=='GET'||!path.endsWith(created.orderId))return;changed=true;const latest=await t.current();await t.plans.updatePlan(t.id,people.owner,latest.version,{type:'item_edit',actor:people.owner.id,itemId:item.id,participants:[people.owner.id,people.buyer.id],price:3200,allocation:'fixed',values:{[people.owner.id]:1000,[people.buyer.id]:2200}});};await rejected(await t.capture(created.orderId,people.buyer));assert.equal(capturePosts(t).length,0);assert.equal((await t.current()).state.events.length,0);
 });
 await check('Whole-group funding requires fresh exact-revision approvals and a current participating editor',async t=>{
  const item=await t.approvedQuote(),before=await t.current();await decoded(await routes.plan.PATCH(request(`/api/plans/${t.id}`,{version:before.version,action:{type:'item_funding',itemId:item.id,revision:item.revision,mode:'whole-group',payerId:people.viewer.id,confirm:true}},{method:'PATCH'}),context(t.id)),400);const changed=await decoded(await routes.plan.PATCH(request(`/api/plans/${t.id}`,{version:before.version,action:{type:'item_funding',itemId:item.id,revision:item.revision,mode:'whole-group',payerId:people.buyer.id,confirm:true}},{method:'PATCH'}),context(t.id)));await rejected(await t.create(changed.state.items[0],people.buyer));await rejected(await t.create(item,people.buyer));assert.equal(orderPosts(t).length,0);
 });
 await check('An open whole-group order blocks a second full collection after item revision and approvals change',async t=>{const item=await groupQuote(t),original=await approvedOrder(t,item,people.buyer),record=await t.current();await t.plans.updatePlan(t.id,people.owner,record.version,{type:'item_edit',actor:people.owner.id,itemId:item.id,participants:item.participants,price:item.price,allocation:'equal'});let fresh=await t.current();for(const person of [people.owner,people.buyer]){const next=await t.current(person);await t.plans.updatePlan(t.id,person,next.version,{type:'approve_item',actor:person.id,itemId:item.id,revision:next.state.items[0].revision});}fresh=await t.current();const denied=await decoded(await t.create(fresh.state.items[0],people.buyer),409);assert.equal(denied.code,'PAYMENT_CHANNEL_CONFLICT');assert.equal(orderPosts(t).length,1);assert.equal(await t.database.prepare('SELECT COUNT(DISTINCT reference_id) n FROM payment_funding_claims WHERE owner=? AND plan_id=? AND item_id=?').bind(accounts.owner,t.id,item.id).first('n'),1);await rejected(await t.capture(original.orderId,people.buyer));assert.equal(capturePosts(t).length,0);});
 console.log(`Checkout: ${checks} actual-route, real SQLite and fixture-provider checks passed (${networkCalls} intercepted sandbox requests; no live calls).`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.checkoutTestEnv;}
