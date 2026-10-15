import {z} from 'zod';
import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {BackendError} from '@/lib/backend-errors';
import {ReminderRepository} from '@/lib/reminder-jobs';
type Context={params:Promise<{planId:string}>};

export async function GET(request:Request,context:Context){
 try{const {identity}=await planApiContext(request),{planId}=await context.params;
  return Response.json(await new ReminderRepository(db()).list(planId,identity),{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
export async function PATCH(request:Request,context:Context){
 try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;
  const input=z.object({notificationId:z.string().min(1).max(180),read:z.literal(true)}).strict().safeParse(await request.json());
  if(!input.success)throw new BackendError('INVALID_REQUEST','Choose one of your notifications to mark as read.');
  return Response.json(await new ReminderRepository(db()).markRead(planId,identity,input.data.notificationId),{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
