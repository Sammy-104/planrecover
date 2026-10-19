import {getPlanReminders} from './reminders.ts';
import {calendarText} from './plan-export.ts';
import type {State} from './model.ts';
const stamp=(v:string)=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function reminderCalendar(state:State,actor?:string,now=new Date().toISOString()){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PlanRecover//Reminders//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${calendarText(state.plan.name+' reminders')}`];
 for(const r of getPlanReminders(state,actor).filter(r=>!r.done)){
  lines.push('BEGIN:VEVENT',`UID:${`${state.plan.id}-${r.id}-${actor??'shared'}`.replace(/[^A-Za-z0-9._-]/g,'_')}@planrecover`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(r.due)}`,`DTEND:${stamp(new Date(Date.parse(r.due)+60000).toISOString())}`,`SUMMARY:${calendarText(r.title)}`,`DESCRIPTION:${calendarText(`${state.plan.name}\n${r.consequence}\nCalendar snapshot; export again after changes.`)}`,'BEGIN:VALARM','ACTION:DISPLAY',`TRIGGER:${r.leadMinutes?`-PT${r.leadMinutes}M`:'PT0M'}`,`DESCRIPTION:${calendarText(r.title)}`,'END:VALARM','END:VEVENT');
 }lines.push('END:VCALENDAR');return lines.map(line=>{let out='',part='',bytes=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(bytes+size>75){out+=part+'\r\n';part=' ';bytes=1;}part+=char;bytes+=size;}return out+part;}).join('\r\n')+'\r\n';
}
