import {providerConfig,type Env} from './http-adapters.ts';
import {backgroundHealth} from './operations-health.ts';
import {BackendError} from './backend-errors.ts';

const codes=['BACKGROUND_OVERDUE','BACKGROUND_RETRY','BACKGROUND_STALLED','NO_COMPLETED_RUN','PROVIDER_REVIEW','REMINDER_REVIEW'] as const;
type Code=typeof codes[number];
type Alert={id:string;code:Code;generation:number;event:'opened'|'recovered';status:string;attempts:number;configuration_hash:string;created:string};
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function healthAlertConfiguration(settings:Env){
 let config:ReturnType<typeof providerConfig>=null,configuration:'configured'|'missing'|'invalid'='missing';
 try{config=providerConfig(settings,'OPS_ALERT');configuration=config?'configured':'missing';}catch{configuration='invalid';}
 const enabled=settings.OPS_ALERT_ENABLED==='true';return {configuration,enabled,activation:enabled?'enabled':'disabled',config};
}
export async function ownerHealthCodes(database:D1Database,owner:string,now=Date.now()){
 const [background,providers,reminders]=await Promise.all([
  database.prepare('SELECT status,last_started,last_completed,next_at,lease_until FROM background_job_runs WHERE owner=?').bind(owner).first<{status:string;last_started:string|null;last_completed:string|null;next_at:number;lease_until:number}>(),
  database.prepare("SELECT 1 present FROM provider_operations WHERE owner=? AND status IN ('creation-uncertain','capture-uncertain','manual-review') UNION ALL SELECT 1 FROM adapter_operations WHERE owner=? AND status IN ('uncertain','manual-review') LIMIT 1").bind(owner,owner).first(),
  database.prepare("SELECT 1 present FROM reminder_jobs WHERE owner=? AND channel<>'in-app' AND status='unavailable' LIMIT 1").bind(owner).first(),
 ]);
 return [...backgroundHealth(background,now).alerts.map(row=>row.code as Code),...(providers?['PROVIDER_REVIEW' as Code]:[]),...(reminders?['REMINDER_REVIEW' as Code]:[])];
}
async function saveObservation(database:D1Database,owner:string,code:Code,active:boolean,configurationHash:string,now:number){
 const time=new Date(now).toISOString();let generation:number|undefined;
 if(active){const row=await database.prepare(`INSERT INTO ops_health_episodes(owner,code,generation,active,opened_at,observed_at) VALUES (?,?,1,1,?,?)
  ON CONFLICT(owner,code) DO UPDATE SET generation=CASE WHEN active=0 THEN generation+1 ELSE generation END,active=1,
  opened_at=CASE WHEN active=0 THEN excluded.opened_at ELSE opened_at END,closed_at=NULL,observed_at=excluded.observed_at WHERE observed_at<excluded.observed_at RETURNING generation`)
  .bind(owner,code,now,now).first<{generation:number}>();generation=row?.generation;
 }else{const row=await database.prepare('UPDATE ops_health_episodes SET active=0,closed_at=?,observed_at=? WHERE owner=? AND code=? AND active=1 AND observed_at<? RETURNING generation').bind(now,now,owner,code,now).first<{generation:number}>();generation=row?.generation;
  if(generation!==undefined)await database.prepare("UPDATE ops_health_alerts SET status='cancelled',last_outcome='recovered-before-send',updated=? WHERE owner=? AND code=? AND generation=? AND event='opened' AND status='pending' AND attempts=0").bind(time,owner,code,generation).run();
 }
 if(generation===undefined)return;
 const event=active?'opened':'recovered',id='health-'+await digest(JSON.stringify([owner,code,generation,event]));
 await database.prepare(`INSERT OR IGNORE INTO ops_health_alerts(id,owner,code,generation,event,configuration_hash,created,updated)
  SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ops_health_episodes WHERE owner=? AND code=? AND generation=? AND active=?)
  ${active?'':"AND EXISTS(SELECT 1 FROM ops_health_alerts WHERE owner=? AND code=? AND generation=? AND event='opened' AND (status IN ('accepted','sending','uncertain') OR attempts>0))"}`)
  .bind(id,owner,code,generation,event,configurationHash,time,time,owner,code,generation,active?1:0,...(active?[]:[owner,code,generation])).run();
}
async function receipt(response:Response,id:string){
 const reader=response.body?.getReader();if(!reader)throw new BackendError('ALERT_UNCERTAIN','The alert acknowledgment is missing.');
 let bytes=0,text='';const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)throw Error('limit');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();const data=JSON.parse(text);
  if(!data||typeof data!=='object'||Array.isArray(data)||data.requestId!==id)throw Error('identity');
  if(response.ok&&data.accepted===true&&Object.keys(data).every(key=>['accepted','requestId'].includes(key)))return 'accepted';
  if(response.status===429&&data.accepted===false&&data.retryable===true&&Object.keys(data).every(key=>['accepted','requestId','retryable'].includes(key)))return 'throttled';
  if(response.status>=400&&response.status<500&&data.accepted===false&&Object.keys(data).every(key=>['accepted','requestId','retryable'].includes(key)))return 'rejected';
  throw Error('uncertain');
 }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
