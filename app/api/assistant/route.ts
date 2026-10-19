import {env} from 'cloudflare:workers';
import {workspaceAccess,checkOrigin,apiError,db} from '@/lib/store';
import {PlanRepository} from '@/lib/plan-repository';
import {assistantRequest,assistantAnswer,assistantFacts,savedPlanAnswer,assistantSystem} from '@/lib/plan-assistant';
import {bedrockConfig,converseJson,converseAgent} from '@/lib/bedrock';
import {ConversationRepository} from '@/lib/conversations';
import {agentToolDefinitions,executeAgentTool,agentInstructions,AgentProposalRepository} from '@/lib/agent-tools';
import {withTrackedBedrock} from '@/lib/bedrock-operations';
import {recordBedrockWorkflowEvidence} from '@/lib/bedrock-workflow-evidence';
import {acquireAiLease} from '@/lib/ai-usage';
import {invoiceJson} from '@/lib/plan-invoices';
import {BackendError,conflict,missingPlan} from '@/lib/backend-errors';
import {loadPlanningPreferences} from '@/lib/planning-constraints';
import {isDemoTrip} from '@/lib/model';
import {savedToolResults} from '@/lib/agent-checkpoints';
export async function POST(request:Request){let conversationLease:{id:string;token:string}|undefined;const conversations=new ConversationRepository(db());try{
 checkOrigin(request);const access=await workspaceAccess(request);
 if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to chat about your saved plans.',401);
 const parsed=assistantRequest.safeParse(await invoiceJson(request,30000));
 if(!parsed.success)throw new BackendError('INVALID_ASSISTANT_REQUEST','Send a message of up to 2,000 characters with a short conversation history.');
 const input=parsed.data,repository=new PlanRepository(db()),identity=access.user;
 if([input.conversationId,input.conversationVersion,input.requestId].some(v=>v!==undefined)&&[input.conversationId,input.conversationVersion,input.requestId].some(v=>v===undefined))throw new BackendError('CONVERSATION_INPUT','Provide the conversation ID, current version and request ID together.');
 if(access.share&&input.planId!==access.share.tripId)throw missingPlan();
 const plans=await repository.listPlans(identity.id),record=input.planId?await repository.getPlan(input.planId,identity):undefined;
 if(access.share&&record?.owner!==access.id)throw missingPlan();
 if(input.demoMember&&(!record||!isDemoTrip(record.state)||record.state.people))throw new BackendError('INVALID_DEMO_CONTEXT','Demo member views are available only in the fictional demo.');
 const memberId=input.demoMember??identity.id;
 const conversationOwner=record?.owner??access.id;
 const decisions=record?await repository.getDecisionExtras(record.state.plan.id!,identity):undefined;
 if(input.conversationId){const saved=await conversations.read(conversationOwner,identity,input.conversationId,undefined,input.demoMember??'');if(saved.planId!==(input.planId??null))throw missingPlan();
  const lease=await conversations.begin(conversationOwner,identity,input.conversationId,input.conversationVersion!,input.requestId!,input.message,input.demoMember??'');
  if(lease.duplicate)return Response.json({...lease.duplicate,readOnly:lease.duplicate.readOnly??true,duplicate:true,conversationId:saved.id},{headers:{'Cache-Control':'private, no-store'}});
  conversationLease={id:saved.id,token:lease.token!};input.history=saved.messages.filter(m=>m.role==='assistant'||m.mode==='complete').slice(-8).map(m=>({role:m.role,text:m.text.slice(0,3000)}));}
 let provider;try{provider=bedrockConfig(env as unknown as Record<string,unknown>);}catch{provider=null;}
 const facts=record&&decisions?assistantFacts(record,memberId,decisions,plans):null;
 let reply=savedPlanAnswer(input.message,record,memberId,decisions,plans),mode:'saved-plan'|'bedrock'='saved-plan',notice:string|undefined;
 let planningVersion:number|undefined;
 let bedrockOperationId:string|undefined;
 let followUps=['Show my schedule','Explain my money','What needs my attention?'];let prepared:unknown[]=[];
 if(provider&&(record&&facts||input.agent)&&!input.demoMember){
  const planning=record?await loadPlanningPreferences(db(),record.owner,record.state.plan.id!,identity.id,record.state.plan.timezone):null;
  planningVersion=planning?.version;
  const context={facts,plans,callerMemberId:identity.id,myPlanningPreferences:planning?.preferences??null,history:input.history,question:input.message};
  // Large plans still get a useful saved-data answer without an unbounded model request.
  if(JSON.stringify(context).length<=46000){
   let release;try{
    release=await acquireAiLease(db(),identity.id,'plan-draft');
    await withTrackedBedrock(db(),env as unknown as Record<string,unknown>,{owner:record?.owner??access.id,memberId:identity.id,planId:input.planId,feature:input.agent?'agent':'chat'},async observer=>{
     bedrockOperationId=observer.operationId;
     if(input.agent&&!input.demoMember){const result=await converseAgent(provider,{system:agentInstructions,prompt:JSON.stringify(context),tools:record?agentToolDefinitions:agentToolDefinitions.filter(t=>t.name==='prepare_plan'),execute:(name,args)=>executeAgentTool({database:db(),repository,owner:access.id,identity,boundPlanId:input.planId,turn:input.conversationId?{conversationId:input.conversationId,requestId:input.requestId!,conversationOwner}:undefined},name,args)},{observer});reply=result.text;prepared=result.results;}
     else{const result=await converseJson(provider,{system:assistantSystem,prompt:JSON.stringify(context),validate:value=>assistantAnswer.parse(value)},{observer});reply=result.value.answer;followUps=result.value.followUps;}
    });mode='bedrock';
   }catch{if(input.conversationId)prepared=await savedToolResults(db(),conversationOwner,identity.id,input.conversationId,input.requestId);notice=prepared.length?'Your prepared reviews were saved. Open them below; the assistant could not finish its reply.':'AI could not answer just now. Here is the answer from your saved plan.';}finally{if(release)await release();}
  }else notice='This plan is large. Showing the answer from your saved records.';
 }
 if(record){const freshAccess=await workspaceAccess(request),current=await repository.getPlan(record.state.plan.id!,identity);
  if(access.share&&(!freshAccess.share||freshAccess.id!==access.id||freshAccess.share.tokenHash!==access.share.tokenHash))throw missingPlan();
  if(current.version!==record.version||JSON.stringify(current.state.preferences[identity.id])!==JSON.stringify(record.state.preferences[identity.id]))throw conflict();
  if(mode==='bedrock'&&planningVersion!==undefined&&(await loadPlanningPreferences(db(),record.owner,record.state.plan.id!,identity.id,current.state.plan.timezone)).version!==planningVersion)throw conflict();
  if(mode==='bedrock'){
   const freshDecisions=await repository.getDecisionExtras(record.state.plan.id!,identity);
   const expectedChanges=[...(decisions?.changes??[])];
   // A saved review created by this exact tool turn is an expected new decision.
   // Any unrelated change, approval, mutation or missing prepared review still conflicts.
   for(const entry of prepared){const tool=entry as {name?:string;result?:{changeId?:unknown;status?:unknown;figures?:unknown;required?:unknown}};
    const result=tool.result;if(tool.name!=='prepare_plan_change'||typeof result?.changeId!=='string'||expectedChanges.some(change=>change.id===result.changeId))continue;
    const saved=await db().prepare("SELECT body,status,created_by FROM plan_changes WHERE id=? AND owner=? AND plan_id=? AND NOT EXISTS(SELECT 1 FROM plan_change_approvals WHERE change_id=plan_changes.id)")
     .bind(result.changeId,record.owner,record.state.plan.id).first<{body:string;status:string;created_by:string}>();
    if(!saved||saved.created_by!==identity.id||saved.status!=='review'||result.status!=='review')throw conflict();
    const terms=JSON.parse(saved.body);
    if(JSON.stringify(terms.figures)!==JSON.stringify(result.figures)||JSON.stringify(terms.required)!==JSON.stringify(result.required))throw conflict();
    if(terms.required.includes(identity.id))expectedChanges.push({id:result.changeId,kind:terms.kind,ownImpact:terms.figures.memberImpacts?.[identity.id]??null,reviewUrl:`/flows?plan=${encodeURIComponent(record.state.plan.id!)}`,requiresReview:true});
   }
   const orderChanges=(value:typeof freshDecisions)=>({...value,changes:[...(value.changes??[])].sort((a,b)=>a.id.localeCompare(b.id))});
   if(JSON.stringify(orderChanges(freshDecisions))!==JSON.stringify(orderChanges({...decisions!,changes:expectedChanges})))throw conflict();
  }
 }
 if(conversationLease)await conversations.finish(conversationOwner,identity,conversationLease.id,input.conversationVersion!,conversationLease.token,input.requestId!,input.message,reply,mode,{followUps,notice:notice??null,prepared,bedrockOperationId:mode==='bedrock'?bedrockOperationId??null:null,readOnly:prepared.length===0,planUnchanged:true,financialEffects:false,modelConnected:!!provider,planId:record?.state.plan.id??null,planVersion:record?.version??null},record?.version);
 if(mode==='bedrock'&&bedrockOperationId&&record){
  // Verify the durable proposal through the same authenticated repository used by its review page.
  for(const entry of prepared){const tool=entry as {name?:string;result?:{proposalId?:unknown;changeId?:unknown}};
   if(tool.name==='prepare_plan_change'&&typeof tool.result?.changeId==='string'){
    const saved=await db().prepare("SELECT id FROM plan_changes WHERE id=? AND owner=? AND plan_id=? AND created_by=? AND status='review'").bind(tool.result.changeId,record.owner,record.state.plan.id,identity.id).first<{id:string}>();
    if(saved)await recordBedrockWorkflowEvidence(db(),env as unknown as Record<string,unknown>,{owner:record.owner,memberId:identity.id,planId:record.state.plan.id!,operationId:bedrockOperationId,scope:'saved-agent-proposal-readback',proofReference:`change:${saved.id}`});
    continue;
   }
   const id=tool.result?.proposalId;
   if(typeof id!=='string'||!['prepare_plan','prepare_plan_action'].includes(tool.name??''))continue;
   const saved=await new AgentProposalRepository(db()).get(access.id,identity,id);
   if(saved.plan_id!==record.state.plan.id||saved.status!=='review')continue;
   await recordBedrockWorkflowEvidence(db(),env as unknown as Record<string,unknown>,{owner:record.owner,memberId:identity.id,planId:record.state.plan.id!,operationId:bedrockOperationId,scope:'saved-agent-proposal-readback',proofReference:`${id}:${saved.plan_version}`});
  }
 }
 return Response.json({reply,followUps,mode,prepared,conversationId:input.conversationId,conversationVersion:input.conversationVersion===undefined?undefined:input.conversationVersion+1,modelConnected:!!provider,notice,planId:record?.state.plan.id??null,
  planVersion:record?.version??null,plans,brief:facts?.brief??[],currency:facts?.currency??null,
  money:facts?.myMoney??null,readOnly:prepared.length===0,planUnchanged:true,financialEffects:false},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}finally{if(conversationLease)await conversations.release(conversationLease.id,conversationLease.token).catch(()=>{});}}
