import {cityRoadLegs} from './road-trip.ts';
import {dayCity,itemDay,visitCity} from './city-stays.ts';
import {cityKey} from './cities.ts';
import {allocate,personalMoney,type State,type Suggestion,type Item} from './model.ts';
import {localDateTime,zonedStart} from './trip-time.ts';
import {travelEstimate,type TravelMode} from './schedule.ts';
import {validPoint} from './itinerary-map.ts';
import type {TravelLeg} from './travel-routes.ts';
import {cashLimit,limitsNeedReview} from './privacy.ts';
import {planCurrency} from './money.ts';
import {freshPlaceInfo} from './place-info.ts';

import {listedWindows} from './opening-hours.ts';
export {listedWindows} from './opening-hours.ts';
import {matrixMinutes,type TravelMatrix} from './route-matrix.ts';
export type PlanningOptions={actor:string;participants:string[];day:string;start?:string;duration?:number;buffer?:number;mode?:TravelMode;routes?:Pick<TravelLeg,'from'|'to'|'minutes'>[];matrix?:TravelMatrix;price?:number|null;extraCost?:number|null};
export type InsertionEvaluation={start:string;duration:number;buffer:number;mode:TravelMode;travelIn:number;travelOut:number;travelStatus:'route'|'estimate'|'unknown'|'not-needed';previousId?:string;nextId?:string;conflict:string|null;hours:'fits'|'closed'|'unknown';status:'fits'|'check'|'blocked';issues:string[];reasons:string[];total:number|null;shares:Record<string,number>;yourShare?:number;projected?:number;budgetRemaining?:number;overBudget:boolean;overCash:boolean;score:number};
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
export function adjacentStops(state:State,c:Suggestion,start:string,duration:number,ids:string[]){
 const begin=Date.parse(start),finish=begin+duration*60000;
 const items=state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&i.participants.some(id=>ids.includes(id))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 return {previous:items.filter(i=>Date.parse(i.start)+i.duration*60000<=begin&&itemDay(i,state.plan.timezone)===localDateTime(start,c.timezone??state.plan.timezone).slice(0,10)).at(-1),next:items.find(i=>Date.parse(i.start)>=finish&&itemDay(i,state.plan.timezone)===localDateTime(start,c.timezone??state.plan.timezone).slice(0,10)),items};
}
export function evaluateInsertion(state:State,c:Suggestion,options:PlanningOptions):InsertionEvaluation{
 const {actor,participants:ids,day}=options,zone=c.timezone??dayCity(state,day).timezone,pref=state.preferences[actor],privatePref=pref&&!pref.publicOnly?pref:undefined;
 const context=visitCity(state,day,c.cityKey);
 const duration=options.duration??c.duration,buffer=options.buffer??(c.flexible?Math.min(180,(privatePref?.travelBuffer??15)+(c.category==='Activity'?privatePref?.queueMinutes??0:0)):c.buffer),mode=options.mode??state.plan.scheduleTravelMode??'walk';
 const start=options.start??c.start,begin=Date.parse(start),finish=begin+duration*60000,local=localDateTime(start,zone),localEnd=localDateTime(new Date(finish).toISOString(),zone),issues:string[]=[],reasons:string[]=[];
 if(!Number.isFinite(begin)||!Number.isInteger(duration)||duration<1||duration>1440||!Number.isInteger(buffer)||buffer<0||buffer>180)throw Error('Choose a valid time, duration and buffer.');
 if(c.routeLegId){const leg=cityRoadLegs(state).find(l=>l.id===c.routeLegId);if(!leg||day<leg.departureDay||day>leg.day)issues.push('Choose a visit during this city transfer.');}
 if(c.cityKey&&c.cityKey!==cityKey(context.destination))issues.push('Choose a visit on a day in this city stay.');
 if(local.slice(0,10)!==day||day<state.plan.start||day>state.plan.end||localEnd.slice(0,10)!==day)issues.push('Choose a visit that finishes within this plan day.');
 const {previous,next,items}=adjacentStops(state,c,start,duration,ids),place={...c,start,duration} as unknown as Item;
 const travel:{status:InsertionEvaluation['travelStatus']}={status:'not-needed'};
 function leg(a:Item,b:Item,fallback:number){if(options.matrix){const value=matrixMinutes(options.matrix,a,b,mode);if(value===null){issues.push('No mapped route connects these activities.');travel.status='unknown';return 1440;}if(value!==undefined){if(travel.status==='not-needed')travel.status='route';return value;}}const route=options.routes?.find(r=>r.from===a.id&&r.to===b.id);if(route){if(travel.status==='not-needed')travel.status='route';return route.minutes;}if(!c.flexible){travel.status='estimate';return fallback;}if(mode==='transit'||!validPoint(a)||!validPoint(b)){travel.status='unknown';return 15;}if(travel.status!=='unknown')travel.status='estimate';return travelEstimate(a,b,mode).minutes;}
 const travelIn=previous?leg(previous,place,c.travelIn):c.flexible?0:c.travelIn,travelOut=next?leg(place,next,c.travelOut):c.flexible?0:c.travelOut;
 let conflict=items.find(i=>begin<Date.parse(i.start)+i.duration*60000&&finish>Date.parse(i.start))?.name??null;
 if(previous&&begin<Date.parse(previous.start)+(previous.duration+travelIn)*60000)conflict=`Travel from ${previous.name}`;
 if(next&&finish+(travelOut+buffer)*60000>Date.parse(next.start))conflict=`Travel and buffer before ${next.name}`;
 if(conflict)issues.push(`Not enough room: ${conflict}.`);
 const windows=freshPlaceInfo(c)?listedWindows(c.openingHours,day):undefined,startMinute=minutes(local.slice(11)),endMinute=startMinute+duration;
 let hours:InsertionEvaluation['hours']=windows===undefined?'unknown':windows.some(([a,b])=>startMinute>=a&&endMinute<=b)?'fits':'closed';
 if(hours==='closed')issues.push('This visit is outside the listed opening hours.');
 if(privatePref?.availableFrom&&startMinute<minutes(privatePref.availableFrom)||privatePref?.availableTo&&endMinute+buffer>minutes(privatePref.availableTo))issues.push('Outside your preferred daily availability.');
 const text=`${c.name} ${c.reason} ${(c.tags??[]).join(' ')}`.toLowerCase(),interests=(privatePref?.interests??[]).filter(interest=>text.includes(interest.toLowerCase()));
 if(interests.length)reasons.push(`Matches your interest in ${interests.join(', ')}.`);
 if(c.price===0)reasons.push('No admission spending added.');
 const booked=items.filter(i=>localDateTime(i.start,zone).slice(0,10)===day).reduce((total,i)=>total+i.duration,0),pace=privatePref?.pace??'balanced',paceCap=pace==='relaxed'?240:pace==='busy'?720:420;
 if(booked+duration>paceCap)issues.push(`This would make the day busier than your ${pace} pace.`);
 if(privatePref?.mobility==='step-free'&&c.stepFree===false)issues.push('The source lists this place as unsuitable for step-free access.');
 if(privatePref?.mobility==='short-walks'&&mode==='walk'&&Math.max(travelIn,travelOut)>(privatePref.maxWalkMinutes??20))issues.push('Walking is longer than your short-walk preference.');
 const price=options.price===undefined?c.price:options.price,total=price===null?null:price+(options.extraCost??0),shares=total===null?{}:allocate(total,ids,'equal',{},state.people?.map(p=>p.id)??Object.keys(state.preferences));
 const review=limitsNeedReview(privatePref,planCurrency(state.plan)),limit=cashLimit(privatePref,planCurrency(state.plan)),yourShare=ids.includes(actor)&&total!==null?shares[actor]:undefined,projected=yourShare===undefined?undefined:personalMoney(state,actor).projected+yourShare,overBudget=!!privatePref&&!review&&projected!==undefined&&projected>privatePref.budget,overCash=limit!==undefined&&yourShare!==undefined&&yourShare>limit;
 if(review)issues.push('The plan currency changed; update your private limits in Settings.');if(overBudget)issues.push('Above your private total budget.');if(overCash)issues.push('Above your private cash limit if paid upfront.');
 const hardBlocked=!!conflict||hours==='closed'||issues.some(issue=>issue.startsWith('Choose a visit')||issue.startsWith('Outside your')||issue.includes('unsuitable')||issue.startsWith('Walking is')||issue.startsWith('No mapped route'));
 if(!conflict)reasons.push(`${duration} min visit${travelIn+travelOut?` + ${travelIn+travelOut} min travel`:''} + ${buffer} min buffer.`);
 if(hours==='fits')reasons.push('Fits the listed weekly hours.');
 if(hours==='unknown')issues.push('Opening hours need checking.');
 if(travel.status!=='route'&&travel.status!=='not-needed')issues.push(travel.status==='estimate'?'Travel uses rough estimates; verify the route.':'Travel is unconfirmed; check locations or transit times.');
 if(total===null)issues.push('Admission cost is unknown.');
 if(mode!=='walk'&&options.extraCost==null)issues.push('Transport, parking or supply costs are not included.');
 if(privatePref?.dietary&&c.category==='Meal')issues.push(`Check your dietary needs: ${privatePref.dietary}.`);
 if(privatePref?.mobility==='step-free'&&c.stepFree!==true)issues.push('Step-free access needs checking.');
 const status:InsertionEvaluation['status']=hardBlocked?'blocked':issues.length?'check':'fits';
 return {start,duration,buffer,mode,travelIn,travelOut,travelStatus:travel.status,previousId:previous?.id,nextId:next?.id,conflict,hours,status,issues,reasons,total,shares,yourShare,projected,budgetRemaining:privatePref&&!review&&projected!==undefined?privatePref.budget-projected:undefined,overBudget,overCash,score:(hardBlocked?-1000:0)+(status==='fits'?100:0)+interests.length*30+(total===0?15:0)-(travelIn+travelOut)/3-(overBudget||overCash?100:0)};
}
export function bestSuggestionSlot(state:State,c:Suggestion,actor:string,day:string,matrix?:TravelMatrix){
 const ids=c.suggestedParticipants??(state.people?.filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id)??Object.keys(state.preferences));
 if(!c.flexible)return {...c,evaluation:evaluateInsertion(state,c,{actor,participants:ids,day:localDateTime(c.start,c.timezone??state.plan.timezone).slice(0,10),matrix,mode:matrix?.mode})};
 const pref=state.preferences[actor],startMinute=pref?.availableFrom?minutes(pref.availableFrom):pref?.pace==='relaxed'?600:540,endMinute=pref?.availableTo?minutes(pref.availableTo):1200;
 const visitBuffer=Math.min(180,(pref?.travelBuffer??15)+(c.category==='Activity'?pref?.queueMinutes??0:0));
 const dayItems=state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&i.participants.some(id=>ids.includes(id))&&itemDay(i,state.plan.timezone)===day).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const candidates=new Set<number>([startMinute]);for(const item of dayItems){const end=Date.parse(item.start)+item.duration*60000,rough=matrix?matrixMinutes(matrix,item,c,matrix.mode):travelEstimate(item,c as unknown as Item,state.plan.scheduleTravelMode??'walk').minutes;if(rough!==null&&rough!==undefined)candidates.add(minutes(localDateTime(new Date(end).toISOString(),c.timezone??dayCity(state,day).timezone).slice(11))+rough+visitBuffer);}
 for(const [a] of (freshPlaceInfo(c)?listedWindows(c.openingHours,day):undefined)??[])if(a>=startMinute&&a<endMinute)candidates.add(a);
 let best:InsertionEvaluation|undefined;
 for(const minute of [...candidates].filter(m=>m>=startMinute&&m+c.duration+visitBuffer<=endMinute).sort((a,b)=>a-b)){const time=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,start=zonedStart(`${day}T${time}`,c.timezone??dayCity(state,day).timezone),evaluation=evaluateInsertion(state,{...c,start},{actor,participants:ids,day,start,matrix,mode:matrix?.mode});if(!best||evaluation.score>best.score)best=evaluation;}
 best??=evaluateInsertion(state,c,{actor,participants:ids,day,start:zonedStart(`${day}T10:00`,c.timezone??dayCity(state,day).timezone),matrix,mode:matrix?.mode});
 return {...c,start:best.start,travelIn:best.travelIn,travelOut:best.travelOut,buffer:best.buffer,evaluation:best};
}
export function personalizedSuggestions(state:State,catalog:Suggestion[],actor:string,day:string,matrix?:TravelMatrix){
 const interests=state.preferences[actor]?.interests??[],pool=catalog.filter(c=>!state.dismissed.includes(c.id)&&!state.muted.includes(c.category)&&!state.items.some(i=>i.status!=='cancelled'&&i.name===c.name));
 pool.sort((a,b)=>interests.filter(i=>`${b.name} ${(b.tags??[]).join(' ')}`.toLowerCase().includes(i.toLowerCase())).length-interests.filter(i=>`${a.name} ${(a.tags??[]).join(' ')}`.toLowerCase().includes(i.toLowerCase())).length);
 return pool.slice(0,60).map(c=>bestSuggestionSlot(state,c,actor,day,matrix)).filter(c=>c.evaluation.status!=='blocked').sort((a,b)=>b.evaluation.score-a.evaluation.score).slice(0,5);
}
