import { checkOrigin,apiError } from '@/lib/store';
import { planApiContext,parsePlanMutation,recordResponse } from '@/lib/plan-api';
import {db} from '@/lib/store';
import {reviewPlanAction} from '@/lib/planning-review';
type Context={params:Promise<{planId:string}>};

export async function GET(request:Request,context:Context) {
  try {const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    return recordResponse(await repository.getPlan(planId,identity),identity.id);
  } catch(error) {return apiError(error);}
}
export async function PATCH(request:Request,context:Context) {
  try {checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    const input=parsePlanMutation(await request.json());
    const review=await reviewPlanAction(db(),await repository.getPlan(planId,identity),identity.id,input.action),record=await repository.updatePlan(planId,identity,input.version,input.action);
    return Response.json({...await recordResponse(record,identity.id).json() as object,review},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
