import {searchCities,validCitySelection,type CitySelection} from './city-search.ts';
import {cityKey,cityProfile,type CityPlace} from './cities.ts';
import {placeDetails,PLACE_DETAILS_VERSION} from './place-details.ts';
import {CITY_CATALOG_LIMIT,DISCOVERY_VERSION,discoveryCollection,discoveryTopic,textCollectionTags} from './discovery.ts';
import {osmPlaces,mergePlaces} from './osm-places.ts';
import {searchMappedPlaces} from './place-search.ts';
import {mappedPopularity} from './place-popularity.ts';
export type CityLookup={destinationKey:string;resolvedCity:string;fetchedAt:string;source:'city-guide'|'wikipedia'|'open-places';entries:CityPlace[];radiusKm?:number;photosChecked?:boolean;detailsVersion?:number;discoveryVersion?:number;sourcesUnavailable?:boolean};
const userAgent='PlanRecoverBeta/1.0 (city discovery; https://planrecover-beta.goodluckimmigrations.chatgpt.site)';
async function wiki(params:Record<string,string>,request:typeof fetch,host='en.wikipedia.org'){
 const url=new URL(`https://${host}/w/api.php`);url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',...params}).toString();
 const response=await request(url,{headers:{'User-Agent':userAgent},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('The city place search is temporarily unavailable. Please try again.');
 const body=await response.json() as any;if(body.error)throw Error('The city search could not complete. Please try again.');return body;
}
const cityDescription=/\b(city|town|capital|municipality|metropolis|village|borough|settlement|commune|national park)\b/i;
const attraction=/museum|park|temple|shrine|palace|garden|market|beach|castle|gallery|cathedral|mosque|historic|monument|zoo|aquarium|tower|landmark|cultural|restaurant|theatre|theater|observatory|shopping|trail|waterfall|amusement|oceanarium|viewpoint|fort|bridge|cafe|café|cinema|stadium|skating|bowling|escape room|arcade|bouldering|climbing|miniature golf|disc golf|bakery|bookshop|bookstore|record shop|music venue|vintage|antique|craft shop|mural|sculpture/i;
const excluded=/school|university|hospital|police|railway station|metro station|airport|motorway|highway|cemetery|military unit|regiment|battalion/i;
export const photoTitles:Record<string,string>={'tokyo-sensoji':'Sensō-ji','tokyo-meiji':'Meiji Shrine','tokyo-gyoen':'Shinjuku Gyo-en','tokyo-tsukiji':'Tsukiji','tokyo-shibuya':'Shibuya Crossing','tokyo-ueno':'Ueno Park','busan-gamcheon':'Gamcheon Culture Village','busan-haeundae':'Haeundae Beach','busan-gwangalli':'Gwangalli Beach','busan-jagalchi':'Jagalchi Market','busan-yonggungsa':'Haedong Yonggungsa'};
function tagsFor(text:string){return [...(/museum|gallery/i.test(text)?['Museums','Culture']:[]),...(/temple|shrine|palace|castle|cathedral|mosque|historic|monument|tower|landmark|bridge|cultural/i.test(text)?['Landmarks','Culture']:[]),...(/park|garden|beach|trail|waterfall|nature|swimming/i.test(text)?['Outdoors']:[]),...(/market|restaurant|food|cafe|café|pub|bar|bakery|pastry|chocolate|ice cream/i.test(text)?['Food']:[]),...(/market|shopping|mall|bookshop|bookstore|record shop|vintage|antique|craft shop/i.test(text)?['Shopping']:[]),...(/zoo|aquarium|amusement|oceanarium|cinema|theatre|theater|bowling|escape room|arcade|climbing|bouldering|golf|skating|music venue/i.test(text)?['Entertainment']:[]),...textCollectionTags(text)];}
function distanceKm(a:{lat:number;lon:number},b:{lat:number;lon:number}){const rad=Math.PI/180,lat=(b.lat-a.lat)*rad,lon=(b.lon-a.lon)*rad;const h=Math.sin(lat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lon/2)**2;return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));}
export function cleanActivityQuery(input:string){const query=input.normalize('NFKC').trim().replace(/\s+/g,' ');if(query.length>100)throw Error('Use a shorter activity search.');return query.replace(/[^\p{L}\p{N}\s'-]/gu,' ').replace(/\s+/g,' ').trim();}
export function activitySearchTerms(input:string,city:string){
 let query=cleanActivityQuery(input).toLowerCase();
 const cityWords=city.toLowerCase().split(/[\s,]+/).filter(Boolean);
 for(const word of cityWords)query=query.split(' ').filter(token=>token!==word).join(' ');
 query=query.replace(/\b(things to do|places to visit|near me|activities|activity|attractions|best|popular|fun|find|search|show|visit|in|near|around|the|a|an|some|for|to|me)\b/g,' ').replace(/\s+/g,' ').trim();
 if(!query)return '(museum OR park OR temple OR market OR landmark OR garden)';
 const collection=discoveryCollection(query,city);if(collection)return collection.terms;
 const topic=discoveryTopic(query,city);
 if(topic==='Entertainment')return '(zoo OR aquarium OR cinema OR theatre OR amusement)';
 if(topic==='Outdoors'&&/^(parks?|gardens?)$/.test(query))return '(park OR garden OR trail)';
 if(topic==='Landmarks'&&/^(temples?|shrines?|monuments?|castles?)$/.test(query))return '(temple OR shrine OR monument OR castle)';
 const groups:[RegExp,string][]=[[/^(food|eat|eating|dining|restaurants?|cafes?|cafés?)$/,'(restaurant OR cafe OR market)'],[/^(walks?|walking|hikes?|hiking|nature|outdoors?)$/,'(trail OR park OR garden OR nature)'],[/^(shops?|shopping|markets?)$/,'(market OR shopping)'],[/^(museums?|art|galleries?|art museums?|art galleries?)$/,'(museum OR gallery)'],[/^(beaches?|swimming)$/,'(beach OR swimming)'],[/^(sights?|sightseeing|landmarks?)$/,'(landmark OR monument OR tower OR palace OR bridge)']];
 for(const [pattern,terms]of groups)if(pattern.test(query))return terms;
 const words=query.split(' ').slice(0,8),prefix=words.map(word=>word.length>=3?`${word}*`:word).join(' '),fuzzy=words.map(word=>word.length>=5?`${word}~1`:word).join(' ');
 return prefix===fuzzy?prefix:`(${prefix} OR ${fuzzy})`;
}
async function guidePlaces(destination:string,selected:CitySelection|undefined,request:typeof fetch){
 const known=cityProfile(destination,selected);if(!known)return {entries:[] as CityPlace[],checked:true};
 const entries=known.places.map(p=>({...p,wikiTitle:photoTitles[p.id]??p.name,tags:[...new Set([...p.tags,...tagsFor(`${p.name} ${p.description}`)])]}));
 let available=true;
 const data=await wiki({titles:entries.map(p=>p.wikiTitle).join('|'),redirects:'1',prop:'pageimages|coordinates|pageprops',coprimary:'primary',piprop:'thumbnail|name',pithumbsize:'640',pilicense:'free',pilimit:'max'},request).catch(()=>{available=false;return {query:{pages:[]}};});
 const {details,checked}=await placeDetails(data.query?.pages??[],request);
 const resolved=(title:string)=>{let t=title;for(const n of data.query?.normalized??[])if(n.from===t)t=n.to;for(const r of data.query?.redirects??[])if(r.from===t)t=r.to;return t;};
 return {entries:entries.map(p=>({...p,...details.get(resolved(p.wikiTitle!))})),checked:available&&checked};
}
async function wikipediaPlaces(city:any,query:string,request:typeof fetch,radiusKm=20){
 const coordinate=city.coordinates[0];
 const generator:Record<string,string>=query?{generator:'search',gsrsearch:`${activitySearchTerms(query,city.title)} nearcoord:${radiusKm}km,${coordinate.lat},${coordinate.lon}`,gsrlimit:'150',gsrnamespace:'0'}:{generator:'geosearch',ggscoord:`${coordinate.lat}|${coordinate.lon}`,ggsradius:String(Math.min(radiusKm*1000,10000)),ggslimit:'500',ggsnamespace:'0'};
 const data=await wiki({...generator,prop:'coordinates|pageprops|description|info|categories|pageimages',coprimary:'primary',colimit:'max',inprop:'url',cllimit:'20',clshow:'!hidden',piprop:'thumbnail|name',pithumbsize:'640',pilicense:'free',pilimit:'max'},request);
 let pages=(data.query?.pages??[]).sort((a:any,b:any)=>(a.index??0)-(b.index??0)).filter((p:any)=>{
  if(p.title===city.title||p.pageprops?.disambiguation!==undefined)return false;
  const text=[p.title,p.description,...(p.categories??[]).map((c:any)=>c.title)].join(' '),point=p.coordinates?.[0];
  if(point&&(!Number.isFinite(point.lat)||!Number.isFinite(point.lon)||distanceKm(coordinate,point)>radiusKm+.1))return false;
  if(query&&!point)return false;
  return attraction.test(text)&&!excluded.test(`${p.title} ${p.description??''}`);
 });
 const foldName=(text:string)=>text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 const terms=activitySearchTerms(query,city.title);
 if(query&&!discoveryTopic(query,city.title)&&!/^\((restaurant OR|trail OR|market OR|museum OR|beach OR|landmark OR)/.test(terms)){
  const words=cleanActivityQuery(query).toLowerCase().split(' ').filter(word=>word.length>1&&!city.title.toLowerCase().split(' ').includes(word)&&!['best','popular','find','search','show','visit','in','near','around','the','some','for','to','me'].includes(word));
  const named=pages.filter((p:any)=>words.length&&words.every(word=>foldName(p.title).includes(foldName(word))));if(named.length)pages=named;
 }
 pages=pages.slice(0,150);
 const {details,checked}=await placeDetails(pages,request);
 return {entries:pages.map((p:any):CityPlace=>{
  const text=`${p.title} ${p.description??''}`,point=p.coordinates?.[0],distance=point?distanceKm(coordinate,point):null;
  return {id:`wiki-${p.pageid}`,name:p.title,category:/restaurant|food market|fish market|cafe|café|pub/i.test(text)?'Meal':/market|shopping/i.test(text)?'Practical stop':'Activity',area:`In and around ${city.title}${distance!==null?` · ${distance.toFixed(1)} km from centre`:''}`,description:p.description?`${p.description}.`:'A local place to explore. Check its source for visit details.',sourceUrl:`https://en.wikipedia.org/?curid=${Number(p.pageid)}`,sourceLabel:'Wikipedia · local place guide',tags:tagsFor(text),wikiTitle:p.title,...(point?{latitude:point.lat,longitude:point.lon}:{}),...details.get(p.title)};
 }).filter((place:CityPlace)=>(discoveryCollection(query,city.title)?place.tags.includes(discoveryCollection(query,city.title)!.label):!discoveryTopic(query,city.title)||place.tags.includes(discoveryTopic(query,city.title)!))&&(place.latitude===undefined||place.longitude===undefined||distanceKm(coordinate,{lat:place.latitude,lon:place.longitude})<=radiusKm+.1)),checked};
}
export async function lookupCity(destination:string,request:typeof fetch=fetch,selectedCity?:CitySelection,search='',radiusKm=20):Promise<CityLookup>{
 const known=cityProfile(destination,selectedCity),query=cleanActivityQuery(search),title=destination.trim();
 if(!title||title.length>120)throw Error('Enter a city and country.');
 const result=(resolvedCity:string,source:CityLookup['source'],entries:CityPlace[],photosChecked=true,sourcesUnavailable=false):CityLookup=>({destinationKey:cityKey(destination),resolvedCity,fetchedAt:new Date().toISOString(),source,entries,radiusKm,photosChecked,detailsVersion:PLACE_DETAILS_VERSION,discoveryVersion:DISCOVERY_VERSION,sourcesUnavailable});
 const guide=query?Promise.resolve({entries:[] as CityPlace[],checked:true}):guidePlaces(destination,selectedCity,request);
 const selected=validCitySelection(selectedCity,destination)??(known?(await searchCities(`${known.name}, ${known.country}`)).find(c=>c.country===known.country):undefined);
 const identify=async(name:string)=>{const b=await wiki({titles:name,redirects:'1',prop:'coordinates|pageprops|description',coprimary:'primary'},request);return b.query?.pages?.find((p:any)=>!p.missing&&p.coordinates?.length&&!('disambiguation' in (p.pageprops??{})));};
 let city:any;
 try{
  city=selected?{title:selected.name,description:'Selected city',coordinates:[{lat:selected.latitude,lon:selected.longitude}]}:await identify(known?.name??(cityKey(title)==='algonquin area, ontario'?'Algonquin Provincial Park':title));
  if(!city&&title.includes(',')){const parts=title.split(',').map(p=>p.trim()),candidate=await identify(parts[0]);if(candidate&&parts.slice(1).every(part=>cityKey(candidate.description??'').includes(cityKey(part))))city=candidate;}
 }catch(e){const fallback=await guide;if(fallback.entries.length)return result(`${known!.name}, ${known!.country}`,'city-guide',fallback.entries,fallback.checked,true);throw e;}
 if(!city||!cityDescription.test(city.description??'')){await guide;throw Error('We could not identify this city reliably. Select it from the city suggestions or include its country.');}
 const mappedSearch=query&&!discoveryTopic(query,city.title)&&selected?searchMappedPlaces(destination,selected,query,'https://planrecover-beta.goodluckimmigrations.chatgpt.site',request,{radiusKm}):Promise.resolve({places:[] as CityPlace[],unavailable:false});
 const [curated,wikipedia,osm,named]=await Promise.allSettled([guide,wikipediaPlaces(city,query,request,radiusKm),osmPlaces(city.title,city.coordinates[0],query,request,radiusKm),mappedSearch]);
 const guided=curated.status==='fulfilled'?curated.value.entries:[],wikiEntries=wikipedia.status==='fulfilled'?wikipedia.value.entries:[],mapped=osm.status==='fulfilled'?osm.value:[];
 // Enrich mapped venues linked to English Wikipedia with licensed photos. Keep their original mapped coordinates.
 const wikiTitles=new Set(wikiEntries.map((p:CityPlace)=>p.wikiTitle));
 const photoPlaces=mapped.filter(p=>p.wikiTitle&&!wikiTitles.has(p.wikiTitle)).slice(0,50);
 let mappedPhotosChecked=true;
 if(photoPlaces.length){
  try{const data=await wiki({titles:[...new Set(photoPlaces.map(p=>p.wikiTitle!))].join('|'),redirects:'1',prop:'pageimages|coordinates|pageprops',piprop:'thumbnail|name',pithumbsize:'640',pilicense:'free',pilimit:'max'},request),enriched=await placeDetails(data.query?.pages??[],request);mappedPhotosChecked=enriched.checked;
   for(const place of photoPlaces){let title=place.wikiTitle!;for(const n of data.query?.normalized??[])if(n.from===title)title=n.to;for(const r of data.query?.redirects??[])if(r.from===title)title=r.to;const detail=enriched.details.get(title);if(detail)Object.assign(place,{wikiTitle:title,imageUrl:detail.imageUrl,imagePageUrl:detail.imagePageUrl,imageCredit:detail.imageCredit,imageLicense:detail.imageLicense,imageLicenseUrl:detail.imageLicenseUrl,photoStatus:detail.photoStatus,popularityCoverage:detail.popularityCoverage,popularitySourceUrl:detail.popularitySourceUrl});}
  }catch{mappedPhotosChecked=false;}
 }
 const searched=named.status==='fulfilled'?named.value.places:[];
 const entries=await mappedPopularity(mergePlaces([guided,searched,wikiEntries,mapped],CITY_CATALOG_LIMIT),request),unavailable=wikipedia.status==='rejected'||osm.status==='rejected';
 if(!entries.length&&!query)throw Error('No suitable places could be loaded. Try an activity search or add your own activity.');
 if(!entries.length&&wikipedia.status==='rejected'&&osm.status==='rejected')throw Error('City place search is temporarily unavailable. Please try again.');
 return result(city.title,mapped.length||searched.length?'open-places':wikiEntries.length?'wikipedia':'city-guide',entries,(curated.status==='fulfilled'?curated.value.checked:false)&&(wikipedia.status==='fulfilled'?wikipedia.value.checked:true)&&mappedPhotosChecked,unavailable);
}
