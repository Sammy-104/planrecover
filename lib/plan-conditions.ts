import {itemDay} from './city-stays.ts';
import {listedWindows} from './opening-hours.ts';
import {localDateTime} from './trip-time.ts';
import {freshPlaceInfo} from './place-info.ts';
import type {Item,State} from './model.ts';
export const FORECAST_FRESHNESS_MS=900000;
export type DayForecast={day:string;checkedAt:string;expiresAt:string;provenance:'weather-forecast';low?:number;high?:number;precipitation?:number;wind?:number;code?:number;watch:boolean;summary:string;location:string;sourceUrl:string};
export type HoursCheck={itemId:string;name:string;status:'fits'|'closed'|'unknown';sourceUrl?:string;checkedAt?:string;expiresAt?:string;sourceUpdatedAt?:string;hours?:string;provenance:'community-map';fresh:boolean;liveInventoryVerified:false};
export type PlanConditions={day:string;forecast?:DayForecast;weatherStatus:'available'|'outside-range'|'unavailable'|'unmapped';hours:HoursCheck[];checkedAt:string};
export function forecastRange(day:string,zone:string,now=new Date()){
 const today=localDateTime(now.toISOString(),zone).slice(0,10),difference=(Date.parse(day+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000;
 return Number.isInteger(difference)&&difference>=0&&difference<16;
}
export function readForecast(body:any,day:string,checkedAt:string,location:string):DayForecast{
 const index=body?.daily?.time?.indexOf(day);if(!Number.isInteger(index)||index<0)throw Error('No forecast for this plan day.');
 const number=(key:string,min:number,max:number)=>{const n=body.daily[key]?.[index];return typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max?n:undefined;};
 const low=number('temperature_2m_min',-100,70),high=number('temperature_2m_max',-100,70),precipitation=number('precipitation_probability_max',0,100),wind=number('wind_speed_10m_max',0,500),code=number('weather_code',0,99);
 if([low,high,precipitation,wind,code].every(n=>n===undefined))throw Error('Forecast values are unavailable.');
 const watch=(precipitation??0)>=60||(code??0)>=51||(wind??0)>=40,summary=code===undefined&&precipitation===undefined&&wind===undefined?'Some weather details are unavailable':code!==undefined&&code>=95?'Thunderstorms in the daily forecast':code!==undefined&&code>=71&&code<=77?'Snow in the daily forecast':(precipitation??0)>=60||code!==undefined&&code>=51?'Rain or snow could affect outdoor plans':(wind??0)>=40?'Wind could affect outdoor plans':'No weather flag in this daily forecast';
 if(!Number.isFinite(Date.parse(checkedAt)))throw Error('Forecast retrieval time is unavailable.');
 return {day,checkedAt,expiresAt:new Date(Date.parse(checkedAt)+FORECAST_FRESHNESS_MS).toISOString(),provenance:'weather-forecast',low,high,precipitation,wind,code,watch,summary,location,sourceUrl:'https://open-meteo.com/'};
}
export function hoursChecks(state:State,day:string,items:Item[]=state.items,now=Date.now()):HoursCheck[]{
 return items.filter(i=>!i.financialOnly&&i.status!=='cancelled'&&i.category!=='Preparation'&&itemDay(i,state.plan.timezone)===day).map(item=>{
  const local=localDateTime(item.start,item.timezone??state.plan.timezone),minute=Number(local.slice(11,13))*60+Number(local.slice(14,16)),fresh=freshPlaceInfo(item,now),windows=fresh?listedWindows(item.openingHours,day):undefined;
  return {itemId:item.id,name:item.name,status:windows===undefined?'unknown':windows.some(([a,b])=>minute>=a&&minute+item.duration<=b)?'fits':'closed',sourceUrl:item.detailsSourceUrl??item.officialWebsite??item.sourceUrl,checkedAt:item.detailsCheckedAt,expiresAt:item.detailsExpiresAt,sourceUpdatedAt:item.detailsSourceUpdatedAt,hours:item.openingHours,provenance:'community-map',fresh,liveInventoryVerified:false};
 });
}
