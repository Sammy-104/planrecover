import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {checkOrigin,apiError,db} from '@/lib/store';
import {PlanningEvidenceRepository,planningEvidenceJson} from '@/lib/planning-evidence';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){
 try{const {identity}=await planApiContext(request),{planId}=await context.params;
  return Response.json(await new PlanningEvidenceRepository(db()).list(planId,identity),{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
export async function POST(request:Request,context:Context){
 try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;
  return Response.json(await new PlanningEvidenceRepository(db()).save(planId,identity,await planningEvidenceJson(request)),{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
export async function DELETE(request:Request,context:Context){
 try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;
  return Response.json(await new PlanningEvidenceRepository(db()).revoke(planId,identity,await planningEvidenceJson(request)),{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
