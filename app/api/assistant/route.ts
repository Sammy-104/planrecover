import {env} from 'cloudflare:workers';
import {workspaceAccess,checkOrigin,apiError,db} from '@/lib/store';
import {PlanRepository} from '@/lib/plan-repository';
import {assistantRequest,assistantAnswer,assistantFacts,savedPlanAnswer,assistantSystem} from '@/lib/plan-assistant';
import {bedrockConfig,converseJson,converseAgent} from '@/lib/bedrock';
import {ConversationRepository} from '@/lib/conversations';
import {agentToolDefinitions,executeAgentTool,agentInstructions} from '@/lib/agent-tools';
import {acquireAiLease} from '@/lib/ai-usage';
import {invoiceJson} from '@/lib/plan-invoices';
import {BackendError,conflict,missingPlan} from '@/lib/backend-errors';
import {loadPlanningPreferences} from '@/lib/planning-constraints';
import {isDemoTrip} from '@/lib/model';
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
 let followUps=['Show my schedule','Explain my money','What needs my attention?'];let prepared:unknown[]=[];
 if(provider&&record&&facts){
  const planning=await loadPlanningPreferences(db(),record.owner,record.state.plan.id!,identity.id,record.state.plan.timezone);
  planningVersion=planning.version;
  const context={facts,myPlanningPreferences:planning.preferences,history:input.history,question:input.message};
  // Large plans still get a useful saved-data answer without an unbounded model request.
  if(JSON.stringify(context).length<=46000){
   let release;try{
    release=await acquireAiLease(db(),identity.id,'plan-draft');
    if(input.agent&&!input.demoMember){const result=await converseAgent(provider,{system:agentInstructions,prompt:JSON.stringify(context),tools:agentToolDefinitions,execute:(name,args)=>executeAgentTool({database:db(),repository,owner:access.id,identity,boundPlanId:input.planId},name,args)});reply=result.text;prepared=result.results;mode='bedrock';}
    else{const result=await converseJson(provider,{system:assistantSystem,prompt:JSON.stringify(context),validate:value=>assistantAnswer.parse(value)});reply=result.value.answer;followUps=result.value.followUps;mode='bedrock';}
   }catch{notice='AI could not answer just now. Here is the answer from your saved plan.';}finally{if(release)await release();}
  }else notice='This plan is large. Showing the answer from your saved records.';
 }
 if(record){const freshAccess=await workspaceAccess(request),current=await repository.getPlan(record.state.plan.id!,identity);
  if(access.share&&(!freshAccess.share||freshAccess.id!==access.id||freshAccess.share.tokenHash!==access.share.tokenHash))throw missingPlan();
  if(current.version!==record.version||JSON.stringify(current.state.preferences[identity.id])!==JSON.stringify(record.state.preferences[identity.id]))throw conflict();
  if(mode==='bedrock'&&planningVersion!==undefined&&(await loadPlanningPreferences(db(),record.owner,record.state.plan.id!,identity.id,current.state.plan.timezone)).version!==planningVersion)throw conflict();
  if(mode==='bedrock'&&JSON.stringify(await repository.getDecisionExtras(record.state.plan.id!,identity))!==JSON.stringify(decisions))throw conflict();
 }
 if(conversationLease)await conversations.finish(conversationOwner,identity,conversationLease.id,input.conversationVersion!,conversationLease.token,input.requestId!,input.message,reply,mode,{followUps,notice:notice??null,prepared,readOnly:prepared.length===0,planUnchanged:true,financialEffects:false,modelConnected:!!provider,planId:record?.state.plan.id??null,planVersion:record?.version??null},record?.version);
 return Response.json({reply,followUps,mode,prepared,conversationId:input.conversationId,conversationVersion:input.conversationVersion===undefined?undefined:input.conversationVersion+1,modelConnected:!!provider,notice,planId:record?.state.plan.id??null,
  planVersion:record?.version??null,plans,brief:facts?.brief??[],currency:facts?.currency??null,
  money:facts?.myMoney??null,readOnly:prepared.length===0,planUnchanged:true,financialEffects:false},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}finally{if(conversationLease)await conversations.release(conversationLease.id,conversationLease.token).catch(()=>{});}}
