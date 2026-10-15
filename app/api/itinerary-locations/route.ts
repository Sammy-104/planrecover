import {workspaceAccess,checkOrigin,loadAccess,saveAccess,requireEdit,apiError,publicState} from '@/lib/store';
import {existingActivityLocations} from '@/lib/activity-locations';
import {validPoint} from '@/lib/itinerary-map';
export async function POST(request:Request){
 try{
  checkOrigin(request);const access=await workspaceAccess(request),body=await request.json() as {tripId:string;itemIds?:string[]},current=await loadAccess(access);
  requireEdit(access,current);if(body.tripId!==current.plan.id)throw Error('The active trip changed. Refresh and try again.');
  if(body.itemIds&&(!Array.isArray(body.itemIds)||body.itemIds.length>100||body.itemIds.some(id=>typeof id!=='string')))throw Error('Choose valid itinerary activities.');
  const {resolved,unavailable}=await existingActivityLocations(current,fetch,body.itemIds);
  for(let attempt=0;attempt<3;attempt++){
   const latest=await loadAccess(access);if(latest.plan.id!==body.tripId)throw Error('The active trip changed. Refresh and try again.');let changed=false;
   for(const item of latest.items){const old=current.items.find(i=>i.id===item.id),detail=resolved.get(item.id);if(detail&&old&&item.status!=='cancelled'&&item.name===old.name&&item.location===old.location&&item.placeLookupManual===old.placeLookupManual&&item.wikiTitle===old.wikiTitle&&item.latitude===old.latitude&&item.longitude===old.longitude){const before=JSON.stringify(item);const {imageUrl,...rest}=detail;Object.assign(item,rest);if(imageUrl)item.imageUrl=imageUrl;if(!validPoint(detail)){delete item.latitude;delete item.longitude;delete item.locationVersion;delete item.locationSourceUrl;}changed=changed||before!==JSON.stringify(item);}}
   if(!changed)return Response.json({state:publicState(latest,access),unavailable},{headers:{'Cache-Control':'private, no-store'}});
   try{return Response.json({state:publicState(await saveAccess(access,latest,latest.version),access),unavailable},{headers:{'Cache-Control':'private, no-store'}});}catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}
  }
  throw Error('Another change was saved. Refresh and try again.');
 }catch(e){return apiError(e);}
}
