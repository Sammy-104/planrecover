import {planCurrency} from './money.ts';
import type {State,Item} from './model.ts';
import type {TravelLeg,RouteResult} from './travel-routes.ts';
import {routeSegments} from './travel-routes.ts';
import {validPoint} from './itinerary-map.ts';
import {itemDay} from './city-stays.ts';
import {tripDays} from './trip-time.ts';

export type RoadBreak={id:string;legId:string;day:string;name:string;minutes:number;itemId?:string};
export type RoadTripSettings={currency?:string;enabled:boolean;vehicles:number;consumption:number|null;fuelPrice:number|null;parking:number;tolls:number;restEvery:number;restMinutes:number;breaks:RoadBreak[]};
export const defaultRoadTrip:RoadTripSettings={enabled:false,vehicles:1,consumption:null,fuelPrice:null,parking:0,tolls:0,restEvery:120,restMinutes:15,breaks:[]};
export function cityRoadLegs(state:State){
 const stays=state.plan.stays??[];
 return stays.slice(1).map((stay,index)=>{
  const previous=stays[index],id=previous.id+'--'+stay.id;
  return {id,departureDay:previous.end,day:stay.start,from:previous.city.name,to:stay.city.name,
   points:[{id:'city-'+previous.id,latitude:previous.city.latitude,longitude:previous.city.longitude},{id:'city-'+stay.id,latitude:stay.city.latitude,longitude:stay.city.longitude}] as Item[]};
 });
}
export function validateRoadTrip(value:unknown,state:State):RoadTripSettings{
 if(!value||typeof value!=='object')throw Error('Enter road-trip settings.');const input=value as RoadTripSettings;if(input.currency&&input.currency!==planCurrency(state.plan))throw Error('Review road-trip budgets in the current plan currency.');
 const whole=(n:number,min:number,max:number,label:string)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Enter a valid '+label+'.');return n;};
 const money=(n:number)=>whole(n,0,1e12,'budget amount');
 const consumption=input.consumption===null?null:Number(input.consumption);if(consumption!==null&&(!Number.isFinite(consumption)||consumption<=0||consumption>100))throw Error('Use fuel consumption from 0 to 100 L/100 km.');
 const fuelPrice=input.fuelPrice===null?null:money(input.fuelPrice);
 if(!Array.isArray(input.breaks)||input.breaks.length>60||new Set(input.breaks.map(b=>b.id)).size!==input.breaks.length)throw Error('Use up to 60 distinct planned breaks.');
 const legs=cityRoadLegs(state),days=tripDays(state.plan.start,state.plan.end);
 const breaks=input.breaks.map(b=>{
  if(typeof b.id!=='string'||!b.id||b.id.length>100||typeof b.name!=='string'||!b.name.trim()||b.name.length>150||!days.includes(b.day)||!legs.some(l=>l.id===b.legId))throw Error('Choose a transfer, day and name for each road-trip break.');
  const leg=legs.find(l=>l.id===b.legId)!;if(b.day<leg.departureDay||b.day>leg.day)throw Error('Choose a break day within this city transfer.');
  if(b.itemId&&!state.items.some(i=>i.id===b.itemId&&i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&itemDay(i,state.plan.timezone)===b.day&&validPoint(i)))throw Error('Choose a mapped itinerary activity for this break.');
  return {id:b.id,legId:b.legId,day:b.day,name:b.name.trim(),minutes:whole(b.minutes,5,240,'break length'),...(b.itemId?{itemId:b.itemId}:{})};
 });
 return {currency:planCurrency(state.plan),enabled:input.enabled===true,vehicles:whole(input.vehicles,1,20,'number of vehicles'),consumption,fuelPrice,parking:money(input.parking),tolls:money(input.tolls),restEvery:whole(input.restEvery,30,360,'driving interval'),restMinutes:whole(input.restMinutes,5,120,'break length'),breaks};
}
export type RoadLegResult={id:string;day:string;from:string;to:string;minutes?:number;km?:number;pending?:boolean;unavailable?:boolean};
export function drivingBudget(settings:RoadTripSettings,legs:RoadLegResult[]){
 const known=legs.filter(l=>Number.isFinite(l.km)&&Number.isFinite(l.minutes)),km=known.reduce((n,l)=>n+l.km!,0),minutes=known.reduce((n,l)=>n+l.minutes!,0),complete=known.length===legs.length&&legs.length>0;
 const fuel=settings.consumption===null||settings.fuelPrice===null?null:Math.round(km/100*settings.consumption*settings.fuelPrice*settings.vehicles);
 const total=fuel===null?null:fuel+settings.parking+settings.tolls;
 if(total!==null&&!Number.isSafeInteger(total)||total!==null&&total>1e12)throw Error('The road-trip estimate is too large. Review the inputs.');
 return {km,minutes,complete,known:known.length,count:legs.length,fuel,total,extras:settings.parking+settings.tolls};
}
export function breakPlan(minutes:number,settings:RoadTripSettings,legId:string){
 const planned=settings.breaks.filter(b=>b.legId===legId),suggested=Math.max(0,Math.floor((minutes-1)/settings.restEvery));
 return {planned,suggested,breakMinutes:planned.length?planned.reduce((n,b)=>n+b.minutes,0):suggested*settings.restMinutes};
}
export function dailyDriving(state:State,day:string,results:RouteResult[]){
 const segments=routeSegments(state,day),expected=segments.flatMap(items=>items.slice(1).map((item,i)=>({from:items[i].id,to:item.id}))),legs=results.flatMap(r=>r.legs).filter(l=>expected.some(e=>e.from===l.from&&e.to===l.to));
 const stops=state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&itemDay(i,state.plan.timezone)===day);
 return {km:legs.reduce((n,l)=>n+l.km,0),minutes:legs.reduce((n,l)=>n+l.minutes,0),routed:legs.length,expected:Math.max(expected.length,stops.length-1),pending:results.some(r=>r.pending),unavailable:results.some(r=>r.unavailable)};
}
