import {BackendError} from './backend-errors.ts';
export type Env=Record<string,unknown>;
export function providerConfig(env:Env,prefix:string){const origin=env[`${prefix}_ORIGIN`],token=env[`${prefix}_TOKEN`];if(!origin&&!token)return null;
 if(typeof origin!=='string'||typeof token!=='string'||!token||token.length>8000||/[\s\x00-\x1f]/.test(token))throw new BackendError('ADAPTER_CONFIG','The server adapter needs valid configuration.',503);
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port||!url.hostname.includes('.')||/^(?:\d|\[)|(?:^|\.)(?:localhost|local|internal|test)$/.test(url.hostname))throw new BackendError('ADAPTER_CONFIG','Configure a public HTTPS provider origin.',503);
 return {origin:url.origin,token};
}
export async function boundedProviderJson(response:Response,maxBytes=65536){if(!response.ok){await response.body?.cancel();throw new BackendError('ADAPTER_PROVIDER','The provider could not complete this request. Saved state is retained.',502);}
 const reader=response.body?.getReader();if(!reader)throw new BackendError('ADAPTER_RESPONSE','The provider returned no confirmation.',502);let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw Error('limit');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();return text.trim()?JSON.parse(text):{};}
 catch{throw new BackendError('ADAPTER_RESPONSE','The provider response could not be validated.',502);}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function providerPost(config:{origin:string;token:string},path:string,body:unknown,idempotencyKey:string,fetcher:typeof fetch=fetch){
 if(!/^\/[a-z][a-z/-]*$/.test(path)||JSON.stringify(body).length>32000)throw new BackendError('ADAPTER_INPUT','The provider request is invalid.');
 try{return await boundedProviderJson(await fetcher(config.origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(body)}));}
 catch(error){if(error instanceof BackendError)throw error;throw new BackendError('ADAPTER_UNCERTAIN','The provider result is uncertain. Keep the same request ID when reviewing or retrying.',503);}
}
