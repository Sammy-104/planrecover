import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {preparePrivateUpload,consumePrivateUpload,cleanupPrivateUploads,privateUploadDigest} from '../lib/private-uploads.ts';
import {TripDocumentService} from '../lib/trip-document-service.ts';
import {createBlobBucket} from '../lib/vercel/blob-bucket.ts';
import {signPrivateUpload} from '../lib/vercel/blob-upload.ts';
import {byteStream} from '../lib/byte-stream.ts';
import {submitFileForm} from '../lib/client-private-upload.ts';

const database=createTestD1(),repository=new PlanRepository(database),owner='private-upload-owner',alice={id:await accountPersonId(owner),name:'Alice'},bob={id:await accountPersonId('upload-bob'),name:'Bob'},viewer={id:await accountPersonId('upload-viewer'),name:'Viewer'};
const bytes=new Uint8Array(5*1024*1024);bytes.set(new TextEncoder().encode('%PDF-1.4\nPrivate fixture'));
const now=Date.now(),storage=new Map(),bucket={put:async(key,data,options)=>storage.set(key,{bytes:new Uint8Array(data),mime:options?.httpMetadata?.contentType}),get:async key=>{const file=storage.get(key);if(!file)return null;return {size:file.bytes.length,httpMetadata:{contentType:file.mime},body:new Response(file.bytes).body,arrayBuffer:async()=>file.bytes.buffer.slice(file.bytes.byteOffset,file.bytes.byteOffset+file.bytes.byteLength)};},delete:async key=>{storage.delete(key);}};
let checks=0;
try{
 const created=await repository.createPlan(owner,alice,{name:'Private upload fixture',destination:'Toronto',start:'2027-04-04',end:'2027-04-05',timezone:'America/Toronto',currency:'CAD',budget:10000}),planId=created.state.plan.id;
 const workspace=await repository.loadWorkspace(owner);addPerson(workspace,bob,'editor');addPerson(workspace,viewer,'viewer');await repository.saveWorkspace(owner,workspace,workspace.version);
 const input={tripId:planId,purpose:'document',filename:'ticket.pdf',mime:'application/pdf',size:bytes.length,sha256:await privateUploadDigest(bytes)};
 await assert.rejects(preparePrivateUpload(database,viewer,input));await assert.rejects(preparePrivateUpload(database,{id:'outsider',name:'Outsider'},input));
 await assert.rejects(preparePrivateUpload(database,alice,{...input,size:8*1024*1024+1}));checks++;
 const grant=await preparePrivateUpload(database,alice,input,{now});assert.match(grant.fileKey,/^[a-f0-9]{64}\/uploads\/[a-f0-9-]{36}$/);assert.equal(grant.expires,now+600000);
 let delegated,signed;
 assert.equal(await signPrivateUpload(grant,'server-secret',{issueSignedToken:async value=>{delegated=value;return {delegationToken:'scope',clientSigningToken:'signing-secret',validUntil:grant.expires};},presignUrl:async(_token,value)=>{signed=value;return {presignedUrl:'https://private.fixture/single-put'};}}),'https://private.fixture/single-put');
 assert.deepEqual(delegated.operations,['put']);assert.equal(delegated.pathname,grant.fileKey);assert.deepEqual(delegated.allowedContentTypes,['application/pdf']);assert.equal(delegated.maximumSizeInBytes,bytes.length);assert.equal(delegated.validUntil,grant.expires);assert.equal(signed.access,'private');assert.equal(signed.allowOverwrite,false);assert.equal(signed.addRandomSuffix,false);checks++;
 storage.set(grant.fileKey,{bytes,mime:input.mime});let publications=0;const service=new TripDocumentService(database,bucket),publish=async file=>{publications++;return {document:await service.upload(planId,alice,{...file,title:'Private ticket',visibility:'private',members:[]})};};
 await assert.rejects(consumePrivateUpload(database,bucket,bob,planId,'document',grant.id,publish));
 await assert.rejects(consumePrivateUpload(database,bucket,alice,planId,'receipt',grant.id,publish));
 const saved=await consumePrivateUpload(database,bucket,alice,planId,'document',grant.id,publish,{now:now+1});assert.equal(saved.document.size,bytes.length);assert.equal(publications,1);
 assert.deepEqual(await consumePrivateUpload(database,bucket,alice,planId,'document',grant.id,publish),JSON.parse(JSON.stringify(saved)));assert.equal(publications,1,'A lost finalization response must not duplicate publication.');
 assert.equal((await service.list(planId,bob)).length,0,'Direct private uploads retain the original document audience.');
 assert.equal((await service.list(planId,alice)).length,1);assert.ok(storage.has(grant.fileKey),'Retain staging key until signed PUT expires to prevent replay recreating an orphan.');checks++;
 const early=await cleanupPrivateUploads(database,bucket,owner,{now:now+2});assert.equal(early.deleted,0);
 const cleaned=await cleanupPrivateUploads(database,bucket,owner,{now:grant.expires+1});assert.equal(cleaned.deleted,1);assert.ok(!storage.has(grant.fileKey));assert.equal((await service.list(planId,alice)).length,1,'Staging cleanup cannot delete published originals.');checks++;
 const stale=await preparePrivateUpload(database,alice,input,{now});storage.set(stale.fileKey,{bytes,mime:input.mime});await assert.rejects(consumePrivateUpload(database,bucket,alice,planId,'document',stale.id,publish,{now:stale.expires+1}));
 const altered=await preparePrivateUpload(database,alice,input,{now});storage.set(altered.fileKey,{bytes:new Uint8Array(bytes.length),mime:input.mime});await assert.rejects(consumePrivateUpload(database,bucket,alice,planId,'document',altered.id,publish,{now:now+1}),/changed/);assert.equal(publications,1);checks++;
 const revoked=await preparePrivateUpload(database,bob,input,{now});storage.set(revoked.fileKey,{bytes,mime:input.mime});database.sqlite.prepare("UPDATE plan_members SET role='viewer' WHERE owner=? AND plan_id=? AND member_id=?").run(owner,planId,bob.id);await assert.rejects(consumePrivateUpload(database,bucket,bob,planId,'document',revoked.id,publish));checks++;
 let readOptions,putOptions,deletedKey;
 const api={get:async(path,options)=>{readOptions=options;return {statusCode:200,stream:new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,2*1024*1024));controller.enqueue(bytes.subarray(2*1024*1024));controller.close();}}),blob:{pathname:path,size:bytes.length,contentType:input.mime,etag:'fixture-etag',uploadedAt:new Date(now)}};},put:async(_path,_data,options)=>{putOptions=options;return {contentType:input.mime,etag:'fixture-etag',url:'must-not-leak'};},del:async path=>{deletedKey=path;},head:async()=>({size:bytes.length,contentType:input.mime,etag:'fixture-etag',uploadedAt:new Date(now)})};
 const adapter=createBlobBucket(database,{token:'server-secret',api}),object=await adapter.get(grant.fileKey);assert.equal(object.size,bytes.length);assert.equal(readOptions.access,'private');assert.equal(readOptions.useCache,false);assert.ok(!('url' in object));
 const response=new Response(object.body);assert.equal(response.headers.get('content-length'),null,'Downloads keep a stream rather than buffering a Vercel response.');assert.equal((await response.arrayBuffer()).byteLength,bytes.length);
 const written=await adapter.put(grant.fileKey,bytes,{httpMetadata:{contentType:input.mime}});assert.equal(putOptions.access,'private');assert.equal(putOptions.allowOverwrite,false);assert.ok(!('url' in written));await adapter.delete(grant.fileKey);assert.equal(deletedKey,grant.fileKey);await assert.rejects(adapter.get('https://someone-else.example/file'));checks++;
 const stream=byteStream(bytes),reader=stream.getReader();let total=0;while(true){const {value,done}=await reader.read();if(done)break;assert.ok(value.byteLength<=65536);total+=value.byteLength;}assert.equal(total,bytes.length);checks++;
 const previousPlatform=process.env.NEXT_PUBLIC_HOSTING_PLATFORM,previousFetch=globalThis.fetch;
 try{
  const form=new FormData();form.set('file',new File([bytes],'ticket.pdf',{type:input.mime}));form.set('tripId',planId);form.set('title','Private ticket');form.set('members','[]');
  const calls=[];process.env.NEXT_PUBLIC_HOSTING_PLATFORM='vercel';globalThis.fetch=async(url,options)=>{assert.equal(url,'https://private.fixture/put-only');assert.equal(options.method,'PUT');assert.equal(options.credentials,'omit');assert.ok(options.body instanceof File);assert.equal(new Headers(options.headers).has('authorization'),false);return new Response(null,{status:200});};
  await submitFileForm('/api/documents',form,async(url,options)=>{calls.push({url,options});return url==='/api/private-uploads'?{uploadId:grant.id,url:'https://private.fixture/put-only'}:{document:saved.document};});
  assert.equal(calls.length,2);const prepared=JSON.parse(calls[0].options.body),final=JSON.parse(calls[1].options.body);assert.equal(prepared.size,bytes.length);assert.equal(prepared.sha256,input.sha256);assert.equal(final.uploadId,grant.id);assert.ok(!('file' in final));assert.ok(!('url' in final));assert.ok(calls.every(call=>typeof call.options.body==='string'&&call.options.body.length<2000),'Vercel application requests contain only bounded metadata, never 5 MiB bytes.');
  process.env.NEXT_PUBLIC_HOSTING_PLATFORM='cloudflare';let ordinary;await submitFileForm('/api/documents',form,async(_url,options)=>{ordinary=options;return {};});assert.equal(ordinary.body,form,'Cloudflare retains the original multipart form.');checks++;
 }finally{globalThis.fetch=previousFetch;if(previousPlatform===undefined)delete process.env.NEXT_PUBLIC_HOSTING_PLATFORM;else process.env.NEXT_PUBLIC_HOSTING_PLATFORM=previousPlatform;}
 console.log(`${checks} private upload checks passed: 5 MiB direct upload publication and browser routing, private scope, signed constraints, source integrity, idempotency, expiry/retention and streamed download/backup adapters. No provider calls.`);
}finally{database.close();}
