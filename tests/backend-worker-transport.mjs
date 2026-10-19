import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Use Wrangler's installed runtime instead of Node's different Fetch behavior.
const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/wrangler/package.json',import.meta.url))));
const {Miniflare}=require('miniflare');
const calls=[];
const runtime=new Miniflare({
 modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,
 script:`export default {async fetch(incoming){
  const url=new URL(incoming.url),redirect=url.searchParams.get('mode'),path=url.pathname;
  try{
   const response=await fetch('https://transport-proof.invalid'+path,{method:'POST',redirect,headers:{Authorization:'Bearer fixture-only','Content-Type':'application/json'},body:'{}'});
   await response.body?.cancel();
   return Response.json({ok:response.ok,status:response.status});
  }catch(error){return Response.json({ok:false,error:error.name,message:error.message});}
 }};`,
 outboundService:async request=>{
  calls.push({url:request.url,authorization:request.headers.get('Authorization')});
  assert.equal(new URL(request.url).hostname,'transport-proof.invalid');
  return new URL(request.url).pathname==='/redirect'
   ?new Response(null,{status:302,headers:{Location:'https://must-not-follow.invalid/'}})
   :Response.json({fixture:true});
 },
});
try{
 const incompatible=await(await runtime.dispatchFetch('http://localhost/success?mode=error')).json();
 assert.equal(incompatible.error,'TypeError');assert.match(incompatible.message,/Invalid redirect value/);assert.equal(calls.length,0);
 const compatible=await(await runtime.dispatchFetch('http://localhost/success?mode=manual')).json();
 assert.deepEqual(compatible,{ok:true,status:200});assert.equal(calls.length,1);assert.equal(calls[0].authorization,'Bearer fixture-only');
 const redirected=await(await runtime.dispatchFetch('http://localhost/redirect?mode=manual')).json();
 assert.deepEqual(redirected,{ok:false,status:302});assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.startsWith('https://transport-proof.invalid/')));
}finally{await runtime.dispose();}

// These server adapters carry credentials or private data. Their corresponding
// fixture suites verify 3xx responses cannot be acknowledged as success.
for(const path of ['lib/bedrock.ts','lib/aws-adapters.ts','lib/http-adapters.ts','lib/ses-email.ts','lib/ses-delivery-events.ts','lib/health-alerts.ts','lib/web-push.ts','services/paypal-relay/worker.mjs']){
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 assert.doesNotMatch(source,/redirect\s*:\s*(['"])error\1/,path+' must use the deployed Worker redirect modes');
}
console.log('PASS Native Worker rejects incompatible redirect mode before dispatch; manual mode preserves authorization and never follows 3xx. All provider traffic was intercepted.');
