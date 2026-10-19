import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {bedrockConfig,converseJson,BedrockError,BEDROCK_DIAGNOSTIC_STAGES,BEDROCK_AWS_EXCEPTIONS,BEDROCK_NETWORK_ERROR_NAMES,BEDROCK_NETWORK_ERROR_CODES,BEDROCK_VALIDATION_REASONS,BEDROCK_STOP_REASONS,type BedrockConfig} from './bedrock.ts';
import {acquireAiLease} from './ai-usage.ts';
import {providerConfig} from './http-adapters.ts';
import {sesEmailConfig} from './ses-email.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
import {healthAlertConfiguration} from './health-alerts.ts';
import {webPushConfig} from './web-push.ts';
import {readBedrockOperationsSummary,withTrackedBedrock,bedrockSharedControls} from './bedrock-operations.ts';
import {readBedrockWorkflowEvidence} from './bedrock-workflow-evidence.ts';

type Settings=Record<string,unknown>;
type Configuration='configured'|'missing'|'invalid';
type Verification='unverified'|'running'|'passed'|'failed'|'interrupted'|'stale';
const provider='bedrock-readiness',kind='synthetic-json-check',prefix='readiness-bedrock-';
const outcomes=['passed','access-denied','model-unavailable','rate-limited','shared-limit','timed-out','invalid-response','unavailable','interrupted','authorization-changed'] as const;
const usageSchema=z.object({inputTokens:z.number().int().nonnegative().max(1_000_000),outputTokens:z.number().int().min(0).max(128),totalTokens:z.number().int().nonnegative().max(1_000_000)}).strict();
const diagnosticSchema=z.object({stage:z.enum(BEDROCK_DIAGNOSTIC_STAGES),upstreamStatus:z.number().int().min(100).max(599).nullable(),awsException:z.enum(BEDROCK_AWS_EXCEPTIONS).nullable(),networkErrorName:z.enum(BEDROCK_NETWORK_ERROR_NAMES).nullable(),networkErrorCode:z.enum(BEDROCK_NETWORK_ERROR_CODES).nullable(),validationReason:z.enum(BEDROCK_VALIDATION_REASONS).optional(),stopReason:z.enum(BEDROCK_STOP_REASONS).optional()}).strict();
const storedResult=z.object({version:z.literal(1),outcome:z.enum(outcomes),usage:usageSchema.nullable(),diagnostic:diagnosticSchema.optional()}).strict();
export const readinessCheckRequest=z.object({action:z.literal('check-bedrock'),requestId:z.string().uuid(),confirm:z.literal(true)}).strict();
type CheckInput=z.infer<typeof readinessCheckRequest>;
type Operation={id:string;owner:string;plan_id:string;member_id:string;provider:string;kind:string;request:string;response:string|null;status:string;lease_token:string|null;lease_until:number;created:string;updated:string};
type Check={id:string;service:'bedrock';scope:'synthetic-json-converse';status:'running'|'passed'|'failed'|'interrupted';outcome:typeof outcomes[number]|null;startedAt:string;completedAt:string|null;usage:z.infer<typeof usageSchema>|null;diagnostic?:z.infer<typeof diagnosticSchema>};
const basic=(configuration:Configuration)=>({configuration,verification:'unverified' as Verification});
const present=(value:unknown)=>value!==undefined&&value!==null&&value!=='';
const credential=(value:unknown,min=1,max=4096)=>typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\s\x00-\x1f\x7f]/.test(value);
const stamp=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():'';

