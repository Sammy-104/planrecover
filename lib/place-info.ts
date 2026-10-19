import {moneyScale} from './money.ts';
export const PLACE_INFO_FRESHNESS_MS=86400000;
export type PlaceInfo={cuisines?:string[];admission?:'free'|'paid';listedPrice?:string;address?:string;officialWebsite?:string;openingHours?:string;indoor?:boolean;stepFree?:boolean;detailsSourceUrl?:string;detailsCheckedAt?:string;
 detailsExpiresAt?:string;detailsSourceUpdatedAt?:string;detailsDataAsOf?:string;detailsProvenance?:'community-map'|'community-knowledge';detailsLiveInventoryVerified?:false;detailsSnapshotComplete?:true};
const mappedFields=['cuisines','admission','listedPrice','address','officialWebsite','openingHours','indoor','stepFree','detailsSourceUrl','detailsCheckedAt','detailsExpiresAt','detailsSourceUpdatedAt','detailsDataAsOf','detailsProvenance','detailsLiveInventoryVerified','detailsSnapshotComplete'] as const;
/** An exact refreshed snapshot also clears tags that the provider has since removed. */
export function mergePlaceInfo<T extends PlaceInfo>(place:T,details:PlaceInfo):T&PlaceInfo{
 const merged={...place};if(details.detailsSnapshotComplete)for(const key of mappedFields)delete merged[key];
 return Object.assign(merged,details);
}
/** Retrieval freshness is separate from the age and accuracy of the community's venue facts. */
export function freshPlaceInfo(place:PlaceInfo,now=Date.now()){
 if(!['community-map','community-knowledge'].includes(place.detailsProvenance??'')||place.detailsSnapshotComplete!==true)return false;
 const checked=Date.parse(place.detailsCheckedAt??''),expiry=place.detailsExpiresAt?Date.parse(place.detailsExpiresAt):checked+PLACE_INFO_FRESHNESS_MS;
 const dataAsOf=place.detailsDataAsOf?Date.parse(place.detailsDataAsOf):checked;
 return Number.isFinite(checked)&&Number.isFinite(expiry)&&Number.isFinite(dataAsOf)&&checked<=now+300000&&dataAsOf<=now+300000
  &&now-checked<PLACE_INFO_FRESHNESS_MS&&now-dataAsOf<PLACE_INFO_FRESHNESS_MS&&expiry>checked&&expiry>now;
}
export function websiteUrl(value:unknown){try{const url=new URL(String(value));return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;}}
export function placeDetailsSourceLabel(place:PlaceInfo){
 try{const host=new URL(place.detailsSourceUrl??'').hostname;if(['wikidata.org','www.wikidata.org'].includes(host))return 'Wikidata community source';if(['openstreetmap.org','www.openstreetmap.org'].includes(host))return 'OpenStreetMap community source';}catch{}
 return 'Public venue source';
}
const text=(value:unknown,max=300)=>typeof value==='string'?value.trim().slice(0,max)||undefined:undefined;
export function mappedPlaceInfo(tags:Record<string,string>,sourceUrl:string,now=Date.now()):PlaceInfo&{wikidataId?:string;commonsFile?:string}{
 const street=[tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' '),address=[street,tags['addr:unit']?`Unit ${tags['addr:unit']}`:undefined,tags['addr:city']||tags['addr:suburb'],tags['addr:postcode']].filter(Boolean).join(', ');
 const indoor=tags.indoor==='yes'?true:tags.indoor==='no'?false:undefined;
 return {wikidataId:/^Q\d+$/.test(tags.wikidata??'')?tags.wikidata:undefined,commonsFile:typeof tags.wikimedia_commons==='string'&&/^File:.+\.(?:jpe?g|png|webp)$/i.test(tags.wikimedia_commons)?tags.wikimedia_commons.slice(5):undefined,cuisines:typeof tags.cuisine==='string'?tags.cuisine.split(';').map(v=>v.trim().replaceAll('_',' ')).filter(Boolean).slice(0,12):undefined,admission:tags.fee==='no'?'free':tags.fee==='yes'?'paid':undefined,listedPrice:text(tags.charge,120),address:text(address),officialWebsite:websiteUrl(tags.website||tags['contact:website']),openingHours:text(tags.opening_hours),indoor,stepFree:tags.wheelchair==='yes'?true:tags.wheelchair==='no'?false:undefined,detailsSourceUrl:sourceUrl,detailsCheckedAt:new Date(now).toISOString(),detailsExpiresAt:new Date(now+PLACE_INFO_FRESHNESS_MS).toISOString(),detailsProvenance:'community-map',detailsLiveInventoryVerified:false,detailsSnapshotComplete:true};
}
export function placeInfo(place:PlaceInfo):PlaceInfo{return {cuisines:place.cuisines,admission:place.admission,listedPrice:place.listedPrice,address:place.address,officialWebsite:websiteUrl(place.officialWebsite),openingHours:place.openingHours,indoor:place.indoor,stepFree:place.stepFree,detailsSourceUrl:websiteUrl(place.detailsSourceUrl),detailsCheckedAt:place.detailsCheckedAt,detailsExpiresAt:place.detailsExpiresAt,detailsSourceUpdatedAt:place.detailsSourceUpdatedAt,detailsDataAsOf:place.detailsDataAsOf,detailsProvenance:place.detailsProvenance==='community-map'||place.detailsProvenance==='community-knowledge'?place.detailsProvenance:undefined,detailsLiveInventoryVerified:place.detailsLiveInventoryVerified===false?false:undefined,detailsSnapshotComplete:place.detailsSnapshotComplete===true?true:undefined};}
export function indoorPlace(place:PlaceInfo&{tags?:string[]}){return place.indoor??(!!place.tags?.includes('Indoor')||!!place.tags?.includes('Museums')&&!place.tags?.includes('Outdoors'));}
export function matchesIdeaFilter(place:PlaceInfo&{price:number|null;category:string;duration:number;tags?:string[]},filter:string,people:number,currency='CAD'){
 if(filter==='Under 20 each'||filter==='Under CAD 20 each')return people>0&&place.price!==null&&Math.ceil(place.price/people)<=20*moneyScale(currency);
 if(filter==='Indoor alternative')return indoorPlace(place);
 if(filter==='What are we missing?')return place.category==='Preparation';
 if(filter==='Fill this free hour')return place.duration<=60;
 if(['Culture','Outdoors','Food'].includes(filter))return !!place.tags?.includes(filter);
 return true;
}
