import {searchMappedPlaces} from '@/lib/place-search';
import {cleanActivityQuery} from '@/lib/city-lookup';
import {cityKey,type CityPlace} from '@/lib/cities';
import {matchesDiscoverySearch,CITY_CATALOG_LIMIT} from '@/lib/discovery';
import {rankPlaces,searchRadius} from '@/lib/place-match';
import {mappedInfo} from '@/lib/mapped-place-info';
import {workspaceAccess,checkOrigin,loadAccess,saveAccess,requireEdit,apiError,publicState} from '@/lib/store';

export async function POST(request:Request){
 try{
  checkOrigin(request);const access=await workspaceAccess(request),body=await request.json() as {tripId:string;destination:string;q:string;selectId?:string;radiusKm?:number;refresh?:boolean};
  if(typeof body.q!=='string'||typeof body.destination!=='string'||body.selectId!==undefined&&typeof body.selectId!=='string')throw Error('Enter a valid place search.');
  const query=cleanActivityQuery(body.q),radius=searchRadius(body.radiusKm),current=await loadAccess(access);if(body.selectId)requireEdit(access,current);
  const check=(state:typeof current)=>{if(state.empty||body.tripId!==state.plan.id||cityKey(body.destination)!==cityKey(state.plan.destination))throw Error('The active plan changed. Refresh and try again.');};check(current);
  const saved=current.recommendations?.destinationKey===cityKey(current.plan.destination)?current.recommendations.entries:[];
  const local=rankPlaces(saved,query,current.plan.city?.name??body.destination,current.plan.city,radius);
  const known=body.selectId?saved.find(p=>p.id===body.selectId):undefined;
  const remote=known?{places:[] as CityPlace[],unavailable:false}:await searchMappedPlaces(body.destination,current.plan.city,query,new URL(request.url).origin,fetch,{radiusKm:radius,refresh:body.refresh===true});
  const places=rankPlaces([...local,...remote.places],query,current.plan.city?.name??body.destination,current.plan.city,radius).slice(0,12);
  if(!body.selectId)return Response.json({places,unavailable:remote.unavailable},{headers:{'Cache-Control':'no-store'}});
  requireEdit(access,current);const chosen=known??remote.places.find(p=>p.id===body.selectId);if(!chosen)throw Error('This place result is no longer available. Search again and choose a result.');
  if(!chosen.detailsCheckedAt)Object.assign(chosen,await mappedInfo(chosen.id));
  for(let attempt=0;attempt<3;attempt++){
   const latest=await loadAccess(access);check(latest);
   const previous=latest.recommendations?.destinationKey===cityKey(body.destination)?latest.recommendations:undefined;
   const byId=new Map((previous?.entries??[]).map(p=>[p.id,p]));byId.set(chosen.id,{...byId.get(chosen.id),...chosen});
   const entries=[...byId.values()],keep=new Set([...latest.saved,chosen.id]);
   const bounded=[...entries.filter(p=>keep.has(p.id)),...entries.filter(p=>!keep.has(p.id)).slice(-CITY_CATALOG_LIMIT)];
   try{return Response.json({state:publicState(await saveAccess(access,{...latest,recommendations:{destinationKey:cityKey(body.destination),resolvedCity:latest.plan.city?.name??body.destination,fetchedAt:new Date().toISOString(),source:'open-places',...previous,entries:bounded}},latest.version),access),selectedId:chosen.id},{headers:{'Cache-Control':'private, no-store'}});}
   catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}
  }
  throw Error('Another change was saved. Refresh and try again.');
 }catch(e){return apiError(e);}
}
