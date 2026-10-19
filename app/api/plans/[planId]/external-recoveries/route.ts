import {checkOrigin,db,apiError} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {ExternalRecoveryService,externalRecoveryRequest} from '@/lib/external-recovery-service';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params;return Response.json({resolutions:await new ExternalRecoveryService(db()).list(planId,identity)},{headers:privateHeaders});}catch(error){return apiError(error);}}
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;return Response.json({resolution:await new ExternalRecoveryService(db()).act(planId,identity,externalRecoveryRequest.parse(await invoiceJson(request,12000)))},{headers:privateHeaders});}catch(error){return apiError(error);}}
