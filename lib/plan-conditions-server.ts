import {dayCity,itemDay} from './city-stays';
import {validPoint} from './itinerary-map';
import {localDateTime} from './trip-time';
import {forecastRange,readForecast,hoursChecks,type PlanConditions} from './plan-conditions';
import {mappedInfo} from './mapped-place-info';
import type {State} from './model';

export async function planConditions(state:State,day:string,origin:string,itemId?:string,refresh=false):Promise<PlanConditions>{
 const items=state.items.filter(i=>!i.financialOnly&&i.category!=='Preparation'&&i.status!=='cancelled'&&itemDay(i,state.plan.timezone)===day),selected=itemId?items.find(i=>i.id===itemId):undefined;
 if(itemId&&!selected)throw Error('Choose an activity on this plan day.');
 const checks=structuredClone(items);
 if(refresh)await Promise.allSettled((selected?[checks.find(i=>i.id===selected.id)!]:checks.slice(0,4)).map(async item=>{
  let id='';try{const url=new URL(item.sourceUrl??item.locationSourceUrl??''),match=/^\/(node|way|relation)\/(\d+)\/?$/.exec(url.pathname);if(url.hostname==='www.openstreetmap.org'&&match)id=`osm-${match[1]}-${match[2]}`;}catch{}
  if(id)Object.assign(item,await mappedInfo(id));
 }));
 const result:PlanConditions={day,hours:hoursChecks(state,day,checks),weatherStatus:'unavailable',checkedAt:new Date().toISOString()};
 if(!forecastRange(day,dayCity(state,day).timezone)){result.weatherStatus='outside-range';return result;}
 const place=selected&&validPoint(selected)?selected:items.find(i=>i.indoor===false&&validPoint(i))??items.find(validPoint)??dayCity(state,day).city;
 if(!place||!validPoint(place)){result.weatherStatus='unmapped';return result;}
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:place.latitude!.toFixed(3),longitude:place.longitude!.toFixed(3),timezone:selected?.timezone??dayCity(state,day).timezone,forecast_days:'16',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'}).toString();
 const key=new URL('/__public_weather_v1',origin);key.searchParams.set('source',url.href);const cache=(globalThis.caches as CacheStorage&{default?:Cache})?.default;
 try{
  let data:{body:any;fetchedAt:string}|undefined;try{const cached=await cache?.match(key.href);if(cached)data=await cached.json();}catch{}
  if(!data){const response=await fetch(url.href,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (plan weather checks)'},signal:AbortSignal.timeout(6500)});if(!response.ok)throw Error();data={body:await response.json(),fetchedAt:new Date().toISOString()};readForecast(data.body,day,data.fetchedAt,'');try{await cache?.put(key.href,Response.json(data,{headers:{'Cache-Control':'public, max-age=900'}}));}catch{}}
  result.forecast=readForecast(data.body,day,data.fetchedAt,'name' in place?String(place.name):state.plan.destination);result.weatherStatus='available';
 }catch{result.weatherStatus='unavailable';}return result;
}
