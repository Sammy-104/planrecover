import {dayCity} from './city-stays.ts';
import type {State,Item} from './model.ts';
import {scheduleLocked,dayItems,travelEstimate,type TravelMode} from './schedule.ts';
import {validPoint} from './itinerary-map.ts';
import {localDateTime} from './trip-time.ts';
import {listedWindows} from './opening-hours.ts';
import {routedMinutes,matrixFingerprint,type TravelMatrix} from './route-matrix.ts';

export type OrderPreview={day:string;mode:TravelMode;fingerprint:string;changes:{itemId:string;start:string}[];before:string[];after:string[];beforeTravel:number|null;afterTravel:number|null;savedMinutes:number;basis:'route'|'estimate';checkedAt?:string;bufferMinutes:number;warnings:string[]};
export function orderFingerprint(state:State,day:string,actor?:string){return JSON.stringify([state.plan.id,dayCity(state,day).timezone,day,...(state.plan.stays?.length?[state.plan.stays]:[]),actor?{id:actor,from:state.preferences[actor]?.availableFrom,until:state.preferences[actor]?.availableTo}:null,dayItems(state,day).map(i=>[i.id,i.category,i.start,i.duration,i.revision,i.latitude,i.longitude,i.status,i.booking,i.paid,i.participants,i.openingHours,i.detailsCheckedAt,i.depends,i.externalBooking]),state.events.filter(e=>dayItems(state,day).some(i=>i.id===e.itemId))]);}
const travel=(a:Item,b:Item,mode:TravelMode,matrix?:TravelMatrix)=>matrix?routedMinutes(matrix,a,b,mode):travelEstimate(a,b,mode).minutes;
function cost(items:Item[],mode:TravelMode,matrix?:TravelMatrix){try{return items.slice(1).reduce((n,i,index)=>n+travel(items[index],i,mode,matrix),0);}catch{return Infinity;}}
function orders(items:Item[],previous:Item|undefined,next:Item|undefined,mode:TravelMode,matrix?:TravelMatrix){
 const total=(order:Item[])=>cost([...(previous?[previous]:[]),...order,...(next?[next]:[])],mode,matrix),distance=(a:Item,b:Item)=>{try{return travel(a,b,mode,matrix);}catch{return Infinity;}},candidates=[items];
 for(const seed of items.slice(0,8)){const left=items.filter(i=>i.id!==seed.id),order=[seed];while(left.length){left.sort((a,b)=>distance(order.at(-1)!,a)-distance(order.at(-1)!,b)||a.id.localeCompare(b.id));order.push(left.shift()!);}candidates.push(order);}
 let best=candidates.sort((a,b)=>total(a)-total(b))[0];for(let pass=0;pass<8;pass++){let improved=false;for(let a=0;a<best.length-1;a++)for(let b=a+1;b<best.length;b++){const candidate=[...best.slice(0,a),...best.slice(a,b+1).reverse(),...best.slice(b+1)];if(total(candidate)<total(best)){best=candidate;improved=true;}}if(!improved)break;}return [items,best,...candidates].sort((a,b)=>total(a)-total(b));
}
function reflow(state:State,day:string,order:Item[],previous:Item|undefined,next:Item|undefined,firstStart:number,mode:TravelMode,actor?:string,matrix?:TravelMatrix){
 let cursor=firstStart,prior=previous;const result:Item[]=[];
 try{for(const item of order){if(prior)cursor=Math.max(cursor,Date.parse(prior.start)+(prior.duration+travel(prior,item,mode,matrix)+10)*60000);let local=localDateTime(new Date(cursor).toISOString(),dayCity(state,day).timezone),minute=Number(local.slice(11,13))*60+Number(local.slice(14,16));
  const fresh=!item.detailsCheckedAt||Date.now()-Date.parse(item.detailsCheckedAt)<30*86400000,windows=fresh?listedWindows(item.openingHours,day):undefined;if(windows){const fit=[...windows].sort((a,b)=>a[0]-b[0]).find(([start,end])=>Math.max(start,minute)+item.duration<=end);if(!fit)return;cursor+=Math.max(0,fit[0]-minute)*60000;local=localDateTime(new Date(cursor).toISOString(),dayCity(state,day).timezone);}
  const finish=cursor+item.duration*60000,pref=actor?state.preferences[actor]:undefined,localFinish=localDateTime(new Date(finish).toISOString(),dayCity(state,day).timezone).slice(11),localStart=local.slice(11);if(pref&&!pref.publicOnly&&(pref.availableFrom&&localStart<pref.availableFrom||pref.availableTo&&localFinish>pref.availableTo))return;if(local.slice(0,10)!==day||localDateTime(new Date(finish-1).toISOString(),dayCity(state,day).timezone).slice(0,10)!==day)return;const moved={...item,start:new Date(cursor).toISOString()};result.push(moved);prior=moved;cursor=finish;
 }if(next&&prior&&cursor+(travel(prior,next,mode,matrix)+10)*60000>Date.parse(next.start))return;return result;}catch{return undefined;}
}
export function optimizeDay(state:State,day:string,mode:TravelMode='walk',actor?:string,matrix?:TravelMatrix):OrderPreview{
 if(!['walk','drive'].includes(mode))throw Error('Walking and driving support order suggestions. Check transit timetables separately.');if(matrix&&matrix.mode!==mode)throw Error('Travel mode changed. Check fresh routes.');
 const items=dayItems(state,day).filter(i=>i.status!=='cancelled'&&i.category!=='Preparation'),warnings:string[]=[];if(items.length>40)throw Error('Order suggestions support up to 40 stops per day.');
 const fixed=(item:Item)=>scheduleLocked(item,state)||item.category==='Meal'||!validPoint(item);
 const resulting:Item[]=[];let i=0;
 while(i<items.length){if(fixed(items[i])){resulting.push(items[i++]);continue;}const start=i;while(i<items.length&&!fixed(items[i]))i++;const block=items.slice(start,i),previous=resulting.at(-1),next=items[i];
  const participantKey=[...block[0].participants].sort().join('|');if(block.some(item=>[...item.participants].sort().join('|')!==participantKey)){warnings.push('Stops with different participant groups keep their current order.');resulting.push(...block);continue;}
  const choices=orders(block,previous,next,mode,matrix),base=cost([...(previous?[previous]:[]),...block,...(next?[next]:[])],mode,matrix);let chosen:Item[]|undefined;
  for(const order of choices){const value=cost([...(previous?[previous]:[]),...order,...(next?[next]:[])],mode,matrix);if(!Number.isFinite(value)||value>base)continue;const same=order.every((item,n)=>item.id===block[n].id);if(same&&!matrix)continue;const moved=reflow(state,day,order,previous,next,Date.parse(block[0].start),mode,actor,matrix);if(moved){chosen=moved;break;}}
  resulting.push(...(chosen??block));
 }
 const changes=resulting.filter(item=>Date.parse(item.start)!==Date.parse(items.find(i=>i.id===item.id)!.start)).map(item=>({itemId:item.id,start:item.start})),before=cost(items,mode,matrix),after=cost(resulting,mode,matrix),beforeTravel=Number.isFinite(before)?before:null,afterTravel=Number.isFinite(after)?after:null,savedMinutes=beforeTravel!==null&&afterTravel!==null?Math.max(0,beforeTravel-afterTravel):0;
 for(const item of resulting){if(item.detailsCheckedAt&&Date.now()-Date.parse(item.detailsCheckedAt)<30*86400000){const windows=listedWindows(item.openingHours,day),local=localDateTime(item.start,dayCity(state,day).timezone),minute=Number(local.slice(11,13))*60+Number(local.slice(14,16));if(windows&&!windows.some(([a,b])=>minute>=a&&minute+item.duration<=b))warnings.push('The listed hours do not fit '+item.name+'. Its current time needs review.');}}
 if(matrix)for(let n=1;n<resulting.length;n++){try{if(Date.parse(resulting[n-1].start)+(resulting[n-1].duration+travel(resulting[n-1],resulting[n],mode,matrix)+10)*60000>Date.parse(resulting[n].start))warnings.push('There is still not enough travel time before '+resulting[n].name+'. Fixed times or available hours need review.');}catch{warnings.push('No continuous mapped route connects all stops. Choose different places or a different travel mode.');}}
 if(items.some(item=>!validPoint(item)))warnings.push('Some activity locations are unconfirmed. They stay in place.');if(resulting.some(i=>!i.openingHours||!i.detailsCheckedAt||Date.now()-Date.parse(i.detailsCheckedAt)>30*86400000))warnings.push('Some opening hours are unconfirmed. Check them before accepting.');
 if(items.some(i=>i.category==='Meal'))warnings.push('Existing meals keep their scheduled times, so time to eat is preserved.');else warnings.push('No meal stop is planned. Add a meal or leave time to eat when reviewing your day.');
 warnings.push(matrix?'Times follow mapped roads and paths. A 10-minute buffer is left between moved stops. Live traffic, parking queues and transit timetables are not included.':'Fictional or offline preview: rough travel estimates, with 10-minute gaps. Fixed, paid, confirmed and linked bookings stay in place.');
 return {day,mode,fingerprint:orderFingerprint(state,day,actor)+(matrix?matrixFingerprint(matrix):''),changes,before:items.map(i=>i.id),after:resulting.map(i=>i.id),beforeTravel,afterTravel,savedMinutes,basis:matrix?'route':'estimate',checkedAt:matrix?.checkedAt,bufferMinutes:10,warnings:[...new Set(warnings)]};
}
