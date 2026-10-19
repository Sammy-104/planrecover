import {apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity,repository}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,plan=await repository.getPlan(planId,identity);
 const events=await db().prepare('SELECT event_type,reason,occurred_at,received_at FROM notification_delivery_events WHERE owner=? AND plan_id=? AND member_id=? ORDER BY received_at DESC,id LIMIT 100').bind(plan.owner,planId,identity.id).all();
 const push=await db().prepare('SELECT a.status,a.reason,a.updated FROM web_push_attempts a JOIN web_push_subscriptions s ON s.id=a.subscription_id WHERE s.owner=? AND s.plan_id=? AND s.member_id=? ORDER BY a.updated DESC,a.id LIMIT 100').bind(plan.owner,planId,identity.id).all();
 return Response.json({email:events.results,push:push.results,evidence:'Email delivery means the receiving mail server accepted the message. Push acceptance does not prove device display.'},{headers:privateHeaders});
 }catch(error){return apiError(error);}}
