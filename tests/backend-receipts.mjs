import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,makePerson} from '../lib/people.ts';
import {ReceiptDraftRepository,receiptExtractionSchema} from '../lib/receipt-drafts.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});
const temporary=mkdtempSync(join(root,'build','backend-receipts-'));
const origin='https://planrecover.test',owner='receipt-alice-account',other='receipt-bob-account';
const alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId(other),name:'Bob'};
globalThis.receiptTestEnv={DB:undefined,BUCKET:undefined};
let provider=async()=>{throw Error('Live inference is disabled.');},checks=0;
globalThis.fetch=(...args)=>provider(...args);
const routes={};
try{
 for(const [name,path]of Object.entries({receipt:'app/api/receipt/route.ts',workspace:'app/api/workspace/route.ts',plan:'app/api/plans/[planId]/route.ts'})){
  const outfile=join(temporary,`${name}.mjs`);
  await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'receipt-test-bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'binding',namespace:'receipt-test'}));builder.onLoad({filter:/.*/,namespace:'receipt-test'},()=>({contents:'export const env=globalThis.receiptTestEnv;',loader:'js'}));}}]});
  routes[name]=await import(pathToFileURL(outfile).href);
 }
 function request(path,method='GET',body,{account=owner,token}={}){
  const headers=new Headers();if(account)headers.set('oai-authenticated-user-id',account);if(token)headers.set('x-trip-share',token);
  if(method!=='GET')headers.set('Origin',origin);
  if(body&&!(body instanceof FormData))headers.set('Content-Type','application/json');
  return new Request(`${origin}${path}`,{method,headers,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 }
 async function decoded(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));if(status<300)assert.match(response.headers.get('Cache-Control')??'',/private, no-store/);return body;}
 const facts={merchant:'Test kitchen',date:'2027-04-04',currency:'CAD',items:[{name:'Meal',amountCents:1000}],taxCents:250,tipCents:0,discountCents:0,totalCents:1250,flags:[]};
 const plan={kind:'day-out',name:'Receipt tests',destination:'Toronto, Ontario, Canada',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000};
 function configured(){Object.assign(globalThis.receiptTestEnv,{AWS_BEARER_TOKEN_BEDROCK:'fixture-key',BEDROCK_REGION:'us-east-1',BEDROCK_MODEL_ID:'fixture.model'});}
 function modelResponse(value=facts,stopReason='end_turn'){return Response.json({output:{message:{role:'assistant',content:[{text:JSON.stringify(value)}]}},stopReason,usage:{inputTokens:50,outputTokens:30,totalTokens:80}});}
 async function upload(state,{mime='image/jpeg',account=owner,token}={}){const form=new FormData();form.set('file',new File([mime==='application/pdf'?'%PDF-1.4\n%synthetic receipt\n%%EOF':'fixture receipt source'],mime==='application/pdf'?'receipt.pdf':'receipt.jpg',{type:mime}));form.set('tripId',state.plan.id);return decoded(await routes.receipt.POST(request('/api/receipt','POST',form,{account,token})));}
 function reviewed(uploaded){return {...uploaded.receipt,merchant:'Test kitchen',date:'2027-04-04',rows:[{id:'line-0',name:'Meal',amount:1000,claims:[alice.id]}],tax:250,tip:0,discount:0,total:1250,payer:alice.id,paymentConfirmed:true};}
 function reviewBody(uploaded,receipt=reviewed(uploaded),resolvedFields=uploaded.reviewFields){return {draftId:uploaded.draft.id,version:uploaded.draft.version,receipt,resolvedFields,currency:'CAD'};}
 async function check(name,callback){
  const database=createTestD1(),objects=new Map();
  for(const key of Object.keys(globalThis.receiptTestEnv))delete globalThis.receiptTestEnv[key];
  Object.assign(globalThis.receiptTestEnv,{DB:database,BUCKET:{async put(key,bytes,options){objects.set(key,{bytes:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},async get(key){const value=objects.get(key);return value?{body:value.bytes,httpMetadata:value.httpMetadata}:null;},async delete(key){objects.delete(key);}}});
  provider=async()=>{throw Error('Live inference is disabled.');};
  try{const repository=new PlanRepository(database),created=await repository.createPlan(owner,alice,plan);await callback({database,objects,repository,state:created.state});checks++;console.log(`PASS ${name}`);}finally{database.close();}
 }
 await check('Receipt APIs require identity and isolate uploads across accounts',async({state})=>{
  await decoded(await routes.receipt.GET(request('/api/receipt','GET',undefined,{account:null})),401);
  const uploaded=await upload(state,{mime:'application/pdf'});
  assert.equal((await decoded(await routes.receipt.GET(request('/api/receipt')))).drafts.length,1);
  assert.deepEqual((await decoded(await routes.receipt.GET(request('/api/receipt','GET',undefined,{account:other})))).drafts,[]);
  await decoded(await routes.receipt.GET(request(`/api/receipt?draftId=${uploaded.draft.id}`,'GET',undefined,{account:other})),404);
  await decoded(await routes.receipt.GET(request(`/api/receipt?key=${encodeURIComponent(uploaded.draft.fileKey)}`,'GET',undefined,{account:other})),403);
 });
 await check('Bedrock sees an already persisted source and preserves unreadable amounts as null',async({database,objects,repository,state})=>{
  configured();let calls=0;
  provider=async(url)=>{calls++;assert.match(String(url),/^https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\//);assert.equal(objects.size,1);const row=database.sqlite.prepare('SELECT status,source_facts FROM receipt_drafts').get();assert.equal(row.status,'extracting');assert.equal(row.source_facts,null);return modelResponse({...facts,items:[{name:'Meal',amountCents:null}],tipCents:null});};
  const before=await repository.loadWorkspace(owner),uploaded=await upload(state);
  assert.equal(calls,1);assert.equal(uploaded.draft.provider,'bedrock');assert.equal(uploaded.draft.status,'review-required');
  assert.equal(uploaded.draft.sourceFacts.items[0].amountCents,null);assert.equal(uploaded.draft.sourceFacts.tipCents,null);
  assert.ok(uploaded.reviewFields.includes('items.0.amountCents'));assert.ok(uploaded.reviewFields.includes('tipCents'));
  assert.match(uploaded.note,/zero is not assumed/);const after=await repository.loadWorkspace(owner);
  assert.equal(after.version,before.version);assert.deepEqual(after.events,before.events);assert.deepEqual(after.receipts,before.receipts);
  const reopened=await decoded(await routes.receipt.GET(request(`/api/receipt?draftId=${uploaded.draft.id}`)));
  assert.deepEqual(reopened.draft.sourceFacts,uploaded.draft.sourceFacts);
 });
 await check('Review requires resolved fields, exact arithmetic and the same source; save creates no automatic expense',async({repository,state})=>{
  configured();provider=async()=>modelResponse({...facts,items:[{name:'Meal',amountCents:null}],tipCents:null});
  const uploaded=await upload(state),receipt=reviewed(uploaded);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,receipt,[]))),400);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,{...receipt,total:1249}))),400);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,{...receipt,fileKey:uploaded.draft.fileKey.replace(/.$/,last=>last==='0'?'1':'0')}))),400);
  let current=await repository.loadWorkspace(owner);
  await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:current.version,action:{type:'receipt',receipt}})),409);
  const reviewedDraft=await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,receipt))));assert.equal(reviewedDraft.draft.status,'reviewed');
  assert.equal((await repository.loadWorkspace(owner)).events.length,0);
  current=await repository.loadWorkspace(owner);
  await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:current.version,action:{type:'receipt',receipt:{...receipt,total:1300,tax:300}}})),409);
  const saved=await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:current.version,action:{type:'receipt',receipt}})));
  assert.equal(saved.state.receipts.length,1);assert.equal(saved.state.events.length,0);
  const approved=await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:saved.state.version,action:{type:'approve_receipt',receiptId:saved.state.receipts[0].id,revision:1}})));
  assert.equal(approved.state.events.length,1);assert.equal(approved.state.events[0].amount,1250);
 });
 await check('The per-plan API applies the same draft-review boundary and rejects stale reviewed drafts',async({repository,state})=>{
  const uploaded=await upload(state,{mime:'application/pdf'}),receipt=reviewed(uploaded),context={params:Promise.resolve({planId:state.plan.id})};
  let record=await repository.getPlan(state.plan.id,alice);
  await decoded(await routes.plan.PATCH(request(`/api/plans/${state.plan.id}`,'PATCH',{version:record.version,action:{type:'receipt',receipt}}),context),409);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,receipt))));
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,receipt))),409);
  record=await repository.getPlan(state.plan.id,alice);
  const saved=await decoded(await routes.plan.PATCH(request(`/api/plans/${state.plan.id}`,'PATCH',{version:record.version,action:{type:'receipt',receipt}}),context));
  assert.equal(saved.state.receipts.length,1);assert.equal(saved.state.events.length,0);
 });
 await check('Model truncation, tool output and provider errors retain a usable manual draft without leaking errors',async({objects,repository,state})=>{
  configured();provider=async()=>modelResponse(facts,'max_tokens');
  const truncated=await upload(state);assert.equal(truncated.draft.status,'failed');assert.equal(truncated.draft.sourceFacts,null);
  provider=async()=>Response.json({output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'x',name:'pay',input:{}}}]}},stopReason:'tool_use'});
  const tool=await upload(state);assert.equal(tool.draft.status,'failed');
  provider=async()=>Response.json({message:'fixture-secret-provider-body'},{status:401});
  const failure=await upload(state);assert.equal(failure.draft.status,'failed');assert.ok(!JSON.stringify(failure).includes('fixture-secret-provider-body'));
  assert.equal(objects.size,3);assert.equal((await repository.loadWorkspace(owner)).events.length,0);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(failure))));
 });
 await check('Missing AI settings preserve image and valid PDF sources without provider calls or AI quota',async({database,state})=>{
  let calls=0;provider=async()=>{calls++;throw Error('Must not invoke.');};
  const image=await upload(state);assert.equal(image.draft.sourceFacts,null);assert.equal(image.draft.status,'review-required');
  const pdf=await upload(state,{mime:'application/pdf'});assert.equal(pdf.draft.sourceFacts,null);assert.match(pdf.note,/PDF saved for manual review/);
  assert.equal(calls,0);assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS count FROM ai_usage_limits').get().count,0);
 });
 await check('Inference quota refusal still saves the upload and offers manual review',async({database,state})=>{
  configured();let calls=0;provider=async()=>{calls++;throw Error('Must not invoke.');};
  database.sqlite.prepare('INSERT INTO ai_usage_limits(member_id,feature,window_start,request_count,lease_until) VALUES (?,?,?,?,?)').run(alice.id,'receipt-extraction',Math.floor(Date.now()/3600000)*3600000,20,0);
  const uploaded=await upload(state);assert.equal(uploaded.draft.status,'failed');assert.match(uploaded.note,/limit/);assert.equal(calls,0);
 });
 await check('Currency mismatch preserves the original currency and requires all manual plan-currency fields',async({state})=>{
  configured();provider=async()=>modelResponse({...facts,currency:'USD'});
  const uploaded=await upload(state);assert.equal(uploaded.draft.sourceFacts.currency,'USD');assert.equal(uploaded.receipt.total,0);assert.equal(uploaded.receipt.rows.length,1);assert.equal(uploaded.receipt.rows[0].name,'Meal');assert.equal(uploaded.receipt.rows[0].amount,0);assert.ok(uploaded.reviewFields.includes('items.0.amountCents'));assert.ok(uploaded.reviewFields.includes('currency'));assert.match(uploaded.note,/No amounts were converted/);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,reviewed(uploaded),[]))),400);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded))));
 });
 await check('Viewers can reopen shared drafts but cannot upload or review; expired extraction can be manually recovered',async({database,repository,state})=>{
  const uploaded=await upload(state,{mime:'application/pdf'});
  const rootState=await repository.loadWorkspace(owner);rootState.people.push(makePerson(bob.id,bob.name,'viewer'));await repository.saveWorkspace(owner,rootState,rootState.version);
  const token='a'.repeat(64),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  database.sqlite.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)').run(hash,token,owner,state.plan.id,'viewer',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
  const read=await decoded(await routes.receipt.GET(request(`/api/receipt?draftId=${uploaded.draft.id}`,'GET',undefined,{account:other,token})));assert.equal(read.draft.id,uploaded.draft.id);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded),{account:other,token})),403);
  database.sqlite.prepare("UPDATE receipt_drafts SET status='extracting',updated=? WHERE id=?").run(new Date(Date.now()-120000).toISOString(),uploaded.draft.id);
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded))));
 });
 await check('Receipt source validation rejects invented fields, unsafe amounts and invalid dates',async()=>{
  assert.equal(receiptExtractionSchema.safeParse({...facts,booked:true}).success,false);
  assert.equal(receiptExtractionSchema.safeParse({...facts,totalCents:-1}).success,false);
  assert.equal(receiptExtractionSchema.safeParse({...facts,totalCents:1.25}).success,false);
  assert.equal(receiptExtractionSchema.safeParse({...facts,date:'2027-02-30'}).success,false);
  assert.equal(receiptExtractionSchema.safeParse({...facts,taxCents:null}).success,true);
 });
 await check('Custom line allocations are part of the reviewed source and cannot change before group approval',async({repository,state})=>{
  const uploaded=await upload(state,{mime:'application/pdf'}),receipt=reviewed(uploaded);
  receipt.rows[0].allocation='weight';receipt.rows[0].values={[alice.id]:2};
  await decoded(await routes.receipt.PATCH(request('/api/receipt','PATCH',reviewBody(uploaded,receipt))));
  let current=await repository.loadWorkspace(owner);
  const tampered=structuredClone(receipt);tampered.rows[0].values[alice.id]=3;
  await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:current.version,action:{type:'receipt',receipt:tampered}})),409);
  current=await repository.loadWorkspace(owner);
  const saved=await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:current.version,action:{type:'receipt',receipt}})));
  assert.equal(saved.state.receipts[0].rows[0].values[alice.id],2);assert.equal(saved.state.events.length,0);
 });
 console.log(`${checks} durable receipt checks passed; live inference and payments disabled.`);
}finally{rmSync(temporary,{recursive:true,force:true});delete globalThis.receiptTestEnv;}
