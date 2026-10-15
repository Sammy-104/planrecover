import { checkOrigin,apiError } from '@/lib/store';
import { planApiContext,parsePlanCreation,privateHeaders,recordResponse } from '@/lib/plan-api';

export async function GET(request:Request) {
  try {const {identity,repository}=await planApiContext(request);
    return Response.json({plans:await repository.listPlans(identity.id)},{headers:privateHeaders});
  } catch(error) {return apiError(error);}
}
export async function POST(request:Request) {
  try {checkOrigin(request);const {identity,repository,access}=await planApiContext(request);
    const record=await repository.createPlan(access.id,identity,parsePlanCreation(await request.json()));
    const response=recordResponse(record);
    return new Response(response.body,{status:201,headers:response.headers});
  } catch(error) {return apiError(error);}
}
