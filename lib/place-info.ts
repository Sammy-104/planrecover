import {moneyScale} from './money.ts';
export type PlaceInfo={cuisines?:string[];admission?:'free'|'paid';listedPrice?:string;address?:string;officialWebsite?:string;openingHours?:string;indoor?:boolean;stepFree?:boolean;detailsSourceUrl?:string;detailsCheckedAt?:string};
export function websiteUrl(value:unknown){try{const url=new URL(String(value));return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;}}
const text=(value:unknown,max=300)=>typeof value==='string'?value.trim().slice(0,max)||undefined:undefined;
export function mappedPlaceInfo(tags:Record<string,string>,sourceUrl:string):PlaceInfo&{wikidataId?:string;commonsFile?:string}{
 const street=[tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' '),address=[street,tags['addr:unit']?`Unit ${tags['addr:unit']}`:undefined,tags['addr:city']||tags['addr:suburb'],tags['addr:postcode']].filter(Boolean).join(', ');
 const indoor=tags.indoor==='yes'?true:tags.indoor==='no'?false:undefined;
 return {wikidataId:/^Q\d+$/.test(tags.wikidata??'')?tags.wikidata:undefined,commonsFile:typeof tags.wikimedia_commons==='string'&&/^File:.+\.(?:jpe?g|png|webp)$/i.test(tags.wikimedia_commons)?tags.wikimedia_commons.slice(5):undefined,cuisines:typeof tags.cuisine==='string'?tags.cuisine.split(';').map(v=>v.trim().replaceAll('_',' ')).filter(Boolean).slice(0,12):undefined,admission:tags.fee==='no'?'free':tags.fee==='yes'?'paid':undefined,listedPrice:text(tags.charge,120),address:text(address),officialWebsite:websiteUrl(tags.website||tags['contact:website']),openingHours:text(tags.opening_hours),indoor,stepFree:tags.wheelchair==='yes'?true:tags.wheelchair==='no'?false:undefined,detailsSourceUrl:sourceUrl,detailsCheckedAt:new Date().toISOString()};
}
export function placeInfo(place:PlaceInfo):PlaceInfo{return {cuisines:place.cuisines,admission:place.admission,listedPrice:place.listedPrice,address:place.address,officialWebsite:websiteUrl(place.officialWebsite),openingHours:place.openingHours,indoor:place.indoor,stepFree:place.stepFree,detailsSourceUrl:websiteUrl(place.detailsSourceUrl),detailsCheckedAt:place.detailsCheckedAt};}
export function indoorPlace(place:PlaceInfo&{tags?:string[]}){return place.indoor??(!!place.tags?.includes('Indoor')||!!place.tags?.includes('Museums')&&!place.tags?.includes('Outdoors'));}
export function matchesIdeaFilter(place:PlaceInfo&{price:number|null;category:string;duration:number;tags?:string[]},filter:string,people:number,currency='CAD'){
 if(filter==='Under 20 each'||filter==='Under CAD 20 each')return people>0&&place.price!==null&&Math.ceil(place.price/people)<=20*moneyScale(currency);
 if(filter==='Indoor alternative')return indoorPlace(place);
 if(filter==='What are we missing?')return place.category==='Preparation';
 if(filter==='Fill this free hour')return place.duration<=60;
 if(['Culture','Outdoors','Food'].includes(filter))return !!place.tags?.includes(filter);
 return true;
}
