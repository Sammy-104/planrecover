'use client';
import {useEffect,useState} from 'react';
import {localDateTime,zonedStart} from '@/lib/trip-time';
import type {PlanningPreferences} from '@/lib/planning-constraints';

async function request(path:string,method='GET',body?:unknown){
 const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const result=await response.json() as any;if(!response.ok)throw Error(result.error??'Your preferences could not be saved.');return result;
}
function localInput(value:string,timezone:string){try{return value?localDateTime(value,timezone).slice(0,16):'';}catch{return '';}}
export function PrivatePlanningPreferences({planId,initial,readOnly,onSaved}:{planId:string;initial:{preferences:PlanningPreferences;version:number};readOnly:boolean;onSaved:()=>Promise<unknown>}){
 const [preferences,setPreferences]=useState(initial.preferences),[diet,setDiet]=useState(initial.preferences.dietaryNeeds.join(', ')),[access,setAccess]=useState(initial.preferences.accessibilityNeeds.join(', ')),[lead,setLead]=useState(initial.preferences.leadMinutes.join(', '));
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const base=`/api/plans/${encodeURIComponent(planId)}/me`;
 useEffect(()=>{setPreferences(structuredClone(initial.preferences));setDiet(initial.preferences.dietaryNeeds.join(', '));setAccess(initial.preferences.accessibilityNeeds.join(', '));setLead(initial.preferences.leadMinutes.join(', '));setError('');setNotice('');},[planId,initial.version]);
 useEffect(()=>{let live=true;setEmail('');void request(base+'/notification-destinations').then(result=>{if(live)setEmail(result.destinations.find((entry:any)=>entry.channel==='email')?.destination??'');}).catch(()=>{});return()=>{live=false;};},[base]);
 async function save(){setBusy(true);setError('');setNotice('');try{
  const leadMinutes=lead.split(',').map(value=>value.trim()).filter(Boolean).map(Number);
  if(!leadMinutes.length||leadMinutes.some(value=>!Number.isInteger(value)||value<0||value>10080)||new Set(leadMinutes).size!==leadMinutes.length)throw Error('Enter distinct reminder lead times from 0 to 10080 minutes.');
  const split=(value:string)=>[...new Set(value.split(',').map(entry=>entry.trim()).filter(Boolean))];
  await request(base+'/planning-preferences','PATCH',{version:initial.version,preferences:{...preferences,dietaryNeeds:split(diet),accessibilityNeeds:split(access),leadMinutes}});
  await onSaved();setNotice('Your private planning preferences were saved.');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function changeWindow(index:number,key:'start'|'end',value:string){
  try{const instant=value?zonedStart(value,preferences.timezone):'';setPreferences({...preferences,availability:preferences.availability.map((window,i)=>i===index?{...window,[key]:instant}:window)});setError('');}catch(e){setError((e as Error).message);}
 }
 return <details className="panel"><summary>Your private availability and reminders</summary>
  {error&&<p role="alert" className="notice warning">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <fieldset disabled={readOnly||busy}><legend>Only you can see these preferences</legend>
   <label className="field"><span>Your timezone</span><input value={preferences.timezone} onChange={e=>setPreferences({...preferences,timezone:e.target.value})} placeholder="America/Toronto"/></label>
   <label className="field"><span>Dietary needs, separated by commas</span><input value={diet} onChange={e=>setDiet(e.target.value)}/></label>
   <label className="field"><span>Accessibility needs, separated by commas</span><input value={access} onChange={e=>setAccess(e.target.value)}/></label>
   <label className="field"><span>Travel buffer in minutes</span><input type="number" min="0" max="240" value={preferences.bufferMinutes} onChange={e=>setPreferences({...preferences,bufferMinutes:Number(e.target.value)})}/></label>
   <h3>Saved availability</h3><p>Available windows limit when you can participate. Unavailable windows block the times you choose. Times below use your timezone.</p>
   {preferences.availability.map((window,index)=><div className="availability-window" key={index}>
    <label className="field"><span>Window {index+1} status</span><select value={window.status} onChange={e=>setPreferences({...preferences,availability:preferences.availability.map((entry,i)=>i===index?{...entry,status:e.target.value as 'available'|'unavailable'}:entry)})}><option value="available">Available</option><option value="unavailable">Unavailable</option></select></label>
    <label className="field"><span>From</span><input type="datetime-local" value={localInput(window.start,preferences.timezone)} onChange={e=>changeWindow(index,'start',e.target.value)}/></label>
    <label className="field"><span>Until</span><input type="datetime-local" value={localInput(window.end,preferences.timezone)} onChange={e=>changeWindow(index,'end',e.target.value)}/></label>
    <button className="btn" type="button" onClick={()=>setPreferences({...preferences,availability:preferences.availability.filter((_,i)=>i!==index)})}>Remove window {index+1}</button>
   </div>)}
   {!preferences.availability.length&&<p>No windows saved. Your availability remains unknown.</p>}
   <button type="button" className="btn" disabled={preferences.availability.length>=100} onClick={()=>setPreferences({...preferences,availability:[...preferences.availability,{start:'',end:'',status:'available'}]})}>Add availability window</button>
   <label className="field"><span>Reminder lead times in minutes, separated by commas</span><input value={lead} onChange={e=>setLead(e.target.value)} placeholder="1440, 60, 0"/><small>0 means at the documented deadline. Maximum: seven days.</small></label>
   {(['inApp','email','push'] as const).map(channel=><label className="flows-choice" key={channel}><input type="checkbox" checked={preferences.delivery[channel]} onChange={e=>setPreferences({...preferences,delivery:{...preferences.delivery,[channel]:e.target.checked}})}/>{channel==='inApp'?'In-app reminders':`${channel==='email'?'Email':'Push'} reminders when a provider is configured`}</label>)}
   <button className="btn primary" onClick={()=>void save()}>{busy?'Saving…':'Save private preferences'}</button>
   <label className="field"><span>Your signed-in email for opted-in reminders</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <button className="btn" disabled={!email} onClick={async()=>{setBusy(true);setError('');try{const current=await request(base+'/notification-destinations'),entry=current.destinations.find((value:any)=>value.channel==='email');await request(base+'/notification-destinations','PATCH',{channel:'email',destination:email,version:entry?.version??0,confirm:true});setNotice('Email destination saved. Delivery also requires your opt-in and a configured provider.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Confirm my reminder email</button>
  </fieldset>
 </details>;
}
