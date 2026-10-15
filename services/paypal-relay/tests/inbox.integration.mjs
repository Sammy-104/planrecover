import assert from 'node:assert/strict';
import {relayPayPal,TARGET} from '../worker.mjs';
import {receivePayPalWebhook,WebhookDeliveryError} from '../../../lib/paypal-webhooks.ts';
import {createTestD1} from '../../../tests/helpers/d1.mjs';
globalThis.fetch=async()=>{throw Error('Live network is disabled.');};
const database=createTestD1(),env={RELAY_ENABLED:'true',PLANRECOVER_SITE_SERVICE_TOKEN:'fixture-only-service-token',RATE_LIMITER:{limit:async()=>({success:true})}},headers={'content-type':'application/json','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT','paypal-transmission-id':'FIXTURE-DELIVERY','paypal-transmission-sig':'fixture-valid','paypal-transmission-time':'2026-10-15T22:00:00Z'};
const raw='{\n "id":"WH-RELAY-INTEGRATION", "event_type":"PAYMENT.CAPTURE.COMPLETED", "resource":{"id":"FIXTURE-CAPTURE"}\n}';let processed=0,forwarded=0;
const privateReceiver=async(url,init)=>{forwarded++;assert.equal(url,TARGET);assert.equal(init.headers.get('OAI-Sites-Authorization'),'Bearer '+env.PLANRECOVER_SITE_SERVICE_TOKEN);try{return Response.json(await receivePayPalWebhook(new Request(url,init),{database,verify:async(received,_event,body)=>{assert.equal(body,raw);return received.get('paypal-transmission-sig')==='fixture-valid';},process:async()=>{processed++;}}));}catch(error){return Response.json({error:'Rejected'},{status:error instanceof WebhookDeliveryError?error.status:503});}};
try{
 const event=(signature='fixture-valid')=>new Request('https://relay.example.test/paypal',{method:'POST',headers:{...headers,'paypal-transmission-sig':signature},body:raw});
 assert.equal((await relayPayPal(event('fixture-invalid'),env,privateReceiver)).status,400);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM webhook_events').get().n,0);
 assert.equal((await relayPayPal(event(),env,privateReceiver)).status,200);assert.equal((await relayPayPal(event(),env,privateReceiver)).status,200);assert.equal(forwarded,3);assert.equal(processed,1);assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM webhook_events').get().n,1);assert.equal(database.sqlite.prepare('SELECT status FROM webhook_events').get().status,'processed');assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM financial_events').get().n,0);
 console.log('PASS local relay → actual migrated private webhook inbox: invalid signature rejected, verified duplicate processed once; no live calls or financial effects.');
}finally{database.close();}
