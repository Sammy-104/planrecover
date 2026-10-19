'use client';
import {useEffect,useState} from 'react';
import {Sun,Navigation,Clock,Copy,Check,WifiOff,Download,ArrowRight,AlertTriangle,MapPin,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import type {State,Item} from '@/lib/model';
import {OfflineStatus} from './offline-status';
import {todayDay,todayOverview} from '@/lib/today';
import {dayCity} from '@/lib/city-stays';
import {tripDays} from '@/lib/trip-time';
import {directionsUrl} from '@/lib/map-planning';
import {validPoint,itineraryStops} from '@/lib/itinerary-map';
import {offlinePlan,exportFilename,type OfflineDeparture} from '@/lib/plan-export';
import {storeOfflinePlan,enableOfflinePage,downloadFile} from '@/lib/offline-plans';

export function TodayView({state,actor,visitorDemo=false,request,onItem,onPlan,onAttention,onTickets}:{state:State;actor:string;visitorDemo?:boolean;request:(url:string,options?:RequestInit)=>Promise<any>;onItem:(item:Item)=>void;onPlan:(day:string)=>void;onAttention:()=>void;onTickets?:()=>void}){
 const [now,setNow]=useState(()=>new Date().toISOString()),[chosen,setChosen]=useState(''),[scope,setScope]=useState<'mine'|'group'>(actor==='guest'?'group':'mine'),[mode,setMode]=useState<'walk'|'drive'|'transit'>(state.plan.scheduleTravelMode??'walk'),[route,setRoute]=useState<OfflineDeparture&{unavailable?:boolean;pending?:boolean}>(),[routing,setRouting]=useState(false),[retry,setRetry]=useState(0),[saving,setSaving]=useState(false),[saved,setSaved]=useState(''),[copied,setCopied]=useState('');
 const today=todayDay(state,now),day=chosen&&chosen>=state.plan.start&&chosen<=state.plan.end?chosen:today.day,context=dayCity(state,day),overview=todayOverview(state,day,actor,scope,now),next=overview.next,origin=overview.origin,numbers=new Map(itineraryStops(state).map(s=>[s.item.id,s.number]));
 const fmt=(value:string,zone=context.timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date().toISOString()),30000);return()=>clearInterval(timer);},[]);
 const signature=JSON.stringify([state.plan.id,next?.id,next?.start,next?.latitude,next?.longitude,origin?.item.id,origin?.item.latitude,origin?.item.longitude,mode,day,scope,actor,retry]);
 useEffect(()=>{setRoute(undefined);setRouting(false);if(visitorDemo||!next||!origin||!validPoint(next)||mode==='transit')return;const life=new AbortController();let timer:ReturnType<typeof setTimeout>,attempts=0;const run=async()=>{setRouting(true);try{const q=new URLSearchParams({tripId:state.plan.id!,day,itemId:next.id,mode,actor,scope}),r=await request('/api/today-travel?'+q,{signal:life.signal});if(life.signal.aborted)return;setRoute(r);if(r.pending&&++attempts<8){timer=setTimeout(()=>void run(),1500);return;}}catch{if(!life.signal.aborted)setRoute({from:origin.item.id,to:next.id,mode,unavailable:true} as any);}if(!life.signal.aborted)setRouting(false);};void run();return()=>{life.abort();clearTimeout(timer);};},[signature]);
 const validRoute=route?.from===origin?.item.id&&route?.to===next?.id&&route?.minutes!==undefined?{...route,mode}:undefined;
 async function save(download=false){setSaving(true);try{const snapshot=offlinePlan(state,validRoute?[validRoute]:[]);if(download){const response=await fetch('/offline.html');if(!response.ok)throw Error('The offline page could not load. Try again.');const html=await response.text();downloadFile(html.replace('<!--PLAN_SNAPSHOT-->',`<script id="plan-snapshot" type="application/json">${JSON.stringify(snapshot).replace(/</g,'\\u003c')}</script>`),exportFilename(state.plan.name)+'-offline.html','text/html;charset=utf-8');}else{await storeOfflinePlan(snapshot);await enableOfflinePage();}setSaved(snapshot.savedAt);toast.success(download?'Offline travel copy downloaded.':'Travel copy saved on this device.');}catch(e){toast.error((e as Error).message);}finally{setSaving(false);}}
 async function copyAddress(item:Item){try{await navigator.clipboard.writeText(item.address??item.location);setCopied('address:'+item.id);}catch{toast.error('Select and copy the address text below.');}}
 async function copy(item:Item){try{await navigator.clipboard.writeText(item.externalBooking??'');setCopied(item.id);setTimeout(()=>setCopied(''),2500);}catch{toast.error('Copy is unavailable. Select the reference text below.');}}
 function reference(item:Item){return item.externalBooking&&<div className="today-booking"><span><small>Booking reference · entered by your group</small><strong>{item.externalBooking}</strong></span><button className="btn small-btn" onClick={()=>void copy(item)} aria-label={`Copy booking reference for ${item.name}`}>{copied===item.id?<Check size={16}/>:<Copy size={16}/>}Copy</button></div>;}
 const directions=next&&validPoint(next)?directionsUrl(origin?[origin.item,next]:[next],mode):undefined;
 const stopEnd=(item:Item)=>new Date(Date.parse(item.start)+item.duration*60000).toISOString();
 return <div className="today-page">
  <div className="page-heading today-heading"><div><p className="eyebrow"><Sun size={14}/>Your plan, on the go</p><h1>Today</h1><p className="muted">{state.plan.name} · {context.destination}</p></div>
   <div className="heading-actions">{onTickets&&<button className="btn" onClick={onTickets}>Tickets & files</button>}<button className="btn" onClick={()=>onPlan(day)}>Open planner<ArrowRight size={16}/></button></div></div>
  <div className="today-controls" role="group" aria-label="Today view options">
   <label className="today-control"><span>Travel day</span><select aria-label="Today day" value={day} onChange={e=>setChosen(e.target.value)}>{tripDays(state.plan.start,state.plan.end).map(d=><option key={d} value={d}>{d} · {dayCity(state,d).city?.name??dayCity(state,d).destination}</option>)}</select></label>
   <label className="today-control"><span>Show activities</span><select aria-label="Today activities" value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="mine">My activities</option><option value="group">Whole group</option></select></label>
  </div>
  {(!overview.isCurrent||today.preview)&&<p className="notice info today-preview">Preview for {day}. Live “now” guidance appears on the travel date.</p>}
  <div className="today-layout">
   <div className="today-main">
    {overview.current&&<section className="today-current" aria-label="Happening now"><span className="today-live-dot" aria-hidden/><span className="pill green">Happening now</span><button className="text-button" onClick={()=>onItem(overview.current!)}>{overview.current.name}</button><span className="today-current-until">Until {fmt(stopEnd(overview.current),overview.current.timezone)}</span>{reference(overview.current)}</section>}
    <section className="today-next" aria-label="Next activity">
     <div className="today-next-top"><span className="today-kicker">{overview.isCurrent?'Up next':'First stop'}</span><span className={`today-time${next?'':' clear'}`}><Clock size={15}/>{next?fmt(next.start,next.timezone):'All clear'}</span></div>
     {next?<>
      <h2>{next.name}</h2>
      <p className="today-address"><MapPin size={16}/>{next.address??next.location}</p>
      <div className="today-status"><span>Stop {numbers.get(next.id)}</span><span>{next.duration} min</span><span>{next.status==='draft'?'Draft — group review pending':'Planned'}</span><span>{next.timezone??context.timezone}</span></div>
      {reference(next)}
      <div className="today-departure">
       <div className="today-departure-top"><h3><Navigation size={15}/>Getting there</h3><select aria-label="Today travel mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="walk">Walk</option><option value="drive">Drive</option><option value="transit">Transit</option></select></div>
       {validRoute?<><strong className="leave-time">{overview.isCurrent&&Date.parse(validRoute.leaveAt)<Date.parse(now)?'Suggested departure was':'Leave by'} {fmt(validRoute.leaveAt,next.timezone)}</strong><p>{validRoute.minutes} min {mode==='walk'?'walk':'drive'} + 10 min buffer{validRoute.km!==undefined?` · ${validRoute.km.toFixed(1)} km`:''}</p></>:<p>{routing?'Checking the mapped route…':mode==='transit'?'Check departure times in Directions.':origin?'Route timing needs checking. Open directions for current conditions.':'Departure time needs a mapped previous stop or accommodation.'}</p>}
       {origin&&<small>From {origin.item.name} · {origin.label.toLowerCase()}. Your current location is not tracked.</small>}
       {!routing&&origin&&!validRoute&&mode!=='transit'&&!visitorDemo&&<button className="text-button" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={14}/>Retry route</button>}
       <small>Mapped travel excludes live traffic and waits. Confirm transport and access.</small>
      </div>
      <div className="today-primary-actions">{directions?<a className="btn primary" href={directions} target="_blank" rel="noreferrer"><Navigation size={17}/>Open directions</a>:<span className="muted">Map location still needs confirmation.</span>}<button className="btn" onClick={()=>void copyAddress(next)}><Copy size={16}/>{copied==='address:'+next.id?'Address copied':'Copy address'}</button><button className="btn" onClick={()=>onItem(next)}>Activity details</button></div>
     </>:<div className="today-clear"><span className="today-clear-icon"><Check size={24}/></span><h2>{overview.stops.length?'You’re done for this day':'A little room to explore'}</h2><p>{overview.stops.length?'Your saved stops are below.':'No activities scheduled for this selection.'}</p></div>}
    </section>
    <section className="today-timeline" aria-label="Your day"><div className="section-top"><h2>Your day</h2><span className="muted">Local times at each stop</span></div>
     {overview.stops.length===0?<p className="muted today-timeline-empty">Nothing scheduled yet.</p>:<ol>{overview.stops.map(i=><li key={i.id} className={`today-stop${next?.id===i.id?' next':''}${overview.current?.id===i.id?' current':''}`}><span className="today-stop-time">{fmt(i.start,i.timezone)}</span><span className="today-stop-number" aria-hidden>{numbers.get(i.id)}</span><div className="today-stop-body"><button className="text-button" onClick={()=>onItem(i)}>{i.name}</button><p>{i.duration} min · {i.address??i.location}</p>{next?.id===i.id&&<span className="pill brand">Next</span>}{reference(i)}</div></li>)}</ol>}
    </section>
   </div>
   <aside className="today-aside">
    {overview.attention.length>0&&<section className="today-attention"><h2><AlertTriangle size={17}/>Needs attention</h2>{overview.attention.map(r=><button key={r.id} onClick={onAttention}><span>{r.title}</span><ArrowRight size={15}/></button>)}</section>}
    <section className="today-offline"><div className="today-offline-title"><WifiOff size={18}/><h2>Ready without a signal</h2></div><OfflineStatus state={state}/><p>Save this itinerary, entered booking references and checked departure guidance on this device. Refresh after changes.</p><div className="today-offline-actions"><button className="btn primary" disabled={saving} onClick={()=>void save()}><WifiOff size={16}/>{saving?'Saving…':'Save offline copy'}</button><button className="btn" disabled={saving} onClick={()=>void save(true)}><Download size={16}/>Download copy</button><a className="btn ghost" href="/offline.html">Open saved plans</a></div><small>{saved?`Saved ${new Date(saved).toLocaleString()}. `:''}Saved copies are read only. Directions and map services need a connection.</small></section>
   </aside>
  </div>
 </div>;
}
