import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {tripCatalog,type Item} from '@/lib/model';
import {dayCity} from '@/lib/city-stays';
import {discoveryOrigin} from '@/lib/discovery-origin';
import {cachedTravelRoute} from '@/lib/routed-travel';
import {validPoint} from '@/lib/itinerary-map';
import {tripDays} from '@/lib/trip-time';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access),day=q.get('day')??'',mode=q.get('mode')??'walk',ids=q.getAll('id');
 if(q.get('tripId')!==state.plan.id||!tripDays(state.plan.start,state.plan.end).includes(day)||!['walk','drive'].includes(mode)||ids.length<2||ids.length>3||new Set(ids).size!==ids.length)throw Error('Choose 2–3 saved places, a plan day and walking or driving.');
 const context=dayCity(state,day,q.get('stayId')??undefined),point=discoveryOrigin(state,q.get('anchorId')??undefined,day,context.id),catalog=tripCatalog(state);
 const places=ids.map(id=>catalog.find(c=>c.id===id&&state.saved.includes(id)));if(places.some(p=>!p))throw Error('Choose places from this plan’s saved shortlist.');
 const routes=await Promise.all(places.map(async place=>{
  if(!point||!validPoint(place!))return {id:place!.id,unmapped:true};
  const result=await cachedTravelRoute([{...point,id:'comparison-origin'} as Item,place as unknown as Item],mode as 'walk'|'drive',new URL(request.url).origin),leg=result.legs[0];
  return {id:place!.id,...(leg?{minutes:leg.minutes,km:leg.km}:{}),pending:result.pending,unavailable:result.unavailable};
 }));
 return Response.json({routes,pending:routes.some(r=>'pending' in r&&r.pending),checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
