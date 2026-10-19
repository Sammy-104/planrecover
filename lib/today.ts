import {type State,type Item} from './model.ts';
import {getPlanReminders} from './reminders.ts';
import {dayCity,itemDay,cityHotels} from './city-stays.ts';
import {localDateTime} from './trip-time.ts';
import {validPoint} from './itinerary-map.ts';

export function todayDay(state:State,now=new Date().toISOString()){
 const match=[...(state.plan.stays??[])].reverse().find(s=>{const d=localDateTime(now,s.timezone).slice(0,10);return d>=s.start&&d<=s.end;});
 const local=localDateTime(now,match?.timezone??state.plan.timezone).slice(0,10);return {day:local<state.plan.start?state.plan.start:local>state.plan.end?state.plan.end:local,preview:local<state.plan.start||local>state.plan.end};
}
export function todayStops(state:State,day:string,actor:string,scope:'mine'|'group'='mine'){
 return state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&itemDay(i,state.plan.timezone)===day&&(scope==='group'||i.participants.includes(actor))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}
export function todayOrigin(state:State,day:string,target:Item,actor:string,scope:'mine'|'group'='mine'){
 const stops=todayStops(state,day,actor,scope),index=stops.findIndex(i=>i.id===target.id);if(index<0)return undefined;
 const previous=stops.slice(0,index).filter(i=>Date.parse(i.start)+i.duration*60000<=Date.parse(target.start)).at(-1);
 // An unmapped preceding stop is a gap, never silently skipped.
 if(previous)return validPoint(previous)?{item:previous,label:'Previous planned stop'}:undefined;
 const hotel=cityHotels(state,day,target.stayId).find(i=>i.id!==target.id&&i.participants.includes(actor)&&validPoint(i)&&Date.parse(i.start)<=Date.parse(target.start)&&(itemDay(i,state.plan.timezone)===day||!!i.bookingEndDate&&day<i.bookingEndDate));
 return hotel?{item:hotel,label:'Saved accommodation'}:undefined;
}
export function todayOverview(state:State,day:string,actor:string,scope:'mine'|'group'='mine',now=new Date().toISOString()){
 const stops=todayStops(state,day,actor,scope),instant=Date.parse(now),isCurrent=localDateTime(now,dayCity(state,day).timezone).slice(0,10)===day;
 const current=isCurrent?stops.find(i=>Date.parse(i.start)<=instant&&Date.parse(i.start)+i.duration*60000>instant):undefined;
 const next=stops.find(i=>!isCurrent||Date.parse(i.start)>instant),attention=getPlanReminders(state,actor).filter(r=>!r.done&&Date.parse(r.due)<=Date.parse(now)+86400000).slice(0,6);
 return {stops,current,next,origin:next?todayOrigin(state,day,next,actor,scope):undefined,isCurrent,attention};
}
export function departureTime(start:string,minutes:number,buffer=10){if(!Number.isFinite(minutes)||minutes<0||minutes>60*24*30)throw Error('Route time is unavailable.');return new Date(Date.parse(start)-(minutes+buffer)*60000).toISOString();}
