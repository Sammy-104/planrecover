'use client';

import {useEffect,useRef,useState} from 'react';
import type {BedrockWorkflowEvidence} from '../lib/bedrock-workflow-evidence';
import type {BedrockOperationsSummary} from '../lib/bedrock-operations';

type Check={id:string;status:string;outcome:string|null;startedAt:string;completedAt:string|null;usage:{totalTokens:number}|null;diagnostic?:{stage:'request'|'headers'|'body'|'validation';upstreamStatus:number|null;awsException:string|null;networkErrorName:string|null;networkErrorCode:string|null;validationReason?:string;stopReason?:string}};
type Evidence={scope:string;status:string;count:number;lastObservedAt:string|null;outcomes?:{event:string;count:number;lastObservedAt:string}[]};
type Service={configuration:'configured'|'missing'|'invalid';verification:string;lastCheck?:Check|null;channels?:Record<string,Service>;provider?:string;enabled?:boolean;activation?:'enabled'|'disabled';evidence?:Evidence;workflowEvidence?:BedrockWorkflowEvidence;activity?:BedrockOperationsSummary|null};
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
 'shared-limit':'The shared AI allowance paused this request. Wait before trying again or review the daily allowance.',
 'timed-out':'AWS did not respond in time. Review provider status before another check.',
 'invalid-response':'The response did not pass validation.',
 unavailable:'The provider could not complete the check.',
 interrupted:'The check did not finish. Review AWS status before starting another.',
 'authorization-changed':'Plan access changed while the check was running.',
};
function serviceSummary(service:Service){return `${configurationLabels[service.configuration]} · ${service.activation==='disabled'?'Sending disabled':service.activation==='enabled'?'Sending enabled · ':''}${service.activation==='disabled'?'':verificationLabels[service.verification]??'Not verified'}`;}
function ScopedEvidence({value}:{value:Evidence}){return <small className="service-evidence">{value.count?`${value.count} saved observations`:'No saved observations'} · {value.scope.replaceAll('-',' ')}{value.lastObservedAt?` · ${new Date(value.lastObservedAt).toLocaleString()}`:''}{value.outcomes?.length?` · ${value.outcomes.map(outcome=>`${outcome.event}: ${outcome.count}`).join(', ')}`:''}. Full workflow remains unverified.</small>;}
const featureLabels={chat:'Chat replies',agent:'Action proposals','plan-draft':'Itinerary drafts','receipt-image':'Image receipts','receipt-pdf':'PDF receipts'};
const workflowLabels={chat:{observed:'Saved reply read back',pending:'Saved reply not checked yet'},agent:{observed:'Saved proposal read back',pending:'Saved proposal not checked yet'},'plan-draft':{observed:'Draft preview built',pending:'Draft preview not checked yet'},'receipt-image':{observed:'Saved image result read back',pending:'Saved image result not checked yet'},'receipt-pdf':{observed:'Saved PDF result read back',pending:'Saved PDF result not checked yet'}};
function BedrockWorkflowChecks({value}:{value:BedrockWorkflowEvidence}){return <div className="notice"><h4>AI feature checks</h4><p>These saved checks apply to the current connection. A connection check alone does not verify these features.</p><dl>{Object.entries(featureLabels).map(([feature,label])=>{const fact=value.features[feature as keyof typeof featureLabels],wording=workflowLabels[feature as keyof typeof workflowLabels];return <div key={feature}><dt>{label}</dt><dd>{fact?.status==='observed'?wording.observed:wording.pending}{fact?.lastObservedAt?` · ${new Date(fact.lastObservedAt).toLocaleString()}`:''}</dd></div>;})}</dl><p className="source-footnote">Saved-result and preview checks do not verify accuracy or approval. Review generated suggestions before applying them. A changed connection needs new checks.</p></div>;}
function BedrockActivity({value}:{value:BedrockOperationsSummary}){
 const features=Object.values(value.features),tokens=features.reduce((sum,feature)=>sum+feature.knownTokens,0),unknown=features.reduce((sum,feature)=>sum+feature.unknownUsageInvocations,0),failed=features.reduce((sum,feature)=>sum+feature.failed+feature.abandoned,0);
 const estimatedCost=value.controls.pricingConfigured&&features.every(feature=>feature.estimatedCostUsd!==null)?features.reduce((sum,feature)=>sum+feature.estimatedCostUsd!,0):null;
 const recentCodes=features.map(feature=>feature.lastErrorCode),limited=recentCodes.some(code=>code==='BEDROCK_SHARED_LIMIT'||code==='BEDROCK_DAILY_LIMIT'||code==='BEDROCK_THROTTLED'),accessIssue=recentCodes.some(code=>code==='BEDROCK_AUTH'||code==='BEDROCK_MODEL');
 return <div className="notice"><h4>AI activity for this plan</h4><p>Current connection · last 24 hours{value.truncated?` · showing the latest ${value.operationLimit.toLocaleString()} requests`:''}.</p>
  <p>Recorded token counts: {tokens.toLocaleString()}{unknown?` · ${unknown.toLocaleString()} model calls have no token counts yet`:''}. {estimatedCost!==null?`Estimated model cost: US$${estimatedCost.toFixed(6)}. This excludes other AWS charges.`:value.controls.pricingConfigured?'A complete cost estimate is unavailable while token counts are missing.':'Cost estimate unavailable: model pricing has not been set.'}</p>
  {limited&&<p className="notice warning">Recent requests reached an AI request or token limit. Review the shared allowance before trying again. Failed requests are not retried automatically.</p>}
  {accessIssue&&<p className="notice warning">A recent request could not use the AWS key or selected model. Review account access and the connection settings.</p>}
  {!!failed&&!limited&&!accessIssue&&<p className="notice warning">{failed.toLocaleString()} recent AI requests did not finish successfully. Check the saved results before trying again.</p>}
  <dl>{Object.entries({...featureLabels,diagnostic:'Connection checks'}).map(([feature,label])=>{const activity=value.features[feature as keyof typeof value.features];return <div key={feature}><dt>{label}</dt><dd>{activity.succeeded.toLocaleString()} validated {activity.succeeded===1?'response':'responses'} · {activity.failed.toLocaleString()} failed{activity.running?` · ${activity.running.toLocaleString()} running`:''}{activity.abandoned?` · ${activity.abandoned.toLocaleString()} interrupted`:''}{activity.lastSucceededAt?` · last success ${new Date(activity.lastSucceededAt).toLocaleString()}`:''}</dd></div>;})}</dl>
  <p className="source-footnote">Shared protection: {value.controls.requestsPerMinute.toLocaleString()} model requests and {value.controls.tokensPerMinute.toLocaleString()} estimated tokens per minute across all members.{value.controls.dailyTokenLimit!==null?` Daily allowance: ${value.controls.dailyTokenLimit.toLocaleString()} tokens, resetting at midnight UTC.`:''} Input reservations are estimates; the AWS quota still applies. Validated responses do not certify saved-result checks or approval.</p>
 </div>;
}

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
  {bedrock?.workflowEvidence&&<BedrockWorkflowChecks value={bedrock.workflowEvidence}/>}
  {bedrock?.activity&&<BedrockActivity value={bedrock.activity}/>}
  <p>A Bedrock check makes one small synthetic request, using up to 128 output tokens and available AWS credits. Run it after verifying account access and quotas. Feature checks above record separate saved-result or preview observations.</p>
  <button className="btn" disabled={busy||bedrock?.configuration!=='configured'||bedrock.verification==='running'} onClick={checkBedrock}>{busy?'Checking…':pendingRequest.current?'Retry the same Bedrock check':'Run one Bedrock check'}</button>
 </section>;
}
