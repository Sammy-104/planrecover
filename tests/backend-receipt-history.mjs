import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1,applyMigrations} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {ReceiptDraftRepository,draftReceipt,requireReviewedReceiptDraft} from '../lib/receipt-drafts.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','receipt-history-test-'));
const owner='history-owner',viewerAccount='history-viewer',alice={id:await accountPersonId(owner),name:'Alice'},viewer={id:await accountPersonId(viewerAccount),name:'Viewer'},origin='https://planrecover.test';
let calls=0,provider,checks=0;globalThis.historyTestEnv={};globalThis.fetch=async(...args)=>{calls++;return provider(...args);};
const facts={merchant:'Synthetic kitchen',date:'2027-04-04',currency:'CAD',items:[{name:'Two meals',amountCents:1000,quantityMilli:2000,unitPriceCents:600,lineDiscountCents:200}],taxCents:0,tipCents:0,discountCents:0,totalCents:1000,flags:[]};
const modelResponse=(value=facts)=>Response.json({output:{message:{role:'assistant',content:[{text:JSON.stringify(value)}]}},stopReason:'end_turn',usage:{inputTokens:90,outputTokens:45,totalTokens:135}});
function request(path,body,account=owner){const form=body instanceof FormData;return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,...form?{}:{'content-type':'application/json'},...account?{'oai-authenticated-user-id':account}:{}},...body===undefined?{}:{body:form?body:JSON.stringify(body)}});}
async function decoded(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
try{
 const routes={};for(const [name,path]of Object.entries({upload:'app/api/receipt/route.ts',history:'app/api/receipt/history/route.ts',retry:'app/api/receipt/retry/route.ts',scan:'app/api/receipt/scan/route.ts'})){
  const outfile=join(directory,name+'.mjs');await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.historyTestEnv;',loader:'js'}));}}]});routes[name]=await import(pathToFileURL(outfile).href);
 }
 async function check(name,run){const database=createTestD1(),objects=new Map();for(const key of Object.keys(globalThis.historyTestEnv))delete globalThis.historyTestEnv[key];
  Object.assign(globalThis.historyTestEnv,{DB:database,BUCKET:{async put(key,bytes,options){objects.set(key,{bytes:new Uint8Array(bytes),httpMetadata:options?.httpMetadata});},async get(key){const object=objects.get(key);return object?{size:object.bytes.length,body:object.bytes,httpMetadata:object.httpMetadata,async arrayBuffer(){return object.bytes.buffer.slice(object.bytes.byteOffset,object.bytes.byteOffset+object.bytes.byteLength);}}:null;},async delete(key){objects.delete(key);}}});
  calls=0;provider=()=>{throw Error('Unexpected provider call.');};try{const plans=new PlanRepository(database),record=await plans.createPlan(owner,alice,{name:'Receipt history test',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}),id=record.state.plan.id,repo=new ReceiptDraftRepository(database),scope={owner,planId:id,memberId:alice.id};
   const configure=()=>Object.assign(globalThis.historyTestEnv,{AWS_BEARER_TOKEN_BEDROCK:'fixture-key',BEDROCK_REGION:'ca-central-1',BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/fixture',BEDROCK_REQUIRE_APPLICATION_PROFILE:'true'});
   const upload=async()=>{const form=new FormData();form.set('tripId',id);form.set('file',new File(['synthetic source'],'receipt.jpg',{type:'image/jpeg'}));return decoded(await routes.upload.POST(request('/api/receipt',form)));};
   const retry=(draft,account=owner)=>routes.retry.POST(request('/api/receipt/retry',{tripId:id,draftId:draft.id,version:draft.version},account));
   await run({database,objects,plans,record,id,repo,scope,configure,upload,retry});checks++;console.log('PASS '+name);
  }finally{database.close();}}
 await check('Upload stages its object, extraction creates immutable snapshots, and line details reconcile',async({database,plans,id,configure,upload})=>{
  configure();provider=async()=>modelResponse();const before=await plans.loadWorkspace(owner),result=await upload();assert.equal(result.draft.version,2);assert.equal(result.receipt.rows[0].quantityMilli,2000);assert.equal(result.receipt.rows[0].unitPrice,600);assert.equal(result.receipt.rows[0].lineDiscount,200);
  assert.equal(database.sqlite.prepare('SELECT status FROM receipt_objects WHERE file_key=?').get(result.draft.fileKey).status,'ready');assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM receipt_revisions WHERE draft_id=?').get(result.draft.id).n,3);
  assert.throws(()=>database.sqlite.prepare("UPDATE receipt_revisions SET body='{}' WHERE draft_id=?").run(result.draft.id),/immutable/);assert.throws(()=>database.sqlite.prepare('DELETE FROM receipt_revisions WHERE draft_id=?').run(result.draft.id),/retained/);assert.deepEqual(await plans.loadWorkspace(owner),before);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM financial_events WHERE plan_id=?').get(id).n,0);
 });
 await check('Failed provider retry keeps prior source facts and records the failed attempt without leaking errors',async({database,repo,scope,id,configure,upload,retry})=>{
  configure();provider=async()=>modelResponse();const first=await upload();provider=async()=>new Response('SECRET-PROVIDER-ERROR',{status:403});const result=await decoded(await retry(first.draft));assert.equal(result.draft.status,'failed');assert.deepEqual(result.draft.sourceFacts,facts);assert.ok(result.note.includes('Previous extracted values'));assert.equal(calls,2);
  const history=await decoded(await routes.history.GET(request(`/api/receipt/history?tripId=${id}&draftId=${first.draft.id}`)));assert.equal(history.revisions.length,5);assert.equal(history.revisions[0].status,'failed');assert.deepEqual(history.revisions[2].sourceFacts,facts);assert.ok(!JSON.stringify(history).includes('SECRET-PROVIDER-ERROR'));
  await decoded(await retry(first.draft),409);assert.equal(calls,2);assert.equal((await repo.get(scope,first.draft.id)).version,4);
 });
 await check('Device and pasted scans retain earlier revisions and history is bounded and paginated',async({repo,scope,id,upload})=>{
  const result=await upload();let draft=result.draft;
  for(let i=0;i<23;i++)draft=await repo.extracted(scope,draft.id,draft.version,{facts:{...facts,merchant:'Revision '+i},warnings:[],provider:'manual-text'});
  const page=await repo.history(scope,draft.id),older=await repo.history(scope,draft.id,page.nextBefore);assert.equal(page.revisions.length,20);assert.ok(page.hasMore);assert.equal(new Set([...page.revisions,...older.revisions].map(row=>row.version)).size,26);assert.equal(calls,0);
  const scan=await decoded(await routes.scan.POST(request('/api/receipt/scan',{tripId:id,draftId:draft.id,version:draft.version,source:'pasted',text:'SHOP\nCoffee CAD 4.50\nTotal CAD 4.50'})));assert.equal(scan.draft.sourceFacts.items.length,1);assert.equal((await repo.history(scope,draft.id)).revisions[1].sourceFacts.merchant,'Revision 22');
 });
 await check('Read access is member scoped; viewers and reviewed sources cannot initiate provider retries',async({database,plans,repo,scope,id,upload,retry})=>{
  const first=await upload();await decoded(await routes.history.GET(request(`/api/receipt/history?tripId=${id}&draftId=${first.draft.id}`,undefined,'outsider')),404);await decoded(await retry(first.draft,'outsider'),404);
  const state=await plans.loadWorkspace(owner);addPerson(state,viewer,'viewer');await plans.saveWorkspace(owner,state,state.version);
  // Invitations bind shared members to the owning workspace, as the real shared UI does.
  const token='b'.repeat(64),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');database.sqlite.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)').run(hash,token,owner,id,'viewer',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
  const read=request(`/api/receipt/history?tripId=${id}&draftId=${first.draft.id}`,undefined,viewerAccount);read.headers.set('x-trip-share',token);await decoded(await routes.history.GET(read));
  const write=request('/api/receipt/retry',{tripId:id,draftId:first.draft.id,version:first.draft.version},viewerAccount);write.headers.set('x-trip-share',token);await decoded(await routes.retry.POST(write),403);
  const draft=await repo.extracted(scope,first.draft.id,first.draft.version,{facts,warnings:[]}),current=await plans.getPlan(id,alice),receipt={...draftReceipt(draft,current.state,alice.id),rows:[{id:'line-0',name:'Meal',amount:1000,claims:[alice.id]}],paymentConfirmed:true};
  const reviewed=await repo.review(scope,draft.id,draft.version,current.state,receipt,[],'CAD');await decoded(await retry(reviewed),409);assert.equal(calls,0);
  database.sqlite.prepare("UPDATE receipt_objects SET status='deleting' WHERE file_key=?").run(reviewed.fileKey);await assert.rejects(requireReviewedReceiptDraft(database,owner,id,receipt),error=>error.status===409);
 });
 await check('Failed uploads leave a tracked staged object and retired/missing sources fail before inference',async({database,repo,scope,upload,retry,configure})=>{
  const first=await upload();configure();database.sqlite.prepare("UPDATE receipt_objects SET status='deleting' WHERE file_key=?").run(first.draft.fileKey);await decoded(await retry(first.draft),409);assert.equal(calls,0);
  database.sqlite.prepare("UPDATE receipt_objects SET status='ready' WHERE file_key=?").run(first.draft.fileKey);globalThis.historyTestEnv.BUCKET.get=async()=>null;await decoded(await retry(first.draft),404);assert.equal((await repo.get(scope,first.draft.id)).version,2);
  globalThis.historyTestEnv.BUCKET.put=async()=>{throw Error('Synthetic storage failure');};const form=new FormData();form.set('tripId',scope.planId);form.set('file',new File(['synthetic'],'receipt.jpg',{type:'image/jpeg'}));const failed=await routes.upload.POST(request('/api/receipt',form));assert.notEqual(failed.status,200);assert.equal(database.sqlite.prepare("SELECT COUNT(*) n FROM receipt_objects WHERE status='staged'").get().n,1);assert.equal(calls,0);
 });
 await check('Foreign or incomplete source quantities do not become plan-currency unit prices',async({record,repo,scope})=>{
  const draft=await repo.create(scope,{fileKey:'synthetic-quantity',mime:'image/jpeg',size:10});const saved=await repo.extracted(scope,draft.id,0,{facts:{...facts,currency:'CHF'},warnings:[]});assert.equal(draftReceipt(saved,record.state,alice.id).rows[0].quantityMilli,undefined);
  const partial=await repo.extracted(scope,saved.id,saved.version,{facts:{...facts,items:[{...facts.items[0],lineDiscountCents:null}]},warnings:[]});assert.equal(draftReceipt(partial,record.state,alice.id).rows[0].unitPrice,undefined);
 });
 // Upgrade a real pre-history database: the first retry must preserve its last known facts.
 {
  const database=createTestD1({migrations:false});try{applyMigrations(database,{through:'0014_recovery_execution.sql'});const plans=new PlanRepository(database),record=await plans.createPlan(owner,alice,{name:'Legacy source',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}),id=crypto.randomUUID(),now=new Date().toISOString();
   database.sqlite.prepare("INSERT INTO receipt_drafts(id,owner,plan_id,uploaded_by,file_key,mime,size,status,version,source_facts,unknown_fields,warnings,created,updated) VALUES (?,?,?,?,?,'image/jpeg',10,'review-required',7,?,'[]','[]',?,?)").run(id,owner,record.state.plan.id,alice.id,'legacy-source',JSON.stringify(facts),now,now);applyMigrations(database,{after:'0014_recovery_execution.sql'});const repo=new ReceiptDraftRepository(database),scope={owner,planId:record.state.plan.id,memberId:alice.id};
   assert.equal((await repo.history(scope,id)).revisions[0].legacySnapshot,true);await repo.extracting(scope,id,7);const history=await repo.history(scope,id);assert.deepEqual(history.revisions.find(row=>row.version===7).sourceFacts,facts);checks++;console.log('PASS Legacy source facts are backfilled atomically on the first versioned change');
  }finally{database.close();}
 }
 console.log(`${checks} receipt revision and retry checks passed; live providers disabled.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.historyTestEnv;}
