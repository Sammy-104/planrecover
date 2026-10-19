import {placeQuery,matchesPlaceQuery} from './place-query.ts';
import {PLACE_DETAILS_VERSION,type CityPlace} from './cities.ts';
import {CITY_CATALOG_LIMIT,activityWords,discoveryCollections,discoveryCollection,discoveryTopic,discoveryTopics,foldPlaceName,matchesPlaceName,type DiscoveryTopic} from './discovery.ts';
import {validPoint} from './itinerary-map.ts';
import {searchRadius} from './place-match.ts';
import {mappedPlaceInfo} from './place-info.ts';
// Both global instances permit use in projects; only city/type/name queries are sent.
const endpoints=['https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const selectors:Record<DiscoveryTopic,string[]>={
 Landmarks:['["tourism"~"^(attraction|viewpoint|artwork)$"]','["historic"~"^(castle|monument|memorial|ruins|archaeological_site|fort|manor|palace|city_gate|citywalls|tomb|building|aqueduct)$"]','["amenity"="place_of_worship"]'],
 Museums:['["tourism"~"^(museum|gallery)$"]'],
 Outdoors:['["leisure"~"^(park|garden|nature_reserve|playground|bird_hide|dog_park|swimming_area|bathing_place)$"]','["natural"~"^(beach|waterfall|peak|cave_entrance)$"]','["tourism"="picnic_site"]','["boundary"="national_park"]'],
 Food:['["amenity"~"^(restaurant|cafe|food_court|pub|bar|ice_cream|fast_food|biergarten)$"]'],
 Shopping:['["shop"~"^(mall|department_store|books|gift|craft|art|games|video_games|music|musical_instrument|antiques|second_hand|clothes|jewelry|toys|outdoor|sports|tea|coffee|chocolate|pastry|bakery|confectionery)$"]','["amenity"="marketplace"]'],
 Entertainment:['["tourism"~"^(zoo|aquarium|theme_park)$"]','["amenity"~"^(cinema|theatre|arts_centre|nightclub|music_venue|planetarium|public_bath)$"]','["leisure"~"^(bowling_alley|water_park|escape_game|trampoline_park|dance|amusement_arcade|sports_centre|sports_hall|stadium|fitness_centre|horse_riding|sauna)$"]','["shop"="massage"]']
};
type Tags=Record<string,string>;
const nicheRules:Record<typeof discoveryCollections[number]['id'],{selectors:string[];matches:(tags:Tags)=>boolean}>={
 cafes:{selectors:['["amenity"="cafe"]'],matches:t=>t.amenity==='cafe'},
 sweets:{selectors:['["shop"~"^(bakery|pastry|chocolate|confectionery)$"]','["amenity"="ice_cream"]'],matches:t=>/^(bakery|pastry|chocolate|confectionery)$/.test(t.shop??'')||t.amenity==='ice_cream'},
 markets:{selectors:['["amenity"="marketplace"]'],matches:t=>t.amenity==='marketplace'},
 escape:{selectors:['["leisure"="escape_game"]'],matches:t=>t.leisure==='escape_game'},
 arcades:{selectors:['["leisure"="amusement_arcade"]','["shop"~"^(games|video_games)$"]'],matches:t=>t.leisure==='amusement_arcade'||/^(games|video_games)$/.test(t.shop??'')},
 climbing:{selectors:['["leisure"~"^(sports_centre|sports_hall|pitch)$"]["sport"~"(^|;)(climbing|climbing_adventure)(;|$)"]'],matches:t=>/^(sports_centre|sports_hall|pitch)$/.test(t.leisure??'')&&/(^|;)(climbing|climbing_adventure)(;|$)/.test(t.sport??'')},
 bowling:{selectors:['["leisure"="bowling_alley"]'],matches:t=>t.leisure==='bowling_alley'},
 golf:{selectors:['["leisure"~"^(miniature_golf|disc_golf_course)$"]'],matches:t=>/^(miniature_golf|disc_golf_course)$/.test(t.leisure??'')},
 skating:{selectors:['["leisure"="ice_rink"]','["leisure"="pitch"]["sport"~"(^|;)(skateboard|roller_skating|ice_skating)(;|$)"]'],matches:t=>t.leisure==='ice_rink'||t.leisure==='pitch'&&/(^|;)(skateboard|roller_skating|ice_skating)(;|$)/.test(t.sport??'')},
 performance:{selectors:['["amenity"~"^(music_venue|theatre)$"]'],matches:t=>/^(music_venue|theatre)$/.test(t.amenity??'')},
 vintage:{selectors:['["shop"~"^(antiques|second_hand)$"]','["shop"]["second_hand"="only"]'],matches:t=>/^(antiques|second_hand)$/.test(t.shop??'')||!!t.shop&&t.second_hand==='only'},
 books:{selectors:['["shop"~"^(books|comics|anime)$"]'],matches:t=>/^(books|comics|anime)$/.test(t.shop??'')},
 records:{selectors:['["shop"~"^(music|musical_instrument)$"]'],matches:t=>/^(music|musical_instrument)$/.test(t.shop??'')},
 arts:{selectors:['["tourism"="gallery"]','["shop"~"^(art|craft)$"]'],matches:t=>t.tourism==='gallery'||/^(art|craft)$/.test(t.shop??'')},
 gardens:{selectors:['["leisure"="garden"]'],matches:t=>t.leisure==='garden'},
 viewpoints:{selectors:['["tourism"="viewpoint"]'],matches:t=>t.tourism==='viewpoint'},
 streetart:{selectors:['["tourism"="artwork"]'],matches:t=>t.tourism==='artwork'},
 swimming:{selectors:['["natural"="beach"]','["leisure"~"^(swimming_pool|swimming_area|bathing_place)$"]'],matches:t=>t.natural==='beach'||/^(swimming_pool|swimming_area|bathing_place)$/.test(t.leisure??'')},
 historic:{selectors:['["historic"~"^(monument|memorial|ruins|archaeological_site|city_gate|citywalls|tomb|building|aqueduct)$"]'],matches:t=>/^(monument|memorial|ruins|archaeological_site|city_gate|citywalls|tomb|building|aqueduct)$/.test(t.historic??'')},
 castles:{selectors:['["historic"~"^(castle|palace|fort|manor)$"]'],matches:t=>/^(castle|palace|fort|manor)$/.test(t.historic??'')},
 worship:{selectors:['["amenity"="place_of_worship"]'],matches:t=>t.amenity==='place_of_worship'},
 nature:{selectors:['["leisure"="nature_reserve"]','["boundary"="national_park"]'],matches:t=>t.leisure==='nature_reserve'||t.boundary==='national_park'},
 waterfalls:{selectors:['["natural"="waterfall"]'],matches:t=>t.natural==='waterfall'},
 caves:{selectors:['["natural"~"^(peak|cave_entrance)$"]'],matches:t=>/^(peak|cave_entrance)$/.test(t.natural??'')},
 family:{selectors:['["leisure"="playground"]'],matches:t=>t.leisure==='playground'},
 animals:{selectors:['["tourism"~"^(zoo|aquarium)$"]'],matches:t=>/^(zoo|aquarium)$/.test(t.tourism??'')},
 themeparks:{selectors:['["tourism"="theme_park"]','["leisure"="water_park"]'],matches:t=>t.tourism==='theme_park'||t.leisure==='water_park'},
 cinemas:{selectors:['["amenity"="cinema"]'],matches:t=>t.amenity==='cinema'},
 wellness:{selectors:['["leisure"="sauna"]','["amenity"="public_bath"]','["shop"="massage"]'],matches:t=>t.leisure==='sauna'||t.amenity==='public_bath'||t.shop==='massage'},
 sports:{selectors:['["leisure"~"^(sports_centre|sports_hall|stadium|fitness_centre|horse_riding)$"]'],matches:t=>/^(sports_centre|sports_hall|stadium|fitness_centre|horse_riding)$/.test(t.leisure??'')}
};
function km(a:{lat:number;lon:number},b:{lat:number;lon:number}){const r=Math.PI/180,h=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
function topics(tags:Record<string,string>):DiscoveryTopic[]{
 const result:DiscoveryTopic[]=[];
 if(/^(museum|gallery)$/.test(tags.tourism??''))result.push('Museums');
 if(/^(park|garden|nature_reserve|playground|bird_hide|dog_park|swimming_area|bathing_place)$/.test(tags.leisure??'')||/^(beach|waterfall|peak|cave_entrance)$/.test(tags.natural??'')||tags.tourism==='picnic_site'||tags.boundary==='national_park')result.push('Outdoors');
 if(/^(restaurant|cafe|food_court|pub|bar|ice_cream|fast_food|biergarten)$/.test(tags.amenity??''))result.push('Food');
 if(tags.shop||tags.amenity==='marketplace')result.push('Shopping');
 if(/^(zoo|aquarium|theme_park)$/.test(tags.tourism??'')||/^(cinema|theatre|arts_centre|nightclub|music_venue|planetarium|public_bath)$/.test(tags.amenity??'')||/^(bowling_alley|water_park|escape_game|trampoline_park|dance|amusement_arcade|sports_centre|sports_hall|stadium|fitness_centre|horse_riding|sauna)$/.test(tags.leisure??''))result.push('Entertainment');
 if(/^(attraction|viewpoint|artwork)$/.test(tags.tourism??'')||tags.historic||tags.amenity==='place_of_worship')result.push('Landmarks');
 return [...new Set([...result,...discoveryCollections.filter(c=>nicheRules[c.id].matches(tags)).map(c=>c.topic)])];
}
const labels:Record<string,string>={place_of_worship:'Temple or place of worship',arts_centre:'Arts centre',nature_reserve:'Nature reserve',archaeological_site:'Archaeological site',food_court:'Food court',theme_park:'Theme park',bowling_alley:'Bowling alley',water_park:'Water park',escape_game:'Escape room',department_store:'Department store',ice_cream:'Ice cream shop',amusement_arcade:'Arcade',games:'Board game shop',music:'Record and music shop',craft:'Arts and crafts supply shop',art:'Art shop',comics:'Comic shop',miniature_golf:'Mini golf',disc_golf_course:'Disc golf course',ice_rink:'Ice rink',music_venue:'Music venue',second_hand:'Second-hand shop',antiques:'Antique shop',swimming_pool:'Swimming pool'};
export function osmQuery(point:{lat:number;lon:number},search='',city='',radiusKm=20){
 const radius=searchRadius(radiusKm);
 if(!validPoint({latitude:point.lat,longitude:point.lon}))throw Error('Invalid city location.');
 const intent=placeQuery(search,city),collection=discoveryCollection(intent.subject,city),topic=intent.topic??discoveryTopic(intent.subject,city),words=intent.descriptive?[]:activityWords(intent.subject,city).slice(0,6);
 // Quote and escape regex characters; user input never becomes an Overpass operator.
 const cuisine=intent.cuisine?'[\"cuisine\"~'+JSON.stringify('(^|;)'+intent.cuisine.toLowerCase()+'(;|$)')+',i]':'';
 const fee=intent.free?'[\"fee\"=\"no\"]':'';
 const named=words.map(word=>`[~"^(name(:[a-zA-Z_-]+)?|alt_name(:[a-zA-Z_-]+)?|official_name|short_name)$"~${JSON.stringify(word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))},i]`).join('');
 const groups=collection?[{selectors:nicheRules[collection.id].selectors,limit:500}]:[
  ...(topic?[topic]:discoveryTopics).map(key=>({selectors:selectors[key],limit:topic||words.length?500:250})),
  ...discoveryCollections.filter(c=>!topic||c.topic===topic).map(c=>({selectors:nicheRules[c.id].selectors,limit:topic||words.length?200:90}))
 ];
 // Separate venue types AND geometry types: a large node list must not hide museums mapped as buildings.
 return '[out:json][timeout:18][maxsize:67108864];'+groups.map(group=>`(${group.selectors.map(selector=>`nwr(around:${radius*1000},${point.lat},${point.lon})["name"]["access"!~"^(private|no)$"]${selector}${named}${cuisine}${fee};`).join('')})->.venues;node.venues;out center body ${group.limit};way.venues;out center body ${group.limit};relation.venues;out center body ${Math.min(group.limit,100)};`).join('');
}
/** Named visitor destinations only; coordinates come from the mapped venue, never the city. */
export async function osmPlaces(city:string,point:{lat:number;lon:number},search:string,request:typeof fetch,radiusKm=20):Promise<CityPlace[]>{
 const radius=searchRadius(radiusKm),query=osmQuery(point,search,city,radius);let body:any;
 for(const endpoint of endpoints){
  try{const response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'PlanRecoverBeta/1.0 (city activities; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(22000)});
   if(!response.ok)throw Error('Local place search is temporarily unavailable.');
   const data=await response.json() as any;if(data.remark||!Array.isArray(data.elements))throw Error('Local place search could not complete.');body=data;break;
  }catch{ /* Try one alternate global instance; Wikipedia and saved places remain independent. */ }
 }
 if(!body)throw Error('Local place search is temporarily unavailable.');
 const intent=placeQuery(search,city),places:CityPlace[]=[],seen=new Set<string>(),collection=discoveryCollection(intent.subject,city),topic=intent.topic??discoveryTopic(intent.subject,city),words=activityWords(intent.subject,city);
 for(const element of body.elements??[]){
  const t=element.tags??{},name=t['name:en']||t.name,location={lat:element.lat??element.center?.lat,lon:element.lon??element.center?.lon},kind=topics(t);
  if(typeof name!=='string'||name.length>200||!kind.length||!['node','way','relation'].includes(element.type)||!Number.isSafeInteger(element.id)||!validPoint({latitude:location.lat,longitude:location.lon})||km(point,location)>radius+.1||t.access==='private'||t.access==='no'||t.disused==='yes'||t.abandoned==='yes')continue;
  if(topic&&!kind.includes(topic))continue;
  if(collection&&!nicheRules[collection.id].matches(t))continue;
  if(search&&!intent.descriptive&&![name,...Object.entries(t).filter(([key])=>/^(name(:[a-zA-Z_-]+)?|alt_name(:[a-zA-Z_-]+)?|official_name|short_name)$/.test(key)).flatMap(([,value])=>String(value).split(';'))].some(value=>matchesPlaceName(value,words)))continue;
  if(!matchesPlaceQuery({name,tags:kind,...mappedPlaceInfo(t,'')},{...intent,topic:undefined},city))continue;
  const id=`osm-${element.type}-${element.id}`;if(seen.has(id))continue;seen.add(id);
  const value=t.tourism||t.historic||t.leisure||t.amenity||t.natural||t.shop,label=nicheRules.climbing.matches(t)?'Climbing venue':t.leisure==='pitch'&&nicheRules.skating.matches(t)?'Skating venue':labels[value]??String(value).replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
  const address=[t['addr:housenumber'],t['addr:street'],t['addr:suburb']].filter(v=>typeof v==='string').join(' '),sourceUrl=`https://www.openstreetmap.org/${element.type}/${element.id}`;
  const wiki=typeof t.wikipedia==='string'&&t.wikipedia.startsWith('en:')?t.wikipedia.slice(3):undefined;
  places.push({id,name,category:kind.includes('Food')?'Meal':kind.includes('Shopping')?'Practical stop':'Activity',area:address||`In and around ${city} · ${km(point,location).toFixed(1)} km from centre`,description:`${label}${t.cuisine?` · ${String(t.cuisine).replaceAll(';',', ')}`:''}${address?` at ${address}`:''}. Check the source for visit details.`,sourceUrl,sourceLabel:'OpenStreetMap · mapped place',tags:[...kind,...discoveryCollections.filter(c=>nicheRules[c.id].matches(t)).map(c=>c.label),...(kind.includes('Museums')||kind.includes('Landmarks')?['Culture']:[])],latitude:location.lat,longitude:location.lon,locationVersion:PLACE_DETAILS_VERSION,placeDetailsVersion:PLACE_DETAILS_VERSION,locationSourceUrl:sourceUrl,...mappedPlaceInfo(t,sourceUrl),...(element.type!=='node'?{locationPrecision:.002}:{}),...(wiki?{wikiTitle:wiki}:{}),...(/^Q\d+$/.test(t.wikidata??'')?{wikidataId:t.wikidata}:{}),commonsFile:typeof t.wikimedia_commons==='string'&&/^File:.+\.(?:jpe?g|png|webp)$/i.test(t.wikimedia_commons)?t.wikimedia_commons.slice(5):undefined,photoStatus:'unavailable'});
 }
 return places;
}
export function mergePlaces(groups:CityPlace[][],limit=CITY_CATALOG_LIMIT){
 const result:CityPlace[]=[],byEntity=new Map<string,CityPlace>(),byTitle=new Map<string,CityPlace>(),byName=new Map<string,CityPlace[]>();
 for(const place of groups.flat()){
  const name=foldPlaceName(place.name);
  const existing=(place.wikidataId?byEntity.get(place.wikidataId):undefined)??(place.wikiTitle?byTitle.get(place.wikiTitle):undefined)??byName.get(name)?.find(p=>typeof p.latitude==='number'&&typeof p.longitude==='number'&&typeof place.latitude==='number'&&typeof place.longitude==='number'&&km({lat:p.latitude,lon:p.longitude},{lat:place.latitude,lon:place.longitude})<.3);
  if(existing){existing.tags=[...new Set([...existing.tags,...place.tags])];for(const field of ['address','officialWebsite','openingHours','indoor','cuisines','admission','listedPrice','commonsFile','detailsSourceUrl','detailsCheckedAt','detailsExpiresAt','detailsSourceUpdatedAt','detailsDataAsOf','detailsProvenance','detailsLiveInventoryVerified','detailsSnapshotComplete','wikiTitle','wikidataId','popularityCoverage','popularitySourceUrl'] as const)if(existing[field]===undefined&&place[field]!==undefined)(existing as any)[field]=place[field];if(!existing.imageUrl&&place.imageUrl)Object.assign(existing,{imageUrl:place.imageUrl,imagePageUrl:place.imagePageUrl,imageCredit:place.imageCredit,imageLicense:place.imageLicense,imageLicenseUrl:place.imageLicenseUrl,photoStatus:place.photoStatus});continue;}
  const added={...place};result.push(added);if(added.wikidataId)byEntity.set(added.wikidataId,added);if(added.wikiTitle)byTitle.set(added.wikiTitle,added);byName.set(name,[...(byName.get(name)??[]),added]);
 }
 // Mix specific collections and broad topics, including on the first page of browsing.
 const buckets=[...discoveryCollections.map(c=>c.label),...discoveryTopics].map(topic=>result.filter(p=>p.tags.includes(topic))),selected=new Set<CityPlace>();
 for(let index=0;selected.size<limit&&buckets.some(b=>index<b.length);index++)for(const bucket of buckets)if(bucket[index]&&selected.size<limit)selected.add(bucket[index]);
 for(const p of result)if(selected.size<limit)selected.add(p);
 return [...selected];
}
