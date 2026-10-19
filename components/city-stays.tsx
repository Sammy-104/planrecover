'use client';
import {useState} from 'react';
import {MapPin,Plus,Trash2,ArrowRight} from 'lucide-react';
import {CityInput} from './city-input';
import {DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from './ui/dialog';
import {dayCity,validateCityStays,type CityStay} from '@/lib/city-stays';
import {destinationSettings} from '@/lib/localization';
import type {State} from '@/lib/model';

export type CityStayDraft=Omit<CityStay,'city'> & {city?:CityStay['city'];query:string};
export function firstStayDraft(plan:State['plan']):CityStayDraft{return {id:crypto.randomUUID(),city:plan.city,query:plan.destination,start:plan.start,end:plan.end,timezone:plan.timezone,kind:'stay',note:''};}
export function routeNames(plan:State['plan']){return plan.stays?.length?plan.stays.map(s=>s.city.name):[plan.city?.name??plan.destination];}
export function JourneySummary({state,day,onEdit,canEdit}:{state:State;day:string;onEdit:()=>void;canEdit:boolean}){
 const stays=state.plan.stays??[],context=dayCity(state,day);
 return <section className="journey-strip" aria-label="City stays"><div><MapPin size={19}/><span><strong>{stays.length?'Your route':'One city or a whole journey'}</strong><small>{stays.length?`${context.destination} · ${day}`:'Keep all your city stays in this plan.'}</small></span></div>{stays.length>0&&<ol>{stays.map((stay,i)=><li key={stay.id} className={context.id===stay.id?'current':''}>{i>0&&<ArrowRight size={14}/>}<span>{stay.city.name}<small>{stay.start.slice(5)}–{stay.end.slice(5)}{stay.kind==='overnight'?' · Overnight':''}</small></span></li>)}</ol>}{canEdit&&<button className="btn small-btn" onClick={onEdit}>{stays.length?'Edit city stays':'Add city stays'}</button>}</section>;
}
export function CityStayFields({rows,onChange,start,end,firstLabel}:{rows:CityStayDraft[];onChange:(rows:CityStayDraft[])=>void;start:string;end:string;firstLabel?:string}){
 function update(index:number,patch:Partial<CityStayDraft>){
  const next=rows.map((r,i)=>i===index?{...r,...patch}:r);
  if(index>0&&patch.start&&next[index-1].end>patch.start&&next[index-1].start<=patch.start)next[index-1]={...next[index-1],end:patch.start};
  onChange(next);
 }
 return <div className="city-stay-editor">{rows.map((row,index)=><article key={row.id} className="city-stay-row"><div className="section-top"><h3><span className="stay-order">{index+1}</span>{row.city?.name??'Choose a city'}</h3>{rows.length>1&&<button type="button" className="icon-button" aria-label={`Remove city stay ${index+1}`} onClick={()=>onChange(rows.filter(r=>r.id!==row.id))}><Trash2 size={17}/></button>}</div><CityInput value={row.query} label={index===0&&firstLabel?firstLabel:`City for stay ${index+1}`} onChange={(query,city)=>update(index,{query,city,timezone:city?destinationSettings(city.label,city).timezone??'UTC':row.timezone})}/><div className="form-grid"><label className="field"><span>Arrive</span><input type="date" aria-label={`Arrival for stay ${index+1}`} min={start} max={end} value={row.start} onChange={e=>update(index,{start:e.target.value})}/></label><label className="field"><span>Depart</span><input type="date" aria-label={`Departure for stay ${index+1}`} min={row.start} max={end} value={row.end} onChange={e=>update(index,{end:e.target.value})}/></label><label className="field"><span>Stop type</span><select value={row.kind} onChange={e=>update(index,{kind:e.target.value as CityStay['kind']})}><option value="stay">City stay</option><option value="overnight">Overnight stop</option></select></label><label className="field"><span>Stay note (optional)</span><input value={row.note} maxLength={300} placeholder="Hotel, transfer or arrival details" onChange={e=>update(index,{note:e.target.value})}/></label></div>{row.city&&<small className="source-footnote">Local time: {row.timezone.replaceAll('_',' ')}</small>}</article>)}<button type="button" className="btn" disabled={rows.length>=30} onClick={()=>onChange([...rows,{id:crypto.randomUUID(),query:'',start:rows.at(-1)?.end??start,end,timezone:rows.at(-1)?.timezone??'UTC',kind:'stay',note:''}])}><Plus size={16}/>Add another city</button><p className="source-footnote">Transfer dates can meet. Choosing an earlier arrival shortens the previous stay when needed.</p></div>;
}
export function CityStaysDialog({state,busy,act,onClose}:{state:State;busy:boolean;act:any;onClose:()=>void}){
 const [rows,setRows]=useState<CityStayDraft[]>(()=>state.plan.stays?.length?state.plan.stays.map(s=>({...s,query:s.city.label})):[firstStayDraft(state.plan)]);
 let error='';try{validateCityStays(rows,state.plan);}catch(e){error=(e as Error).message;}
 return <DialogContent className="modal-large"><DialogHeader><DialogTitle>City stays</DialogTitle><DialogDescription>Keep every city in one plan. Activities keep their booked times.</DialogDescription></DialogHeader><div className="modal-body"><CityStayFields rows={rows} onChange={setRows} start={state.plan.start} end={state.plan.end}/>{error&&<p className="inline-error" role="alert">{error}</p>}<p className="source-footnote">Discovery follows each day’s city. Editing stays does not move activities or make hotel bookings.</p></div><DialogFooter><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy||!!error} onClick={async()=>{if(await act({type:'city_stays',stays:rows},'City stays saved'))onClose();}}>Save city stays</button></DialogFooter></DialogContent>;
}
