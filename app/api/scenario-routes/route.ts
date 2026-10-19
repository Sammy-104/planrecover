import {frontendJson} from '@/lib/frontend-request';
import {workspaceAccess,loadAccess,checkOrigin,apiError} from '@/lib/store';
import {validateScenario,scenarioOverview,type TripScenario} from '@/lib/trip-workbench';
import {routeSegments} from '@/lib/travel-routes';
import {tripDays} from '@/lib/trip-time';
import {cachedTravelRoute} from '@/lib/routed-travel';
import type {State} from '@/lib/model';
export async function POST(request:Request){try{checkOrigin(request);const access=await workspaceAccess(request),state=await loadAccess(access),body=await frontendJson(request) as {tripId:string;scenario:TripScenario};if(body.tripId!==state.plan.id)throw Error('Choose this plan for the comparison.');const scenario=validateScenario(body.scenario,state,access.user?.id??'guest'),overview=scenarioOverview(state,scenario),origin=new URL(request.url).origin;
 async function report(s:State,mode:'walk'|'drive'){const segments=tripDays(s.plan.start,s.plan.end).flatMap(d=>routeSegments(s,d));if(segments.length>120)throw Error('Compare a shorter date range for this route check.');const routes=await Promise.all(segments.map(points=>cachedTravelRoute(points,mode,origin))),legs=routes.flatMap(r=>r.legs);return {mode,minutes:legs.reduce((n,l)=>n+l.minutes,0),km:legs.reduce((n,l)=>n+l.km,0),known:routes.filter(r=>r.legs.length).length,segments:segments.length,pending:routes.some(r=>r.pending),unavailable:routes.some(r=>r.unavailable),unmapped:s.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&(i.latitude===undefined||i.longitude===undefined)).length};}
 const [baseline,alternative]=await Promise.all([report(state,state.plan.scheduleTravelMode==='drive'?'drive':'walk'),report({...state,items:overview.items,plan:{...state.plan,start:scenario.start,end:scenario.end}},scenario.travelMode)]);return Response.json({baseline,alternative,pending:baseline.pending||alternative.pending,checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return apiError(e);}}
