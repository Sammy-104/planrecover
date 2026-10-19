import type {State} from './model.ts';
import {itemDay} from './city-stays.ts';
import {validPlanDates,planKind} from './plan-types.ts';
import {localDateTime} from './trip-time.ts';

export function planDateReview(state:State,start:string,end:string){
 if(!validPlanDates(planKind(state.plan),start,end))throw Error('Choose valid plan dates. A day out must use one date.');
 const conflicts=state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly).filter(i=>{
  const day=itemDay(i,state.plan.timezone),finish=localDateTime(new Date(Date.parse(i.start)+i.duration*60000-1).toISOString(),i.timezone??state.plan.timezone).slice(0,10);
  return i.category==='Preparation'?day>end:day<start||day>end||finish>end||!!i.bookingEndDate&&i.bookingEndDate>end;
 }).map(i=>({id:i.id,name:i.name,reason:i.bookingEndDate&&i.bookingEndDate>end?'Checkout is after the new end date.':'The saved time is outside the new dates.'}));
 const old=state.plan.stays??[],stays=old.map((stay,index)=>({
  ...stay,
  start:index===0&&stay.start===state.plan.start&&start<stay.start?start:stay.start<start?start:stay.start,
  end:index===old.length-1&&stay.end===state.plan.end&&end>stay.end?end:stay.end>end?end:stay.end,
 }));
 for(let index=0;index<old.length;index++)if(old[index].end<start||old[index].start>end)conflicts.push({id:old[index].id,name:old[index].city.name,reason:'This whole city stay is outside the new dates. Edit or remove the stay first.'});
 for(const stop of state.plan.roadTrip?.breaks??[])if(stop.day<start||stop.day>end)conflicts.push({id:stop.id,name:stop.name,reason:'This planned road-trip break is outside the new dates.'});
 const changedStays=stays.filter((stay,index)=>stay.start!==old[index].start||stay.end!==old[index].end);
 return {conflicts,stays,changedStays};
}
