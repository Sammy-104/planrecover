import {dayCity,itemDay} from './city-stays.ts';
import {validPoint} from './itinerary-map.ts';
import {forecastRange,readForecast,hoursChecks,FORECAST_FRESHNESS_MS,type PlanConditions} from './plan-conditions.ts';
import {mappedVenueInfo,mappedVenueId} from './mapped-place-info.ts';
import {mergePlaceInfo} from './place-info.ts';
import {boundedProviderJson} from './http-adapters.ts';
import type {State} from './model.ts';

export async function planConditions(state:State,day:string,origin:string,itemId?:string,refresh=false,options:{request?:typeof fetch;now?:number;cache?:Pick<Cache,'match'|'put'>|null}={}):Promise<PlanConditions>{
 const now=options.now??Date.now(),request=options.request??fetch;
 const items=state.items.filter(i=>!i.financialOnly&&i.category!=='Preparation'&&i.status!=='cancelled'&&itemDay(i,state.plan.timezone)===day),selected=itemId?items.find(i=>i.id===itemId):undefined;
 if(itemId&&!selected)throw Error('Choose an activity on this plan day.');
 const checks=structuredClone(items);
 if(refresh)await Promise.allSettled((selected?[checks.find(i=>i.id===selected.id)!]:checks.slice(0,4)).map(async item=>{
  if(mappedVenueId(item)){const details=await mappedVenueInfo(item,request,{refresh:true,now});checks[checks.findIndex(check=>check.id===item.id)]=mergePlaceInfo(item,'detailsCheckedAt' in details?details:{detailsSnapshotComplete:true,detailsExpiresAt:new Date(now).toISOString()});}
 }));
 const result:PlanConditions={day,hours:hoursChecks(state,day,checks,now),weatherStatus:'unavailable',checkedAt:new Date(now).toISOString()};
 if(!forecastRange(day,dayCity(state,day).timezone,new Date(now))){result.weatherStatus='outside-range';return result;}
 const place=selected&&validPoint(selected)?selected:items.find(i=>i.indoor===false&&validPoint(i))??items.find(validPoint)??dayCity(state,day).city;
 if(!place||!validPoint(place)){result.weatherStatus='unmapped';return result;}
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:place.latitude!.toFixed(3),longitude:place.longitude!.toFixed(3),timezone:selected?.timezone??dayCity(state,day).timezone,forecast_days:'16',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'}).toString();
 const key=new URL('/__public_weather_v2',origin);key.searchParams.set('source',url.href);const cache=options.cache===undefined?(globalThis.caches as CacheStorage&{default?:Cache})?.default:options.cache;
 try{
  let data:{body:any;fetchedAt:string}|undefined;try{const cached=!refresh?await cache?.match(key.href):undefined;if(cached){const candidate=await boundedProviderJson(cached,65536) as typeof data,at=Date.parse(candidate?.fetchedAt??'');if(Number.isFinite(at)&&at<=now+300000&&now-at<FORECAST_FRESHNESS_MS){readForecast(candidate!.body,day,candidate!.fetchedAt,'');data=candidate;}}}catch{}
  if(!data){const response=await request(url.href,{redirect:'manual',headers:{'User-Agent':'PlanRecoverBeta/1.0 (public weather checks)'},signal:AbortSignal.timeout(6500)});data={body:await boundedProviderJson(response,65536),fetchedAt:new Date(options.now??Date.now()).toISOString()};readForecast(data.body,day,data.fetchedAt,'');try{await cache?.put(key.href,Response.json(data,{headers:{'Cache-Control':'public, max-age=900'}}));}catch{}}
  result.forecast=readForecast(data.body,day,data.fetchedAt,'name' in place?String(place.name):state.plan.destination);result.weatherStatus='available';
 }catch{result.weatherStatus='unavailable';}return result;
}
