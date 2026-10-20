import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {TripDocumentService} from '../lib/trip-document-service.ts';
import {ReceiptDraftRepository} from '../lib/receipt-drafts.ts';
import {publishReceiptSource} from '../lib/receipt-source-publication.ts';
import {preparePrivateUpload,consumePrivateUpload,cleanupPrivateUploads,privateUploadDigest,PRIVATE_UPLOAD_LEASE_MS,PRIVATE_UPLOAD_RECOVERY_MS} from '../lib/private-uploads.ts';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(purpose='document'){
 const original=createTestD1(),owner='upload-recovery-fixture',identity={id:'person-upload-recovery',name:'Fixture owner'},now=Date.now(),storage=new Map(),bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic private upload recovery fixture');let puts=0,outage=false,fault;
 const wrap=statement=>({sql:statement.sql,bind:(...args)=>wrap(statement.bind(...args)),first:async(...args)=>{if(outage)throw Error('Synthetic database outage');return statement.first(...args);},all:async(...args)=>{if(outage)throw Error('Synthetic database outage');return statement.all(...args);},run:async(...args)=>{if(outage)throw Error('Synthetic database outage');return statement.run(...args);},raw:async(...args)=>{if(outage)throw Error('Synthetic database outage');return statement.raw(...args);},execute:(...args)=>{if(outage)throw Error('Synthetic database outage');return statement.execute(...args);}});
 const database={prepare:sql=>wrap(original.prepare(sql)),exec:(...args)=>original.exec(...args),batch:async statements=>{if(outage)throw Error('Synthetic database outage');const target=statements.some(s=>s.sql.includes(purpose==='document'?'INSERT INTO trip_documents':'INSERT INTO receipt_drafts'));if(target&&fault==='before'){fault=undefined;throw Error('Synthetic failure before publication');}const result=await original.batch(statements);if(target&&fault==='after'){fault=undefined;outage=true;throw Error('Synthetic lost publication acknowledgement');}return result;}};
 const repository=new PlanRepository(database),created=await repository.createPlan(owner,identity,{name:'Upload recovery fixture',destination:'Toronto',start:'2027-04-04',end:'2027-04-05',timezone:'America/Toronto',currency:'CAD',budget:10000}),planId=created.state.plan.id;
 const bucket={put:async(key,data,options)=>{if(storage.has(key))throw Error('Synthetic immutable object already exists');puts++;storage.set(key,{bytes:new Uint8Array(data),mime:options?.httpMetadata?.contentType});},get:async key=>{const file=storage.get(key);if(!file)return null;return {size:file.bytes.length,httpMetadata:{contentType:file.mime},body:new Response(file.bytes).body,arrayBuffer:async()=>file.bytes.buffer.slice(file.bytes.byteOffset,file.bytes.byteOffset+file.bytes.byteLength)};},delete:async key=>{storage.delete(key);}};
 const input={tripId:planId,purpose,filename:'fixture.pdf',mime:'application/pdf',size:bytes.length,sha256:await privateUploadDigest(bytes)},grant=await preparePrivateUpload(database,identity,input,{now});storage.set(grant.fileKey,{bytes,mime:input.mime});
 const service=new TripDocumentService(database,bucket),drafts=new ReceiptDraftRepository(database),scope={owner,planId,memberId:identity.id};let publications=0;
 const publish=async file=>{publications++;return purpose==='document'?{document:await service.upload(planId,identity,{...file,title:'Fixture publication',visibility:'private',members:[]})}:{draft:await publishReceiptSource(database,bucket,drafts,scope,file,draft=>({draft}))};};
 return {database,original,owner,identity,now,storage,bytes,bucket,planId,grant,purpose,publish,scope,drafts,consume:(callback=publish,time=now+1)=>consumePrivateUpload(database,bucket,identity,planId,purpose,grant.id,callback,{now:time}),setFault:value=>{fault=value;},recover:()=>{outage=false;},get puts(){return puts;},get publications(){return publications;},row:()=>original.prepare('SELECT * FROM private_uploads WHERE id=?').bind(grant.id).first(),count:async()=>(await original.prepare(`SELECT COUNT(*) AS count FROM ${purpose==='document'?'trip_documents':'receipt_drafts'}`).first('count')),close:()=>original.close()};
}
let checks=0;async function check(name,run){await run();checks++;console.log(`PASS ${name}`);}
for(const purpose of ['document','receipt']){
 await check(`${purpose}: lost publication acknowledgement then retry returns one durable record`,async()=>{
  const f=await fixture(purpose);try{
   f.setFault('after');await assert.rejects(f.consume(),/lost publication acknowledgement/);f.recover();
   assert.equal((await f.row()).status,'used','The durable record and upload linkage committed together despite unavailable readback.');
   const saved=await f.consume();assert.equal((saved.document??saved.draft).id,f.grant.id);
   assert.equal(await f.count(),1);assert.equal(f.publications,1);assert.equal(f.puts,1);
   assert.ok(f.storage.has((saved.document?await f.original.prepare('SELECT file_key FROM trip_documents WHERE id=?').bind(saved.document.id).first('file_key'):saved.draft.fileKey)),'The committed source was not deleted by an error handler.');
  }finally{f.close();}
 });
 await check(`${purpose}: precommit failure reuses verified immutable bytes without duplicate PUT or record`,async()=>{
  const f=await fixture(purpose);try{
   f.setFault('before');await assert.rejects(f.consume(),/before publication/);assert.equal((await f.row()).status,'failed');assert.equal(await f.count(),0);assert.equal(f.puts,1);
   const saved=await f.consume(undefined,f.now+2);assert.equal((saved.document??saved.draft).id,f.grant.id);assert.equal(await f.count(),1);assert.equal(f.puts,1);
   assert.equal((await f.row()).status,'used');assert.equal(f.publications,2);
  }finally{f.close();}
 });
}
await check('A failure after receipt source publication recovers that source without repeating extraction/publication',async()=>{
 const f=await fixture('receipt');try{
  const result=await f.consume(async file=>{await f.publish(file);throw Error('Synthetic extraction interruption');});
  assert.equal(result.draft.id,f.grant.id);assert.equal(result.draft.status,'uploaded');assert.equal(await f.count(),1);
  await f.consume();assert.equal(f.publications,1);assert.equal(f.puts,1);
 }finally{f.close();}
});
await check('Expired processing leases permit one takeover while a stale worker cannot overwrite success',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();try{
  const old=f.consume(async file=>{entered.resolve();await release.promise;return f.publish(file);});await entered.promise;
  await assert.rejects(f.consume(undefined,f.now+2),error=>error.code==='UPLOAD_BUSY');
  const saved=await f.consume(undefined,f.now+PRIVATE_UPLOAD_LEASE_MS+2);release.resolve();const recovered=await old;
  assert.deepEqual(recovered,JSON.parse(JSON.stringify(saved)));assert.equal(await f.count(),1);assert.equal((await f.row()).status,'used');assert.equal(f.puts,1);
 }finally{release.resolve();f.close();}
});
await check('A stale worker failure cannot release or fail the new worker lease',async()=>{
 const f=await fixture(),oldEntered=deferred(),oldRelease=deferred(),newEntered=deferred(),newRelease=deferred();try{
  const old=f.consume(async()=>{oldEntered.resolve();await oldRelease.promise;throw Error('Synthetic stale worker failure');});await oldEntered.promise;
  const next=f.consume(async file=>{newEntered.resolve();await newRelease.promise;return f.publish(file);},f.now+PRIVATE_UPLOAD_LEASE_MS+2);await newEntered.promise;
  const lease=(await f.row()).result;oldRelease.resolve();await assert.rejects(old,/stale worker failure/);
  const held=await f.row();assert.equal(held.status,'processing');assert.equal(held.result,lease);assert.ok(held.lease_until>f.now+PRIVATE_UPLOAD_LEASE_MS+2);
  newRelease.resolve();await next;assert.equal(await f.count(),1);assert.equal((await f.row()).status,'used');
 }finally{oldRelease.resolve();newRelease.resolve();f.close();}
});
await check('Processing recovery withholds cleanup after PUT expiry, then releases staging after publication',async()=>{
 const f=await fixture();try{
  await f.original.prepare("UPDATE private_uploads SET status='processing',result=?,lease_until=? WHERE id=?").bind(JSON.stringify({leaseToken:'synthetic-crashed-worker'}),f.now+PRIVATE_UPLOAD_LEASE_MS,f.grant.id).run();
  assert.equal((await cleanupPrivateUploads(f.database,f.bucket,f.owner,{now:f.grant.expires+1})).deleted,0);assert.ok(f.storage.has(f.grant.fileKey));
  await f.consume(undefined,f.grant.expires+2);assert.equal(await f.count(),1);
  assert.equal((await cleanupPrivateUploads(f.database,f.bucket,f.owner,{now:f.grant.expires+3})).deleted,1);assert.equal(await f.count(),1);assert.equal(f.storage.has(f.grant.fileKey),false);
 }finally{f.close();}
});
await check('Abandoned recovery is bounded to 24 hours and cannot publish after cleanup',async()=>{
 const f=await fixture();try{
  await f.original.prepare("UPDATE private_uploads SET status='failed' WHERE id=?").bind(f.grant.id).run();
  const later=f.now+PRIVATE_UPLOAD_RECOVERY_MS+1;assert.equal((await cleanupPrivateUploads(f.database,f.bucket,f.owner,{now:later})).deleted,1);
  await assert.rejects(f.consume(undefined,later+1),error=>error.code==='UPLOAD_EXPIRED');assert.equal(await f.count(),0);
 }finally{f.close();}
});
await check('A mismatched deterministic object cannot be overwritten or published on retry',async()=>{
 const f=await fixture();try{
  f.setFault('before');await assert.rejects(f.consume());const publishedKey=[...f.storage.keys()].find(key=>key!==f.grant.fileKey);assert.ok(publishedKey);
  f.storage.set(publishedKey,{bytes:new Uint8Array(f.bytes.length),mime:'application/pdf'});
  await assert.rejects(f.consume(undefined,f.now+2),error=>error.code==='UPLOAD_OBJECT');assert.equal(await f.count(),0);assert.equal(f.puts,1);
 }finally{f.close();}
});
console.log(`${checks} durable upload recovery checks passed; no provider calls.`);
