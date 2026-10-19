import {mappedPlaceInfo,freshPlaceInfo,websiteUrl,PLACE_INFO_FRESHNESS_MS,type PlaceInfo} from './place-info.ts';
import {boundedProviderJson} from './http-adapters.ts';
import {boundedPlaceRequest} from './public-place-request.ts';
const recent=new Map<string,{at:number;details:ReturnType<typeof mappedPlaceInfo>}>(),pending=new Map<string,Promise<ReturnType<typeof mappedPlaceInfo>>>();
const endpoints=['https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const instant=(value:unknown,now:number)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now+300000?new Date(value).toISOString():undefined;
type Venue={id?:string;sourceUrl?:string;locationSourceUrl?:string;wikidataId?:string;latitude?:number;longitude?:number};
const pointFor=(place:Venue)=>typeof place.latitude==='number'&&typeof place.longitude==='number'&&Number.isFinite(place.latitude)&&Number.isFinite(place.longitude)&&Math.abs(place.latitude)<=90&&Math.abs(place.longitude)<=180?{latitude:place.latitude,longitude:place.longitude}:undefined;
export function mappedVenueId(place:Venue){
 if(/^osm-(node|way|relation)-[1-9]\d{0,15}$/.test(place.id??''))return place.id!;
 for(const source of [place.sourceUrl,place.locationSourceUrl])try{const url=new URL(source??''),match=/^\/(node|way|relation)\/([1-9]\d{0,15})\/?$/.exec(url.pathname);if(['www.openstreetmap.org','openstreetmap.org'].includes(url.hostname)&&match)return `osm-${match[1]}-${match[2]}`;}catch{}
 return /^Q[1-9]\d{0,14}$/.test(place.wikidataId??'')?`wikidata-${place.wikidataId}`:'';
}
const wikiRecent=new Map<string,{at:number;details:PlaceInfo}>(),wikiPending=new Map<string,Promise<PlaceInfo>>();
async function wikidataVenueInfo(id:string,request:typeof fetch,options:{refresh?:boolean;now?:number}):Promise<PlaceInfo>{
 const now=options.now??Date.now(),remembered=wikiRecent.get(id);if(!options.refresh&&remembered&&now>=remembered.at&&now-remembered.at<3600000&&freshPlaceInfo(remembered.details,now))return remembered.details;
 if(wikiPending.has(id))return wikiPending.get(id)!;
 const lookup=(async()=>{try{
  const url=new URL('https://www.wikidata.org/w/api.php');url.search=new URLSearchParams({action:'wbgetentities',ids:id,props:'claims|info',format:'json'}).toString();
  const response=await request(url.href,{redirect:'manual',headers:{'User-Agent':'PlanRecoverBeta/1.0 (public venue details)'},signal:AbortSignal.timeout(6000)}),body=await boundedProviderJson(response,262144) as any,entity=body?.entities?.[id];
  if(body?.error||entity?.id!==id||entity.missing!==undefined||!entity.claims||typeof entity.claims!=='object'||!instant(entity.modified,options.now??Date.now()))throw Error('Invalid entity.');
  const claims=Array.isArray(entity.claims.P856)?entity.claims.P856:[],current=claims.filter((claim:any)=>claim.rank!=='deprecated'&&claim.mainsnak?.snaktype==='value'),preferred=current.filter((claim:any)=>claim.rank==='preferred');
  const websites=[...new Set((preferred.length?preferred:current).flatMap((claim:any)=>{const value=websiteUrl(claim.mainsnak?.datavalue?.value);return value?[value]:[];}))];
  const checked=options.now??Date.now(),details:PlaceInfo={officialWebsite:websites.length===1?websites[0] as string:undefined,detailsSourceUrl:`https://www.wikidata.org/wiki/${id}`,detailsCheckedAt:new Date(checked).toISOString(),detailsExpiresAt:new Date(checked+PLACE_INFO_FRESHNESS_MS).toISOString(),detailsSourceUpdatedAt:instant(entity.modified,checked),detailsProvenance:'community-knowledge',detailsLiveInventoryVerified:false,detailsSnapshotComplete:true};
  if(wikiRecent.size>=500)wikiRecent.delete(wikiRecent.keys().next().value!);wikiRecent.set(id,{at:checked,details});return details;
 }catch{if(options.refresh)wikiRecent.delete(id);return {};}})().finally(()=>wikiPending.delete(id));wikiPending.set(id,lookup);return lookup;
}
/** The saved public knowledge entity is a bounded fallback, never a source of inferred price or capacity. */
export async function mappedVenueInfo(place:Venue,request:typeof fetch=fetch,options:{refresh?:boolean;now?:number}={}):Promise<PlaceInfo>{
 const id=mappedVenueId(place),wiki=/^Q[1-9]\d{0,14}$/.test(place.wikidataId??'')?wikidataVenueInfo(place.wikidataId!,request,options):null;
 const [details,fallback]=await Promise.all([mappedInfo(id,request,{...options,point:pointFor(place)}),wiki??Promise.resolve({})]);
 return 'detailsCheckedAt' in details?details:fallback;
}
/** Only a public map identity and, for an exact Wikidata entity, its public coordinate leave the app. */
export async function mappedInfo(id:string,request:typeof fetch=fetch,options:{refresh?:boolean;now?:number;point?:{latitude:number;longitude:number}}={}){
 const match=/^osm-(node|way|relation)-([1-9]\d{0,15})$/.exec(id),entity=/^wikidata-(Q[1-9]\d{0,14})$/.exec(id),point=options.point&&pointFor(options.point);
 if((!match||!Number.isSafeInteger(Number(match[2])))&&(!entity||!point))return {};
 const key=entity?`${id}:${point!.latitude.toFixed(5)},${point!.longitude.toFixed(5)}`:id;
 const now=options.now??Date.now(),remembered=recent.get(key);
 if(!options.refresh&&remembered&&now>=remembered.at&&now-remembered.at<3600000&&freshPlaceInfo(remembered.details,now))return remembered.details;
 if(pending.has(key))return pending.get(key)!;
 const lookup=(async()=>{
  const fetcher=boundedPlaceRequest(request,10000);
  for(const endpoint of endpoints){
   try{const query=match?`${match[1]}(${match[2]})`:`nwr(around:500,${point!.latitude.toFixed(5)},${point!.longitude.toFixed(5)})["wikidata"="${entity![1]}"]`;
    const response=await fetcher(endpoint,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'PlanRecoverBeta/1.0 (public venue details)'},body:new URLSearchParams({data:`[out:json][timeout:5];${query};${entity?'out meta center 3;':'out meta;'}`}),signal:AbortSignal.timeout(6000)});
    const body=await boundedProviderJson(response,65536) as any;
    if(body?.remark||!Array.isArray(body?.elements)||body.elements.length>2)continue;
    const candidates=body.elements.filter((e:any)=>match?e?.type===match[1]&&String(e.id)===match[2]:['node','way','relation'].includes(e?.type)&&Number.isSafeInteger(e.id)&&e.id>0&&e.tags?.wikidata===entity![1]);
    const element=candidates.length===1?candidates[0]:undefined;
    if(!element||!element.tags||typeof element.tags!=='object'||Array.isArray(element.tags))continue;
    if(entity){const latitude=element.lat??element.center?.lat,longitude=element.lon??element.center?.lon;if(!pointFor({latitude,longitude})||Math.abs(latitude-point!.latitude)>.005||Math.abs(longitude-point!.longitude)>.01)continue;}
    if(body.osm3s?.timestamp_osm_base!==undefined&&!instant(body.osm3s.timestamp_osm_base,options.now??Date.now())||element.timestamp!==undefined&&!instant(element.timestamp,options.now??Date.now()))continue;
    const tags=Object.fromEntries(Object.entries(element.tags).filter(([key,value])=>key.length<=100&&typeof value==='string'&&value.length<=5000)) as Record<string,string>;
    const checked=options.now??Date.now(),details={...mappedPlaceInfo(tags,`https://www.openstreetmap.org/${element.type}/${element.id}`,checked),detailsSnapshotComplete:true as const,
     detailsSourceUpdatedAt:instant(element.timestamp,checked),detailsDataAsOf:instant(body.osm3s?.timestamp_osm_base,checked)};
    // A lagging mirror must not acquire another day of freshness just because it was read now.
    if(details.detailsDataAsOf)details.detailsExpiresAt=new Date(Math.min(checked+PLACE_INFO_FRESHNESS_MS,Date.parse(details.detailsDataAsOf)+PLACE_INFO_FRESHNESS_MS)).toISOString();
    if(recent.size>=500)recent.delete(recent.keys().next().value!);recent.set(key,{at:checked,details});return details;
   }catch{/* A bounded alternate can recover an outage; unknown facts never become supplier confirmation. */}
  }
  if(options.refresh)recent.delete(key);return {};
 })().finally(()=>pending.delete(key));
 pending.set(key,lookup);return lookup;
}
