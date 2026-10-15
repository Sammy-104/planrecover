import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {handlePlanMcp} from '../lib/plan-mcp.ts';
import {accountPersonId,makePerson} from '../lib/people.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))(createRequire(require.resolve('vite')).resolve('esbuild'));
const origin='https://planrecover.test',owner='decision-owner-account',bobAccount='decision-bob-account',carolAccount='decision-carol-account';
const alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId(bobAccount),name:'Bob'},
  carol={id:await accountPersonId(carolAccount),name:'Carol'},outsider={id:await accountPersonId('decision-outsider-account'),name:'Outsider'};
let checks=0,providerCalls=0;
const previousFetch=globalThis.fetch;
globalThis.fetch=async()=>{providerCalls++;throw Error('MCP decisions must never contact providers.');};
globalThis.decisionTestEnv={DB:undefined};
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-mcp-decisions-'));
try{
 const outfile=join(directory,'mcp-route.mjs');
 await build({entryPoints:[resolve(root,'app/mcp/route.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',
   tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'decisions-workers',setup(builder){
     builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'binding',namespace:'decision-tests'}));
     builder.onLoad({filter:/.*/,namespace:'decision-tests'},()=>({contents:'export const env=globalThis.decisionTestEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(outfile).href);
 function snapshot(database){return Object.fromEntries(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
   .map(({name})=>[name,database.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));}
 function request(planId,account=owner){return new Request(`${origin}/mcp`,{method:'POST',headers:{'content-type':'application/json',
   accept:'application/json, text/event-stream',origin,...(account?{'oai-authenticated-user-id':account}:{})},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_decisions',arguments:{planId}}})});}
 async function call(repository,planId,identity){const response=await handlePlanMcp(request(planId),async()=>({identity,repository}));
   assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
   const body=await response.json();assert.equal(body.result.isError,false);assert.deepEqual(JSON.parse(body.result.content[0].text),body.result.structuredContent);
   return body.result.structuredContent;}
 async function check(name,callback){const database=createTestD1();globalThis.decisionTestEnv.DB=database;
   try{const fixture=await seed(database);await callback(fixture);assert.equal(providerCalls,0);checks++;console.log(`PASS ${name}`);}
   finally{database.close();delete globalThis.decisionTestEnv.DB;}}
 async function seed(database){
   const repository=new PlanRepository(database),record=await repository.createPlan(owner,alice,{kind:'day-out',name:'Decision privacy',destination:'Toronto, Ontario, Canada',
     start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:50000});
   const state=await repository.loadWorkspace(owner);state.people=[makePerson(alice.id,'Alice','owner'),makePerson(bob.id,'Bob','editor'),makePerson(carol.id,'Carol','viewer')];
   state.items=[{id:'booking',name:'Reviewed fictional booking',category:'Activity',start:'2027-04-04T12:00:00-04:00',duration:60,
     price:3000,participants:[alice.id,bob.id],shares:{[alice.id]:1800,[bob.id]:1200},allocation:'fixed',values:{[alice.id]:1800,[bob.id]:1200},revision:1,
     approvals:[],status:'draft',booking:'unconfirmed',policy:'Saved quote',source:'Fictional demo merchant · terms',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'}];
   state.reminders=[{id:'shared-reminder',itemId:'booking',title:'Documented plan deadline',due:'2027-04-03T18:00:00-04:00',consequence:'Review saved supplier terms.',done:false}];
   state.preferences[bob.id]={budget:900000,cash:876543,reserve:765432,pace:'private-bob-pace',interests:['private-bob-interest'],paypalMe:'https://paypal.me/private-bob',financing:654321};
   await repository.saveWorkspace(owner,state,state.version);const planId=record.state.plan.id;
   const hidden=await repository.createPlan(owner,alice,{kind:'day-out',name:'Other same-owner plan',destination:'Ottawa, Ontario, Canada',start:'2027-05-01',end:'2027-05-01',timezone:'America/Toronto',currency:'CAD',budget:5000});
   const privateTerms={email:'private-recipient-sentinel@example.com',due:'2027-04-04',dueAt:'2027-04-04T18:00:00-04:00',privateSource:'private-invoice-source-sentinel'};
   async function invoice(id,member,amount,{plan=planId,status='draft',paid=0,approved=[]}={}){await database.prepare(`INSERT INTO plan_invoices
     (id,owner,plan_id,item_id,member_id,revision,request_id,terms,approved_members,amount,minimum,paid,status,version,created,updated)
     VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,2,?,?)`).bind(id,owner,plan,'booking',member,id,JSON.stringify(privateTerms),JSON.stringify(approved),amount,1,paid,status,
       '2026-10-14T12:00:00Z','2026-10-14T12:00:00Z').run();}
   await invoice('invoice-alice',alice.id,1000);await invoice('invoice-bob',bob.id,2000);
   await invoice('invoice-carol',carol.id,3000,{approved:[carol.id]});
   await invoice('invoice-bob-partial',bob.id,4000,{status:'partially-paid',paid:1000,approved:[bob.id]});
   await invoice('invoice-bob-paid-hidden',bob.id,5000,{status:'paid',paid:5000,approved:[bob.id]});
   await invoice('invoice-other-plan-hidden',alice.id,9000,{plan:hidden.state.plan.id});
   async function recovery(id,required,allocations,{status='review',version=1,approved=[],plan=planId}={}){
     const policyId=`policy-${id}`,policy={itemId:'booking',merchant:'fictional-sandbox',merchantName:'private-supplier-sentinel',
       terms:'private-source-terms-sentinel',evidence:'private-source-evidence-sentinel'};
     await database.prepare('INSERT INTO booking_policies(id,owner,plan_id,item_id,revision,body,confirmed_by,created) VALUES (?,?,?,?,1,?,?,?)')
       .bind(policyId,owner,plan,'booking',JSON.stringify(policy),alice.id,'2026-10-14T12:00:00Z').run();
     await database.prepare(`INSERT INTO recovery_proposals(id,owner,plan_id,policy_id,plan_version,version,status,body,created_by,created,updated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,owner,plan,policyId,1,version,status,JSON.stringify({policy,required,allocations,reason:'Reviewed cancellation terms.',
         fingerprint:'fixture-source-fingerprint',dependentItems:[]}),alice.id,'2026-10-14T12:00:00Z','2026-10-14T12:00:00Z').run();
     for(const [member,approvedVersion]of approved)await database.prepare('INSERT INTO recovery_approvals(proposal_id,version,member_id,approved) VALUES (?,?,?,?)')
       .bind(id,approvedVersion,member,'2026-10-14T12:00:00Z').run();
   }
   await recovery('recovery-shared',[alice.id,bob.id],[{memberId:alice.id,amount:600},{memberId:bob.id,amount:400}]);
   await recovery('recovery-already-approved',[alice.id],[{memberId:alice.id,amount:200}],{approved:[[alice.id,1]]});
   await recovery('recovery-bob-version2',[bob.id],[{memberId:bob.id,amount:700}],{version:2,approved:[[bob.id,1]]});
   await recovery('recovery-completed-hidden',[alice.id],[{memberId:alice.id,amount:100}],{status:'completed'});
   await recovery('recovery-other-plan-hidden',[alice.id],[{memberId:alice.id,amount:9000}],{plan:hidden.state.plan.id});
   async function notification(id,member,{read=false,plan=planId}={}){
     await database.prepare(`INSERT INTO reminder_jobs(id,owner,plan_id,member_id,source_kind,source_id,source_due_at,title,body,timezone,lead_minutes,
       channel,due_at,plan_version,preferences_version,invoice_version,status,created,updated)
       VALUES (?,?,?,?,'reminder',?,?,'Fixture notification','Fixture notification source','America/Toronto',0,'in-app',?,1,0,-1,'delivered',?,?)`)
       .bind(`job-${id}`,owner,plan,member,id,0,0,'2026-10-14T12:00:00Z','2026-10-14T12:00:00Z').run();
     await database.prepare('INSERT INTO plan_notifications(id,job_id,owner,plan_id,member_id,title,body,created,read_at) VALUES (?,?,?,?,?,?,?,?,?)')
       .bind(id,`job-${id}`,owner,plan,member,`Notification ${id}`,`private-${id}-body`,'2026-10-14T12:00:00Z',read?'2026-10-14T12:30:00Z':null).run();
   }
   await notification('alice-unread',alice.id);await notification('alice-read-hidden',alice.id,{read:true});await notification('bob-unread',bob.id);
   await notification('carol-unread',carol.id);await notification('other-plan-hidden',alice.id,{plan:hidden.state.plan.id});
   // A lazy import cannot hide behind identical millisecond timestamps in the route read-only check.
   await database.prepare("UPDATE profiles SET updated='1970-01-01T00:00:00Z'").run();
   return {database,repository,planId,hiddenPlanId:hidden.state.plan.id};
 }
 await check('Recipients see only their own invoice decisions; owners can review each participant without private terms',async({repository,planId})=>{
   const ownerView=await repository.getDecisionExtras(planId,alice),bobView=await repository.getDecisionExtras(planId,bob),carolView=await repository.getDecisionExtras(planId,carol);
   assert.deepEqual(ownerView.invoices.map(row=>row.id).sort(),['invoice-alice','invoice-bob','invoice-bob-partial','invoice-carol']);
   assert.equal(ownerView.invoices.find(row=>row.id==='invoice-bob').action,'await-recipient-approval');
   assert.equal(ownerView.invoices.find(row=>row.id==='invoice-carol').action,'send-after-review');
   assert.deepEqual(bobView.invoices.map(row=>row.id).sort(),['invoice-bob','invoice-bob-partial']);
   assert.equal(bobView.invoices.find(row=>row.id==='invoice-bob').action,'approve-terms');
   assert.equal(bobView.invoices.find(row=>row.id==='invoice-bob-partial').outstanding,3000);
   assert.equal(bobView.invoices.find(row=>row.id==='invoice-bob-partial').action,'review-payment');
   assert.deepEqual(carolView.invoices.map(row=>row.id),['invoice-carol']);
   for(const view of [ownerView,bobView,carolView])assert.ok(!JSON.stringify(view).includes('private-recipient-sentinel'));
 });
 await check('Recovery decisions expose only required pending versions and the caller’s exact own refund',async({repository,planId})=>{
   const ownerView=await repository.getDecisionExtras(planId,alice),bobView=await repository.getDecisionExtras(planId,bob),carolView=await repository.getDecisionExtras(planId,carol);
   assert.deepEqual(ownerView.recoveries.map(row=>({id:row.id,ownRefund:row.ownRefund})),[{id:'recovery-shared',ownRefund:600}]);
   assert.deepEqual(bobView.recoveries.map(row=>({id:row.id,version:row.version,ownRefund:row.ownRefund})).sort((a,b)=>a.id.localeCompare(b.id)),
     [{id:'recovery-bob-version2',version:2,ownRefund:700},{id:'recovery-shared',version:1,ownRefund:400}]);
   assert.deepEqual(carolView.recoveries,[]);
   assert.ok(!JSON.stringify(ownerView.recoveries).includes('private-source'));assert.ok(!JSON.stringify(bobView.recoveries).includes('private-supplier'));
 });
 await check('Unread notifications are caller-scoped and exclude read notifications and other plans',async({repository,planId})=>{
   for(const [identity,id]of [[alice,'alice-unread'],[bob,'bob-unread'],[carol,'carol-unread']]){
     const result=await repository.getDecisionExtras(planId,identity);assert.deepEqual(result.notifications.map(row=>row.id),[id]);
     assert.equal(result.notifications[0].body,`private-${id}-body`);
   }
 });
 await check('Repository and MCP decision reads preserve every table and never call providers',async({database,repository,planId})=>{
   const before=snapshot(database);
   for(const identity of [alice,bob,carol]){const extras=await repository.getDecisionExtras(planId,identity),result=await call(repository,planId,identity);
     assert.deepEqual(result.invoices,extras.invoices);assert.deepEqual(result.recoveries,extras.recoveries);assert.deepEqual(result.notifications,extras.notifications);
     assert.equal(result.reminders[0].title,'Documented plan deadline');assert.ok(!JSON.stringify(result).includes('private-bob-pace'));
     assert.ok(!JSON.stringify(result).includes('private-recipient-sentinel'));}
   assert.deepEqual(snapshot(database),before);
 });
 await check('Outsiders and removed members cannot read decisions and cause no table writes',async({database,repository,planId})=>{
   const before=snapshot(database);await assert.rejects(repository.getDecisionExtras(planId,outsider),error=>error.status===404);
   const response=await handlePlanMcp(request(planId),async()=>({identity:outsider,repository}));const result=await response.json();
   assert.equal(response.status,200);assert.equal(result.result.isError,true);assert.ok(!JSON.stringify(result).includes('invoice-bob'));
   assert.deepEqual(snapshot(database),before);
   await database.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").bind(owner,planId,bob.id).run();
   const removedSnapshot=snapshot(database);await assert.rejects(repository.getDecisionExtras(planId,bob),error=>error.status===404);
   assert.deepEqual(snapshot(database),removedSnapshot);
 });
 await check('The actual MCP route reads owner, member and outsider decisions without initializing or synchronizing any saved table',async({database,repository,planId})=>{
   const before=snapshot(database);
   for(const [identity,account]of [[alice,owner],[bob,bobAccount],[carol,carolAccount]]){
     const response=await route.POST(request(planId,account));assert.equal(response.status,200);
     const result=await response.json();assert.equal(result.result.isError,false);
     assert.deepEqual(result.result.structuredContent.invoices,(await repository.getDecisionExtras(planId,identity)).invoices);
     assert.deepEqual(snapshot(database),before);
   }
   const forbidden=await route.POST(request(planId,'decision-outsider-account'));
   assert.equal(forbidden.status,200);assert.equal((await forbidden.json()).result.isError,true);
   assert.deepEqual(snapshot(database),before);
 });
 console.log(`${checks} MCP decision privacy and read-only checks passed; ${providerCalls} provider calls.`);
}finally{globalThis.fetch=previousFetch;delete globalThis.decisionTestEnv;rmSync(directory,{recursive:true,force:true});}