/** Coarse operational alerts only. Disabled by default; no plan text, email,
 * provider IDs or credentials enter alert payloads/rows. Ambiguous attempts are
 * never automatically resent, even if a lease expires or configuration changes. */
export async function dispatchOwnerHealthAlerts(database:D1Database,settings:Env,owner:string,options:{now?:number;fetch?:typeof fetch;limit?:number}={}){
 const state=healthAlertConfiguration(settings);if(!state.enabled||!state.config)return {configuration:state.configuration,activation:state.activation,attempted:0,accepted:0,uncertain:0};
 const now=options.now??Date.now(),time=new Date(now).toISOString(),configurationHash=await digest(JSON.stringify(state.config)),active=new Set(await ownerHealthCodes(database,owner,now));
 for(const code of codes)await saveObservation(database,owner,code,active.has(code),configurationHash,now);
 await database.prepare("UPDATE ops_health_alerts SET status='uncertain',lease_token=NULL,lease_until=0,last_outcome='interrupted',updated=? WHERE owner=? AND status='sending' AND lease_until<=?").bind(time,owner,now).run();
 await database.prepare("UPDATE ops_health_alerts SET status='cancelled',last_outcome='configuration-changed',updated=? WHERE owner=? AND status='pending' AND configuration_hash<>?").bind(time,owner,configurationHash).run();
 const rows=await database.prepare("SELECT id,code,generation,event,status,attempts,configuration_hash,created FROM ops_health_alerts WHERE owner=? AND status='pending' AND next_at<=? AND attempts<3 AND configuration_hash=? ORDER BY created,id LIMIT ?").bind(owner,now,configurationHash,Math.max(1,Math.min(5,options.limit??3))).all<Alert>();
 let attempted=0,accepted=0,uncertain=0;
 for(const row of rows.results){const token=crypto.randomUUID(),claim=await database.prepare("UPDATE ops_health_alerts SET status='sending',attempts=attempts+1,lease_token=?,lease_until=?,updated=? WHERE id=? AND owner=? AND status='pending' AND next_at<=? AND attempts<3 AND configuration_hash=?").bind(token,now+15000,time,row.id,owner,now,configurationHash).run();if(!claim.meta.changes)continue;attempted++;
  let outcome='uncertain';try{outcome=await receipt(await (options.fetch??fetch)(state.config.origin+'/alerts',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${state.config.token}`,'Content-Type':'application/json','Idempotency-Key':row.id},body:JSON.stringify({version:1,requestId:row.id,event:row.event,code:row.code,occurredAt:row.created})}),row.id);}catch{/* Provider text and errors deliberately stay out of saved rows. */}
  const status=outcome==='accepted'?'accepted':outcome==='throttled'&&row.attempts+1<3?'pending':outcome==='throttled'||outcome==='rejected'?'rejected':'uncertain';
  const saved=await database.prepare("UPDATE ops_health_alerts SET status=?,next_at=?,lease_token=NULL,lease_until=0,accepted_at=?,last_outcome=?,updated=? WHERE id=? AND owner=? AND status='sending' AND lease_token=?").bind(status,status==='pending'?now+60000*Math.pow(2,row.attempts):0,status==='accepted'?time:null,outcome,time,row.id,owner,token).run();if(saved.meta.changes){if(status==='accepted')accepted++;if(status==='uncertain')uncertain++;}
 }
 return {configuration:state.configuration,activation:state.activation,attempted,accepted,uncertain,evidence:'Receiver acceptance only; external on-call notification is not established.'};
}
