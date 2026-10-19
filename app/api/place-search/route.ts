import {frontendJson} from '@/lib/frontend-request';
import type {State} from '@/lib/model';
import {discoveryContext,cityRecommendations,setCityRecommendations} from '@/lib/city-stays';
import {discoveryOrigin,queryAnchor} from '@/lib/discovery-origin';
import {mappedPhotos} from '@/lib/place-photos';
import {searchMappedPlaces} from '@/lib/place-search';
import {cleanActivityQuery} from '@/lib/city-lookup';
import {cityKey,type CityPlace} from '@/lib/cities';
import {matchesDiscoverySearch,CITY_CATALOG_LIMIT} from '@/lib/discovery';
import {rankPlaces,searchRadius} from '@/lib/place-match';
import {mappedInfo} from '@/lib/mapped-place-info';
import {workspaceAccess,checkOrigin,loadAccess,saveAccess,requireEdit,apiError,publicState,type WorkspaceAccess} from '@/lib/store';

const visibleState=(access:WorkspaceAccess,state:State)=>publicState(state,access);
export async function POST(request:Request){
 try{
  checkOrigin(request);const access=await workspaceAccess(request),body=await frontendJson(request) as {tripId:string;destination:string;q:string;selectId?:string;radiusKm?:number;refresh?:boolean;anchorId?:string;day?:string;stayId?:string};
  if(typeof body.q!=='string'||typeof body.destination!=='string'||body.selectId!==undefined&&typeof body.selectId!=='string')throw Error('Enter a valid place search.');
  if(body.anchorId!==undefined&&typeof body.anchorId!=='string')throw Error('Choose a valid search location.');
  const query=cleanActivityQuery(body.q),radius=searchRadius(body.radiusKm),current=await loadAccess(access);if(body.selectId)requireEdit(access,current);
  const check=(state:typeof current)=>{if(state.empty||body.tripId!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');};check(current);const context=discoveryContext(current,body),catalog=cityRecommendations(current,context.destination);const origin=discoveryOrigin(current,queryAnchor(current,body.anchorId,query,context.day,context.id),context.day,context.id);
  const saved=catalog?.entries??[];
  const local=rankPlaces(saved,query,context.city?.name??body.destination,origin,radius);
  const known=body.selectId?saved.find(p=>p.id===body.selectId):undefined;
  const remote=known?{places:[] as CityPlace[],unavailable:false}:await searchMappedPlaces(body.destination,context.city,query,new URL(request.url).origin,fetch,{radiusKm:radius,refresh:body.refresh===true,origin});
  const places=rankPlaces([...local,...remote.places],query,context.city?.name??body.destination,origin,radius).slice(0,12);
  if(!body.selectId)return Response.json({places,unavailable:remote.unavailable},{headers:{'Cache-Control':'no-store'}});
  requireEdit(access,current);let chosen=known??remote.places.find(p=>p.id===body.selectId);if(!chosen)throw Error('This place result is no longer available. Search again and choose a result.');
  if(!chosen.detailsCheckedAt)Object.assign(chosen,await mappedInfo(chosen.id));
  if(!chosen.imageUrl)chosen=(await mappedPhotos([chosen])).places[0];
  for(let attempt=0;attempt<3;attempt++){
   const latest=await loadAccess(access);check(latest);const latestContext=discoveryContext(latest,body);if(JSON.stringify(discoveryOrigin(latest,queryAnchor(latest,body.anchorId,query,context.day,context.id),context.day,context.id))!==JSON.stringify(origin))throw Error('The search location changed. Search again.');
   const previous=cityRecommendations(latest,context.destination);
   const byId=new Map((previous?.entries??[]).map(p=>[p.id,p]));byId.set(chosen.id,{...byId.get(chosen.id),...chosen});
   const entries=[...byId.values()],keep=new Set([...latest.saved,chosen.id]);
   const bounded=[...entries.filter(p=>keep.has(p.id)),...entries.filter(p=>!keep.has(p.id)).slice(-CITY_CATALOG_LIMIT)];
   try{return Response.json({state:visibleState(access,await saveAccess(access,setCityRecommendations(latest,{destinationKey:cityKey(body.destination),resolvedCity:latestContext.city?.name??body.destination,fetchedAt:new Date().toISOString(),source:'open-places',...previous,entries:bounded}),latest.version)),selectedId:chosen.id});}
   catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}
  }
  throw Error('Another change was saved. Refresh and try again.');
 }catch(e){return apiError(e);}
}
