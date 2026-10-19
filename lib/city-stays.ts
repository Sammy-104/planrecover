import type {State,Item} from './model.ts';
import {validCitySelection,type CitySelection} from './city-search.ts';
import {cityKey} from './cities.ts';
import {destinationSettings,validTimezone} from './localization.ts';
import {localDateTime,validTripDates} from './trip-time.ts';

export type CityStay={id:string;city:CitySelection;start:string;end:string;timezone:string;kind:'stay'|'overnight';note:string};
export function validateCityStays(value:unknown,plan:State['plan']):CityStay[]{
 if(!Array.isArray(value)||value.length>30)throw Error('Use up to 30 city stays.');
 const ids=new Set<string>();
 const stays=value.map((input:any)=>{
  if(!input||typeof input.id!=='string'||!input.id||input.id.length>100||ids.has(input.id))throw Error('Each city stay needs a unique ID.');ids.add(input.id);
  const city=validCitySelection(input.city,input.city?.label??'');if(!city)throw Error('Choose a city from the city suggestions.');
  if(!validTripDates(input.start,input.end)||input.start<plan.start||input.end>plan.end)throw Error('City stays must be within the plan dates.');
  if(!['stay','overnight'].includes(input.kind))throw Error('Choose a city stay or overnight stop.');
  const timezone=validTimezone(destinationSettings(city.label,city).timezone??input.timezone);
  return {id:input.id,city,start:input.start,end:input.end,timezone,kind:input.kind,note:String(input.note??'').trim().slice(0,300)} as CityStay;
 }).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
 for(let i=1;i<stays.length;i++)if(stays[i].start<stays[i-1].end)throw Error('City stays can meet on a transfer day but cannot overlap overnight.');
 return stays;
}
export function cityContexts(state:State){
 const base={id:'base',destination:state.plan.destination,city:state.plan.city,timezone:state.plan.timezone,start:state.plan.start,end:state.plan.end};
 return [base,...(state.plan.stays??[]).map(s=>({...s,destination:s.city.label}))];
}
export function dayCity(state:State,day:string,stayId?:string){
 const contexts=cityContexts(state),stays=contexts.slice(1),matching=stays.filter(s=>s.start<=day&&s.end>=day);
 if(stayId){const chosen=contexts.find(s=>s.id===stayId);if(!chosen||chosen.id==='base'&&matching.length>0||chosen.id!=='base'&&(day<chosen.start||day>chosen.end))throw Error('Choose a city stay that includes this day.');return chosen;}
 return matching.at(-1)??[...stays].reverse().find(s=>s.start<=day)??contexts[0];
}
export function discoveryContext(state:State,body:{day?:unknown;stayId?:unknown;destination?:unknown}){
 const day=body.day===undefined?state.plan.start:String(body.day);if(!validTripDates(day,day)||day<state.plan.start||day>state.plan.end)throw Error('Choose a day in this plan.');
 const context=dayCity(state,day,body.stayId===undefined?undefined:String(body.stayId));
 if(typeof body.destination!=='string'||cityKey(body.destination)!==cityKey(context.destination))throw Error('The selected city changed. Search again.');
 return {...context,day};
}
export function cityRecommendations(state:State,destination:string){const key=cityKey(destination);return (state.recommendations?.destinationKey===key?state.recommendations:undefined)??state.cityRecommendations?.[key];}
export function setCityRecommendations(state:State,recommendations:NonNullable<State['recommendations']>):State{
 return {...state,cityRecommendations:{...state.cityRecommendations,[recommendations.destinationKey]:recommendations},...(recommendations.destinationKey===cityKey(state.plan.destination)?{recommendations}:{})};
}
export function itemTimezone(item:Pick<Item,'timezone'>,fallback:string){return item.timezone??fallback;}
export function itemDay(item:Pick<Item,'start'|'timezone'>,fallback:string){return localDateTime(item.start,itemTimezone(item,fallback)).slice(0,10);}
export function cityHotels(state:State,day:string,stayId?:string){
 let context:ReturnType<typeof dayCity>;try{context=dayCity(state,day,stayId);}catch{return [];}return state.items.filter(i=>i.status!=='cancelled'&&i.category==='Accommodation'&&(i.stayId===context.id||!i.stayId&&cityKey(context.destination)===cityKey(state.plan.destination))&&(context.id==='base'&&!state.plan.stays?.length||itemDay(i,state.plan.timezone)<=day&&(i.bookingEndDate?day<i.bookingEndDate:itemDay(i,state.plan.timezone)===day)));
}

export function visitCity(state:State,day:string,key?:string){const contexts=cityContexts(state),matching=contexts.slice(1).filter(c=>c.start<=day&&c.end>=day);return (key?[...(matching.length?matching:[dayCity(state,day)])].reverse().find(c=>cityKey(c.destination)===key):undefined)??dayCity(state,day);}
export function discoveryCities(state:State,day:string){const matching=cityContexts(state).slice(1).filter(c=>c.start<=day&&c.end>=day);return matching.length?matching:[dayCity(state,day)];}
/** A read-only planning scope. Never save this derived workspace. */
export function draftCityState(state:State,day=state.plan.start):State{
 if(!state.plan.stays?.length)return state;
 if(day<state.plan.start||day>state.plan.end||!validTripDates(day,day))throw Error('Choose a plan day for this draft.');
 const context=dayCity(state,day),recommendations=cityRecommendations(state,context.destination);
 return {...state,plan:{...state.plan,destination:context.destination,contentDestination:context.destination,city:context.city,timezone:context.timezone,start:day,end:context.end<day?day:context.end,stays:undefined},recommendations,cityRecommendations:recommendations?{[cityKey(context.destination)]:recommendations}:undefined};
}
