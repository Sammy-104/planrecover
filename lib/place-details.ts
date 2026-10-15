import {PLACE_DETAILS_VERSION,type PlacePhoto,type PlaceLocation} from './cities.ts';
import {validPoint} from './itinerary-map.ts';
import {websiteUrl} from './place-info.ts';
import {entityPopularity,type PlacePopularity} from './place-popularity.ts';

export {PLACE_DETAILS_VERSION} from './cities.ts';
const agent='PlanRecoverBeta/1.0 (place details; https://planrecover-beta.goodluckimmigrations.chatgpt.site)';
const plain=(value:unknown)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim().slice(0,250):'';
const safeUrl=(value:unknown,hosts:string[])=>{try{const url=new URL(String(value));return url.protocol==='https:'&&hosts.includes(url.hostname)?url.href:undefined;}catch{return undefined;}};
const fileKey=(value:string)=>value.replaceAll('_',' ').normalize('NFC');
async function api(host:string,parameters:Record<string,string>,request:typeof fetch){
 const url=new URL(`https://${host}/w/api.php`);url.search=new URLSearchParams({format:'json',formatversion:'2',...parameters}).toString();
 const response=await request(url,{headers:{'User-Agent':agent},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Place details unavailable');const body=await response.json() as any;if(body.error)throw Error('Place details unavailable');return body;
}
function currentClaims(entity:any,property:string){
 const claims=(entity?.claims?.[property]??[]).filter((claim:any)=>claim.rank!=='deprecated'&&claim.mainsnak?.snaktype==='value'&&!claim.qualifiers?.P582);
 return claims.some((claim:any)=>claim.rank==='preferred')?claims.filter((claim:any)=>claim.rank==='preferred'):claims;
}
function entityPoint(entity:any){
 const candidates=currentClaims(entity,'P625').map((claim:any)=>claim.mainsnak.datavalue?.value).filter((point:any)=>point&&validPoint(point)&&/^https?:\/\/www\.wikidata\.org\/entity\/Q2$/.test(point.globe));
 if(!candidates.length)return undefined;
 // Multiple current locations can describe a chain or several sites. Do not choose a branch.
 if(candidates.some((point:any)=>Math.abs(point.latitude-candidates[0].latitude)>.002||Math.abs(point.longitude-candidates[0].longitude)>.002))return undefined;
 return candidates.sort((a:any,b:any)=>(a.precision??1)-(b.precision??1))[0];
}
async function licensedPhotos(pages:any[],request:typeof fetch){
 const credits=new Map<string,PlacePhoto>();let checked=true;
 const candidates=pages.filter(page=>typeof page.pageimage==='string'&&!/\.(svg|pdf|djvu)$/i.test(page.pageimage));
 for(let offset=0;offset<candidates.length;offset+=12){
  const group=candidates.slice(offset,offset+12);
  try{
   const data=await api('commons.wikimedia.org',{action:'query',titles:[...new Set(group.map(page=>`File:${page.pageimage}`))].join('|'),redirects:'1',prop:'imageinfo',iiprop:'extmetadata|url',iiurlwidth:'640',iiextmetadatafilter:'Artist|Credit|LicenseShortName|LicenseUrl'},request);
   const canonical=(title:string)=>{let result=fileKey(title);for(const redirect of [...(data.query?.normalized??[]),...(data.query?.redirects??[])])if(fileKey(redirect.from)===result)result=fileKey(redirect.to);return result;};
   for(const file of data.query?.pages??[]){
    const info=file.imageinfo?.[0],meta=info?.extmetadata,pageUrl=safeUrl(info?.descriptionurl,['commons.wikimedia.org']);
    const license=plain(meta?.LicenseShortName?.value),artist=plain(meta?.Artist?.value)||plain(meta?.Credit?.value)||'Wikimedia Commons';
    if(!pageUrl||!license)continue;
    for(const candidate of group.filter(page=>canonical(`File:${page.pageimage}`)===fileKey(file.title))){
     const imageUrl=safeUrl(info?.thumburl,['upload.wikimedia.org','thumb.wikimedia.org'])??safeUrl(candidate.thumbnail?.source,['upload.wikimedia.org','thumb.wikimedia.org']);
     if(imageUrl)credits.set(candidate.title,{imageUrl,imagePageUrl:pageUrl,imageCredit:artist,imageLicense:license,imageLicenseUrl:safeUrl(meta?.LicenseUrl?.value,['creativecommons.org','www.creativecommons.org']),photoStatus:'available'});
    }
   }
  }catch{checked=false;}
 }
 return {credits,checked};
}

/** Match coordinates and photos through the exact article/entity, never a nearby namesake. */
export async function placeDetails(pages:any[],request:typeof fetch=fetch){
 const details=new Map<string,PlaceLocation&PlacePhoto&PlacePopularity>();let checked=true;
 const ids=[...new Set<string>(pages.map(page=>page.pageprops?.wikibase_item).filter((id:any)=>typeof id==='string'&&/^Q\d+$/.test(id)))];
 const entities=new Map<string,any>();
 for(let offset=0;offset<ids.length;offset+=50){
  try{const body=await api('www.wikidata.org',{action:'wbgetentities',ids:ids.slice(offset,offset+50).join('|'),props:'claims|sitelinks/urls'},request);for(const [id,entity]of Object.entries(body.entities??{}))entities.set(id,{...(entity as any),id});}
  catch{checked=false;}
 }
 for(const page of pages){
  const wikidataId=page.pageprops?.wikibase_item,entity=entities.get(wikidataId),precise=entityPoint(entity),wiki=page.coordinates?.find((point:any)=>point.primary!==false&&(!point.globe||point.globe==='earth')&&validPoint({latitude:point.lat,longitude:point.lon}));
  const structured=precise&&(!wiki||(Number.isFinite(precise.precision)&&precise.precision>0&&precise.precision<=.001));
  const point=structured?precise:(wiki?{latitude:wiki.lat,longitude:wiki.lon}:precise);
  details.set(page.title,{wikiTitle:page.title,placeDetailsVersion:PLACE_DETAILS_VERSION,...(/^Q\d+$/.test(wikidataId??'')?{wikidataId}:{}),...(point?{latitude:point.latitude,longitude:point.longitude,locationVersion:PLACE_DETAILS_VERSION,locationSourceUrl:structured?`https://www.wikidata.org/wiki/${wikidataId}`:Number.isFinite(page.pageid)?`https://en.wikipedia.org/?curid=${Number(page.pageid)}`:`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,...(structured&&precise?.precision?{locationPrecision:precise.precision}:{})}:{})});
  const officialWebsite=currentClaims(entity,'P856').map((claim:any)=>websiteUrl(claim.mainsnak.datavalue?.value)).find(Boolean);
  Object.assign(details.get(page.title)!,entityPopularity(entity));
  if(officialWebsite)Object.assign(details.get(page.title)!,{officialWebsite,detailsSourceUrl:`https://www.wikidata.org/wiki/${wikidataId}`,detailsCheckedAt:new Date().toISOString()});
 }
 const first=await licensedPhotos(pages,request);checked=checked&&first.checked;
 const alternate=pages.filter(page=>!first.credits.has(page.title)).map(page=>{
  const filename=currentClaims(entities.get(page.pageprops?.wikibase_item),'P18').map((claim:any)=>claim.mainsnak.datavalue?.value).find((value:any)=>typeof value==='string'&&!/\.(svg|pdf|djvu)$/i.test(value));
  return filename?{...page,pageimage:filename,thumbnail:undefined}:undefined;
 }).filter(Boolean);
 const second=await licensedPhotos(alternate,request);checked=checked&&second.checked;
 for(const page of pages)details.set(page.title,{...details.get(page.title),...(first.credits.get(page.title)??second.credits.get(page.title)??{photoStatus:checked?'unavailable':'retry'})});
 return {details,checked};
}
