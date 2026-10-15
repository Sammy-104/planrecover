// No visitor identity, financial actions, local storage or arbitrary destinations.
export const TARGET = 'https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site/api/webhooks/paypal';
export const SIGNATURE_HEADERS = ['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
export const MAX_BODY = 200000;
class BodyError extends Error {constructor(status){super('Invalid delivery');this.status=status;}}
function reply(status,text,retry=false){return new Response(text,{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff',...(retry?{'Retry-After':'30'}:{})}});}
async function limitedBody(stream,limit,timeoutMs){
 if(!stream)throw new BodyError(400);
 const reader=stream.getReader();let timer,size=0;const chunks=[];
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new BodyError(408));void reader.cancel().catch(()=>{});},timeoutMs);});
 try{return await Promise.race([deadline,(async()=>{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){void reader.cancel().catch(()=>{});throw new BodyError(413);}chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;})()]);}
 catch(error){if(error instanceof BodyError)throw error;throw new BodyError(400);}
 finally{clearTimeout(timer);reader.releaseLock();}
}
function jsonType(headers){return (headers.get('content-type')??'').split(';',1)[0].trim().toLowerCase()==='application/json';}
function validCertificate(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&['api.sandbox.paypal.com','api-m.sandbox.paypal.com'].includes(url.hostname)&&/^\/v1\/notifications\/certs\/[A-Za-z0-9-]+$/.test(url.pathname);}catch{return false;}}
export async function relayPayPal(request,env,fetcher=fetch,{bodyTimeoutMs=10000,forwardTimeoutMs=15000}={}){
 const url=new URL(request.url);
 if(url.pathname!=='/paypal'||url.search)return reply(404,'Not found');
 if(request.method!=='POST'){const result=reply(405,'Method not allowed');result.headers.set('Allow','POST');return result;}
 if(env.RELAY_ENABLED!=='true'||typeof env.PLANRECOVER_SITE_SERVICE_TOKEN!=='string'||env.PLANRECOVER_SITE_SERVICE_TOKEN.length<16||/[\r\n]/.test(env.PLANRECOVER_SITE_SERVICE_TOKEN)||!env.RATE_LIMITER?.limit)return reply(503,'Receiver unavailable',true);
 if(!jsonType(request.headers)||request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity'||SIGNATURE_HEADERS.some(name=>!request.headers.get(name)||request.headers.get(name).length>4096)||!validCertificate(request.headers.get('paypal-cert-url')))return reply(400,'Invalid delivery');
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))return reply(400,'Invalid delivery');
 if(declared!==null&&Number(declared)>MAX_BODY)return reply(413,'Delivery too large');
 try{if(!(await env.RATE_LIMITER.limit({key:'paypal-sandbox-ingress'})).success)return reply(429,'Try later',true);}catch{return reply(503,'Receiver unavailable',true);}
 let bytes;
 try{bytes=await limitedBody(request.body,MAX_BODY,bodyTimeoutMs);if(declared!==null&&Number(declared)!==bytes.length)throw new BodyError(400);const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(value.id)||typeof value.event_type!=='string'||!/^[A-Z0-9_.-]{1,128}$/.test(value.event_type)||!value.resource||typeof value.resource!=='object'||Array.isArray(value.resource))throw new BodyError(400);}
 catch(error){return reply(error instanceof BodyError?error.status:400,'Invalid delivery');}
 const headers=new Headers({'Content-Type':'application/json','OAI-Sites-Authorization':`Bearer ${env.PLANRECOVER_SITE_SERVICE_TOKEN}`});for(const name of SIGNATURE_HEADERS)headers.set(name,request.headers.get(name));
 try{
  const response=await fetcher(TARGET,{method:'POST',headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(forwardTimeoutMs)});
  if(!response.ok){void response.body?.cancel().catch(()=>{});return [400,409,413].includes(response.status)?reply(response.status,'Delivery rejected'):reply(503,'Delivery not accepted',true);}
  if(!jsonType(response.headers)){void response.body?.cancel().catch(()=>{});return reply(503,'Delivery not accepted',true);}
  const ack=JSON.parse(new TextDecoder().decode(await limitedBody(response.body,8192,bodyTimeoutMs)));
  return ack?.received===true&&ack?.status==='processed'?reply(200,'Accepted'):reply(503,'Delivery not accepted',true);
 }catch{return reply(503,'Delivery not accepted',true);}
}
// Cloudflare passes ExecutionContext as argument three, not an injectable fetcher.
export default {fetch(request,env){return relayPayPal(request,env);}};
