import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {cityRoadLegs,dailyDriving} from '@/lib/road-trip';
import {cachedTravelRoute} from '@/lib/routed-travel';
import {routeSegments} from '@/lib/travel-routes';
import {tripDays} from '@/lib/trip-time';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access),day=q.get('day')??state.plan.start;
 if(q.get('tripId')!==state.plan.id||!tripDays(state.plan.start,state.plan.end).includes(day))throw Error('Choose this plan and one of its days.');
 const origin=new URL(request.url).origin,transfers=cityRoadLegs(state),segments=routeSegments(state,day);
 const [legs,dayRoutes]=await Promise.all([
  Promise.all(transfers.map(async leg=>{const route=await cachedTravelRoute(leg.points,'drive',origin),found=route.legs[0];return {id:leg.id,day:leg.day,from:leg.from,to:leg.to,...(found?{minutes:found.minutes,km:found.km}:{}),pending:route.pending,unavailable:route.unavailable};})),
  Promise.all(segments.map(points=>cachedTravelRoute(points,'drive',origin))),
 ]);
 return Response.json({legs,daily:dailyDriving(state,day,dayRoutes),checkedAt:new Date().toISOString(),pending:legs.some(l=>l.pending)||dayRoutes.some(r=>r.pending)},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
