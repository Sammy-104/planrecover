import { checkOrigin,apiError } from '@/lib/store';
import { planApiContext,parsePlanMutation,recordResponse } from '@/lib/plan-api';
type Context={params:Promise<{planId:string}>};

export async function GET(request:Request,context:Context) {
  try {const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    return recordResponse(await repository.getPlan(planId,identity));
  } catch(error) {return apiError(error);}
}
export async function PATCH(request:Request,context:Context) {
  try {checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    const input=parsePlanMutation(await request.json());
    return recordResponse(await repository.updatePlan(planId,identity,input.version,input.action));
  } catch(error) {return apiError(error);}
}
