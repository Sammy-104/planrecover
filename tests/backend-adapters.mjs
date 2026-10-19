import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
import {initialState,splitReceipt} from '../lib/model.ts';
import {providerConfig,providerPost} from '../lib/http-adapters.ts';
import {queryAmazonLocation} from '../lib/amazon-location.ts';
import {awsJson} from '../lib/aws-adapters.ts';
import {converseAgent,converseJson} from '../lib/bedrock.ts';
import {extractReceipt} from '../lib/receipt-extraction.ts';
import {cleanupReceiptObjects} from '../lib/receipt-retention.ts';
import {runSupplierOperation} from '../lib/supplier-adapter.ts';
import {runExternalReminderJobs,saveNotificationDestination} from '../lib/notification-adapter.ts';
import {syncPlanReminders} from '../lib/reminder-jobs.ts';
import {defaultPlanningPreferences} from '../lib/planning-constraints.ts';
import {runApprovalWorkflow} from '../lib/step-functions.ts';
import {PlanChangeService} from '../lib/plan-changes.ts';
import relayWorker,{relayPayPal} from '../infrastructure/paypal-relay/worker.ts';
let checks=0;
async function check(name,run){await run();checks++;console.log('PASS '+name);}
const aws={AWS_ADAPTERS_ENABLED:'true',AWS_ADAPTER_ACCESS_KEY_ID:'AKIDEXAMPLE',AWS_ADAPTER_SECRET_ACCESS_KEY:'fixture-secret',AWS_ADAPTER_SESSION_TOKEN:'fixture-session'};
const bedrock={apiKey:'fixture-token',region:'ca-central-1',modelId:'ca.amazon.nova-lite-v1:0',timeoutMs:5000,maxTokens:1000};
const usage={inputTokens:10,outputTokens:5,totalTokens:15};
await check('AWS and generic provider redirects never become accepted responses or credential-forwarding follow-ups',async()=>{
 for(const status of [301,302,303,307,308]){
  let calls=0;const fetcher=async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return Response.json({accepted:true},{status,headers:{Location:'https://redirect-target.invalid/'}});};
  await assert.rejects(awsJson(aws,'geo-places','SearchText',{QueryText:'Toronto'},{fetch:fetcher}),error=>error.code==='ADAPTER_PROVIDER');
  assert.equal(calls,1);calls=0;
  await assert.rejects(providerPost({origin:'https://provider.example.com',token:'fixture-token'},'/quote',{},'fixture-request',fetcher),error=>error.code==='ADAPTER_PROVIDER');
  assert.equal(calls,1);
 }
});
await check('Unconfigured adapters make no network requests; private and credential-bearing origins are rejected',async()=>{
 assert.equal(providerConfig({},'SUPPLIER'),null);for(const origin of ['http://example.com','https://127.0.0.1','https://localhost','https://private.internal','https://user:password@example.com','https://example.com/path'])assert.throws(()=>providerConfig({SUPPLIER_ORIGIN:origin,SUPPLIER_TOKEN:'key'},'SUPPLIER'));
 await assert.rejects(queryAmazonLocation({}, {operation:'search',query:'Toronto',bias:[-79,43],maxResults:5},()=>{throw Error('must not call');}),e=>e.code==='AWS_ADAPTER_UNCONFIGURED');
});
await check('AWS requests are signed independently correctly, pin Canadian endpoints and preserve route units',async()=>{
 let calls=0;const now=new Date('2026-10-15T12:34:56Z');await awsJson(aws,'geo-places','SearchText',{QueryText:'Toronto'},{now,fetch:async(url,init)=>{calls++;assert.equal(url,'https://places.geo.ca-central-1.amazonaws.com/v2/search-text');assert.equal(init.redirect,'manual');assert.equal(init.headers['x-amz-security-token'],'fixture-session');
  const names=['content-type','host','x-amz-date','x-amz-security-token'],canonical=names.map(n=>`${n}:${init.headers[n]}\n`).join('');const hash=s=>createHash('sha256').update(s).digest('hex');const request=`POST\n/v2/search-text\n\n${canonical}\n${names.join(';')}\n${hash(init.body)}`;
  let key=Buffer.from('AWS4fixture-secret');for(const part of ['20261015','ca-central-1','geo-places','aws4_request'])key=createHmac('sha256',key).update(part).digest();const signature=createHmac('sha256',key).update(`AWS4-HMAC-SHA256\n20261015T123456Z\n20261015/ca-central-1/geo-places/aws4_request\n${hash(request)}`).digest('hex');assert.ok(init.headers.Authorization.endsWith(signature));return Response.json({ResultItems:[]});}});assert.equal(calls,1);
 const route=await queryAmazonLocation(aws,{operation:'route',origin:[-79,43],destination:[-79.1,43.1],travelMode:'Pedestrian'},async(url,init)=>{assert.equal(new URL(url).hostname,'routes.geo.ca-central-1.amazonaws.com');return Response.json({Routes:[{Summary:{Distance:1234,Duration:456}}]});});assert.deepEqual(route.routes,[{distanceMetres:1234,durationSeconds:456}]);assert.equal(route.bookingAuthority,false);
});
await check('Bedrock tools use a bounded validated loop; invented tools are never executed',async()=>{
 let calls=0,executions=0;const result=await converseAgent(bedrock,{system:'Prepare review previews only.',prompt:'Plan a museum visit',tools:[{name:'preview',description:'Read preview',inputSchema:{type:'object'}}],execute:async(name,input)=>{executions++;assert.equal(name,'preview');return {reviewUrl:'/flows?proposal=fixture',applied:false};}}, {fetch:async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.toolConfig.toolChoice.auto.constructor,Object);return calls===1?Response.json({output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'safe-id',name:'preview',input:{}}}]}},stopReason:'tool_use',usage}):Response.json({output:{message:{role:'assistant',content:[{text:'Review the saved proposal in PlanRecover.'}]}},stopReason:'end_turn',usage});}});assert.equal(executions,1);assert.equal(calls,2);assert.equal(result.results.length,1);
 await assert.rejects(converseAgent(bedrock,{system:'Safe',prompt:'Test',tools:[{name:'preview',description:'Read',inputSchema:{type:'object'}}],execute:async()=>{throw Error('must not execute');}},{fetch:async()=>Response.json({output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'bad',name:'capture_payment',input:{}}}]}},stopReason:'tool_use',usage})}),e=>e.code==='BEDROCK_OUTPUT');
});
await check('PDF extraction sends a neutral document block and preserves human review; quantity extensions are exact',async()=>{
 let requested;const facts={merchant:'Shop',date:'2026-10-15',currency:'CAD',items:[{name:'Coffee',amountCents:500,quantityMilli:2000,unitPriceCents:300,lineDiscountCents:100}],taxCents:0,tipCents:0,discountCents:0,totalCents:500,flags:[]};
 const result=await extractReceipt({AWS_BEARER_TOKEN_BEDROCK:'fixture-token',BEDROCK_REGION:'ca-central-1',BEDROCK_MODEL_ID:'ca.amazon.nova-lite-v1:0'},{mime:'application/pdf',bytes:new TextEncoder().encode('%PDF-fixture')},'CAD',{fetch:async(url,init)=>{requested=JSON.parse(init.body);return Response.json({output:{message:{role:'assistant',content:[{text:JSON.stringify(facts)}]}},stopReason:'end_turn',usage});}});
 assert.equal(result.facts.items[0].quantityMilli,2000);assert.equal(requested.messages[0].content[1].document.name,'Receipt');assert.equal(requested.messages[0].content[1].document.format,'pdf');
 const receipt={rows:[{id:'one',name:'Coffee',amount:500,claims:['a'],quantityMilli:2000,unitPrice:300,lineDiscount:100}],tax:0,tip:0,discount:0,total:500,tipRule:'proportional'};assert.equal(splitReceipt(receipt,['a']).a,500);assert.throws(()=>splitReceipt({...receipt,rows:[{...receipt.rows[0],amount:501}],total:501},['a']),/match the line amount/);
});
const owner='adapter-owner',alice={id:await accountPersonId(owner),name:'Alice'};
await check('Optional Textract uses its own signed Canadian endpoint, retains detections and never guesses absent currency or discounts',async()=>{
 const field=(name,text)=>({Type:{Text:name},ValueDetection:{Text:text,Confidence:98},Currency:{Code:'CAD'}}),document={DocumentMetadata:{Pages:1},ExpenseDocuments:[{SummaryFields:[field('VENDOR_NAME','Fixture shop'),field('TOTAL','$5.00')],LineItemGroups:[{LineItems:[{LineItemExpenseFields:[field('ITEM','Coffee'),field('PRICE','5.00'),field('QUANTITY','2'),field('UNIT_PRICE','2.50')]}]}]}]};let calls=0;
 const result=await extractReceipt({...aws,RECEIPT_EXTRACTION_PROVIDER:'textract'},{mime:'image/png',bytes:new Uint8Array([137,80,78,71])},'CAD',{fetch:async(url,init)=>{calls++;assert.equal(url,'https://textract.ca-central-1.amazonaws.com/');assert.equal(init.headers['x-amz-target'],'Textract.AnalyzeExpense');assert.equal(init.headers['content-type'],'application/x-amz-json-1.1');assert.match(init.headers.Authorization,/ca-central-1\/textract\/aws4_request/);assert.equal(JSON.parse(init.body).Document.Bytes,'iVBORw==');return Response.json(document);}});
 assert.equal(calls,1);assert.equal(result.provider,'aws-textract');assert.equal(result.facts.totalCents,500);assert.equal(result.facts.items[0].quantityMilli,2000);assert.equal(result.facts.items[0].lineDiscountCents,null);assert.equal(result.facts.detections[0].confidence,98);
 const missing=structuredClone(document);for(const field of [...missing.ExpenseDocuments[0].SummaryFields,...missing.ExpenseDocuments[0].LineItemGroups[0].LineItems[0].LineItemExpenseFields])delete field.Currency;
 const unknown=await extractReceipt({...aws,RECEIPT_EXTRACTION_PROVIDER:'textract'},{mime:'image/jpeg',bytes:new Uint8Array([255,216,255])},'CAD',{fetch:async()=>Response.json(missing)});assert.equal(unknown.facts.currency,null);assert.equal(unknown.facts.totalCents,null);
 const disabled=await extractReceipt({RECEIPT_EXTRACTION_PROVIDER:'textract'},{mime:'image/png',bytes:new Uint8Array([137,80,78,71])},'CAD',{fetch:async()=>{throw Error('disabled');}});assert.equal(disabled.facts,null);assert.equal(disabled.failed,true);
});
async function fixture(run){const database=createTestD1();try{const repository=new PlanRepository(database),record=await repository.createPlan(owner,alice,{name:'Adapter fixtures',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});await run({database,repository,planId:record.state.plan.id});}finally{database.close();}}
await check('Receipt retention deletes abandoned managed sources but retains reviewed and referenced evidence',()=>fixture(async({database,repository,planId})=>{
 const old='2020-01-01T00:00:00Z';for(const key of ['unused','reviewed','referenced'])await database.prepare("INSERT INTO receipt_objects(file_key,owner,plan_id,status,created) VALUES (?,?,?,'ready',?)").bind(key,owner,planId,old).run();
 await database.prepare("INSERT INTO receipt_drafts(id,owner,plan_id,uploaded_by,file_key,mime,size,status,unknown_fields,warnings,created,updated) VALUES ('reviewed-draft',?,?,?,'reviewed','image/png',10,'reviewed','[]','[]',?,?)").bind(owner,planId,alice.id,old,old).run();const root=await repository.loadWorkspace(owner);root.receipts.push({fileKey:'referenced'});await repository.saveWorkspace(owner,root,root.version);
 const deleted=[];const result=await cleanupReceiptObjects(database,{delete:async key=>deleted.push(key)},owner);assert.deepEqual(deleted,['unused']);assert.equal(result.deleted,1);assert.equal(database.sqlite.prepare("SELECT status FROM receipt_objects WHERE file_key='reviewed'").get().status,'ready');
}));
await check('Sandbox supplier quotes are request-bound, idempotent and cannot book without approvals and verified money',()=>fixture(async({database,repository,planId})=>{
 const root=await repository.loadWorkspace(owner);root.items.push({id:'item',name:'Museum',category:'Activity',start:'2027-04-04T14:00:00-04:00',duration:60,price:1000,participants:[alice.id],shares:{[alice.id]:1000},allocation:'equal',values:{},revision:1,approvals:[],status:'draft',booking:'unconfirmed',policy:'Terms pending',source:'Manual',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'});await repository.saveWorkspace(owner,root,root.version);const record=await repository.getPlan(planId,alice),id=crypto.randomUUID(),input={operation:'quote',requestId:id,version:record.version,itemId:'item',revision:1};const env={SUPPLIER_ORIGIN:'https://supplier.example.com',SUPPLIER_TOKEN:'fixture-key',SUPPLIER_MODE:'sandbox',SUPPLIER_BOOKING_ENABLED:'true'};let calls=0;
 const provider=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(init.headers['Idempotency-Key'],id);assert.equal(body.item.id,'item');return Response.json({sandbox:true,quoteId:'quote',itemId:'item',revision:1,amount:1000,currency:'CAD',expiresAt:'2029-01-01T00:00:00Z',available:true,terms:'Reviewed fictional terms',sourceUrl:'https://supplier.example.com/terms'});};
 await runSupplierOperation(database,env,planId,alice,input,provider);await runSupplierOperation(database,env,planId,alice,input,provider);assert.equal(calls,1);
 await assert.rejects(runSupplierOperation(database,env,planId,alice,{...input,operation:'book',requestId:crypto.randomUUID(),quoteOperationId:id,confirm:true},provider),e=>e.code==='SUPPLIER_FUNDING');assert.equal(calls,1);
 await assert.rejects(runSupplierOperation(database,env,planId,alice,{...input,revision:2},provider));
}));
await check('External reminders require opt-in and account-owned destinations, deduplicate acknowledgments, and remain disabled without configuration',()=>fixture(async({database,repository,planId})=>{
 let root=await repository.loadWorkspace(owner);root.items.push({id:'task',name:'Pack',category:'Preparation',start:new Date(Date.now()-1000).toISOString(),duration:5,price:0,participants:[alice.id],shares:{[alice.id]:0},allocation:'equal',values:{},revision:1,approvals:[alice.id],status:'scheduled',booking:'unconfirmed',policy:'Task',source:'Manual',expires:null,deadline:null,depends:[],paid:[],location:'Toronto',taskOwner:alice.id});await repository.saveWorkspace(owner,root,root.version);
 const prefs=defaultPlanningPreferences('America/Toronto');prefs.delivery={inApp:false,email:true,push:false};prefs.leadMinutes=[0];await database.prepare('INSERT INTO member_planning_preferences(owner,plan_id,member_id,body,version,updated) VALUES (?,?,?,?,1,?)').bind(owner,planId,alice.id,JSON.stringify(prefs),new Date().toISOString()).run();
 await assert.rejects(saveNotificationDestination(database,planId,alice,{channel:'email',destination:'other@example.com',version:0,confirm:true},'alice@example.com'));
 await saveNotificationDestination(database,planId,alice,{channel:'email',destination:'alice@example.com',version:0,confirm:true},'alice@example.com');await syncPlanReminders(database,owner,{plan:{id:planId}});
 assert.equal((await runExternalReminderJobs(database,{},owner)).attempted,0);let calls=0;const env={NOTIFICATION_ORIGIN:'https://notify.example.com',NOTIFICATION_TOKEN:'fixture-key'},fetcher=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.destination,'alice@example.com');return Response.json({accepted:true,requestId:body.requestId,deliveryId:'provider-delivery'});};
 const result=await runExternalReminderJobs(database,env,owner,{fetch:fetcher});assert.equal(result.accepted,1);await runExternalReminderJobs(database,env,owner,{fetch:fetcher});assert.equal(calls,1);
}));
await check('Step Functions callback tokens are encrypted and approval cannot resume before all affected members agree',()=>fixture(async({database,repository,planId})=>{
 const root=await repository.loadWorkspace(owner);root.items.push({id:'free',name:'Free stop',category:'Free stop',start:'2027-04-04T14:00:00-04:00',duration:60,price:0,participants:[alice.id],shares:{[alice.id]:0},allocation:'equal',values:{},revision:1,approvals:[],status:'draft',booking:'unconfirmed',policy:'Free',source:'Manual',expires:null,deadline:null,depends:[],paid:[],location:'Toronto'});await repository.saveWorkspace(owner,root,root.version);const record=await repository.getPlan(planId,alice),service=new PlanChangeService(database),change=await service.propose(planId,alice,{type:'recovery',version:record.version,itemIds:['free'],option:'cancel',replacements:[]});
 const env={...aws,STEP_FUNCTIONS_STATE_MACHINE_ARN:'arn:aws:states:ca-central-1:123456789012:stateMachine:Approval',STEP_FUNCTIONS_ACTIVITY_ARN:'arn:aws:states:ca-central-1:123456789012:activity:Approval',WORKFLOW_TOKEN_KEY:'fixture-only-encryption-key-longer-than-32'};let taskInput,calls=0;
 const fetcher=async(url,init)=>{calls++;const target=init.headers['x-amz-target'],body=JSON.parse(init.body);if(target.endsWith('StartExecution')){taskInput=body.input;return Response.json({executionArn:'arn:aws:states:ca-central-1:123456789012:execution:Approval:fixture'});}if(target.endsWith('GetActivityTask'))return Response.json({taskToken:'sensitive-fixture-task-token',input:taskInput});assert.ok(target.endsWith('SendTaskSuccess'));assert.equal(body.taskToken,'sensitive-fixture-task-token');assert.equal(JSON.parse(body.output).paymentAuthorized,false);return Response.json({});};
 const input={changeId:change.id,version:record.version,confirm:true};await runApprovalWorkflow(database,env,planId,alice,{...input,action:'start'},fetcher);await runApprovalWorkflow(database,env,planId,alice,{...input,action:'claim-approval'},fetcher);assert.ok(!database.sqlite.prepare("SELECT response FROM adapter_operations WHERE provider='aws-step-functions'").get().response.includes('sensitive-fixture-task-token'));
 await assert.rejects(runApprovalWorkflow(database,env,planId,alice,{...input,action:'complete-approval'},fetcher));assert.equal(calls,2);await service.act(planId,alice,{type:'approve',changeId:change.id,version:record.version,confirm:true});await runApprovalWorkflow(database,env,planId,alice,{...input,action:'complete-approval'},fetcher);assert.equal(calls,3);assert.equal((await repository.getPlan(planId,alice)).state.items[0].status,'draft');
}));
await check('Webhook relay preserves exact signature bytes and forwards no visitor headers or arbitrary targets',async()=>{
 const raw='{\n  "id": "WH-FIXTURE", "event_type": "PAYMENT.CAPTURE.COMPLETED"\n}',headers={'content-type':'application/json','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT','paypal-transmission-id':'delivery','paypal-transmission-sig':'signature','paypal-transmission-time':'2026-10-15T10:00:00Z',cookie:'private-cookie','oai-authenticated-user-id':'spoofed'};
 let calls=0;const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site/api/webhooks/paypal');assert.equal(new TextDecoder().decode(init.body),raw);assert.equal(init.headers.get('cookie'),null);assert.equal(init.headers.get('oai-authenticated-user-id'),null);assert.equal(init.headers.get('OAI-Sites-Authorization'),'Bearer fixture-only');return Response.json({received:true});};
 assert.equal((await relayPayPal(new Request('https://relay.example.com/paypal',{method:'POST',headers,body:raw}),{PLANRECOVER_SITE_SERVICE_TOKEN:'fixture-only'},fetcher)).status,200);
 assert.equal((await relayPayPal(new Request('https://relay.example.com/other',{method:'POST',headers,body:raw}),{PLANRECOVER_SITE_SERVICE_TOKEN:'fixture-only'},fetcher)).status,404);assert.equal(calls,1);
 const originalFetch=globalThis.fetch;try{globalThis.fetch=fetcher;assert.equal((await relayWorker.fetch(new Request('https://relay.example.com/paypal',{method:'POST',headers,body:raw}),{PLANRECOVER_SITE_SERVICE_TOKEN:'fixture-only'},{waitUntil(){}})).status,200);assert.equal(calls,2);}finally{globalThis.fetch=originalFetch;}
});
console.log(`${checks} provider adapter, receipt and workflow checks passed with fixture HTTP only.`);
