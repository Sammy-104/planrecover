'use client';
export async function requestRoutePreview(body:Record<string,unknown>,signal?:AbortSignal,endpoint='/api/schedule-preview'){
 for(let attempt=0;attempt<9;attempt++){
  const headers=new Headers({'Content-Type':'application/json'}),token=new URLSearchParams(window.location.hash.slice(1)).get('trip');if(token)headers.set('x-trip-share',token);
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal}),result=await response.json() as any;if(!response.ok)throw Error(result.error??'Could not check routed times.');if(result.unavailable)throw Error('Mapped routes could not load. Retry the preview when the service is available.');
  if(!result.pending)return result;if(attempt===8)throw Error('Routing is busy. Try again in a moment.');
  await new Promise<void>((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(done,1500),cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new DOMException('Aborted','AbortError'));};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
 }
 throw Error('Routing is busy. Try again in a moment.');
}
