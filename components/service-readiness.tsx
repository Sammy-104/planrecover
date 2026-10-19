'use client';

import {useEffect,useRef,useState} from 'react';

type Check={id:string;status:string;outcome:string|null;startedAt:string;completedAt:string|null;usage:{totalTokens:number}|null;diagnostic?:{stage:'request'|'headers'|'body'|'validation';upstreamStatus:number|null;awsException:string|null;networkErrorName:string|null;networkErrorCode:string|null;validationReason?:string;stopReason?:string}};
type Evidence={scope:string;status:string;count:number;lastObservedAt:string|null;outcomes?:{event:string;count:number;lastObservedAt:string}[]};
type Service={configuration:'configured'|'missing'|'invalid';verification:string;lastCheck?:Check|null;channels?:Record<string,Service>;provider?:string;enabled?:boolean;activation?:'enabled'|'disabled';evidence?:Evidence};
type Readiness={configurationIsNotVerification:true;services:Record<string,Service>};
const labels:Record<string,string>={bedrock:'Amazon Bedrock',paypal:'PayPal sandbox',webhook:'Signed PayPal callbacks',runner:'Background checks',supplier:'Supplier connection',notifications:'Reminder delivery'};
const configurationLabels={configured:'Configured',missing:'Not configured',invalid:'Configuration needs review'};
const verificationLabels:Record<string,string>={unverified:'Not verified',running:'Check in progress',passed:'Synthetic check passed',failed:'Check failed',interrupted:'Check interrupted',stale:'Check needs repeating after configuration change'};
const diagnosticStages={request:'Connecting to AWS',headers:'AWS response',body:'Reading the AWS response',validation:'Validating the reply'};
const validationLabels:Record<string,string>={'envelope':'Invalid response structure','stop-reason':'Incomplete or unsupported reply','message':'Invalid assistant message','content-block':'Unsupported reply content','content-limit':'Reply too large','output-wrapper':'Unrecognized answer formatting','json-syntax':'Invalid JSON','json-tree':'Unsafe or oversized JSON','application-schema':'Reply does not match the required fields','usage':'Invalid token counts'};
const outcomes:Record<string,string>={
 'access-denied':'AWS denied access. Review the key, model permissions and account access.',
 'model-unavailable':'Review the selected model, region and application profile in AWS.',
 'rate-limited':'AWS limited the request. Review the account quota before another check.',
 'timed-out':'AWS did not respond in time. Review provider status before another check.',
 'invalid-response':'The response did not pass validation.',
 unavailable:'The provider could not complete the check.',
 interrupted:'The check did not finish. Review AWS status before starting another.',
 'authorization-changed':'Plan access changed while the check was running.',
};
function serviceSummary(service:Service){return `${configurationLabels[service.configuration]} · ${service.activation==='disabled'?'Sending disabled':service.activation==='enabled'?'Sending enabled · ':''}${service.activation==='disabled'?'':verificationLabels[service.verification]??'Not verified'}`;}
function ScopedEvidence({value}:{value:Evidence}){return <small className="service-evidence">{value.count?`${value.count} saved observations`:'No saved observations'} · {value.scope.replaceAll('-',' ')}{value.lastObservedAt?` · ${new Date(value.lastObservedAt).toLocaleString()}`:''}{value.outcomes?.length?` · ${value.outcomes.map(outcome=>`${outcome.event}: ${outcome.count}`).join(', ')}`:''}. Full workflow remains unverified.</small>;}

export function ServiceReadiness({planId}:{planId:string}){
 const [readiness,setReadiness]=useState<Readiness|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const alive=useRef(true),pendingRequest=useRef<string|null>(null);
 const path=`/api/plans/${encodeURIComponent(planId)}/readiness`;
 useEffect(()=>{alive.current=true;const abort=new AbortController();setReadiness(null);setError('');pendingRequest.current=null;
  void fetch(path,{credentials:'same-origin',signal:abort.signal}).then(async response=>{const result=await response.json() as any;if(!response.ok)throw Error(result.error??'Service checks could not be loaded.');if(alive.current&&!abort.signal.aborted)setReadiness(result);}).catch(e=>{if(alive.current&&!abort.signal.aborted)setError((e as Error).message);});
  return()=>{alive.current=false;abort.abort();};
 },[path]);
 async function refresh(){setBusy(true);setError('');try{const response=await fetch(path,{credentials:'same-origin'}),result=await response.json() as any;if(!response.ok)throw Error(result.error??'Service checks could not be loaded.');if(alive.current)setReadiness(result);}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
 async function checkBedrock(){setBusy(true);setError('');const requestId=pendingRequest.current??crypto.randomUUID();pendingRequest.current=requestId;
  try{const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check-bedrock',requestId,confirm:true})}),result=await response.json() as any;
   if(!response.ok)throw Error(result.error??'The check could not be completed.');pendingRequest.current=null;if(alive.current)setReadiness(result.readiness);
  }catch(e){if(alive.current)setError((e as Error).message+' Refresh the saved result before starting a new check. Retrying uses the same request.');}
  finally{if(alive.current)setBusy(false);}
 }
 const bedrock=readiness?.services.bedrock,check=bedrock?.lastCheck;
 return <section className="service-readiness" aria-label="Service readiness">
  <div className="section-top"><h3>Service readiness</h3><button className="btn small-btn" disabled={busy} onClick={refresh}>Refresh checks</button></div>
  <p>Configured settings and verified service responses are tracked separately.</p>
  {error&&<p className="notice warning" role="alert">{error}</p>}
  {!readiness&&!error&&<p role="status">Loading service checks…</p>}
  {readiness&&<dl className="service-readiness-list">{Object.entries(labels).flatMap(([key,label])=>{const service=readiness.services[key];if(!service)return [];const rows=key==='notifications'&&service.channels?Object.entries(service.channels).map(([channel,value])=>({key:`notifications-${channel}`,label:channel==='email'?(value.provider==='amazon-ses'?'Amazon SES email':'Email reminders'):'Push reminders',service:value})):[{key,label,service}];return rows.map(row=><div key={row.key}><dt>{row.label}</dt><dd>{serviceSummary(row.service)}{row.service.evidence&&<ScopedEvidence value={row.service.evidence}/>}</dd></div>);})}</dl>}
  {check&&<div className="notice" role="status"><strong>Last Bedrock check: {verificationLabels[check.status]??check.status}</strong><p>{check.completedAt?new Date(check.completedAt).toLocaleString():new Date(check.startedAt).toLocaleString()}{check.usage?` · ${check.usage.totalTokens} tokens`:''}</p>{check.outcome&&outcomes[check.outcome]&&<p>{outcomes[check.outcome]}</p>}{check.diagnostic&&<p className="source-footnote">Connection details: {[diagnosticStages[check.diagnostic.stage],check.diagnostic.upstreamStatus?`HTTP ${check.diagnostic.upstreamStatus}`:null,check.diagnostic.awsException,check.diagnostic.networkErrorName,check.diagnostic.networkErrorCode,check.diagnostic.validationReason?validationLabels[check.diagnostic.validationReason]:null,check.diagnostic.stopReason].filter(Boolean).join(' · ')}</p>}</div>}
  <p>A Bedrock check makes one small synthetic request, using up to 128 output tokens and available AWS credits. Run it after verifying account access and quotas. Passing this check still leaves chat, itinerary and receipt workflows to verify.</p>
  <button className="btn" disabled={busy||bedrock?.configuration!=='configured'||bedrock.verification==='running'} onClick={checkBedrock}>{busy?'Checking…':pendingRequest.current?'Retry the same Bedrock check':'Run one Bedrock check'}</button>
 </section>;
}
