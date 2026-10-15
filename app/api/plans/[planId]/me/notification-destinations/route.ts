import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {destinationRequest,saveNotificationDestination} from '@/lib/notification-adapter';
import {invoiceJson} from '@/lib/plan-invoices';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity,repository}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,record=await repository.getPlan(planId,identity);const rows=await db().prepare('SELECT channel,destination,version,confirmed_at FROM notification_destinations WHERE owner=? AND plan_id=? AND member_id=?').bind(record.owner,planId,identity.id).all();return Response.json({destinations:rows.results},{headers:privateHeaders});}catch(e){return apiError(e);}}
export async function PATCH(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;return Response.json(await saveNotificationDestination(db(),planId,identity,destinationRequest.parse(await invoiceJson(request,4000)),request.headers.get('oai-authenticated-user-email')),{headers:privateHeaders});}catch(e){return apiError(e);}}
