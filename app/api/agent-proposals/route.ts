import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {AgentProposalRepository,executeAgentTool} from '@/lib/agent-tools';
import {invoiceJson} from '@/lib/plan-invoices';
import {z} from 'zod';
export async function GET(request:Request){try{const {access,identity}=await planApiContext(request,{readOnly:true}),id=z.string().uuid().parse(new URL(request.url).searchParams.get('id'));return Response.json(await new AgentProposalRepository(db()).get(access.id,identity,id),{headers:privateHeaders});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{checkOrigin(request);const {access,identity,repository}=await planApiContext(request),body=await invoiceJson(request,30000);
 if(body&&typeof body==='object'&&'confirm' in body){const input=z.object({id:z.string().uuid(),confirm:z.literal(true)}).strict().parse(body);return Response.json(await new AgentProposalRepository(db()).apply(access.id,identity,input.id,input.confirm),{headers:privateHeaders});}
 const input=z.object({tool:z.string(),input:z.unknown()}).strict().parse(body);return Response.json(await executeAgentTool({database:db(),repository,owner:access.id,identity},input.tool,input.input),{headers:privateHeaders});}catch(e){return apiError(e);}}
