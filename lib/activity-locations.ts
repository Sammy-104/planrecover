import {dayCity,itemDay} from './city-stays.ts';
import {tripCatalog,type State,type Item} from './model.ts';
import {photoTitles} from './city-lookup.ts';
import {searchCities,validCitySelection} from './city-search.ts';
import {validPoint,needsPlaceDetails} from './itinerary-map.ts';
import {placeDetails,PLACE_DETAILS_VERSION} from './place-details.ts';
import type {PlaceLocation,PlacePhoto} from './cities.ts';

type Point={latitude:number;longitude:number};
const fold=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const pointOf=(page:any):Point|undefined=>{const p=page?.coordinates?.[0],point={latitude:p?.lat,longitude:p?.lon};return validPoint(point)&&!('disambiguation' in (page.pageprops??{}))?point:undefined;};
function distance(a:Point,b:Point){const rad=Math.PI/180,h=Math.sin((b.latitude-a.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
async function wiki(parameters:Record<string,string>,request:typeof fetch){
 const url=new URL('https://en.wikipedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'coordinates|pageprops|pageimages',coprimary:'primary',piprop:'thumbnail|name',pithumbsize:'640',pilicense:'free',pilimit:'max',...parameters}).toString();
 const response=await request(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (itinerary map; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Location search unavailable');const body=await response.json() as any;if(body.error)throw Error('Location search unavailable');return body;
}
async function localCity(label:string){const cities=(await searchCities(label)).filter(city=>fold(city.name)===fold(label.split(',')[0])||fold(city.label)===fold(label));return cities.length===1?cities[0]:undefined;}
function namedPlace(value:string,cityName:string){
 const cityWords=new Set(fold(cityName).split(' '));
 const words=fold(value).split(' ').filter(word=>!cityWords.has(word)&&!['visit','visiting','tour','at','the','a','an','in','near','stop','activity','booking'].includes(word));
 if(!words.length||words.every(word=>['dinner','lunch','breakfast','meal','hotel','transport','shuttle','walk','hike','shopping','free','time','downtime','preparation','museum','park','restaurant','cafe','café','garden','beach'].includes(word)))return undefined;
 return words.join(' ');
}

/** Resolve a source's coordinates or a named nearby venue; never use a city centre as a stop. */
export async function existingActivityLocations(state:State,request:typeof fetch=fetch,itemIds?:string[]){
 const catalog=tripCatalog(state),resolved=new Map<string,PlaceLocation&PlacePhoto>(),pending:{item:Item;title?:string;pageId?:string}[]=[],manual:Item[]=[];
 let unavailable=false;
 for(const item of state.items){
  if(item.status==='cancelled'||!needsPlaceDetails(item)||(itemIds&&!itemIds.includes(item.id)))continue;
  const match=!item.placeLookupManual?catalog.find(place=>place.name===item.name):undefined;
  if(match&&validPoint(match)&&match.placeDetailsVersion===PLACE_DETAILS_VERSION){resolved.set(item.id,{latitude:match.latitude!,longitude:match.longitude!,wikiTitle:match.wikiTitle,wikidataId:match.wikidataId,locationVersion:match.locationVersion,locationSourceUrl:match.locationSourceUrl,locationPrecision:match.locationPrecision,placeDetailsVersion:match.placeDetailsVersion,...(match.imageUrl?{imageUrl:match.imageUrl,imagePageUrl:match.imagePageUrl,imageCredit:match.imageCredit,imageLicense:match.imageLicense,imageLicenseUrl:match.imageLicenseUrl}:{}),photoStatus:match.photoStatus});continue;}
  const pageId=!item.placeLookupManual?/https:\/\/en\.wikipedia\.org\/\?curid=(\d+)/.exec(item.policy)?.[1]:undefined,title=item.wikiTitle??(match&&(match.wikiTitle??photoTitles[match.id]));
  if(pageId||title)pending.push({item,title,pageId});
  else if(!/fictional|seeded demo|blueprint fixture/i.test(item.source)&&item.category!=='Preparation')manual.push(item);
 }
 await Promise.all([pending.filter(p=>p.pageId),pending.filter(p=>!p.pageId&&p.title)].map(async entries=>{
  for(let offset=0;offset<entries.length;offset+=50){
   const group=entries.slice(offset,offset+50);
   try{
    const parameters:Record<string,string>=group[0].pageId?{pageids:[...new Set(group.map(p=>p.pageId!))].join('|')}:{titles:[...new Set(group.map(p=>p.title!))].join('|')};
    const body=await wiki({...parameters,redirects:'1'},request),enriched=await placeDetails(body.query?.pages??[],request);
    const normalized=(title:string)=>{let result=title;for(const n of body.query?.normalized??[])if(n.from===result)result=n.to;for(const r of body.query?.redirects??[])if(r.from===result)result=r.to;return result;};
    for(const candidate of group){const page=body.query?.pages?.find((p:any)=>(candidate.pageId&&String(p.pageid)===candidate.pageId)||(candidate.title&&p.title===normalized(candidate.title)));if(page&&!page.missing&&!('disambiguation' in (page.pageprops??{}))){const detail=enriched.details.get(page.title);if(detail)resolved.set(candidate.item.id,detail);}}
   }catch{unavailable=true;}
  }
 }));
 if(!manual.length)return {resolved,unavailable};
 const selected=validCitySelection(state.plan.city,state.plan.destination);
 const lookups=new Map<string,Promise<PlaceLocation&PlacePhoto|undefined>>();
 // Limit parallel requests while allowing each stop to use its own city.
 let next=0;
 await Promise.all(Array.from({length:Math.min(3,manual.length)},async()=>{
  while(next<manual.length){
   const item=manual[next++],context=dayCity(state,itemDay(item,state.plan.timezone),state.plan.stays?.some(s=>s.id===item.stayId)?item.stayId:undefined),tripCity=context.city??selected??await localCity(context.destination),locationCity=tripCity&&fold(item.location.split(',')[0])===fold(tripCity.name)?tripCity:await localCity(item.location),city=locationCity||tripCity;if(!city)continue;
   const query=namedPlace(item.name,city.name)??(!locationCity?namedPlace(item.location,city.name):undefined);if(!query)continue;
   const key=`${query}|${city.latitude}|${city.longitude}`;
   if(!lookups.has(key))lookups.set(key,(async()=>{
    const body=await wiki({generator:'search',gsrsearch:`"${query}" nearcoord:50km,${city.latitude},${city.longitude}`,gsrnamespace:'0',gsrlimit:'10'},request);
    const candidates=(body.query?.pages??[]).filter((page:any)=>{const point=pointOf(page);return point&&distance(city,point)<=50.1&&query.split(' ').every(word=>fold(page.title).split(' ').includes(word));});
    const exact=candidates.filter((page:any)=>fold(page.title.replace(/\([^)]*\)/g,''))===query),matches=exact.length?exact:candidates;
    if(matches.length!==1)return undefined;const enriched=await placeDetails(matches,request),detail=enriched.details.get(matches[0].title);return detail&&validPoint(detail)&&distance(city,detail as Point)<=50.1?detail:undefined;
   })());
   try{const point=await lookups.get(key)!;if(point)resolved.set(item.id,point);}catch{unavailable=true;}
  }
 }));
 return {resolved,unavailable};
}
