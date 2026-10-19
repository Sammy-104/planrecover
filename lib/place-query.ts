import {activityWords,discoveryCollection,discoveryTopic,foldPlaceName,matchesDiscoverySearch,type DiscoveryTopic} from './discovery.ts';

const cuisines=['Korean','Japanese','Chinese','Indian','Thai','Vietnamese','Italian','Mexican','Greek','French','Lebanese','Turkish','Ethiopian','Caribbean'] as const;
export type PlaceQuery={input:string;subject:string;topic?:DiscoveryTopic;cuisine?:string;free:boolean;budget:boolean;nearHotel:boolean;descriptive:boolean};
/** Interpret supported requests without inventing prices, reviews, or cuisine tags. */
export function placeQuery(input:string,city=''):PlaceQuery{
 const normalized=foldPlaceName(input),nearHotel=/\b(?:near|around|close to|by) (?:my |our |the )?(?:hotel|accommodation)\b/.test(normalized);
 const free=/\b(?:free|no entry fee|no admission fee)\b/.test(normalized),budget=/\b(?:cheap|affordable|budget|inexpensive)\b/.test(normalized);
 const stripped=normalized.replace(/\b(?:near|around|close to|by) (?:my |our |the )?(?:hotel|accommodation)\b/g,' ').replace(/\b(?:free|no entry fee|no admission fee|cheap|affordable|budget|inexpensive)\b/g,' ').replace(/\s+/g,' ').trim();
 const cuisine=cuisines.find(name=>new RegExp('\\b'+name.toLowerCase()+'\\b').test(stripped));
 const remaining=cuisine?stripped.replace(new RegExp('\\b'+cuisine.toLowerCase()+'\\b','g'),'').trim():stripped;
 const collection=discoveryCollection(stripped,city),direct=discoveryTopic(stripped,city);
 const foodWords=/^(?:food|restaurants?|places to eat|dining|cuisine|meals?|eat|eating)$/;
 const cuisineRequest=!!cuisine&&(!remaining||foodWords.test(activityWords(remaining,city).join(' ')));
 const generic=activityWords(stripped,city).length===0||/^(?:activities|things to do|attractions|places|places to visit)?$/.test(stripped);
 const descriptive=!!collection||!!direct||cuisineRequest||generic;
 const topic=cuisineRequest?'Food':direct;
 return {input,subject:descriptive?(collection?.label??(cuisineRequest?'restaurants':generic?'':stripped)):normalized.replace(/\b(?:near|around|close to|by) (?:my |our |the )?(?:hotel|accommodation)\b/g,' ').trim()||input.trim(),topic,cuisine:cuisineRequest?cuisine:undefined,free:free&&descriptive,budget:budget&&descriptive,nearHotel,descriptive};
}
export function matchesPlaceQuery(place:{name:string;description?:string;reason?:string;tags?:readonly string[];cuisines?:string[];admission?:string;price?:number|null},query:PlaceQuery,city=''){
 if(query.free&&query.topic==='Food'&&place.price!==0)return false;
 if(query.free&&!query.topic&&place.tags?.includes('Food'))return false;
 if(query.free&&place.admission!=='free'&&place.price!==0)return false;
 if(query.cuisine){const cuisine=query.cuisine.toLowerCase();if(!place.cuisines?.some(value=>foldPlaceName(value)===cuisine)&&!new RegExp('\\b'+cuisine+'\\b').test(foldPlaceName(place.name)))return false;}
 if(query.topic){const data={name:place.name,description:place.description??place.reason??'',tags:place.tags??[]};if(!matchesDiscoverySearch(data,query.subject,city))return false;}
 return true;
}
export function placeQueryNote(query:PlaceQuery){
 if(query.budget)return 'Matching places are shown. Prices need checking; these results are not verified as cheap.';
 if(query.free)return 'The source lists no entry fee. Optional purchases, transport and special events may cost extra.';
 return '';
}
