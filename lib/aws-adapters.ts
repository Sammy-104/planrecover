import {boundedProviderJson,type Env} from './http-adapters.ts';
import {BackendError} from './backend-errors.ts';
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
async function hmac(key:Uint8Array,text:string){const k=await crypto.subtle.importKey('raw',key as BufferSource,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,encoder.encode(text)));}
export function awsAdapterConfig(env:Env){const id=env.AWS_ADAPTER_ACCESS_KEY_ID,secret=env.AWS_ADAPTER_SECRET_ACCESS_KEY,token=env.AWS_ADAPTER_SESSION_TOKEN;
 if(env.AWS_ADAPTERS_ENABLED!=='true'||!id&&!secret)return null;if(typeof id!=='string'||typeof secret!=='string'||!id||!secret||typeof token!=='undefined'&&typeof token!=='string')throw new BackendError('AWS_ADAPTER_CONFIG','Configure restricted AWS adapter credentials.',503);
 return {accessKeyId:id,secretAccessKey:secret,sessionToken:token as string|undefined,region:'ca-central-1'};
}
export async function awsJson(env:Env,service:'states'|'geo-places'|'geo-routes'|'textract',operation:string,payload:unknown,options:{fetch?:typeof fetch;now?:Date;timeoutMs?:number}={}){
 const config=awsAdapterConfig(env);if(!config)throw new BackendError('AWS_ADAPTER_UNCONFIGURED','The selected AWS adapter is not configured.',503);
 if(JSON.stringify(payload).length>(service==='textract'?6_700_000:48000))throw new BackendError('AWS_ADAPTER_INPUT','The AWS request is too large.');
 const routes:Record<string,{host:string;path:string;target?:string}>={StartExecution:{host:'states.ca-central-1.amazonaws.com',path:'/',target:'AWSStepFunctions.StartExecution'},DescribeExecution:{host:'states.ca-central-1.amazonaws.com',path:'/',target:'AWSStepFunctions.DescribeExecution'},GetActivityTask:{host:'states.ca-central-1.amazonaws.com',path:'/',target:'AWSStepFunctions.GetActivityTask'},SendTaskSuccess:{host:'states.ca-central-1.amazonaws.com',path:'/',target:'AWSStepFunctions.SendTaskSuccess'},SendTaskFailure:{host:'states.ca-central-1.amazonaws.com',path:'/',target:'AWSStepFunctions.SendTaskFailure'},SearchText:{host:'places.geo.ca-central-1.amazonaws.com',path:'/v2/search-text'},CalculateRoutes:{host:'routes.geo.ca-central-1.amazonaws.com',path:'/v2/routes'}};
 routes.AnalyzeExpense={host:'textract.ca-central-1.amazonaws.com',path:'/',target:'Textract.AnalyzeExpense'};
 const route=routes[operation];if(!route||service==='states'&&!operation.match(/^(?:StartExecution|DescribeExecution|GetActivityTask|SendTaskSuccess|SendTaskFailure)$/)||service==='geo-places'&&operation!=='SearchText'||service==='geo-routes'&&operation!=='CalculateRoutes'||service==='textract'&&operation!=='AnalyzeExpense')throw new BackendError('AWS_ADAPTER_INPUT','Unsupported AWS operation.');
 const now=options.now??new Date(),date=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),body=JSON.stringify(payload),headers:Record<string,string>={'content-type':service==='textract'?'application/x-amz-json-1.1':service==='states'?'application/x-amz-json-1.0':'application/json',host:route.host,'x-amz-date':date,...(route.target?{'x-amz-target':route.target}:{}),...(config.sessionToken?{'x-amz-security-token':config.sessionToken}:{})};
 const keys=Object.keys(headers).sort(),canonical=keys.map(k=>`${k}:${headers[k].trim()}\n`).join(''),signed=keys.join(';'),scope=`${day}/${config.region}/${service}/aws4_request`,request=`POST\n${route.path}\n\n${canonical}\n${signed}\n${await digest(body)}`;
 const key=await hmac(await hmac(await hmac(await hmac(encoder.encode('AWS4'+config.secretAccessKey),day),config.region),service),'aws4_request'),signature=hex((await hmac(key,`AWS4-HMAC-SHA256\n${date}\n${scope}\n${await digest(request)}`)).buffer as ArrayBuffer);
 headers.Authorization=`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
 try{return await boundedProviderJson(await (options.fetch??fetch)(`https://${route.host}${route.path}`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(options.timeoutMs??12000),headers,body}),service==='textract'?2_000_000:65536);}
 catch(error){if(error instanceof BackendError)throw error;throw new BackendError('AWS_ADAPTER_UNAVAILABLE','The AWS adapter could not confirm the request. Review its saved status.',503);}
}
