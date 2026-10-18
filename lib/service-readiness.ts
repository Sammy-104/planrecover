import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {bedrockConfig,converseJson,type BedrockConfig} from './bedrock.ts';
import {acquireAiLease} from './ai-usage.ts';
import {providerConfig} from './http-adapters.ts';
import {sesEmailConfig} from './ses-email.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';

type Settings=Record<string,unknown>;
type Configuration='configured'|'missing'|'invalid';
type Verification='unverified'|'running'|'passed'|'failed'|'interrupted'|'stale';
const provider='bedrock-readiness',kind='synthetic-json-check',prefix='readiness-bedrock-';
const outcomes=['passed','access-denied','model-unavailable','rate-limited','timed-out','invalid-response','unavailable','interrupted','authorization-changed'] as const;
const usageSchema=z.object({inputTokens:z.number().int().nonnegative().max(1_000_000),outputTokens:z.number().int().min(0).max(128),totalTokens:z.number().int().nonnegative().max(1_000_000)}).strict();
const storedResult=z.object({version:z.literal(1),outcome:z.enum(outcomes),usage:usageSchema.nullable()}).strict();
export const readinessCheckRequest=z.object({action:z.literal('check-bedrock'),requestId:z.string().uuid(),confirm:z.literal(true)}).strict();
type CheckInput=z.infer<typeof readinessCheckRequest>;
type Operation={id:string;owner:string;plan_id:string;member_id:string;provider:string;kind:string;request:string;response:string|null;status:string;lease_token:string|null;lease_until:number;created:string;updated:string};
type Check={id:string;service:'bedrock';scope:'synthetic-json-converse';status:'running'|'passed'|'failed'|'interrupted';outcome:typeof outcomes[number]|null;startedAt:string;completedAt:string|null;usage:z.infer<typeof usageSchema>|null};
const basic=(configuration:Configuration)=>({configuration,verification:'unverified' as Verification});
const present=(value:unknown)=>value!==undefined&&value!==null&&value!=='';
const credential=(value:unknown,min=1,max=4096)=>typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\s\x00-\x1f\x7f]/.test(value);
const stamp=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():'';

function bedrockSettings(settings:Settings):{configuration:Configuration;config:BedrockConfig|null}{
 try{const config=bedrockConfig(settings);return {configuration:config?'configured':'missing',config};}
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
 const push=genericConfiguration(settings,'NOTIFICATION');let email=push,emailProvider='generic';
 if(settings.AWS_SES_ENABLED==='true'){emailProvider='amazon-ses';try{email=sesEmailConfig(settings)?'configured':'missing';}catch{email='invalid';}}
 const configuration:Configuration=email==='invalid'||push==='invalid'?'invalid':email==='configured'||push==='configured'?'configured':'missing';
 return {configuration,email,push,emailProvider};
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
  outcome:running?null:result?.outcome??'interrupted',startedAt:stamp(row.created),completedAt:running||!result?null:stamp(row.updated),usage:result?.usage??null};
}
function failureOutcome(error:unknown):typeof outcomes[number]{
 const code=error instanceof BackendError?error.code:'';
 if(code==='BEDROCK_AUTH')return 'access-denied';
 if(code==='BEDROCK_MODEL')return 'model-unavailable';
 if(code==='BEDROCK_THROTTLED')return 'rate-limited';
 if(code==='BEDROCK_TIMEOUT')return 'timed-out';
 if(['BEDROCK_RESPONSE','BEDROCK_OUTPUT','BEDROCK_BLOCKED'].includes(code))return 'invalid-response';
 return 'unavailable';
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
  const [last,background]=await Promise.all([
   this.database.prepare('SELECT * FROM adapter_operations WHERE owner=? AND plan_id=? AND provider=? AND kind=? ORDER BY created DESC,id DESC LIMIT 1').bind(record.owner,planId,provider,kind).first<Operation>(),
   this.database.prepare('SELECT status,last_started,last_completed FROM background_job_runs WHERE owner=?').bind(record.owner).first<{status:string;last_started:string|null;last_completed:string|null}>(),
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
   bedrock:{configuration:bedrock.configuration,verification,lastCheck:check,scope:'synthetic-json-converse',fullWorkflowVerification:'unverified'},
   paypal:{...basic(paypal),scope:'sandbox-credentials'},webhook:{...basic(webhook),scope:'signed-ingress'},
   runner:{...basic(runner),scope:'unattended-schedule',lastObservedRun:background?{status:['idle','running','completed','retry'].includes(background.status)?background.status:'unknown',startedAt:background.last_started?stamp(background.last_started):null,completedAt:background.last_completed?stamp(background.last_completed):null}:null},
   supplier:{...basic(supplier),scope:'supplier-bridge'},notifications:{...basic(notifications.configuration),scope:'provider-delivery',channels:{email:{...basic(notifications.email),provider:notifications.emailProvider},push:basic(notifications.push)}},
  }};
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
   let outcome:typeof outcomes[number]='unavailable',usage:z.infer<typeof usageSchema>|null=null;
   try{
    await this.owner(planId,identity);
    const result=await converseJson({...configured.config,maxTokens:128,timeoutMs:Math.min(8000,configured.config.timeoutMs)},
     {system:'Perform a synthetic connectivity check. Return only the JSON object {"ok":true}.',prompt:'Return {"ok":true}. No user, plan or receipt data is included.',validate:value=>z.object({ok:z.literal(true)}).strict().parse(value)},
     {fetch:dependencies.fetch});outcome='passed';usage=result.usage;
   }catch(error){outcome=error instanceof BackendError&&['FORBIDDEN','PLAN_NOT_FOUND'].includes(error.code)?'authorization-changed':failureOutcome(error);}
   const response=JSON.stringify({version:1,outcome,usage}),saved=await this.database.prepare("UPDATE adapter_operations SET status=?,response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND owner=? AND plan_id=? AND status='processing' AND lease_token=?")
    .bind(outcome==='passed'?'completed':'failed',response,new Date(now()).toISOString(),id,record.owner,planId,token).run();
   if(!saved.meta.changes)throw conflict();
   const latest=await this.operation(id);if(!latest)throw conflict();
   return {check:checkView(latest,now()),duplicate:false,readiness:await this.inspect(planId,identity,settings,now())};
  }finally{await release();}
 }
}
