import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const priorPlatform=process.env.NEXT_PUBLIC_HOSTING_PLATFORM,priorFetch=globalThis.fetch,priorWindow=globalThis.window,priorNow=Date.now;
const browser=new EventTarget();browser.location={hash:''};globalThis.window=browser;process.env.NEXT_PUBLIC_HOSTING_PLATFORM='vercel';
const {submitFileForm,clearPendingPrivateUploads}=await import('../lib/client-private-upload.ts');
let now=1000000,grants=0,puts=0,finals=0,mode='lost',ids=[],pause;
Date.now=()=>now;
const file=new File([new TextEncoder().encode('%PDF-1.4\nPrivate retry fixture')],'ticket.pdf',{type:'application/pdf'});
const form=(title='Ticket')=>{const value=new FormData();value.set('tripId','same-plan');value.set('title',title);value.set('visibility','private');value.set('members','[]');value.set('file',file);return value;};
const request=async(path,options)=>{
 const body=JSON.parse(options.body);
 if(path==='/api/private-uploads'){grants++;return {uploadId:'server-upload-'+grants,url:'https://private.fixture/put-'+grants,expires:now+600000};}
 finals++;ids.push(body.uploadId);assert.ok(!('file' in body));assert.ok(!('url' in body));
 if(mode==='lost')throw Error('Final response lost after publication.');
 if(mode==='forbidden')throw Object.assign(Error('Editing access was revoked.'),{status:403});
 if(mode==='expired')throw Object.assign(Error('This upload expired. Choose the file again.'),{status:409});
 if(mode==='busy')throw Object.assign(Error('This upload is still being saved. Retry shortly.'),{status:409});
 if(mode==='sync')return pause;
 return {document:{id:'published-file',uploadId:body.uploadId}};
};
globalThis.fetch=async(url,options)=>{puts++;assert.match(url,/^https:\/\/private\.fixture\/put-/);assert.equal(options.method,'PUT');assert.equal(options.credentials,'omit');return new Response(null,{status:200});};
let checks=0;
function reset(){clearPendingPrivateUploads();grants=0;puts=0;finals=0;ids=[];mode='lost';}
try{
 await assert.rejects(submitFileForm('/api/documents',form(),request),/lost/);mode='success';
 const result=await submitFileForm('/api/documents',form(),request);assert.equal(result.document.uploadId,'server-upload-1');assert.equal(grants,1);assert.equal(puts,1);assert.equal(finals,2);assert.deepEqual(ids,['server-upload-1','server-upload-1']);checks++;
 await submitFileForm('/api/documents',form(),request);assert.equal(grants,2,'A successful final reply removes the retry record.');assert.equal(puts,2);checks++;
 reset();await assert.rejects(submitFileForm('/api/documents',form('Original metadata'),request));mode='success';await submitFileForm('/api/documents',form('Changed metadata'),request);assert.equal(grants,2);assert.equal(puts,2,'Different reviewed metadata cannot reuse another finalization.');checks++;
 reset();await assert.rejects(submitFileForm('/api/documents',form(),request));now+=24*60*60*1000+1;mode='success';await submitFileForm('/api/documents',form(),request);assert.equal(grants,2,'Recovery records expire within a bounded interval.');checks++;
 reset();for(let i=0;i<8;i++)await assert.rejects(submitFileForm('/api/documents',form('Pending '+i),request));await assert.rejects(submitFileForm('/api/documents',form('Ninth pending'),request),/earlier uploads/);assert.equal(grants,8,'An uncertain upload cannot silently evict another deduplication record.');now+=24*60*60*1000+1;mode='success';await submitFileForm('/api/documents',form('Ninth pending'),request);assert.equal(grants,9);checks++;
 for(const failure of ['forbidden','expired']){reset();mode=failure;await assert.rejects(submitFileForm('/api/documents',form(),request));mode='success';await submitFileForm('/api/documents',form(),request);assert.equal(grants,2,'Definitive '+failure+' failures release the old session.');}checks++;
 reset();mode='busy';await assert.rejects(submitFileForm('/api/documents',form(),request));mode='success';await submitFileForm('/api/documents',form(),request);assert.equal(grants,1);assert.equal(puts,1,'A temporary busy response retries finalization only.');checks++;
 reset();await assert.rejects(submitFileForm('/api/documents',form(),request));browser.dispatchEvent(new Event('pagehide'));mode='success';await submitFileForm('/api/documents',form(),request);assert.equal(grants,2,'Full-page authentication redirects discard previous-account retry state.');checks++;
 reset();mode='sync';let release;pause=new Promise(resolve=>{release=resolve;});const first=submitFileForm('/api/documents',form(),request),second=submitFileForm('/api/documents',form(),request);while(!finals)await new Promise(resolve=>setTimeout(resolve,0));release({document:{id:'one-publication'}});await Promise.all([first,second]);assert.equal(grants,1);assert.equal(puts,1);assert.equal(finals,1,'Concurrent identical submits share one bounded operation.');checks++;
 reset();const ordinary=form();process.env.NEXT_PUBLIC_HOSTING_PLATFORM='cloudflare';let received;await submitFileForm('/api/documents',ordinary,async(_path,options)=>{received=options.body;return {};});assert.equal(received,ordinary);assert.equal(grants,0);assert.equal(puts,0);checks++;
 // Bundle the actual UI request adapter, so this checks the server-code path used by the wallet/scanner.
 const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),viteRequire=createRequire(require.resolve('vite')),{build}=viteRequire(viteRequire.resolve('esbuild'));
 const built=await build({stdin:{contents:"export {jsonFetch,WorkspaceError} from './app/workbench/shared';",resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',target:'node24',packages:'external',jsx:'automatic',tsconfig:root+'tsconfig.json',logLevel:'silent'}),actual={exports:{}};
 delete globalThis.window;try{new Function('require','module','exports',built.outputFiles[0].text)(require,actual,actual.exports);}finally{globalThis.window=browser;}
 reset();process.env.NEXT_PUBLIC_HOSTING_PLATFORM='vercel';let expired=true;
 globalThis.fetch=async(path,options)=>{
  if(path==='/api/private-uploads'){grants++;return Response.json({uploadId:'actual-upload-'+grants,url:'https://private.fixture/actual-put'});}
  if(path==='https://private.fixture/actual-put'){puts++;return new Response(null,{status:200});}
  finals++;return expired?Response.json({error:'Source not retained.',code:'UPLOAD_EXPIRED'},{status:409}):Response.json({document:{id:'actual-ui-publication'}});
 };
 await assert.rejects(submitFileForm('/api/documents',form(),actual.exports.jsonFetch),error=>error instanceof actual.exports.WorkspaceError&&error.status===409&&error.code==='UPLOAD_EXPIRED');
 expired=false;await submitFileForm('/api/documents',form(),actual.exports.jsonFetch);assert.equal(grants,2,'The actual UI adapter must retain an expiry code even when the human message contains no classifier keywords.');assert.equal(puts,2);checks++;
 console.log(`${checks} client private upload checks passed: lost final response reuse, successful cleanup, exact metadata, expiry/capacity, definitive errors, temporary busy state, auth navigation and concurrent submissions. No provider calls.`);
}finally{clearPendingPrivateUploads();globalThis.fetch=priorFetch;Date.now=priorNow;if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;if(priorPlatform===undefined)delete process.env.NEXT_PUBLIC_HOSTING_PLATFORM;else process.env.NEXT_PUBLIC_HOSTING_PLATFORM=priorPlatform;}
