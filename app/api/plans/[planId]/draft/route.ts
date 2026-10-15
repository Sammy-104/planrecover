import { env } from 'cloudflare:workers';
import { checkOrigin, apiError, db } from '@/lib/store';
import { BackendError, conflict, forbidden } from '@/lib/backend-errors';
import { planApiContext, privateHeaders } from '@/lib/plan-api';
import { bedrockConfig, converseJson } from '@/lib/bedrock';
import { planDraftRequest, planDraftPrompt, planDraftSystem, validatePlanDraft, previewPlanDraft } from '@/lib/ai-plan';
import { acquireAiLease } from '@/lib/ai-usage';
import {loadPlanningPreferences} from '@/lib/planning-constraints';
import {loadPlanningEvidence} from '@/lib/planning-evidence';
type Context = {params:Promise<{planId:string}>};

async function boundedBody(request:Request) {
  const reader=request.body?.getReader();
  if(!reader)return '';
  const decoder=new TextDecoder();let text='',size=0;
  try{
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
      if(size>20_000){await reader.cancel();throw new BackendError('REQUEST_TOO_LARGE','Keep the draft request under 20 KB.',413);}
      text+=decoder.decode(chunk.value,{stream:true});}
    return text+decoder.decode();
  }finally{reader.releaseLock();}
}

export async function POST(request:Request, context:Context) {
  try {
    checkOrigin(request);
    const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    const record=await repository.getPlan(planId,identity);
    if(!['owner','editor'].includes(record.role))throw forbidden();
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      throw new BackendError('INVALID_REQUEST','Send a JSON draft request.',415);
    const text=await boundedBody(request);
    let raw:unknown;try{raw=JSON.parse(text);}catch{throw new BackendError('INVALID_REQUEST','Provide valid JSON.');}
    const parsed=planDraftRequest.safeParse(raw);
    if(!parsed.success)throw new BackendError('INVALID_REQUEST','Provide a short draft request and the current plan version.');
    if(parsed.data.version!==record.version)throw conflict();
    const provider=bedrockConfig(env as unknown as Record<string,unknown>);
    if(!provider)throw new BackendError('BEDROCK_NOT_CONFIGURED','Amazon Bedrock needs its server key, region and model before AI drafts are available.',503);
    const planning=await loadPlanningPreferences(db(),record.owner,planId,identity.id,record.state.plan.timezone);
    const evidence=await loadPlanningEvidence(db(),record.owner,planId);
    const release=await acquireAiLease(db(),identity.id,'plan-draft');
    let result;
    try{result=await converseJson(provider,{system:planDraftSystem,
      prompt:planDraftPrompt(record.state,identity.id,parsed.data.prompt,planning.preferences,evidence),
      validate:value=>validatePlanDraft(value,record.state)});}
    finally{await release();}
    // Membership or plan edits may change while inference is running.
    const current=await repository.getPlan(planId,identity);
    if(!['owner','editor'].includes(current.role))throw forbidden();
    if(current.version!==record.version)throw conflict();
    if(JSON.stringify(current.state.preferences[identity.id])!==JSON.stringify(record.state.preferences[identity.id]))throw conflict();
    const freshPlanning=await loadPlanningPreferences(db(),record.owner,planId,identity.id,current.state.plan.timezone);
    if(freshPlanning.version!==planning.version)throw conflict();
    const freshEvidence=await loadPlanningEvidence(db(),record.owner,planId);
    if(JSON.stringify(freshEvidence)!==JSON.stringify(evidence))throw conflict();
    return Response.json({planId,version:record.version,provider:result.provider,modelId:result.modelId,
      usage:result.usage,draft:previewPlanDraft(result.value,current.state,identity.id,freshPlanning.preferences,freshEvidence)}, {headers:privateHeaders});
  }catch(error){return apiError(error);}
}
