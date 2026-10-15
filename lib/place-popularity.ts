import {placeDistance,placeMatchScore} from './place-match.ts';

/** Public recognition is a popularity proxy, not a visitor count or review rating. */
export type PlacePopularity={popularityCoverage?:number;popularitySourceUrl?:string};
export type DiscoverySort='popular'|'nearest'|'relevance';
export function entityPopularity(entity:any):PlacePopularity{
 if(!entity||!/^Q\d+$/.test(entity.id??'')||!entity.sitelinks||typeof entity.sitelinks!=='object')return {};
 const coverage=Object.values(entity.sitelinks).filter((link:any)=>typeof link?.url==='string'&&/^https:\/\/[a-z0-9-]+\.wikipedia\.org\/wiki\//i.test(link.url)).length;
 return {popularityCoverage:coverage,popularitySourceUrl:`https://www.wikidata.org/wiki/${entity.id}`};
}
export function popularityScore(place:PlacePopularity){return Number.isSafeInteger(place.popularityCoverage)&&place.popularityCoverage!>=0?place.popularityCoverage:undefined;}
/** Fill recognition for mapped places without an English article; failure never blocks discovery. */
export async function mappedPopularity<T extends PlacePopularity&{wikidataId?:string}>(places:T[],request:typeof fetch){
 const ids=[...new Set(places.filter(place=>popularityScore(place)===undefined&&/^Q\d+$/.test(place.wikidataId??'')).map(place=>place.wikidataId!))].slice(0,200);
 const found=new Map<string,PlacePopularity>();
 await Promise.all(Array.from({length:Math.ceil(ids.length/50)},async(_,batch)=>{
  try{
   const url=new URL('https://www.wikidata.org/w/api.php');url.search=new URLSearchParams({action:'wbgetentities',format:'json',ids:ids.slice(batch*50,batch*50+50).join('|'),props:'sitelinks/urls'}).toString();
   const response=await request(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (place recognition; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(8000)});
   if(!response.ok)return;const data=await response.json() as any;
   for(const [id,entity]of Object.entries(data.entities??{}))found.set(id,entityPopularity({...entity as any,id}));
  }catch{ /* Optional public metadata: leave unknown places available. */ }
 }));
 return places.map(place=>popularityScore(place)===undefined&&place.wikidataId?{...place,...found.get(place.wikidataId)}:place);
}
export function sortDiscovery<T extends PlacePopularity&{id:string;name:string;latitude?:number;longitude?:number}>(places:T[],sort:DiscoverySort,point?:{latitude?:number;longitude?:number},query='',city=''){
 const rows=places.map((place,index)=>({place,index,popularity:popularityScore(place),distance:point?placeDistance(point,place):undefined,match:sort==='relevance'?placeMatchScore(place.name,query,city):undefined}));
 rows.sort((a,b)=>{
  if(sort==='popular'){
   if(a.popularity===undefined&&b.popularity!==undefined)return 1;
   if(b.popularity===undefined&&a.popularity!==undefined)return -1;
   if(a.popularity!==undefined&&b.popularity!==undefined&&a.popularity!==b.popularity)return b.popularity-a.popularity;
  }
  if(sort==='relevance'){const match=(a.match??Infinity)-(b.match??Infinity);if(match)return match;}
  if(sort==='nearest'||sort==='relevance'){const distance=(a.distance??Infinity)-(b.distance??Infinity);if(distance)return distance;}
  return a.index-b.index;
 });
 return rows.map(row=>row.place);
}
