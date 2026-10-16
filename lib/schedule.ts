import type {Item,State} from './model.ts';
import {localDateTime,zonedStart,tripDays} from './trip-time.ts';
import {placeDistance} from './place-match.ts';
export type TravelMode='walk'|'drive'|'transit';
export function scheduleDay(item:Item,zone:string){return localDateTime(item.start,zone).slice(0,10);}
export function scheduleLocked(item:Item){return item.category==='Accommodation'||item.category==='Preparation'||item.status==='cancelled'||['demo-confirmed','confirmed','pending'].includes(item.booking)||item.paid.length>0||item.status==='awaiting-payment';}
export function travelEstimate(a:Item,b:Item,mode:TravelMode='walk'){const km=placeDistance(a,b);return {minutes:km===undefined?15:Math.max(5,Math.ceil((km*1.3/(mode==='drive'?30:4.5)*60+(mode==='drive'?10:3))/5)*5),known:km!==undefined,km};}
export function dayItems(state:State,day:string){return state.items.filter(i=>scheduleDay(i,state.plan.timezone)===day).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));}
export function scheduleConnections(state:State,day:string,mode:TravelMode='walk'){
 const items=dayItems(state,day).filter(i=>i.category!=='Preparation'&&i.status!=='cancelled');
 return items.slice(1).map((item,index)=>{const previous=items[index],gap=(Date.parse(item.start)-Date.parse(previous.start))/60000-previous.duration,travel=travelEstimate(previous,item,mode),shared=item.participants.some(id=>previous.participants.includes(id));return {item,previous,gap,travel,shared,overlap:shared&&gap<0,tight:mode!=='transit'&&shared&&gap>=0&&gap<travel.minutes};});
}
/** Reflow flexible stops from the drop point, while preserving existing later gaps and fixed bookings. */
export function previewMove(state:State,itemId:string,day:string,beforeId:string|null=null,mode:TravelMode='walk'){
 if(!['walk','drive'].includes(mode))throw Error('Choose walking or driving to reorder with travel estimates. Check transit departure times in Directions.');
 if(!tripDays(state.plan.start,state.plan.end).includes(day))throw Error('Choose a day within this plan.');
 const moving=state.items.find(i=>i.id===itemId);if(!moving)throw Error('Plan item not found.');if(scheduleLocked(moving))throw Error('This booking or task has a fixed time. Edit its details separately.');
 const original=dayItems(state,day).filter(i=>!['Preparation','Accommodation'].includes(i.category)&&i.status!=='cancelled'),originalIndex=original.findIndex(i=>i.id===itemId);
 if(originalIndex>=0&&(beforeId===itemId||beforeId===null&&originalIndex===original.length-1||beforeId!==null&&original[originalIndex+1]?.id===beforeId))return [];
 const targets=dayItems(state,day).filter(i=>i.id!==itemId&&!['Preparation','Accommodation'].includes(i.category)&&i.status!=='cancelled');
 const index=beforeId===null?targets.length:targets.findIndex(i=>i.id===beforeId);if(index<0)throw Error('The target activity changed. Refresh and try again.');
 const previous=targets[index-1],first=targets[index],sequence=[moving,...targets.slice(index)],changes:{itemId:string;start:string}[]=[];
 let start=first?Date.parse(first.start):previous?Date.parse(previous.start)+previous.duration*60000+travelEstimate(previous,moving,mode).minutes*60000:Date.parse(zonedStart(`${day}T${localDateTime(moving.start,state.plan.timezone).slice(11)}`,state.plan.timezone));
 if(previous)start=Math.max(start,Date.parse(previous.start)+(previous.duration+travelEstimate(previous,moving,mode).minutes)*60000);
 let prior=previous;
 for(const item of sequence){
  if(prior)start=Math.max(start,Date.parse(prior.start)+(prior.duration+travelEstimate(prior,item,mode).minutes)*60000);
  if(item.id!==itemId)start=Math.max(start,Date.parse(item.start));
  if(start!==Date.parse(item.start)&&scheduleLocked(item))throw Error(`There is not enough room before ${item.name}. Its confirmed time stays fixed.`);
  const finish=start+item.duration*60000,local=localDateTime(new Date(start).toISOString(),state.plan.timezone),endDay=localDateTime(new Date(finish-1).toISOString(),state.plan.timezone).slice(0,10);
  if(local.slice(0,10)!==day||endDay!==day)throw Error('These activities do not fit in this day with travel time. Choose another day or position.');
  const next={...item,start:zonedStart(local,state.plan.timezone)};if(Date.parse(next.start)!==Date.parse(item.start))changes.push({itemId:item.id,start:next.start});prior=next;
 }
 return changes;
}
