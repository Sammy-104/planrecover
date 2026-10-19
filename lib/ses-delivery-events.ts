import {X509Certificate,verify} from 'node:crypto';
import {BackendError} from './backend-errors.ts';
import {sesDigest} from './ses-email.ts';
import type {Env} from './http-adapters.ts';

const denied=()=>new BackendError('SES_EVENT_AUTH','SES event authenticity could not be established.',403);
const invalid=()=>new BackendError('SES_EVENT_INVALID','The SES event is invalid.',400);
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(value);
const canonicalAddress=(value:string)=>value.trim().toLowerCase();
type EventConfig={region:string;topicArn:string};
export function sesEventConfig(env:Env):EventConfig|null{
 if(env.AWS_SES_EVENTS_ENABLED!=='true')return null;
 const region=env.AWS_SES_REGION,topic=env.AWS_SES_EVENTS_TOPIC_ARN;
 if(typeof region!=='string'||!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)||typeof topic!=='string'||!new RegExp(`^arn:aws:sns:${region}:\\d{12}:[A-Za-z0-9_-]{1,256}$`).test(topic))throw new BackendError('SES_EVENTS_CONFIG','Configure the exact SES event topic and region.',503);
 return {region,topicArn:topic};
}

/** Bounded stream reader also covers chunked requests and certificate responses. */
export async function notificationText(body:ReadableStream<Uint8Array>|null,maximum:number){
 const reader=body?.getReader();if(!reader)throw invalid();let length=0,value='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>maximum)throw new BackendError('NOTIFICATION_SIZE','The notification exceeds the size limit.',413);value+=decoder.decode(chunk.value,{stream:true});}return value+decoder.decode();}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
const certCache=new Map<string,{pem:string;until:number}>();
export async function authenticateSesEnvelope(raw:string,config:EventConfig,options:{now?:number;fetch?:typeof fetch}={}){
 let envelope:Record<string,unknown>;try{envelope=object(JSON.parse(raw));}catch{throw invalid();}
 const now=options.now??Date.now(),timestamp=typeof envelope.Timestamp==='string'?Date.parse(envelope.Timestamp):NaN;
 if(envelope.TopicArn!==config.topicArn||envelope.SignatureVersion!=='2'||!['Notification','SubscriptionConfirmation','UnsubscribeConfirmation'].includes(String(envelope.Type))||
  !identifier(envelope.MessageId)||typeof envelope.Message!=='string'||envelope.Message.length>30000||!Number.isFinite(timestamp)||timestamp>now+300000||timestamp<now-7*86400000||
  typeof envelope.Signature!=='string'||!/^[A-Za-z0-9+/]{256,2048}={0,2}$/.test(envelope.Signature)||typeof envelope.SigningCertURL!=='string')throw denied();
 const expectedHost=`sns.${config.region}.amazonaws.com`;let certUrl:URL;try{certUrl=new URL(envelope.SigningCertURL);}catch{throw denied();}
 if(certUrl.protocol!=='https:'||certUrl.hostname!==expectedHost||certUrl.port||certUrl.username||certUrl.password||certUrl.search||certUrl.hash||!/^\/SimpleNotificationService-[a-fA-F0-9]{32,128}\.pem$/.test(certUrl.pathname))throw denied();
 const fields=envelope.Type==='Notification'?['Message','MessageId',...(Object.hasOwn(envelope,'Subject')?['Subject']:[]),'Timestamp','TopicArn','Type']:['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type'];
 if(fields.some(field=>typeof envelope[field]!=='string'||String(envelope[field]).length>32000))throw denied();
 const canonical=fields.map(field=>`${field}\n${envelope[field]}\n`).join('');
 let pem=certCache.get(certUrl.href);if(!pem||pem.until<=now){
  let response:Response;try{response=await(options.fetch??fetch)(certUrl.href,{redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw new BackendError('SES_EVENT_CERTIFICATE','SES signature verification is temporarily unavailable.',503);}
  if(!response.ok)throw new BackendError('SES_EVENT_CERTIFICATE','SES signature verification is temporarily unavailable.',503);
  const value=await notificationText(response.body,12000);pem={pem:value,until:now+3600000};if(certCache.size>=16)certCache.delete(certCache.keys().next().value!);certCache.set(certUrl.href,pem);
 }
 try{const cert=new X509Certificate(pem.pem);if(Date.parse(cert.validFrom)>now||Date.parse(cert.validTo)<now||cert.publicKey.asymmetricKeyType!=='rsa'||!verify('RSA-SHA256',Buffer.from(canonical),cert.publicKey,Buffer.from(envelope.Signature,'base64')))throw denied();}catch{certCache.delete(certUrl.href);throw denied();}
 return envelope;
}

export async function emailDestinationSuppressed(database:D1Database,owner:string,address:string,now=Date.now()){
 return !!await database.prepare('SELECT destination_hash FROM notification_suppressions WHERE owner=? AND destination_hash=? AND (suppressed_until IS NULL OR suppressed_until>?)').bind(owner,await sesDigest(canonicalAddress(address)),now).first();
}

/** Signature-authenticated SNS envelopes are never stored. Only correlated coarse
 * outcome facts are retained; arbitrary recipient/header/body data is discarded. */
export async function receiveSesEvent(database:D1Database,env:Env,raw:string,options:{now?:number;fetch?:typeof fetch}={}){
 const config=sesEventConfig(env);if(!config)throw new BackendError('SES_EVENTS_DISABLED','SES event ingestion is disabled.',503);
 if(new TextEncoder().encode(raw).length>32768)throw new BackendError('NOTIFICATION_SIZE','The notification exceeds the size limit.',413);
 const envelope=await authenticateSesEnvelope(raw,config,options);
 if(envelope.Type!=='Notification')return {accepted:true,confirmationRequired:envelope.Type==='SubscriptionConfirmation',processed:false};
 let event:Record<string,unknown>;try{event=object(JSON.parse(String(envelope.Message)));}catch{throw invalid();}
 const mail=object(event.mail),tags=object(mail.tags),attemptTag=tags.PlanRecoverAttempt;
 if(!Array.isArray(attemptTag)||attemptTag.length!==1||typeof attemptTag[0]!=='string'||!/^ses-[a-f0-9]{64}-[1-3]$/.test(attemptTag[0])||!identifier(mail.messageId))throw invalid();
 const attempt=await database.prepare("SELECT id,owner,plan_id,member_id,request,response,status FROM adapter_operations WHERE id=? AND provider='aws-ses' AND kind='send-email' AND status IN ('sending','completed','uncertain')").bind(attemptTag[0]).first<{id:string;owner:string;plan_id:string;member_id:string;request:string;response:string|null;status:string}>();
 if(!attempt)return {accepted:true,processed:false};
 const request=object(JSON.parse(attempt.request)),response=object(JSON.parse(attempt.response??'{}'));
 if(typeof request.destinationHash!=='string'||request.region!==config.region||response.messageId!==undefined&&response.messageId!==mail.messageId||!Array.isArray(mail.destination)||mail.destination.length!==1||typeof mail.destination[0]!=='string'||await sesDigest(canonicalAddress(mail.destination[0]))!==request.destinationHash)throw invalid();
 const type=event.eventType??event.notificationType;
 const mapping:Record<string,string>={Delivery:'delivery',Bounce:'bounce',Complaint:'complaint',DeliveryDelay:'delay',Reject:'rejected','Rendering Failure':'rejected'};
 const eventType=mapping[String(type)];if(!eventType)return {accepted:true,processed:false};
 const detail=object(event[eventType==='rejected'?(type==='Reject'?'reject':'failure'):eventType==='delay'?'deliveryDelay':eventType]);
 const occurred=typeof detail.timestamp==='string'?detail.timestamp:envelope.Timestamp,occurredMs=Date.parse(String(occurred)),now=options.now??Date.now();
 if(!Number.isFinite(occurredMs)||occurredMs>now+300000||occurredMs<now-90*86400000)throw invalid();
 const recipientKey=eventType==='bounce'?'bouncedRecipients':eventType==='complaint'?'complainedRecipients':eventType==='delivery'?'recipients':null;
 const recipients=recipientKey?detail[recipientKey]:null;
 if(Array.isArray(recipients)&&recipients.length){for(const recipient of recipients){const address=typeof recipient==='string'?recipient:object(recipient).emailAddress;if(typeof address!=='string'||await sesDigest(canonicalAddress(address))!==request.destinationHash)throw invalid();}}
 let reason=eventType,suppression:string|null=null,until:number|null=null;
 if(eventType==='bounce'){if(!['Permanent','Transient','Undetermined'].includes(String(detail.bounceType)))throw invalid();suppression=detail.bounceType==='Transient'?'soft-bounce':'hard-bounce';reason=suppression;until=suppression==='soft-bounce'?now+86400000:null;}
 if(eventType==='complaint'){suppression='complaint';reason='complaint';}
 const id=await sesDigest(`${config.topicArn}:${envelope.MessageId}`),digest=await sesDigest(String(envelope.Message));
 const prior=await database.prepare('SELECT digest FROM notification_delivery_events WHERE id=?').bind(id).first<{digest:string}>();if(prior){if(prior.digest!==digest)throw invalid();return {accepted:true,processed:true,duplicate:true};}
 const guard=crypto.randomUUID(),commands=[database.prepare('INSERT OR IGNORE INTO notification_delivery_events(id,attempt_id,owner,plan_id,member_id,provider_message_id,event_type,occurred_at,received_at,digest,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,attempt.id,attempt.owner,attempt.plan_id,attempt.member_id,mail.messageId,eventType,new Date(occurredMs).toISOString(),new Date(now).toISOString(),digest,reason),database.prepare('INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM notification_delivery_events WHERE id=? AND digest=?) THEN 1 ELSE 0 END)').bind(guard,id,digest)];
 if(suppression)commands.push(database.prepare(`INSERT INTO notification_suppressions(owner,destination_hash,reason,suppressed_until,event_id,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,destination_hash) DO UPDATE SET reason=CASE WHEN notification_suppressions.suppressed_until IS NULL THEN notification_suppressions.reason ELSE excluded.reason END,suppressed_until=CASE WHEN notification_suppressions.suppressed_until IS NULL OR excluded.suppressed_until IS NULL THEN NULL ELSE MAX(notification_suppressions.suppressed_until,excluded.suppressed_until) END,event_id=excluded.event_id,updated=excluded.updated`).bind(attempt.owner,request.destinationHash,suppression,until,id,new Date(now).toISOString()));
 commands.push(database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard));
 await database.batch(commands);return {accepted:true,processed:true,duplicate:false};
}
