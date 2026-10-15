export type CitySelection={id:string;name:string;country:string;region:string;label:string;latitude:number;longitude:number};
const cache=new Map<string,{at:number;cities:CitySelection[]}>();
const remotePending=new Map<string,Promise<CitySelection[]>>();

export function validCitySelection(value:unknown,destination:string):CitySelection|undefined{
 if(!value||typeof value!=='object')return undefined;
 const p=value as CitySelection;
 if(!['id','name','country','region','label'].every(key=>typeof p[key as keyof CitySelection]==='string'&&String(p[key as keyof CitySelection]).length<=180))return undefined;
 if(!p.name.trim()||!p.country.trim()||p.label!==destination.trim()||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)return undefined;
 return {id:p.id,name:p.name,country:p.country,region:p.region,label:p.label,latitude:p.latitude,longitude:p.longitude};
}

type IndexedCity={city:CitySelection;names:string[];country:string;region:string;population:number};
let indexPromise:Promise<IndexedCity[]>|undefined;
const fold=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
async function cityIndex(){
 return indexPromise??=import('./data/cities.ts').then(module=>{
  const data=module.default as unknown as {countries:Record<string,string>;cities:[number,string,string,string,number,number,number,string[]][]};
  return data.cities.map(([id,name,code,region,latitude,longitude,population,aliases])=>{
   const country=data.countries[code]??code,label=[...new Set([name,region,country].filter(Boolean))].join(', ');
   return {city:{id:`geo-${id}`,name,country,region,label,latitude,longitude},names:[...new Set([name,...aliases].map(fold))],country:fold(country),region:fold(region),population};
  });
 });
}
async function smallerSettlements(query:string,request:typeof fetch){
 if(!remotePending.has(query))remotePending.set(query,(async()=>{
  try{
   const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:query,lang:'en',limit:'12'}).toString();
   for(const value of ['city','town','village','hamlet','municipality'])url.searchParams.append('osm_tag',`place:${value}`);
   const response=await request(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (city suggestions; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(5000)});
   if(!response.ok)return [];const body=await response.json() as any,cities:CitySelection[]=[],seen=new Set<string>();
   for(const feature of Array.isArray(body.features)?body.features:[]){
    const p=feature?.properties??{},coordinates=feature?.geometry?.coordinates,type=({N:'node',W:'way',R:'relation'} as Record<string,string>)[p.osm_type];
    if(!type||!Number.isSafeInteger(p.osm_id)||p.osm_id<1||p.osm_key!=='place'||!['city','town','village','hamlet','municipality'].includes(p.osm_value)||feature.geometry?.type!=='Point')continue;
    const name=typeof p.name==='string'?p.name.trim():'',country=typeof p.country==='string'?p.country.trim():'',region=typeof p.state==='string'?p.state:typeof p.county==='string'?p.county:'';
    const label=[...new Set([name,region,country].filter(Boolean))].join(', '),city=validCitySelection({id:`osm-${type}-${p.osm_id}`,name,country,region,label,latitude:coordinates?.[1],longitude:coordinates?.[0]},label);
    if(!city||seen.has(fold(label)))continue;seen.add(fold(label));cities.push(city);
   }
   return cities.slice(0,8);
  }catch{return [];}
 })().finally(()=>remotePending.delete(query)));
 return remotePending.get(query)!;
}
export async function searchCities(input:string,request:typeof fetch=fetch):Promise<CitySelection[]>{
 const query=input.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(query.length<2)return [];
 if(query.length>120)throw Error('Use a shorter city name.');
 const key=fold(query),cached=cache.get(key);if(cached&&Date.now()-cached.at<(cached.cities.length?3600000:30000))return cached.cities;
 const parts=query.split(',').map(fold).filter(Boolean),nameQuery=parts[0],qualifiers=parts.slice(1);
 const entries=await cityIndex(),countryOnly=!qualifiers.length&&entries.some(e=>e.country===nameQuery);
 const tokens=nameQuery.split(' '),matches:{entry:IndexedCity;score:number}[]=[];
 for(const entry of entries){
  if(countryOnly&&entry.country!==nameQuery)continue;
  if(qualifiers.some(part=>part!==entry.country&&part!==entry.region&&!entry.country.startsWith(part)&&!entry.region.startsWith(part)))continue;
  let score=countryOnly?0:99;
  for(const candidate of entry.names){
   if(candidate===nameQuery){score=0;break;}
   if(candidate.startsWith(nameQuery))score=Math.min(score,1);
   else if(tokens.every(token=>candidate.startsWith(token)||candidate.includes(' '+token)))score=Math.min(score,2);
  }
  // Entering a country is also useful: offer its largest cities.
  if(!qualifiers.length&&(entry.country===nameQuery||entry.region===nameQuery))score=Math.min(score,3);
  if(score<99)matches.push({entry,score});
 }
 matches.sort((a,b)=>a.score-b.score||b.entry.population-a.entry.population||a.entry.city.label.localeCompare(b.entry.city.label));
 const cities=matches.length?matches.slice(0,8).map(m=>m.entry.city):query.length>=3?await smallerSettlements(query,request):[];
 if(cache.size>=250)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),cities});
 return cities;
}
