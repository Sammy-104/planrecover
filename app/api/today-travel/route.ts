import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {todayStops,todayOrigin,departureTime} from '@/lib/today';
import {tripDays} from '@/lib/trip-time';
import {validPoint} from '@/lib/itinerary-map';
import {cachedTravelRoute} from '@/lib/routed-travel';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access),day=q.get('day')??'',mode=q.get('mode'),scope=q.get('scope')==='group'?'group':'mine',actor=state.people?access.user?.id??'guest':q.get('actor')??'sam';
 if(q.get('tripId')!==state.plan.id||!tripDays(state.plan.start,state.plan.end).includes(day)||!['walk','drive'].includes(mode??''))throw Error('Choose this plan’s day and a walking or driving route.');
 const target=todayStops(state,day,actor,scope).find(i=>i.id===q.get('itemId'));if(!target)throw Error('Choose an activity on this day.');
 const origin=todayOrigin(state,day,target,actor,scope);if(!origin||!validPoint(target))return Response.json({unmapped:true},{headers:{'Cache-Control':'private, no-store'}});
 const route=await cachedTravelRoute([origin.item,target],mode as 'walk'|'drive',new URL(request.url).origin),leg=route.legs[0],checkedAt=new Date().toISOString();
 return Response.json({pending:route.pending,unavailable:route.unavailable,from:origin.item.id,to:target.id,originLabel:origin.label,...(leg?{minutes:leg.minutes,km:leg.km,leaveAt:departureTime(target.start,leg.minutes),buffer:10,checkedAt}:{})},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
