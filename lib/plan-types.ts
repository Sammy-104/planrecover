import {validTripDates} from './trip-time.ts';

export type PlanKind='trip'|'day-out'|'event';
export const planTypes=[
 {id:'trip',label:'Trip',plural:'Trips',description:'Getaways and holidays',schedule:'Itinerary',name:'My next trip'},
 {id:'day-out',label:'Day out',plural:'Days Out',description:'Local stops in one day',schedule:'Schedule',name:'A day together'},
 {id:'event',label:'Event',plural:'Events',description:'Celebrations and gatherings',schedule:'Agenda',name:'My next event'}
] as const;
export function planKind(plan:{kind?:PlanKind}):PlanKind{return planTypes.some(type=>type.id===plan.kind)?plan.kind!:'trip';}
export function planType(plan:{kind?:PlanKind}){return planTypes.find(type=>type.id===planKind(plan))!;}
export function parsePlanKind(value:unknown):PlanKind{
 if(value===undefined)return 'trip';
 if(!planTypes.some(type=>type.id===value))throw Error('Choose a trip, day out or event.');
 return value as PlanKind;
}
export function validPlanDates(kind:PlanKind,start:string,end:string){return validTripDates(start,end)&&(kind!=='day-out'||start===end);}
export function defaultPlanGoal(kind:PlanKind,destination:string){
 return kind==='event'?`An event in ${destination} with friends.`:kind==='day-out'?`A day out in ${destination} with friends.`:`A trip to ${destination} for four friends.`;
}
