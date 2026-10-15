import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {changeRequest,PlanChangeService} from '@/lib/plan-changes';
import {BackendError} from '@/lib/backend-errors';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params;
 return Response.json({changes:await new PlanChangeService(db()).list(planId,identity)},{headers:privateHeaders});}catch(e){return apiError(e);}}
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;
 const parsed=changeRequest.safeParse(await invoiceJson(request,30000));if(!parsed.success)throw new BackendError('INVALID_CHANGE','Provide a supported reviewed change and current plan version.');
 const service=new PlanChangeService(db()),input=parsed.data;const change=input.type==='departure'||input.type==='recovery'?await service.propose(planId,identity,input):await service.act(planId,identity,input);
 return Response.json({change},{headers:privateHeaders});}catch(e){return apiError(e);}}