function bedrockSettings(settings:Settings):{configuration:Configuration;config:BedrockConfig|null}{
 try{const config=bedrockConfig(settings);if(config)bedrockSharedControls(settings);return {configuration:config?'configured':'missing',config};}
 catch{return {configuration:'invalid',config:null};}
}
function paypalConfiguration(settings:Settings):Configuration{
 if(!present(settings.PAYPAL_CLIENT_ID)&&!present(settings.PAYPAL_CLIENT_SECRET))return 'missing';
 return credential(settings.PAYPAL_CLIENT_ID,1,512)&&credential(settings.PAYPAL_CLIENT_SECRET)?'configured':'invalid';
}
function genericConfiguration(settings:Settings,prefix:string):Configuration{
 try{return providerConfig(settings,prefix)?'configured':'missing';}catch{return 'invalid';}
}
function notificationConfiguration(settings:Settings){
 let push=genericConfiguration(settings,'NOTIFICATION'),pushProvider='generic',pushEnabled=push==='configured';let email=push,emailProvider='generic',emailEnabled=push==='configured';
 const pushPresent=['WEB_PUSH_PUBLIC_KEY','WEB_PUSH_PRIVATE_KEY','WEB_PUSH_SUBJECT'].some(key=>present(settings[key]));
 if(settings.WEB_PUSH_ENABLED==='true'||settings.WEB_PUSH_ENABLED==='false'||pushPresent){pushProvider='web-push';pushEnabled=settings.WEB_PUSH_ENABLED==='true';try{push=!pushPresent&&!pushEnabled?'missing':webPushConfig({...settings,WEB_PUSH_ENABLED:'true'})?'configured':'missing';}catch{push='invalid';}}
 const sesPresent=['AWS_SES_REGION','AWS_SES_FROM_EMAIL','AWS_SES_ACCESS_KEY_ID','AWS_SES_SECRET_ACCESS_KEY'].some(key=>present(settings[key]));
 if(settings.AWS_SES_ENABLED==='true'||settings.AWS_SES_ENABLED==='false'||sesPresent){emailProvider='amazon-ses';emailEnabled=settings.AWS_SES_ENABLED==='true';try{email=!sesPresent&&!emailEnabled?'missing':sesEmailConfig({...settings,AWS_SES_ENABLED:'true'})?'configured':'missing';}catch{email='invalid';}}
 const configuration:Configuration=email==='invalid'||push==='invalid'?'invalid':email==='configured'||push==='configured'?'configured':'missing';
 return {configuration,email,push,emailProvider,emailEnabled,pushProvider,pushEnabled};
}
async function configHash(config:BedrockConfig){
 const bytes=new TextEncoder().encode(JSON.stringify({key:config.apiKey,region:config.region,model:config.modelId,profile:!!config.requireApplicationProfile}));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function checkView(row:Operation,now:number):Check{
 const parsed=storedResult.safeParse((()=>{try{return JSON.parse(row.response??'null');}catch{return null;}})());
 const running=row.status==='processing'&&row.lease_until>now,result=parsed.success?parsed.data:null;
 const status=running?'running':row.status==='completed'&&result?.outcome==='passed'?'passed':row.status==='failed'&&result?'failed':'interrupted';
 return {id:row.id.slice(prefix.length),service:'bedrock',scope:'synthetic-json-converse',status,
  outcome:running?null:result?.outcome??'interrupted',startedAt:stamp(row.created),completedAt:running||!result?null:stamp(row.updated),usage:result?.usage??null,...(!running&&result?.diagnostic?{diagnostic:result.diagnostic}:{})};
}
function failureOutcome(error:unknown):typeof outcomes[number]{
 const code=error instanceof BackendError?error.code:'';
 if(code==='BEDROCK_AUTH')return 'access-denied';
 if(code==='BEDROCK_MODEL')return 'model-unavailable';
 if(code==='BEDROCK_THROTTLED')return 'rate-limited';
 if(code==='BEDROCK_SHARED_LIMIT'||code==='BEDROCK_DAILY_LIMIT')return 'shared-limit';
 if(code==='BEDROCK_TIMEOUT')return 'timed-out';
 if(['BEDROCK_RESPONSE','BEDROCK_OUTPUT','BEDROCK_BLOCKED'].includes(code))return 'invalid-response';
 return 'unavailable';
}

/** These are server-retained facts with deliberately narrow scopes. A saved
 * acceptance, signed callback or manual job does not certify a whole journey,
 * delivery to a person, current credentials, or an unattended schedule. */
export async function observedServiceEvidence(database:D1Database,owner:string,planId:string){
 const [payments,webhooks,supplier,email,push,scheduled,alerts,emailOutcomes,pushAttempts]=await Promise.all([
  database.prepare("SELECT COUNT(*) count,MAX(created) observed_at FROM financial_events WHERE owner=? AND plan_id=? AND provider='paypal-sandbox'").bind(owner,planId).first<{count:number;observed_at:string|null}>(),
  database.prepare(`SELECT COUNT(*) count,MAX(w.processed) observed_at FROM webhook_events w WHERE w.status='processed' AND (
   EXISTS(SELECT 1 FROM financial_events f WHERE f.owner=? AND f.plan_id=? AND f.provider='paypal-sandbox' AND f.provider_id=json_extract(w.body,'$.resource.id')) OR
   EXISTS(SELECT 1 FROM provider_operations p WHERE p.owner=? AND json_extract(p.payload,'$.planrecoverTripId')=? AND p.provider_id=json_extract(w.body,'$.resource.id')) OR
   EXISTS(SELECT 1 FROM plan_invoices i WHERE i.owner=? AND i.plan_id=? AND i.provider_id=json_extract(w.body,'$.resource.id')))`)
   .bind(owner,planId,owner,planId,owner,planId).first<{count:number;observed_at:string|null}>(),
  database.prepare("SELECT COUNT(*) count,MAX(updated) observed_at FROM adapter_operations WHERE owner=? AND plan_id=? AND provider='supplier' AND status='completed'").bind(owner,planId).first<{count:number;observed_at:string|null}>(),
  database.prepare("SELECT COUNT(*) count,MAX(updated) observed_at FROM adapter_operations WHERE owner=? AND plan_id=? AND provider='aws-ses' AND kind='send-email' AND status='completed' AND json_extract(response,'$.accepted')=1").bind(owner,planId).first<{count:number;observed_at:string|null}>(),
  database.prepare("SELECT COUNT(*) count,MAX(delivered) observed_at FROM reminder_jobs WHERE owner=? AND plan_id=? AND channel='push' AND status='delivered'").bind(owner,planId).first<{count:number;observed_at:string|null}>(),
  database.prepare("SELECT COUNT(*) count,MAX(completed_at) observed_at FROM background_run_evidence WHERE owner=? AND source='scheduled' AND status='completed' AND completed_at IS NOT NULL").bind(owner).first<{count:number;observed_at:string|null}>(),
  database.prepare("SELECT COUNT(*) count,MAX(accepted_at) observed_at FROM ops_health_alerts WHERE owner=? AND status='accepted'").bind(owner).first<{count:number;observed_at:string|null}>(),
  database.prepare('SELECT event_type,COUNT(*) count,MAX(occurred_at) observed_at FROM notification_delivery_events WHERE owner=? AND plan_id=? GROUP BY event_type').bind(owner,planId).all<{event_type:string;count:number;observed_at:string}>(),
  database.prepare('SELECT status,COUNT(*) count,MAX(updated) observed_at FROM web_push_attempts WHERE job_id IN (SELECT id FROM reminder_jobs WHERE owner=? AND plan_id=?) GROUP BY status').bind(owner,planId).all<{status:string;count:number;observed_at:string}>(),
 ]);
 const view=(row:{count:number;observed_at:string|null}|null,scope:string)=>({scope,status:row?.count?'observed':'unobserved',count:row?.count??0,lastObservedAt:row?.observed_at?stamp(row.observed_at):null,fullWorkflowVerification:'unverified'});
 return {paypal:view(payments,'canonical-sandbox-financial-effect'),webhook:view(webhooks,'signed-processed-callback-matching-plan-provider-reference'),supplier:view(supplier,'validated-bridge-response'),email:{...view(email,'ses-provider-acceptance-only'),outcomes:emailOutcomes.results.filter(row=>['delivery','bounce','complaint','delay','rejected'].includes(row.event_type)).map(row=>({event:row.event_type,count:row.count,lastObservedAt:stamp(row.observed_at)})),deliveryScope:'Signed SES events describe provider delivery outcomes, not whether a person read an email.'},push:{...view(push,'push-provider-acceptance-only'),attempts:pushAttempts.results.filter(row=>['sending','accepted','rejected','expired','uncertain','cancelled'].includes(row.status)).map(row=>({status:row.status,count:row.count,lastObservedAt:stamp(row.observed_at)}))},runner:view(scheduled,'recorded-scheduled-run-completion'),alerts:view(alerts,'alert-receiver-acceptance-only')};
}

/** Configuration inspection never contacts providers. Stored checks contain only
 * coarse outcomes/counts; configuration fingerprints and credentials stay private. */
export class ServiceReadinessService{
 constructor(private database:D1Database,private repository=new PlanRepository(database)){}
 private async owner(planId:string,identity:Identity){const record=await this.repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();return record;}
 private async operation(id:string){return this.database.prepare('SELECT * FROM adapter_operations WHERE id=?').bind(id).first<Operation>();}
 private ownOperation(row:Operation,owner:string,planId:string){if(row.owner!==owner||row.plan_id!==planId||row.provider!==provider||row.kind!==kind)throw conflict();return row;}
 async inspect(planId:string,identity:Identity,settings:Settings,now=Date.now()){
  const record=await this.owner(planId,identity),bedrock=bedrockSettings(settings),paypal=paypalConfiguration(settings);
  const [last,background,evidence,activity,workflowEvidence]=await Promise.all([
   this.database.prepare('SELECT * FROM adapter_operations WHERE owner=? AND plan_id=? AND provider=? AND kind=? ORDER BY created DESC,id DESC LIMIT 1').bind(record.owner,planId,provider,kind).first<Operation>(),
   this.database.prepare('SELECT status,last_started,last_completed FROM background_job_runs WHERE owner=?').bind(record.owner).first<{status:string;last_started:string|null;last_completed:string|null}>(),
   observedServiceEvidence(this.database,record.owner,planId),
   bedrock.config?readBedrockOperationsSummary(this.database,settings,record.owner,planId,now):null,
   readBedrockWorkflowEvidence(this.database,settings,record.owner,planId),
  ]);
  const check=last?checkView(last,now):null;let verification:Verification='unverified';
  if(last&&bedrock.config){let fingerprint='';try{fingerprint=JSON.parse(last.request).configurationHash;}catch{}
   verification=fingerprint!==await configHash(bedrock.config)?'stale':check!.status;
  }
  const webhook:Configuration=!present(settings.PAYPAL_WEBHOOK_ID)?'missing':paypal==='configured'&&typeof settings.PAYPAL_WEBHOOK_ID==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(settings.PAYPAL_WEBHOOK_ID)?'configured':'invalid';
  const runner:Configuration=!present(settings.JOB_RUNNER_KEY)?'missing':credential(settings.JOB_RUNNER_KEY,16)?'configured':'invalid';
  let supplier=genericConfiguration(settings,'SUPPLIER');if(supplier==='configured'&&settings.SUPPLIER_MODE!=='sandbox')supplier='invalid';
  const notifications=notificationConfiguration(settings);
  return {configurationIsNotVerification:true,services:{
   bedrock:{configuration:bedrock.configuration,verification,lastCheck:check,scope:'synthetic-json-converse',activity,workflowEvidence,fullWorkflowVerification:workflowEvidence.verification},
   paypal:{...basic(paypal),scope:'sandbox-credentials',evidence:evidence.paypal},webhook:{...basic(webhook),scope:'signed-ingress',evidence:evidence.webhook},
   runner:{...basic(runner),scope:'unattended-schedule',evidence:evidence.runner,lastObservedRun:background?{status:['idle','running','completed','retry'].includes(background.status)?background.status:'unknown',startedAt:background.last_started?stamp(background.last_started):null,completedAt:background.last_completed?stamp(background.last_completed):null}:null},
   supplier:{...basic(supplier),scope:'supplier-bridge',evidence:evidence.supplier},notifications:{...basic(notifications.configuration),scope:'provider-delivery',channels:{email:{...basic(notifications.email),provider:notifications.emailProvider,enabled:notifications.emailEnabled,activation:notifications.emailEnabled?'enabled':'disabled',evidence:evidence.email},push:{...basic(notifications.push),provider:notifications.pushProvider,enabled:notifications.pushEnabled,activation:notifications.pushEnabled?'enabled':'disabled',evidence:evidence.push}}},
  },operations:{healthAlerts:{configuration:healthAlertConfiguration(settings).configuration,enabled:healthAlertConfiguration(settings).enabled,evidence:evidence.alerts},backup:{verification:'unverified',scope:'hosted-export-and-restore',offlineToolsAvailable:true}},evidenceIsScopedObservation:true};
 }
 async checkBedrock(planId:string,identity:Identity,settings:Settings,input:CheckInput,dependencies:{fetch?:typeof fetch;now?:()=>number}={}){
  const parsed=readinessCheckRequest.safeParse(input);if(!parsed.success)throw new BackendError('READINESS_INPUT','Explicitly confirm one Bedrock check with a new request ID.');
  const now=dependencies.now??Date.now,record=await this.owner(planId,identity),id=prefix+parsed.data.requestId;
  const prior=await this.operation(id);
  if(prior){this.ownOperation(prior,record.owner,planId);
   if(prior.status==='processing'&&prior.lease_until>now())throw new BackendError('READINESS_RUNNING','This diagnostic is already running. Read its saved status without submitting another check.',409);
   return {check:checkView(prior,now()),duplicate:true,readiness:await this.inspect(planId,identity,settings,now())};
  }
  const configured=bedrockSettings(settings);if(!configured.config)throw new BackendError('READINESS_CONFIG','Configure valid Bedrock server settings before running a diagnostic.',503);
  const recent=await this.database.prepare('SELECT id FROM adapter_operations WHERE owner=? AND provider=? AND kind=? AND created>? LIMIT 1').bind(record.owner,provider,kind,new Date(now()-60_000).toISOString()).first();
  if(recent)throw new BackendError('READINESS_RATE_LIMIT','Wait at least one minute before explicitly starting another diagnostic.',429);
  const release=await acquireAiLease(this.database,identity.id,'plan-draft',now()),token=crypto.randomUUID(),at=new Date(now()).toISOString();
  try{
   const request=JSON.stringify({version:1,configurationHash:await configHash(configured.config)});
   const inserted=await this.database.prepare(`INSERT OR IGNORE INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,status,lease_token,lease_until,created,updated)
    SELECT ?,?,?,?,?,?,?,'processing',?,?,?,? WHERE EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
     WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role='owner')
     AND NOT EXISTS(SELECT 1 FROM adapter_operations WHERE owner=? AND provider=? AND kind=? AND created>?)`)
    .bind(id,record.owner,planId,identity.id,provider,kind,request,token,now()+65_000,at,at,record.owner,planId,identity.id,record.owner,provider,kind,new Date(now()-60_000).toISOString()).run();
   if(!inserted.meta.changes)throw conflict();
   let outcome:typeof outcomes[number]='unavailable',usage:z.infer<typeof usageSchema>|null=null,diagnostic:z.infer<typeof diagnosticSchema>|undefined;
   try{
    await this.owner(planId,identity);
    const result=await withTrackedBedrock(this.database,settings,{owner:record.owner,memberId:identity.id,planId,feature:'diagnostic'},observer=>converseJson({...configured.config!,maxTokens:128,timeoutMs:Math.min(8000,configured.config!.timeoutMs)},
     {system:'Perform a synthetic connectivity check. Return only the JSON object {"ok":true}.',prompt:'Return {"ok":true}. No user, plan or receipt data is included.',validate:value=>z.object({ok:z.literal(true)}).strict().parse(value)},
     {fetch:dependencies.fetch,observer}));outcome='passed';usage=result.usage;
   }catch(error){outcome=error instanceof BackendError&&['FORBIDDEN','PLAN_NOT_FOUND'].includes(error.code)?'authorization-changed':failureOutcome(error);if(error instanceof BedrockError){const checked=diagnosticSchema.safeParse(error.diagnostic);if(checked.success)diagnostic=checked.data;}}
   const response=JSON.stringify({version:1,outcome,usage,...(diagnostic?{diagnostic}:{})}),saved=await this.database.prepare("UPDATE adapter_operations SET status=?,response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND owner=? AND plan_id=? AND status='processing' AND lease_token=?")
    .bind(outcome==='passed'?'completed':'failed',response,new Date(now()).toISOString(),id,record.owner,planId,token).run();
   if(!saved.meta.changes)throw conflict();
   const latest=await this.operation(id);if(!latest)throw conflict();
   return {check:checkView(latest,now()),duplicate:false,readiness:await this.inspect(planId,identity,settings,now())};
  }finally{await release();}
 }
}
