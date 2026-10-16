import {checkOrigin,db,apiError} from '@/lib/store';
import {planApiContext,privateHeaders,parsePlanMutation} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {reviewPlanAction} from '@/lib/planning-review';
import {conflict} from '@/lib/backend-errors';
export async function POST(request:Request,context:{params:Promise<{planId:string}>}){try{
 checkOrigin(request);const {identity,repository}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,input=parsePlanMutation(await invoiceJson(request,30000)),record=await repository.getPlan(planId,identity);
 if(record.version!==input.version)throw conflict();return Response.json({review:await reviewPlanAction(db(),record,identity.id,input.action)},{headers:privateHeaders});
}catch(error){return apiError(error);}}
