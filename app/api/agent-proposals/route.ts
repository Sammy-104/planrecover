import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {AgentProposalRepository,executeAgentTool} from '@/lib/agent-tools';
import {invoiceJson} from '@/lib/plan-invoices';
import {z} from 'zod';
import {BackendError} from '@/lib/backend-errors';
export async function GET(request:Request){try{const {identity}=await planApiContext(request,{readOnly:true}),raw=new URL(request.url).searchParams.get('id'),repository=new AgentProposalRepository(db());
 if(!raw)return Response.json({proposals:await repository.list(undefined,identity)},{headers:privateHeaders});
 const saved=await repository.get(await repository.ownerFor(identity,z.string().uuid().parse(raw)),identity,raw);
 return Response.json({id:saved.id,plan_id:saved.plan_id,plan_version:saved.plan_version,status:saved.status,preview:saved.preview,result:saved.result},{headers:privateHeaders});
}catch(e){return apiError(e);}}
export async function POST(request:Request){try{checkOrigin(request);const {access,identity,repository}=await planApiContext(request),body=await invoiceJson(request,30000);
 if(body&&typeof body==='object'&&'confirm' in body){const input=z.object({id:z.string().uuid(),confirm:z.literal(true)}).strict().parse(body),proposals=new AgentProposalRepository(db()),proposalOwner=await proposals.ownerFor(identity,input.id),saved=await proposals.get(proposalOwner,identity,input.id);
  if(saved.preview.kind==='create-plan'&&proposalOwner!==access.id)throw new BackendError('PROPOSAL_OWNER','Prepare a new plan preview in your own account before creating it.',409);
  return Response.json(await proposals.apply(proposalOwner,identity,input.id,input.confirm),{headers:privateHeaders});}
 const input=z.object({tool:z.string(),input:z.unknown()}).strict().parse(body);return Response.json(await executeAgentTool({database:db(),repository,owner:access.id,identity},input.tool,input.input),{headers:privateHeaders});}catch(e){return apiError(e);}}
