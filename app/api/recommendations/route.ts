import {searchRadius,rankPlaces} from '@/lib/place-match';
import {cleanActivityQuery} from '@/lib/city-lookup';
import {cityCatalog} from '@/lib/city-catalog-cache';
import {CITY_CATALOG_LIMIT,DISCOVERY_VERSION,matchesDiscoverySearch} from '@/lib/discovery';
import {cityKey,cityProfile,PLACE_DETAILS_VERSION} from '@/lib/cities';
import {workspaceAccess,checkOrigin,loadAccess,saveAccess,requireEdit,apiError,publicState} from '@/lib/store';

export async function POST(request:Request){
 try{
  checkOrigin(request);const access=await workspaceAccess(request);
  const body=await request.json() as {tripId:string;destination:string;q?:string;refresh?:boolean;radiusKm?:number};
  const {tripId,destination}=body;
  if(typeof destination!=='string'||(body.q!==undefined&&typeof body.q!=='string'))throw Error('Enter a valid city and search.');
  const query=cleanActivityQuery(body.q??''),radius=searchRadius(body.radiusKm),current=await loadAccess(access);
  if(tripId!==current.plan.id||cityKey(destination)!==cityKey(current.plan.destination))throw Error('The active trip changed. Refresh and try again.');
  requireEdit(access,current);const existing=current.recommendations;
  if(!query&&!body.refresh&&existing?.destinationKey===cityKey(destination)&&existing.radiusKm===radius&&existing.photosChecked&&existing.detailsVersion===PLACE_DETAILS_VERSION&&existing.discoveryVersion===DISCOVERY_VERSION&&!existing.sourcesUnavailable)return Response.json({state:publicState(current,access),resultIds:existing.entries.map(p=>p.id)},{headers:{'Cache-Control':'private, no-store'}});
  let recommendations;
  try{recommendations=await cityCatalog(current.plan.destination,current.plan.city,query,!!body.refresh,new URL(request.url).origin,fetch,radius);}
  catch(error){
   if(existing?.destinationKey!==cityKey(destination)||!existing.entries.length)throw error;
   recommendations={...existing,entries:rankPlaces(existing.entries,query,current.plan.city?.name??destination,current.plan.city,radius),sourcesUnavailable:true,photosChecked:false};
  }
  // Re-read after the network lookup to preserve trip edits and previous search selections.
  for(let attempt=0;attempt<3;attempt++){
   const latest=await loadAccess(access);
   if(latest.plan.id!==tripId||cityKey(latest.plan.destination)!==recommendations.destinationKey)throw Error('The active trip changed. Refresh and try again.');
   const previous=latest.recommendations?.destinationKey===recommendations.destinationKey?latest.recommendations.entries:[];
   // Keep real same-city matches usable during an upstream outage, with the outage notice retained.
   const resultIds=new Set(recommendations.entries.map(p=>p.id));
   if(recommendations.sourcesUnavailable)for(const place of rankPlaces(previous,query,latest.plan.city?.name??destination,latest.plan.city,radius))resultIds.add(place.id);
   const byId=new Map(previous.map(p=>[p.id,p]));
   for(const place of recommendations.entries)byId.set(place.id,{...byId.get(place.id),...place});
   const entries=[...byId.values()];
   const photosChecked=query?latest.recommendations?.photosChecked??false:recommendations.photosChecked;
   const discoveryVersion=query?latest.recommendations?.discoveryVersion:recommendations.discoveryVersion;
   const keep=new Set([...latest.saved,...resultIds,...(cityProfile(destination,latest.plan.city)?.places.map(p=>p.id)??[])]);
   const required=entries.filter(p=>keep.has(p.id)),remaining=Math.max(0,CITY_CATALOG_LIMIT-required.length),bounded=[...required,...(remaining?entries.filter(p=>!keep.has(p.id)).slice(-remaining):[])];
   const radiusKm=query?latest.recommendations?.radiusKm:recommendations.radiusKm;
   try{return Response.json({state:publicState(await saveAccess(access,{...latest,recommendations:{...recommendations,radiusKm,photosChecked,discoveryVersion,entries:bounded}},latest.version),access),resultIds:[...resultIds],query},{headers:{'Cache-Control':'private, no-store'}});}
   catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}
  }
  throw Error('Another change was saved. Refresh and try again.');
 }catch(e){return apiError(e);}
}
