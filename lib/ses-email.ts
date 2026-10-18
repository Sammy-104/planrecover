import {BackendError} from './backend-errors.ts';
import type {Env} from './http-adapters.ts';

// SES API endpoints: https://docs.aws.amazon.com/general/latest/gr/ses.html
const regions=new Set(['us-east-1','us-east-2','us-west-1','us-west-2','af-south-1','ap-south-1','ap-south-2','ap-southeast-1','ap-southeast-2','ap-southeast-3','ap-southeast-5','ap-northeast-1','ap-northeast-2','ap-northeast-3','ca-central-1','ca-west-1','eu-central-1','eu-central-2','eu-west-1','eu-west-2','eu-west-3','eu-south-1','eu-north-1','il-central-1','me-south-1','me-central-1','sa-east-1']);
const address=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
const validAddress=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&address.test(value)&&!value.includes('..');
export type SesEmailConfig={region:string;fromEmail:string;accessKeyId:string;secretAccessKey:string;sessionToken?:string;configurationSet?:string};
const configError=()=>new BackendError('SES_CONFIG','Amazon SES needs valid dedicated sending credentials, a supported region and a verified sender address.',503);
/** Configuration only. Never performs a request or exposes credentials in diagnostics. */
export function sesEmailConfig(env:Env):SesEmailConfig|null{
 if(env.AWS_SES_ENABLED!=='true')return null;
 const region=env.AWS_SES_REGION,fromEmail=env.AWS_SES_FROM_EMAIL,id=env.AWS_SES_ACCESS_KEY_ID,secret=env.AWS_SES_SECRET_ACCESS_KEY,session=env.AWS_SES_SESSION_TOKEN,set=env.AWS_SES_CONFIGURATION_SET;
 if(typeof region!=='string'||!regions.has(region)||!validAddress(fromEmail)||typeof id!=='string'||!/^(?:AKIA|ASIA)[A-Z0-9]{16}$/.test(id)||typeof secret!=='string'||!/^[A-Za-z0-9/+]{40}$/.test(secret)||
  session!==undefined&&session!==''&&(typeof session!=='string'||session.length>8000||/[\s\x00-\x1f]/.test(session))||id.startsWith('ASIA')&&!session||
  set!==undefined&&set!==''&&(typeof set!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(set)))throw configError();
 return {region,fromEmail,accessKeyId:id,secretAccessKey:secret,...(session?{sessionToken:session as string}:{}),...(set?{configurationSet:set as string}:{})};
}

export class SesEmailError extends BackendError{
 constructor(public outcome:'uncertain'|'rejected'|'not-sent',public retryable=false,public reason='ses-result-uncertain'){
  super('SES_EMAIL_RESULT',outcome==='uncertain'?'Amazon SES acceptance is uncertain. Automatic resending is blocked; review the saved attempt.':outcome==='not-sent'?'The reminder changed before sending. No email request was submitted.':'Amazon SES did not accept this email. Review its saved status and sending configuration.',503);
 }
}
const encoder=new TextEncoder(),hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
export const sesDigest=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
async function hmac(key:Uint8Array,value:string){const imported=await crypto.subtle.importKey('raw',key as BufferSource,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',imported,encoder.encode(value)));}
async function responseJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new SesEmailError('uncertain');let count=0,text='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>16384)throw new SesEmailError('uncertain');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();return JSON.parse(text) as Record<string,unknown>;}
 catch{throw new SesEmailError('uncertain');}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}

/** SES SendEmail has no idempotency token. Callers MUST durably reserve an attempt
 * before calling, and must never automatically retry an unknown acceptance. */
export async function sendSesEmail(config:SesEmailConfig,input:{destination:string;title:string;text:string;attemptId:string},options:{fetch?:typeof fetch;now?:Date;beforeSend:()=>Promise<boolean>}):Promise<{messageId:string}>{
 if(!regions.has(config.region)||!validAddress(config.fromEmail))throw configError();
 if(!validAddress(input.destination)||!input.title.trim()||input.title.length>500||input.text.length>20000||!/^[A-Za-z0-9_-]{1,180}$/.test(input.attemptId))throw new SesEmailError('not-sent',false,'ses-invalid-message');
 const host=`email.${config.region}.amazonaws.com`,path='/v2/email/outbound-emails',now=options.now??new Date(),date=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8);
 const body=JSON.stringify({FromEmailAddress:config.fromEmail,Destination:{ToAddresses:[input.destination]},Content:{Simple:{Subject:{Data:input.title.replace(/[\r\n]/g,' ').slice(0,200),Charset:'UTF-8'},Body:{Text:{Data:input.text,Charset:'UTF-8'}}}},EmailTags:[{Name:'PlanRecoverAttempt',Value:input.attemptId}],...(config.configurationSet?{ConfigurationSetName:config.configurationSet}:{})});
 if(encoder.encode(body).length>32000)throw new SesEmailError('not-sent',false,'ses-invalid-message');
 const headers:Record<string,string>={'content-type':'application/json',host,'x-amz-date':date,...(config.sessionToken?{'x-amz-security-token':config.sessionToken}:{})},keys=Object.keys(headers).sort(),signed=keys.join(';'),canonical=keys.map(key=>`${key}:${headers[key].trim()}\n`).join('');
 const scope=`${day}/${config.region}/ses/aws4_request`,request=`POST\n${path}\n\n${canonical}\n${signed}\n${await sesDigest(body)}`,stringToSign=`AWS4-HMAC-SHA256\n${date}\n${scope}\n${await sesDigest(request)}`;
 const key=await hmac(await hmac(await hmac(await hmac(encoder.encode('AWS4'+config.secretAccessKey),day),config.region),'ses'),'aws4_request'),signature=hex((await hmac(key,stringToSign)).buffer as ArrayBuffer);
 headers.Authorization=`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
 if(!await options.beforeSend())throw new SesEmailError('not-sent',false,'ses-source-changed');
 try{
  const response=await (options.fetch??fetch)(`https://${host}${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers,body}),value=await responseJson(response);
  if(response.status===200&&typeof value.MessageId==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(value.MessageId))return {messageId:value.MessageId};
  // Only documented, parsed rejection responses establish nonacceptance.
  const raw=response.headers.get('x-amzn-errortype')??value.__type??value.code,code=typeof raw==='string'?raw.split('#').at(-1)!.split(':')[0]:'';
  if(response.status===429&&code==='TooManyRequestsException')throw new SesEmailError('rejected',true,'ses-throttled');
  if(response.status===400&&['AccountSuspendedException','BadRequestException','LimitExceededException','MailFromDomainNotVerifiedException','MessageRejected','NotFoundException','SendingPausedException'].includes(code)||response.status===404&&code==='NotFoundException'||response.status===403&&['AccessDeniedException','SignatureDoesNotMatch','InvalidSignatureException','UnrecognizedClientException','ExpiredTokenException'].includes(code))throw new SesEmailError('rejected',false,'ses-rejected');
  throw new SesEmailError('uncertain');
 }catch(error){if(error instanceof SesEmailError)throw error;throw new SesEmailError('uncertain');}
}
