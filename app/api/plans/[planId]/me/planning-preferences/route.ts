import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {PlanningPreferencesRepository,parsePlanningPreferenceMutation} from '@/lib/planning-constraints';
import {syncPlanReminders,reminderDeliveryConfiguration} from '@/lib/reminder-jobs';
import {env} from 'cloudflare:workers';
type Context={params:Promise<{planId:string}>};

export async function GET(request:Request,context:Context){
 try{const {identity}=await planApiContext(request),{planId}=await context.params;
  return Response.json(await new PlanningPreferencesRepository(db()).get(planId,identity),{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
export async function PATCH(request:Request,context:Context){
 try{checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params;
  const input=parsePlanningPreferenceMutation(await request.json());
  const saved=await new PlanningPreferencesRepository(db()).update(planId,identity,input.preferences,input.version);
  const record=await repository.getPlan(planId,identity);let remindersSynced=true;
  try{await syncPlanReminders(db(),record.owner,record.state);}catch{remindersSynced=false;}
  return Response.json({...saved,remindersSynced,delivery:reminderDeliveryConfiguration(env as unknown as Record<string,unknown>)},{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
