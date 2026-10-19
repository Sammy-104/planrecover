import {dayCity,itemDay,itemTimezone} from './city-stays.ts';
import {routedMinutes,type TravelMatrix} from './route-matrix.ts';
import {listedWindows} from './opening-hours.ts';
import type {Item,State} from './model.ts';
import {localDateTime,zonedStart,tripDays} from './trip-time.ts';
import {placeDistance} from './place-match.ts';
export type TravelMode='walk'|'drive'|'transit';
export function scheduleDay(item:Item,zone:string){return itemDay(item,zone);}
export function scheduleLocked(item:Item,state?:State){return !!state?.events.some(e=>e.itemId===item.id&&e.status==='confirmed'&&e.kind!=='settlement')||!!item.depends.length||item.category==='Accommodation'||item.category==='Preparation'||item.status==='cancelled'||item.booking==='demo-confirmed'||item.booking==='confirmed'||item.booking==='pending'||item.booking==='cancelled'||!!item.externalBooking||item.paid.length>0||item.status==='awaiting-payment';}
export function travelEstimate(a:Item,b:Item,mode:TravelMode='walk'){const km=placeDistance(a,b);return {minutes:km===undefined?15:Math.max(5,Math.ceil((km*1.3/(mode==='drive'?30:4.5)*60+(mode==='drive'?10:3))/5)*5),known:km!==undefined,km};}
export function dayItems(state:State,day:string){return state.items.filter(i=>!i.financialOnly&&scheduleDay(i,state.plan.timezone)===day).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));}
export function scheduleConnections(state:State,day:string,mode:TravelMode='walk'){
 const items=dayItems(state,day).filter(i=>i.category!=='Preparation'&&i.status!=='cancelled');
 return items.slice(1).map((item,index)=>{const previous=items[index],gap=(Date.parse(item.start)-Date.parse(previous.start))/60000-previous.duration,travel=travelEstimate(previous,item,mode),shared=item.participants.some(id=>previous.participants.includes(id));return {item,previous,gap,travel,shared,overlap:shared&&gap<0,tight:mode!=='transit'&&shared&&gap>=0&&gap<travel.minutes};});
}
/** Reflow flexible stops from the drop point, while preserving existing later gaps and fixed bookings. */
export function previewMove(state:State,itemId:string,day:string,beforeId:string|null=null,mode:TravelMode='walk',matrix?:TravelMatrix,actor?:string){
 if(!['walk','drive'].includes(mode))throw Error('Choose walking or driving to reorder with routed travel. Check transit departure times in Directions.');
 if(!tripDays(state.plan.start,state.plan.end).includes(day))throw Error('Choose a day within this plan.');
 const travel=(a:Item,b:Item)=>matrix?routedMinutes(matrix,a,b,mode)+10:travelEstimate(a,b,mode).minutes;
 const moving=state.items.find(i=>i.id===itemId);if(!moving)throw Error('Plan item not found.');if(moving.stayId&&dayCity(state,day).id!==moving.stayId&&dayCity(state,day).destination!==dayCity(state,scheduleDay(moving,dayCity(state,day).timezone)).destination)throw Error('This activity is in another city. Choose a day in the same city stay.');if(scheduleLocked(moving,state))throw Error('This booking or task has a fixed time. Edit its details separately.');
 const original=dayItems(state,day).filter(i=>!['Preparation','Accommodation'].includes(i.category)&&i.status!=='cancelled'),originalIndex=original.findIndex(i=>i.id===itemId);
 if(originalIndex>=0&&(beforeId===itemId||beforeId===null&&originalIndex===original.length-1||beforeId!==null&&original[originalIndex+1]?.id===beforeId))return [];
 const targets=dayItems(state,day).filter(i=>i.id!==itemId&&!['Preparation','Accommodation'].includes(i.category)&&i.status!=='cancelled');
 const index=beforeId===null?targets.length:targets.findIndex(i=>i.id===beforeId);if(index<0)throw Error('The target activity changed. Refresh and try again.');
 const previous=targets[index-1],first=targets[index],sequence=[moving,...targets.slice(index)],changes:{itemId:string;start:string}[]=[];
 let start=first?Date.parse(first.start):previous?Date.parse(previous.start)+previous.duration*60000+travel(previous,moving)*60000:Date.parse(zonedStart(`${day}T${localDateTime(moving.start,dayCity(state,day).timezone).slice(11)}`,dayCity(state,day).timezone));
 if(matrix&&first&&(scheduleLocked(first,state)||first.category==='Meal'))start=Date.parse(first.start)-(moving.duration+travel(moving,first))*60000;
 if(previous)start=Math.max(start,Date.parse(previous.start)+(previous.duration+travel(previous,moving))*60000);
 let prior=previous;
 for(const item of sequence){
  if(prior)start=Math.max(start,Date.parse(prior.start)+(prior.duration+travel(prior,item))*60000);
  if(item.id!==itemId)start=Math.max(start,Date.parse(item.start));
  if(start!==Date.parse(item.start)&&(scheduleLocked(item,state)||matrix&&item.category==='Meal'&&item.id!==moving.id))throw Error(`There is not enough room before ${item.name}. Its confirmed time stays fixed.`);
  if(matrix&&!scheduleLocked(item,state)){const localTime=localDateTime(new Date(start).toISOString(),dayCity(state,day).timezone),minute=Number(localTime.slice(11,13))*60+Number(localTime.slice(14,16)),fresh=!item.detailsCheckedAt||Date.now()-Date.parse(item.detailsCheckedAt)<30*86400000,windows=fresh?listedWindows(item.openingHours,day):undefined;if(windows){const fit=[...windows].sort((a,b)=>a[0]-b[0]).find(([a,b])=>Math.max(a,minute)+item.duration<=b);if(!fit)throw Error('This visit does not fit the listed opening hours for '+item.name+'.');if(item.category==='Meal'&&item.id!==moving.id&&minute<fit[0])throw Error('The existing meal time stays fixed.');start+=Math.max(0,fit[0]-minute)*60000;}}
  const finish=start+item.duration*60000,local=localDateTime(new Date(start).toISOString(),dayCity(state,day).timezone),endDay=localDateTime(new Date(finish-1).toISOString(),dayCity(state,day).timezone).slice(0,10);
  if(local.slice(0,10)!==day||endDay!==day)throw Error('These activities do not fit in this day with travel time. Choose another day or position.');
  if(matrix&&actor){const pref=state.preferences[actor];if(pref&&!pref.publicOnly&&(pref.availableFrom&&local.slice(11)<pref.availableFrom||pref.availableTo&&localDateTime(new Date(finish).toISOString(),dayCity(state,day).timezone).slice(11)>pref.availableTo))throw Error('This move falls outside your daily availability.');}
  const next={...item,start:zonedStart(local,dayCity(state,day).timezone)};if(Date.parse(next.start)!==Date.parse(item.start))changes.push({itemId:item.id,start:next.start});prior=next;
 }
 return changes;
}
