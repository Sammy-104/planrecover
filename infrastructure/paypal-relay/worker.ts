/** Deploy as a separate narrow public receiver. The application Site remains private. */
type RelayEnv={PLANRECOVER_SITE_SERVICE_TOKEN:string;RATE_LIMITER?:{limit:(input:{key:string})=>Promise<{success:boolean}>}};
const target='https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site/api/webhooks/paypal';
const required=['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
export async function relayPayPal(request:Request,env:RelayEnv,fetcher:typeof fetch=fetch){
 const url=new URL(request.url);if(url.pathname!=='/paypal'||url.search)return new Response('Not found',{status:404});
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 if(!env.PLANRECOVER_SITE_SERVICE_TOKEN)return new Response('Receiver unavailable',{status:503});
 if(env.RATE_LIMITER&&!(await env.RATE_LIMITER.limit({key:request.headers.get('cf-connecting-ip')??'unknown'})).success)return new Response('Try later',{status:429});
 if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json')||required.some(name=>!request.headers.get(name)||request.headers.get(name)!.length>4096))return new Response('Invalid delivery',{status:400});
 let cert:URL;try{cert=new URL(request.headers.get('paypal-cert-url')!);}catch{return new Response('Invalid delivery',{status:400});}
 if(cert.protocol!=='https:'||!['api.paypal.com','api.sandbox.paypal.com','api-m.paypal.com','api-m.sandbox.paypal.com'].includes(cert.hostname)||!cert.pathname.startsWith('/v1/notifications/certs/')||cert.username||cert.password||cert.port)return new Response('Invalid delivery',{status:400});
 const reader=request.body?.getReader();if(!reader)return new Response('Invalid delivery',{status:400});const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>200000){await reader.cancel();return new Response('Delivery too large',{status:413});}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const headers=new Headers({'Content-Type':'application/json','OAI-Sites-Authorization':`Bearer ${env.PLANRECOVER_SITE_SERVICE_TOKEN}`});for(const name of required)headers.set(name,request.headers.get(name)!);
 try{const response=await fetcher(target,{method:'POST',headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(15000)});await response.body?.cancel();return new Response(response.ok?'Accepted':'Delivery not accepted',{status:response.ok?200:503,headers:{'Cache-Control':'no-store',...(response.ok?{}:{'Retry-After':'30'})}});}catch{return new Response('Delivery not accepted',{status:503,headers:{'Retry-After':'30'}});}
}
export default {fetch(request:Request,env:RelayEnv){return relayPayPal(request,env);}};
