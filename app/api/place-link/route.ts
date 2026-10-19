import {frontendJson} from '@/lib/frontend-request';
import {workspaceAccess,loadAccess,requireEdit,saveAccess,checkOrigin,apiError,publicState} from '@/lib/store';
import {discoveryContext,cityRecommendations,setCityRecommendations} from '@/lib/city-stays';
import {expandPlaceLink} from '@/lib/place-link';
import {osmPlaceById} from '@/lib/public-osm-place';
import {searchMappedPlaces} from '@/lib/place-search';
import {cityKey,type CityPlace} from '@/lib/cities';
import {placeDistance,rankPlaces} from '@/lib/place-match';
import {mappedPhotos} from '@/lib/place-photos';
export async function POST(request:Request){try{checkOrigin(request);const access=await workspaceAccess(request),body=await frontendJson(request) as {tripId:string;day:string;stayId?:string;destination:string;url:string;query?:string;selectId?:string},state=await loadAccess(access);if(body.tripId!==state.plan.id||typeof body.url!=='string')throw Error('Choose this plan and paste a place link.');const context=discoveryContext(state,body),hint=await expandPlaceLink(body.url),query=(body.query??hint.query).trim();if(query.length>100)throw Error('Use a shorter venue name.');let places:CityPlace[]=[],unavailable=false;
 if(hint.osmId){try{const exact=await osmPlaceById(hint.osmId);if(exact&&context.city&&(placeDistance(context.city,exact)??Infinity)<=100)places=[exact];}catch{unavailable=true;}}
 if(!places.length&&query.length>=3){const local=cityRecommendations(state,context.destination)?.entries??[],remote=await searchMappedPlaces(context.destination,context.city,query,new URL(request.url).origin);places=rankPlaces([...local,...remote.places],query,context.city?.name??context.destination,context.city,50).slice(0,12);unavailable=remote.unavailable;}
 if(!body.selectId)return Response.json({hint,query,places,unavailable},{headers:{'Cache-Control':'private, no-store'}});requireEdit(access,state);const selected=places.find(p=>p.id===body.selectId);if(!selected)throw Error('Choose one of the matching place results.');const chosen=(await mappedPhotos([selected])).places[0];
 for(let attempt=0;attempt<3;attempt++){const latest=await loadAccess(access),c=discoveryContext(latest,body);if(latest.plan.id!==body.tripId||cityKey(c.destination)!==cityKey(context.destination))throw Error('The selected city changed. Search again.');const previous=cityRecommendations(latest,c.destination),entries=[...(previous?.entries??[]).filter(p=>p.id!==chosen.id),chosen];try{const next=await saveAccess(access,setCityRecommendations(latest,{...previous,destinationKey:cityKey(c.destination),resolvedCity:c.city?.name??c.destination,fetchedAt:new Date().toISOString(),source:'open-places',entries}),latest.version);return Response.json({state:publicState(next,access),selectedId:chosen.id});}catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}}
 throw Error('Another edit was saved. Refresh and try again.');}catch(e){return apiError(e);}}
