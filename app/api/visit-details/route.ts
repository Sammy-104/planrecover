import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {tripCatalog} from '@/lib/model';
import {mappedInfo} from '@/lib/mapped-place-info';
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access);
 if(query.get('tripId')!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');
 const itemId=query.get('itemId'),suggestionId=query.get('suggestionId'),place=itemId?state.items.find(i=>i.id===itemId):tripCatalog(state).find(c=>c.id===suggestionId);
 if(!place)throw Error('This place is no longer in the plan.');
 let id=suggestionId??'';if(!/^osm-(node|way|relation)-\d+$/.test(id)){try{const url=new URL(place.sourceUrl??place.locationSourceUrl??''),match=/^\/(node|way|relation)\/(\d+)\/?$/.exec(url.pathname);id=url.hostname==='www.openstreetmap.org'&&match?`osm-${match[1]}-${match[2]}`:'';}catch{id='';}}
 const details=place.detailsCheckedAt&&Date.now()-Date.parse(place.detailsCheckedAt)<86400000?{}:await mappedInfo(id);
 return Response.json({details},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
