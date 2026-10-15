import {dollars,type State} from './model.ts';
import {itineraryStops,validPoint} from './itinerary-map.ts';
import {stopDay} from './map-planning.ts';
export const calendarText=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r\n|\n|\r/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
function foldLine(line:string){let result='',current='',bytes=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(bytes+size>75){result+=current+'\r\n';current=' ';bytes=1;}current+=char;bytes+=size;}return result+current;}
const stamp=(value:string|number)=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function calendarExport(state:State,now=new Date().toISOString()){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PlanRecover//Plans//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${calendarText(state.plan.name)}`];
 for(const item of state.items.filter(i=>i.status!=='cancelled').sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))){
  const description=[`${state.plan.name} · ${item.category}`,item.status==='draft'?'Draft; group review required.':'Planned activity.', 'Calendar copy only; this export does not make a reservation.',item.price===null?'Cost unknown':`${dollars(item.price,state.plan.currency)} planned group total`,item.openingHours?`Listed hours: ${item.openingHours}. Check before visiting.`:'',item.officialWebsite??''].filter(Boolean).join('\n');
  lines.push('BEGIN:VEVENT',`UID:${`${state.plan.id}-${item.id}`.replace(/[^A-Za-z0-9._-]/g,'_')}@planrecover`, `DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(item.start)}`,`DTEND:${stamp(Date.parse(item.start)+item.duration*60000)}`,`SEQUENCE:${item.revision}`,`SUMMARY:${calendarText(item.name)}`,`DESCRIPTION:${calendarText(description)}`,`LOCATION:${calendarText(item.address??item.location)}`,`STATUS:${item.status==='draft'?'TENTATIVE':'CONFIRMED'}`);
  if(validPoint(item))lines.push(`GEO:${item.latitude};${item.longitude}`);lines.push('END:VEVENT');
 }lines.push('END:VCALENDAR');return lines.map(foldLine).join('\r\n')+'\r\n';
}
export type OfflinePlan={id:string;name:string;destination:string;timezone:string;start:string;end:string;savedAt:string;stops:{number:number;name:string;day:string;time:string;duration:number;location:string;cost:string;status:string;hours?:string;website?:string;latitude?:number;longitude?:number}[];tasks:{name:string;due:string;done:boolean}[]};
export function offlinePlan(state:State):OfflinePlan{
 const format=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:state.plan.timezone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
 return {id:state.plan.id!,name:state.plan.name,destination:state.plan.destination,timezone:state.plan.timezone,start:state.plan.start,end:state.plan.end,savedAt:new Date().toISOString(),stops:itineraryStops(state).map(({item,number})=>({number,name:item.name,day:stopDay(item,state.plan.timezone),time:format(item.start),duration:item.duration,location:item.address??item.location,cost:item.price===null?'Cost unknown':item.price===0?'Free':`${dollars(item.price,state.plan.currency)} group estimate`,status:item.status==='draft'?'Draft · group review needed':'Planned',hours:item.openingHours,website:item.officialWebsite,...(validPoint(item)?{latitude:item.latitude,longitude:item.longitude}:{})})),tasks:state.items.filter(i=>i.category==='Preparation'&&i.status!=='cancelled').map(i=>({name:i.name,due:new Intl.DateTimeFormat('en-CA',{timeZone:state.plan.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(i.start)),done:!!i.done}))};
}
export function exportFilename(name:string){return name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,90)||'plan';}
