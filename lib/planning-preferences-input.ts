import type {PlanningPreferences} from './planning-constraints.ts';
import {localDateTime,zonedStart} from './trip-time.ts';
import {parseTimeInput,validLocalDateTime} from './time-input.ts';

type Window=PlanningPreferences['availability'][number];
export type AvailabilityEdits=Record<number,Partial<Pick<Window,'start'|'end'>>>;

/** Keep incomplete keyboard input separate from the last persisted instants. */
export function availabilityInputWindows(windows:Window[],timezone:string,edits:AvailabilityEdits={}){
 const local=(value:string)=>{try{return value?localDateTime(value,timezone):'';}catch{return '';}};
 return windows.map((window,index)=>({...window,start:edits[index]?.start??local(window.start),end:edits[index]?.end??local(window.end)}));
}

export function parseAvailabilityInputWindows(windows:Window[],timezone:string):Window[]{
 if(windows.length>100)throw Error('Keep up to 100 availability windows.');
 try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('Enter a valid time zone before saving availability.');}
 function instant(value:string){
  const split=value.indexOf('T'),date=value.slice(0,split),time=split<0?null:parseTimeInput(value.slice(split+1));
  const local=`${date}T${time??''}`;
  if(!time||!validLocalDateTime(local,true))throw Error('Complete each availability window with a valid date and time.');
  return zonedStart(local,timezone);
 }
 return windows.map(window=>{
  if(!['available','unavailable'].includes(window.status))throw Error('Choose an availability status.');
  const start=instant(window.start),end=instant(window.end);
  if(Date.parse(end)<=Date.parse(start))throw Error('Availability must end after it starts.');
  return {...window,start,end};
 });
}
