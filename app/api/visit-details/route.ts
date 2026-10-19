import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {tripCatalog} from '@/lib/model';
import {mappedVenueInfo,mappedVenueId} from '@/lib/mapped-place-info';
import {freshPlaceInfo} from '@/lib/place-info';
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access);
 if(query.get('tripId')!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');
 const itemId=query.get('itemId'),suggestionId=query.get('suggestionId');if(!!itemId===!!suggestionId)throw Error('Choose one saved place to refresh.');
 const place=itemId?state.items.find(i=>i.id===itemId):tripCatalog(state).find(c=>c.id===suggestionId);
 if(!place)throw Error('This place is no longer in the plan.');
 const id=mappedVenueId(place),refresh=query.get('refresh')==='1',cached=!refresh&&freshPlaceInfo(place),details=cached?{}:await mappedVenueInfo(place,fetch,{refresh});
 const refreshed='detailsCheckedAt' in details;
 // Clear removed or unrefreshable community facts instead of merging old hours into a new snapshot.
 const safeDetails=cached||!id?{}:refreshed?details:{detailsSnapshotComplete:true,detailsExpiresAt:new Date().toISOString(),detailsProvenance:'community-map',detailsLiveInventoryVerified:false};
 return Response.json({details:safeDetails,refreshStatus:cached?'cached':refreshed?'refreshed':id?'unavailable':'unmapped',provenance:'public-venue-data',liveInventoryVerified:false},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
