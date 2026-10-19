import type {CityPlace} from './cities.ts';
import {placeDetails} from './place-details.ts';
import {boundedPlaceRequest} from './public-place-request.ts';
const recent=new Map<string,{at:number;checked:boolean;fields:Record<string,unknown>}>();

/** Only exact mapped entity/file links qualify; a nearby or similarly named photo is never substituted. */
export async function mappedPhotos(places:CityPlace[],request:typeof fetch=fetch,limit=36){
 const key=(p:CityPlace)=>JSON.stringify([p.wikidataId,p.commonsFile]);
 const cached=(p:CityPlace)=>{const value=recent.get(key(p));return value&&Date.now()-value.at<(value.checked?6*3600000:30000)?value:undefined;};
 places=places.map(p=>!p.imageUrl&&cached(p)?{...p,...cached(p)!.fields}:p);
 const targets=places.filter(p=>!p.imageUrl&&(p.commonsFile||p.wikidataId)&&!cached(p)).slice(0,limit);
 const cacheChecked=places.every(p=>cached(p)?.checked!==false);
 if(!targets.length)return {places,checked:cacheChecked};
 const pages=targets.map(p=>({title:p.id,pageimage:p.commonsFile,pageprops:{wikibase_item:p.wikidataId}}));
 const {details,checked}=await placeDetails(pages,boundedPlaceRequest(request,6000));
 const media=['imageUrl','imagePageUrl','imageCredit','imageLicense','imageLicenseUrl','photoStatus','popularityCoverage','popularitySourceUrl'] as const;
 return {checked:checked&&cacheChecked,places:places.map(place=>{const found=details.get(place.id);if(!found)return place;const fields:Record<string,unknown>={};for(const field of media)if(found[field]!==undefined)fields[field]=found[field];if(recent.size>=500)recent.delete(recent.keys().next().value!);recent.set(key(place),{at:Date.now(),checked,fields});return {...place,...fields};})};
}
