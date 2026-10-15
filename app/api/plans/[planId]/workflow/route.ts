import {env} from 'cloudflare:workers';
import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {runApprovalWorkflow,workflowRequest} from '@/lib/step-functions';
type Context={params:Promise<{planId:string}>};
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;return Response.json(await runApprovalWorkflow(db(),env as unknown as Record<string,unknown>,planId,identity,workflowRequest.parse(await invoiceJson(request,2000))),{headers:privateHeaders});}catch(e){return apiError(e);}}
