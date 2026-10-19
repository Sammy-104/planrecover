import {boundedPlaceRequest} from './public-place-request.ts';
import {osmPlaces} from './osm-places.ts';
import {placeQuery} from './place-query.ts';
import {PLACE_DETAILS_VERSION,type CityPlace} from './cities.ts';
import {searchCities,validCitySelection,type CitySelection} from './city-search.ts';
import {cleanActivityQuery} from './city-lookup.ts';
import {foldPlaceName,textCollectionTags} from './discovery.ts';
import {validPoint} from './itinerary-map.ts';
import {rankPlaces,searchRadius} from './place-match.ts';

export type PlaceSearch={places:CityPlace[];unavailable:boolean};
const pending=new Map<string,Promise<PlaceSearch>>(),recent=new Map<string,{at:number;result:PlaceSearch}>();
const provider='https://photon.komoot.io/api/';
function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const r=Math.PI/180,h=Math.sin((b.latitude-a.latitude)*r/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
function text(value:unknown){return typeof value==='string'?value.trim().slice(0,200):'';}
/** Only named destinations with a provider coordinate. Addresses and city centres are not activity pins. */
export function photonPlaces(body:any,city:CitySelection,radius=20):CityPlace[]{
 const places:CityPlace[]=[],seen=new Set<string>();
 for(const f of Array.isArray(body?.features)?body.features:[]){
  const p=f?.properties??{},coordinates=f?.geometry?.coordinates,name=text(p.name),key=text(p.osm_key),value=text(p.osm_value);
  const type=({N:'node',W:'way',R:'relation'} as Record<string,string>)[p.osm_type],point={latitude:coordinates?.[1],longitude:coordinates?.[0]};
  if(!name||!type||!Number.isSafeInteger(p.osm_id)||p.osm_id<1||f?.geometry?.type!=='Point'||!validPoint(point)||distance(city,point)>radius+.1)continue;
  // Broad enough for niche businesses; exclude unnamed addresses, streets and settlements.
  if(!['shop','tourism','leisure','historic','amenity','natural','railway','aeroway'].includes(key)||/^(school|university|hospital|police|prison|parking|parking_entrance|toilets|waste_basket|bench|post_box|drinking_water)$/.test(value))continue;
  if(key==='railway'&&!/^(station|halt)$/.test(value)||key==='aeroway'&&value!=='aerodrome'||key==='natural'&&!/^(beach|waterfall|peak|cave_entrance)$/.test(value))continue;
  const id=`osm-${type}-${p.osm_id}`;if(seen.has(id))continue;seen.add(id);
  const food=key==='amenity'&&/^(restaurant|cafe|fast_food|food_court|pub|bar|ice_cream|biergarten)$/.test(value),hotel=key==='tourism'&&/^(hotel|motel|hostel|guest_house|camp_site)$/.test(value),transport=key==='railway'||key==='aeroway';
  const category=food?'Meal':hotel?'Accommodation':transport?'Transport':key==='shop'?'Practical stop':'Activity';
  const label=value.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
  const area=[text(p.housenumber),text(p.street),text(p.city)||text(p.district)||city.name].filter(Boolean).join(' '),sourceUrl=`https://www.openstreetmap.org/${type}/${p.osm_id}`;
  const topic=food?'Food':key==='shop'?'Shopping':value==='museum'||value==='gallery'?'Museums':key==='natural'||/^(park|garden|nature_reserve)$/.test(value)?'Outdoors':key==='historic'||/^(attraction|viewpoint|artwork|place_of_worship)$/.test(value)?'Landmarks':'Entertainment';
  places.push({id,name,category,area,description:`${label} in ${text(p.city)||city.name}. Check the source for visit details.`,sourceUrl,sourceLabel:'OpenStreetMap · place search',tags:[topic,...textCollectionTags(`${name} ${label}`)],...point,locationVersion:PLACE_DETAILS_VERSION,placeDetailsVersion:PLACE_DETAILS_VERSION,locationSourceUrl:sourceUrl,...(type!=='node'?{locationPrecision:.002}:{}),photoStatus:'unavailable'});
 }
 return places;
}
export async function searchMappedPlaces(destination:string,selected:CitySelection|undefined,input:string,origin:string,request:typeof fetch=fetch,options:{radiusKm?:number;refresh?:boolean;origin?:{latitude:number;longitude:number}}={}):Promise<PlaceSearch>{
 request=boundedPlaceRequest(request,12000);
 const radius=searchRadius(options.radiusKm);
 const query=cleanActivityQuery(input);if(query.length<3)return {places:[],unavailable:false};
 let city=validCitySelection(selected,destination)??(await searchCities(destination)).find(c=>foldPlaceName(c.label)===foldPlaceName(destination)||foldPlaceName(c.name)===foldPlaceName(destination.split(',')[0]));
 if(!city)return {places:[],unavailable:true};
 if(options.origin&&validPoint(options.origin))city={...city,...options.origin};
 const intent=placeQuery(query,city.name),providerQuery=intent.descriptive?[intent.cuisine,intent.subject].filter(Boolean).join(' '):intent.subject;
 const cacheKey=new URL('/__public_place_search',origin);cacheKey.search=new URLSearchParams({v:'4',radius:String(radius),lat:String(city.latitude),lon:String(city.longitude),q:foldPlaceName(query)}).toString();
 const id=cacheKey.href,remembered=recent.get(id);if(!options.refresh&&remembered&&Date.now()-remembered.at<(remembered.result.unavailable?30000:3600000))return remembered.result;
 const cache=(globalThis as typeof globalThis&{caches?:CacheStorage&{default?:Cache}}).caches?.default;
 if(cache&&!options.refresh){try{const cached=await cache.match(id);if(cached)return await cached.json() as PlaceSearch;}catch{}}
 if(!pending.has(id))pending.set(id,(async()=>{
  let result:PlaceSearch;
  try{
   if(intent.descriptive){const semantic=await osmPlaces(city!.name,{lat:city!.latitude,lon:city!.longitude},query,request,radius);result={places:rankPlaces(semantic,query,city!.name,city,radius).slice(0,30),unavailable:false};}
   else {const url=new URL(provider);url.search=new URLSearchParams({q:providerQuery,lat:String(city.latitude),lon:String(city.longitude),lang:'en',limit:'50',location_bias_scale:'0.1'}).toString();
   const latitudeDelta=(radius+.1)/111.32,longitudeDelta=(radius+.1)/(111.32*Math.max(.02,Math.cos(city.latitude*Math.PI/180))),west=city.longitude-longitudeDelta,east=city.longitude+longitudeDelta;
   if(west>=-180&&east<=180)url.searchParams.set('bbox',[west,Math.max(-90,city.latitude-latitudeDelta),east,Math.min(90,city.latitude+latitudeDelta)].join(','));
   const response=await request(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (place search; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Place search unavailable.');const body=await response.json() as any;if(!Array.isArray(body?.features))throw Error('Invalid place results.');
   result={places:rankPlaces(photonPlaces(body,city!,radius),query,city!.name,city,radius).slice(0,30),unavailable:false};}
   if(cache){try{await cache.put(id,Response.json(result,{headers:{'Cache-Control':'public, max-age=3600'}}));}catch{}}
  }catch{result={places:[],unavailable:true};}
  if(recent.size>=250)recent.delete(recent.keys().next().value!);recent.set(id,{at:Date.now(),result});return result;
 })().finally(()=>pending.delete(id)));
 return pending.get(id)!;
}
