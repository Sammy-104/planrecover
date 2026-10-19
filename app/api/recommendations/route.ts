import {frontendJson} from '@/lib/frontend-request';
import type {State} from '@/lib/model';
import {discoveryContext,cityRecommendations,setCityRecommendations} from '@/lib/city-stays';
import {discoveryOrigin,queryAnchor} from '@/lib/discovery-origin';
import {searchRadius,rankPlaces} from '@/lib/place-match';
import {cleanActivityQuery} from '@/lib/city-lookup';
import {cityCatalog} from '@/lib/city-catalog-cache';
import {CITY_CATALOG_LIMIT,DISCOVERY_VERSION,matchesDiscoverySearch} from '@/lib/discovery';
import {cityKey,cityProfile,PLACE_DETAILS_VERSION} from '@/lib/cities';
import {workspaceAccess,checkOrigin,loadAccess,saveAccess,requireEdit,apiError,publicState,type WorkspaceAccess} from '@/lib/store';

const visibleState=(access:WorkspaceAccess,state:State)=>publicState(state,access);
export async function POST(request:Request){
 try{
  checkOrigin(request);const access=await workspaceAccess(request);
  const body=await frontendJson(request) as {tripId:string;destination:string;q?:string;refresh?:boolean;radiusKm?:number;anchorId?:string;day?:string;stayId?:string};
  const {tripId,destination}=body;
  if(typeof destination!=='string'||(body.q!==undefined&&typeof body.q!=='string'))throw Error('Enter a valid city and search.');
  if(body.anchorId!==undefined&&typeof body.anchorId!=='string')throw Error('Choose a valid search location.');
  const query=cleanActivityQuery(body.q??''),radius=searchRadius(body.radiusKm),current=await loadAccess(access);
  const context=discoveryContext(current,body);if(tripId!==current.plan.id)throw Error('The active trip changed. Refresh and try again.');
  requireEdit(access,current);const existing=cityRecommendations(current,context.destination),origin=discoveryOrigin(current,queryAnchor(current,body.anchorId,query,context.day,context.id),context.day,context.id);
  if(!query&&!body.refresh&&JSON.stringify(existing?.searchPoint)===JSON.stringify(origin)&&existing?.destinationKey===cityKey(destination)&&existing.radiusKm===radius&&existing.photosChecked&&existing.detailsVersion===PLACE_DETAILS_VERSION&&existing.discoveryVersion===DISCOVERY_VERSION&&!existing.sourcesUnavailable)return Response.json({state:visibleState(access,current),resultIds:existing.entries.map(p=>p.id)});
  let recommendations;
  try{recommendations=await cityCatalog(context.destination,context.city,query,!!body.refresh,new URL(request.url).origin,fetch,radius,origin);}
  catch(error){
   if(existing?.destinationKey!==cityKey(destination)||!existing.entries.length)throw error;
   recommendations={...existing,entries:rankPlaces(existing.entries,query,context.city?.name??destination,origin,radius),sourcesUnavailable:true,photosChecked:false};
  }
  // Re-read after the network lookup to preserve trip edits and previous search selections.
  for(let attempt=0;attempt<3;attempt++){
   const latest=await loadAccess(access),latestContext=discoveryContext(latest,body),previousCatalog=cityRecommendations(latest,context.destination);if(JSON.stringify(discoveryOrigin(latest,queryAnchor(latest,body.anchorId,query,context.day,context.id),context.day,context.id))!==JSON.stringify(origin))throw Error('The search location changed. Search again.');
   if(latest.plan.id!==tripId||cityKey(latestContext.destination)!==recommendations.destinationKey)throw Error('The active trip changed. Refresh and try again.');
   const previous=previousCatalog?.destinationKey===recommendations.destinationKey?previousCatalog.entries:[];
   // Keep real same-city matches usable during an upstream outage, with the outage notice retained.
   const resultIds=new Set(recommendations.entries.map(p=>p.id));
   if(recommendations.sourcesUnavailable)for(const place of rankPlaces(previous,query,latestContext.city?.name??destination,origin,radius))resultIds.add(place.id);
   const byId=new Map(previous.map(p=>[p.id,p]));
   for(const place of recommendations.entries)byId.set(place.id,{...byId.get(place.id),...place});
   const entries=[...byId.values()];
   const photosChecked=query?previousCatalog?.photosChecked??false:recommendations.photosChecked;
   const discoveryVersion=query?previousCatalog?.discoveryVersion:recommendations.discoveryVersion;
   const keep=new Set([...latest.saved,...resultIds,...(cityProfile(destination,latestContext.city)?.places.map(p=>p.id)??[])]);
   const required=entries.filter(p=>keep.has(p.id)),remaining=Math.max(0,CITY_CATALOG_LIMIT-required.length),bounded=[...required,...(remaining?entries.filter(p=>!keep.has(p.id)).slice(-remaining):[])];
   const radiusKm=query?previousCatalog?.radiusKm:recommendations.radiusKm;
   try{return Response.json({state:visibleState(access,await saveAccess(access,setCityRecommendations(latest,{...recommendations,radiusKm,photosChecked,discoveryVersion,entries:bounded}),latest.version)),resultIds:[...resultIds],query});}
   catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}
  }
  throw Error('Another change was saved. Refresh and try again.');
 }catch(e){return apiError(e);}
}
