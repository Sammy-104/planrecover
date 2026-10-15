import {workspaceAccess,loadAccess,db,apiError} from '@/lib/store';
import {routeSegments,routeUrl,readRoute,type TravelLeg} from '@/lib/travel-routes';
import {tripDays} from '@/lib/trip-time';

export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access),day=query.get('day')??'',mode=query.get('mode');
 if(query.get('tripId')!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');
 if(!tripDays(state.plan.start,state.plan.end).includes(day)||!['walk','drive'].includes(mode??''))throw Error('Choose a plan day and walking or driving.');
 const cache=(globalThis.caches as CacheStorage&{default?:Cache})?.default,legs:TravelLeg[]=[];let fetched=false,pending=false,unavailable=false;
 for(const items of routeSegments(state,day)){
  const url=routeUrl(items,mode as 'walk'|'drive'),key=new URL('/__public_route_v1',request.url);key.searchParams.set('route',url);
  let body:any;const cached=await cache?.match(key.href);if(cached)body=await cached.json();
  if(!body){
   if(fetched){pending=true;continue;}
   // One shared lease across Worker instances keeps public-provider traffic below one request/second.
   const now=Date.now(),slot=await db().prepare('INSERT INTO route_provider_slots (id,next_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE route_provider_slots.next_at <= ?').bind('fossgis-osrm',now+1200,now).run();
   if(!slot.meta.changes){pending=true;continue;}fetched=true;
   try{const response=await fetch(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (itinerary routing; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Route provider unavailable.');body=await response.json();readRoute(body,items);try{await cache?.put(key.href,Response.json(body,{headers:{'Cache-Control':'public, max-age=86400'}}));}catch{}}catch{unavailable=true;continue;}
  }
  try{legs.push(...readRoute(body,items));}catch{unavailable=true;}
 }
 return Response.json({legs,pending,unavailable},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
