import { checkOrigin,apiError } from '@/lib/store';
import { planApiContext,parsePreferences,privateHeaders } from '@/lib/plan-api';
type Context={params:Promise<{planId:string}>};

export async function GET(request:Request,context:Context) {
  try {const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    return Response.json(await repository.getPreferences(planId,identity),{headers:privateHeaders});
  } catch(error) {return apiError(error);}
}
export async function PATCH(request:Request,context:Context) {
  try {checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params;
    const input=parsePreferences(await request.json());
    return Response.json(await repository.updatePreferences(planId,identity,input.preferences,input.version),{headers:privateHeaders});
  } catch(error) {return apiError(error);}
}
