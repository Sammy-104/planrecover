import {lookupCity,cleanActivityQuery,type CityLookup} from './city-lookup.ts';
import {cityKey} from './cities.ts';
import {DISCOVERY_VERSION} from './discovery.ts';
import type {CitySelection} from './city-search.ts';
const pending=new Map<string,Promise<CityLookup>>();
/** Shared cache contains public place metadata only, never trips or account data. */
export async function cityCatalog(destination:string,city:CitySelection|undefined,query:string,refresh:boolean,origin:string,request:typeof fetch=fetch,radiusKm=20){
 const key=new URL('/__public_city_catalog',origin);key.search=new URLSearchParams({radius:String(radiusKm),v:String(DISCOVERY_VERSION),city:cityKey(destination),point:city?`${city.latitude},${city.longitude}`:'',q:cleanActivityQuery(query).toLowerCase()}).toString();
 const cache=(globalThis as typeof globalThis&{caches?:CacheStorage&{default?:Cache}}).caches?.default;
 if(!refresh&&cache){try{const cached=await cache.match(key.href);if(cached){const value=await cached.json() as CityLookup;if(value.discoveryVersion===DISCOVERY_VERSION)return value;}}catch{}}
 const id=key.href+(refresh?'|refresh':'');
 if(!pending.has(id))pending.set(id,(async()=>{
  const result=await lookupCity(destination,request,city,query,radiusKm);
  if(cache&&!result.sourcesUnavailable&&result.photosChecked){try{await cache.put(key.href,Response.json(result,{headers:{'Cache-Control':'public, max-age=21600'}}));}catch{}}
  return result;
 })().finally(()=>pending.delete(id)));
 return pending.get(id)!;
}
