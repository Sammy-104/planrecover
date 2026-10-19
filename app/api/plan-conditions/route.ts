import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {tripDays} from '@/lib/trip-time';
import {planConditions} from '@/lib/plan-conditions-server';
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access),day=query.get('day')??'';
 if(query.get('tripId')!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');if(!tripDays(state.plan.start,state.plan.end).includes(day))throw Error('Choose a day within this plan.');
 return Response.json(await planConditions(state,day,new URL(request.url).origin,query.get('itemId')??undefined,query.get('refresh')==='1'),{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
