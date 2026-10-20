import type {Item,State} from './model.ts';
import {localDateTime} from './trip-time.ts';

/** Keep long trips usable without mounting a button for every plan date. */
export function visiblePlanDays(days:string[],selected:string,size=7):string[]{
 if(days.length<=9)return days;
 const index=Math.max(0,days.indexOf(selected));
 const start=Math.min(Math.max(0,index-Math.floor(size/2)),Math.max(0,days.length-size));
 return days.slice(start,start+size);
}

/** City-stay activities retain their local timezone when details are edited. */
export function activityTimeZone(item:Pick<Item,'timezone'>,plan:Pick<State['plan'],'timezone'>){
 return item.timezone??plan.timezone;
}

/** Reveal the first new activity after a draft batch is saved. */
export function addedDraftDay(before:State,after:State):string|undefined{
 if(before.plan.id!==after.plan.id)return;
 const existing=new Set(before.items.map(item=>item.id)),added=after.items.find(item=>!existing.has(item.id));
 if(!added)return;
 try{
  const day=localDateTime(added.start,activityTimeZone(added,after.plan)).slice(0,10);
  return day>=after.plan.start&&day<=after.plan.end?day:undefined;
 }catch{return;}
}

export function conciseActivityLocation(item:Pick<Item,'address'|'location'>){
 return (item.address??item.location).replace(/\s*·\s*\d+(?:\.\d+)?\s*km from centre.*$/i,'');
}
