import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{relayPayPal,TARGET,SIGNATURE_HEADERS,MAX_BODY} from '../worker.mjs';
import {onlineConfig} from '../scripts/prepare-online.mjs';
import {readFile} from 'node:fs/promises';
globalThis.fetch=async()=>{throw Error('Live network is disabled for relay tests.');};
const token='fixture-only-service-token',raw='{\n "id":"WH-LOCAL-TEST", "event_type":"PAYMENT.CAPTURE.COMPLETED", "resource":{"id":"CAPTURE-FIXTURE","note":"é"}\n}',headers={'content-type':'application/json; charset=utf-8','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123','paypal-transmission-id':'DELIVERY-123','paypal-transmission-sig':'fixture-signature','paypal-transmission-time':'2026-10-15T22:00:00Z'};
const environment=()=>({RELAY_ENABLED:'true',PLANRECOVER_SITE_SERVICE_TOKEN:token,RATE_LIMITER:{limit:async()=>({success:true})}});
const request=(changes={})=>new Request('https://relay.example.test/paypal',{method:'POST',headers,body:raw,...changes});
const accepted=()=>Response.json({received:true,status:'processed'});
test('Forwards exact signed bytes to the pinned private endpoint, with only approved headers',async()=>{
 let calls=0;const reply=await relayPayPal(request({headers:{...headers,cookie:'private','oai-authenticated-user-id':'spoofed',authorization:'Bearer attacker','x-forwarded-host':'attacker.test'}}),environment(),async(url,init)=>{calls++;assert.equal(url,TARGET);assert.equal(init.redirect,'manual');assert.ok(init.signal instanceof AbortSignal);assert.deepEqual(init.body,new TextEncoder().encode(raw));assert.deepEqual([...init.headers.keys()].sort(),['content-type','oai-sites-authorization',...SIGNATURE_HEADERS].sort());assert.equal(init.headers.get('OAI-Sites-Authorization'),'Bearer '+token);return accepted();});
 assert.equal(reply.status,200);assert.equal(calls,1);assert.equal(await reply.text(),'Accepted');assert.equal(reply.headers.get('cache-control'),'no-store');
});
test('Runtime fetch entry point ignores ExecutionContext and uses the configured fetch implementation',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return accepted();};try{assert.equal((await worker.fetch(request(),environment(),{waitUntil(){},passThroughOnException(){}})).status,200);assert.equal(calls,1);}finally{globalThis.fetch=async()=>{throw Error('Live network is disabled.');};}
});
test('Default local deployment is disabled and absent configuration cannot forward',async()=>{
 for(const enabled of [undefined,'false',true,'TRUE'])assert.equal((await relayPayPal(request(),{...environment(),RELAY_ENABLED:enabled})).status,503);
 for(const patch of [{PLANRECOVER_SITE_SERVICE_TOKEN:''},{PLANRECOVER_SITE_SERVICE_TOKEN:'short'},{PLANRECOVER_SITE_SERVICE_TOKEN:token+'\r\n'},{RATE_LIMITER:undefined}])assert.equal((await relayPayPal(request(),{...environment(),...patch})).status,503);
});
test('Only POST on the exact receiver path is supported',async()=>{
 for(const path of ['/','/paypal/','/paypal?target=https://attacker.test','/other'])assert.equal((await relayPayPal(new Request('https://relay.example.test'+path,{method:'POST',headers,body:raw}),environment())).status,404);
 const reply=await relayPayPal(request({method:'GET',body:undefined}),environment());assert.equal(reply.status,405);assert.equal(reply.headers.get('allow'),'POST');
});
test('All five bounded signature headers and an exact JSON media type are required',async()=>{
 for(const name of SIGNATURE_HEADERS){const changed={...headers};delete changed[name];assert.equal((await relayPayPal(request({headers:changed}),environment())).status,400);}
 assert.equal((await relayPayPal(request({headers:{...headers,'paypal-transmission-sig':'x'.repeat(4097)}}),environment())).status,400);
 for(const type of ['text/plain','application/json-not-real',''])assert.equal((await relayPayPal(request({headers:{...headers,'content-type':type}}),environment())).status,400);
 assert.equal((await relayPayPal(request({headers:{...headers,'content-encoding':'gzip'}}),environment())).status,400);
});
test('Certificates must match the private sandbox verifier host and path policy',async()=>{
 for(const certificate of ['https://attacker.test/v1/notifications/certs/CERT','http://api.sandbox.paypal.com/v1/notifications/certs/CERT','https://api.paypal.com/v1/notifications/certs/CERT','https://api.sandbox.paypal.com/v1/notifications/certs/CERT?x=1','https://api.sandbox.paypal.com/v1/notifications/certs/CERT#secret','https://user@api.sandbox.paypal.com/v1/notifications/certs/CERT','https://api.sandbox.paypal.com:8443/v1/notifications/certs/CERT','https://api.sandbox.paypal.com/v1/notifications/certs/','https://api.sandbox.paypal.com/v1/notifications/certs/CERT/other'])assert.equal((await relayPayPal(request({headers:{...headers,'paypal-cert-url':certificate}}),environment())).status,400);
 assert.equal((await relayPayPal(request({headers:{...headers,'paypal-cert-url':'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT'}}),environment(),async()=>accepted())).status,200);
});
test('The shared ingress limiter rejects excess traffic and fails closed when unavailable',async()=>{
 let key;const env=environment();env.RATE_LIMITER.limit=async value=>{key=value.key;return {success:false};};assert.equal((await relayPayPal(request(),env)).status,429);assert.equal(key,'paypal-sandbox-ingress');
 env.RATE_LIMITER.limit=async()=>{throw Error(token);};const reply=await relayPayPal(request(),env);assert.equal(reply.status,503);assert.ok(!(await reply.text()).includes(token));
});
test('Declared and streamed limits stop oversized requests before private forwarding',async()=>{
 assert.equal((await relayPayPal(request({headers:{...headers,'content-length':String(MAX_BODY+1)}}),environment())).status,413);
 assert.equal((await relayPayPal(request({body:'x'.repeat(MAX_BODY+1)}),environment())).status,413);
 for(const size of ['-1','NaN','1.5','9007199254740992','1'])assert.equal((await relayPayPal(request({headers:{...headers,'content-length':size}}),environment())).status,400);
 assert.equal((await relayPayPal(request({headers:{...headers,'content-length':String(new TextEncoder().encode(raw).length)}}),environment(),async()=>accepted())).status,200);
});
test('Malformed, empty, invalid UTF-8 and non-event bodies never reach private verification',async()=>{
 for(const body of ['',null,'{','[]','{}','null',JSON.stringify({id:'wrong/id',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{}}),JSON.stringify({id:'WH-X',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:[]}),new Uint8Array([255])])assert.equal((await relayPayPal(request({body}),environment())).status,400);
});
test('Broken and stalled inbound streams return controlled errors without forwarding',async()=>{
 const broken=new ReadableStream({start(controller){controller.error(Error(token));}});assert.equal((await relayPayPal(request({body:broken,duplex:'half'}),environment())).status,400);
 let cancelled=false;const stalled=new ReadableStream({cancel(){cancelled=true;}});assert.equal((await relayPayPal(request({body:stalled,duplex:'half'}),environment(),undefined,{bodyTimeoutMs:5})).status,408);assert.equal(cancelled,true);
});
test('Only a processed JSON acknowledgment is accepted, including duplicate delivery acknowledgments',async()=>{
 for(const response of [new Response('<html>Sign in</html>'),Response.json({received:true}),Response.json({received:false,status:'processed'}),new Response('invalid',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(8193),{headers:{'content-type':'application/json'}})])assert.equal((await relayPayPal(request(),environment(),async()=>response)).status,503);
 assert.equal((await relayPayPal(request(),environment(),async()=>Response.json({received:true,duplicate:true,status:'processed'}))).status,200);
});
test('Permanent verification errors are rejected; service and transient errors request a later provider retry',async()=>{
 for(const status of [301,302,303,307,308,400,409,413,401,403,404,429,500,503]){let calls=0;const reply=await relayPayPal(request(),environment(),async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(token,{status,headers:{'set-cookie':'secret',Location:'https://redirect-target.invalid/'}});});assert.equal(calls,1);assert.equal(reply.status,[400,409,413].includes(status)?status:503);assert.equal(reply.headers.get('set-cookie'),null);assert.ok(!(await reply.text()).includes(token));assert.equal(reply.headers.get('retry-after'),[400,409,413].includes(status)?null:'30');}
});
test('Network failures and timeouts do not retry or expose private exception details',async()=>{
 let calls=0;const result=await relayPayPal(request(),environment(),async()=>{calls++;throw Error(token);});assert.equal(result.status,503);assert.equal(calls,1);assert.ok(!(await result.text()).includes(token));
 const timed=await relayPayPal(request(),environment(),async(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error(token)),{once:true})),{forwardTimeoutMs:5});assert.equal(timed.status,503);
});
test('Repeated deliveries are forwarded again; no unverified local duplicate cache can acknowledge one',async()=>{
 let calls=0;const provider=async()=>{calls++;return accepted();};await relayPayPal(request(),environment(),provider);await relayPayPal(request(),environment(),provider);assert.equal(calls,2);
});
test('Moving online requires an explicit account configuration and preserves the disabled local default',async()=>{
 const base=JSON.parse(await readFile(new URL('../wrangler.json',import.meta.url),'utf8'));assert.equal(base.workers_dev,false);assert.equal(base.vars.RELAY_ENABLED,'false');assert.ok(!('account_id' in base));
 for(const account of [undefined,'','fixture-token','https://example.test'])assert.throws(()=>onlineConfig(base,account));
 const online=onlineConfig(base,'a'.repeat(32));assert.equal(online.workers_dev,true);assert.equal(online.vars.RELAY_ENABLED,'true');assert.equal(base.workers_dev,false);assert.ok(!JSON.stringify(online).includes(token));assert.equal(online.ratelimits[0].name,'RATE_LIMITER');assert.throws(()=>onlineConfig({...base,ratelimits:[]},'a'.repeat(32)));
});
