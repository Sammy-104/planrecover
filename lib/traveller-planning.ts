import {personalMoney,planMembers,allocate,type State,type Preferences,type Suggestion} from './model.ts';
import {planCurrency} from './money.ts';
import {dayCity,itemDay} from './city-stays.ts';
import {localDateTime} from './trip-time.ts';
import {placeDistance} from './place-match.ts';
import {scheduleConnections,type TravelMode} from './schedule.ts';
import type {TravelLeg} from './travel-routes.ts';
export type PlanningStyle={pace:string;interests:string[];dietary?:string;mobility?:Preferences['mobility'];availableFrom?:string;availableTo?:string;travelBuffer?:number;queueMinutes?:number;restMinutes?:number;maxWalkMinutes?:number};
export function validatePlanningStyle(p:PlanningStyle){
 if(!p||!['relaxed','balanced','busy'].includes(p.pace)||!Array.isArray(p.interests)||p.interests.length>30||p.interests.some(i=>typeof i!=='string'||i.length>80))throw Error('Choose your pace and up to 30 interests.');
 const duration=(v:number|undefined,fallback:number,max:number,label:string)=>{const n=v??fallback;if(!Number.isInteger(n)||n<0||n>max)throw Error('Enter a valid '+label+'.');return n;};
 const clock=(v:string|undefined)=>{if(!v)return undefined;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw Error('Choose valid daily start and finish times.');return v;};
 const from=clock(p.availableFrom),to=clock(p.availableTo);if(from&&to&&from>=to)throw Error('Finish your planning day after it starts.');
 if(p.mobility!==undefined&&!['any','step-free','short-walks'].includes(p.mobility))throw Error('Choose a walking or access preference.');
 return {pace:p.pace,interests:[...new Set(p.interests.map(i=>i.trim()).filter(Boolean))],dietary:(p.dietary??'').trim().slice(0,160),mobility:p.mobility??'any',availableFrom:from,availableTo:to,travelBuffer:duration(p.travelBuffer,15,90,'travel buffer'),queueMinutes:duration(p.queueMinutes,0,120,'queue allowance'),restMinutes:duration(p.restMinutes,0,180,'rest allowance'),maxWalkMinutes:duration(p.maxWalkMinutes,20,180,'walking limit')};
}
export function recommendationReasons(place:Suggestion,pref:Preferences|undefined,point?:{latitude?:number;longitude?:number}){
 const personal=pref&&!pref.publicOnly?pref:undefined,text=[place.name,place.reason,...place.tags??[]].join(' ').toLowerCase(),reasons:string[]=[];
 const interests=(personal?.interests??[]).filter(i=>text.includes(i.toLowerCase()));if(interests.length)reasons.push('Matches '+interests.slice(0,2).join(' & '));
 if(place.price===0||place.admission==='free')reasons.push('No entry fee listed');if(place.indoor===true)reasons.push('Indoor option');
 const distance=point?placeDistance(point,place):undefined;if(distance!==undefined&&distance<=3)reasons.push(`${distance.toFixed(1)} km from your search origin · straight-line`);
 if(personal?.mobility==='step-free')reasons.push(place.stepFree===true?'Step-free access listed':place.stepFree===false?'Source reports access barriers':'Step-free access needs checking');
 if(personal?.dietary&&place.category==='Meal')reasons.push('Check your dietary requirements with the venue');
 return reasons.slice(0,4);
}
const minute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
export function dayReality(state:State,day:string,actor:string,routes:Pick<TravelLeg,'from'|'to'|'minutes'>[]=[],mode:TravelMode=state.plan.scheduleTravelMode??'walk'){
 const pref=state.preferences[actor],privatePref=pref&&!pref.publicOnly?pref:undefined,personal=planMembers(state).some(p=>p.id===actor&&!['viewer','legacy'].includes(p.role));
 const items=state.items.filter(i=>!i.financialOnly&&i.status!=='cancelled'&&i.category!=='Preparation'&&itemDay(i,state.plan.timezone)===day&&(!personal||i.participants.includes(actor))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const connections=scheduleConnections({...state,items},day,mode).filter(c=>c.shared),buffer=privatePref?.travelBuffer??15,queue=(privatePref?.queueMinutes??0)*items.filter(i=>i.category==='Activity').length,rest=privatePref?.restMinutes??0;
 const travel=mode==='transit'?undefined:connections.reduce((n,c)=>n+(routes.find(r=>r.from===c.previous.id&&r.to===c.item.id)?.minutes??c.travel.minutes),0),routed=connections.filter(c=>routes.some(r=>r.from===c.previous.id&&r.to===c.item.id)).length;
 const visit=items.reduce((n,i)=>n+i.duration,0),allowance=queue+rest+connections.length*buffer,total=visit+(travel??0)+allowance,pace=privatePref?.pace??'balanced',cap=pace==='relaxed'?300:pace==='busy'?660:480,warnings:string[]=[];
 for(const c of connections){const duration=mode==='transit'?undefined:routes.find(r=>r.from===c.previous.id&&r.to===c.item.id)?.minutes??c.travel.minutes;if(c.overlap)warnings.push(c.previous.name+' overlaps '+c.item.name+'.');else if(duration!==undefined&&c.gap<duration+buffer)warnings.push('Allow more time between '+c.previous.name+' and '+c.item.name+'.');if(mode==='walk'&&duration!==undefined&&privatePref?.mobility==='short-walks'&&duration>(privatePref.maxWalkMinutes??20))warnings.push('The walk to '+c.item.name+' exceeds your walking limit.');}
 const zone=dayCity(state,day).timezone,first=items[0]?minute(localDateTime(items[0].start,items[0].timezone??zone).slice(11)):undefined,last=items.at(-1),finish=last?minute(localDateTime(new Date(Date.parse(last.start)+last.duration*60000).toISOString(),last.timezone??zone).slice(11)):undefined;
 const spans=(a:number,b:number)=>first!==undefined&&finish!==undefined&&first<a&&finish>b;
 const breakIn=(a:number,b:number)=>items.some(i=>['Meal','Buffer'].includes(i.category)&&minute(localDateTime(i.start,i.timezone??zone).slice(11))<b&&minute(localDateTime(i.start,i.timezone??zone).slice(11))+i.duration>a);
 if(spans(12*60,14*60)&&!breakIn(11*60,15*60))warnings.push('No lunch or rest stop is marked during this long day.');
 if(spans(18*60,20*60)&&!breakIn(17*60,21*60))warnings.push('Leave room for dinner.');
 if(first!==undefined&&privatePref?.availableFrom&&first<minute(privatePref.availableFrom)||finish!==undefined&&privatePref?.availableTo&&finish>minute(privatePref.availableTo))warnings.push('Some stops are outside your preferred daily hours.');
 if(total>cap)warnings.push('Visits, travel and your allowances exceed your '+pace+' daily target.');
 if(state.plan.stays?.some((stay,index,stays)=>index>0&&stay.start===day&&stays[index-1].city.id!==stay.city.id))warnings.push('Check city-transfer travel and hotel arrival. Transfer time is counted only when saved as an itinerary stop.');
 const label=!items.length?'Open day':total>cap||warnings.some(w=>w.includes('overlap'))?'Packed':total<=cap*.65?'Relaxed':'Balanced';
 return {items:items.length,personal,visit,travel,allowance,queue,rest,buffer,total,cap,label,warnings:[...new Set(warnings)],routed,connections:connections.length,estimated:mode==='transit'||routed<connections.length};
}
export type CostAllowance={id:string;label:string;amount:number|null;participants:string[]};
export type PlanningCosts={currency:string;entries:CostAllowance[]};
export function validatePlanningCosts(value:PlanningCosts,state:State):PlanningCosts{
 if(!value||value.currency!==planCurrency(state.plan)||!Array.isArray(value.entries)||value.entries.length>20)throw Error('Review allowances in this plan’s currency, up to 20 entries.');
 const ids=planMembers(state).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id);let total=0;
 const entries=value.entries.map(e=>{if(!e||typeof e.id!=='string'||!e.id||e.id.length>100||typeof e.label!=='string'||!e.label.trim()||e.label.length>100||e.amount!==null&&(!Number.isSafeInteger(e.amount)||e.amount<0||e.amount>1e12)||!Array.isArray(e.participants)||!e.participants.length||new Set(e.participants).size!==e.participants.length||e.participants.some(id=>!ids.includes(id)))throw Error('Use a name, a valid amount or Unknown, and current participants for each allowance.');total+=e.amount??0;return {id:e.id,label:e.label.trim(),amount:e.amount,participants:e.participants};});
 if(!Number.isSafeInteger(total)||total>1e12||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('Review the allowance totals and distinct entries.');return {currency:value.currency,entries};
}
export function costOutlook(state:State,actor:string){
 const people=planMembers(state),known=people.reduce((n,p)=>n+personalMoney(state,p.id).projected,0),recorded=people.reduce((n,p)=>n+personalMoney(state,p.id).cost,0),paid=people.reduce((n,p)=>n+personalMoney(state,p.id).contribution,0),valid=state.plan.planningCosts?.currency===planCurrency(state.plan),entries=valid?state.plan.planningCosts!.entries:[];
 const extra=entries.reduce((n,e)=>n+(e.amount??0),0),mine=entries.reduce((n,e)=>n+(e.amount===null?0:allocate(e.amount,e.participants,'equal',{},people.map(p=>p.id))[actor]??0),0),unknownItems=state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&!['Preparation','Buffer'].includes(i.category)&&i.price===null),unknown=unknownItems.length+entries.filter(e=>e.amount===null).length;
 return {known,recorded,paid,extra,total:known+extra,yours:personalMoney(state,actor).projected+mine,allowanceShare:mine,unknown,unknownItems,currencyReview:!!state.plan.planningCosts&&!valid,entries};
}
