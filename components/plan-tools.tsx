'use client';
import {useState} from 'react';
import {Car,Download,Printer,WifiOff,LoaderCircle,Ellipsis,Sparkles,FileText,ReceiptText,SlidersHorizontal,History} from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuLabel,DropdownMenuSub,DropdownMenuSubTrigger,DropdownMenuSubContent} from '@/components/ui/dropdown-menu';
import {toast} from 'sonner';
import {OfflineStatus} from './offline-status';
import {calendarExport,offlinePlan,exportFilename} from '@/lib/plan-export';
import {storeOfflinePlan,enableOfflinePage,downloadFile} from '@/lib/offline-plans';
import type {State} from '@/lib/model';
export function PlanTools({state,canEdit=false,onDraft,onImport,onReceipt,onEdit,onHistory,onRoadTrip,onTest,onPreferences,onWholeTrip,onHotels,onTickets,onScenarios,onRouteStops}:{state:State;canEdit?:boolean;onDraft?:()=>void;onImport?:()=>void;onReceipt?:()=>void;onEdit?:()=>void;onHistory?:()=>void;onRoadTrip?:()=>void;onTest?:()=>void;onPreferences?:()=>void;onWholeTrip?:()=>void;onHotels?:()=>void;onTickets?:()=>void;onScenarios?:()=>void;onRouteStops?:()=>void}){
 const [saving,setSaving]=useState(false),[saved,setSaved]=useState(''),copy=offlinePlan(state);
 async function offline(){setSaving(true);try{await storeOfflinePlan(copy);await enableOfflinePage();setSaved(copy.savedAt);toast.success('Offline copy saved on this device.');}catch(e){toast.error(e instanceof Error?e.message:'This browser could not save an offline copy. Try Download copy.');}finally{setSaving(false);}}
 async function download(){setSaving(true);try{const response=await fetch('/offline.html');if(!response.ok)throw Error('The offline copy could not be prepared. Try again.');const html=await response.text(),payload=JSON.stringify(copy).replace(/</g,'\\u003c');downloadFile(html.replace('<!--PLAN_SNAPSHOT-->',`<script id="plan-snapshot" type="application/json">${payload}</script>`),exportFilename(state.plan.name)+'-offline.html','text/html;charset=utf-8');toast.success('Downloaded a read-only offline copy.');}catch(e){toast.error((e as Error).message);}finally{setSaving(false);}}
 return <section className="plan-tools" aria-label="Plan tools">
  <div className="plan-tools-actions"><DropdownMenu><DropdownMenuTrigger asChild><button className="btn" aria-label="Open plan tools"><Ellipsis size={17}/>Plan tools</button></DropdownMenuTrigger>
   <DropdownMenuContent align="end" className="plan-tools-menu">
    {canEdit&&onDraft&&<DropdownMenuItem onSelect={onDraft}><Sparkles size={16}/>Draft from a goal</DropdownMenuItem>}
    {canEdit&&onEdit&&<DropdownMenuItem onSelect={onEdit}><SlidersHorizontal size={16}/>Edit plan details</DropdownMenuItem>}
    {onTickets&&<DropdownMenuItem onSelect={onTickets}><FileText size={16}/>Tickets & booking files</DropdownMenuItem>}
    {canEdit&&onReceipt&&<DropdownMenuItem onSelect={onReceipt}><ReceiptText size={16}/>Add receipt</DropdownMenuItem>}
    {onPreferences&&<DropdownMenuItem onSelect={onPreferences}><SlidersHorizontal size={16}/>My planning preferences</DropdownMenuItem>}
    <DropdownMenuSeparator/>
    {(onWholeTrip||onHotels||onRouteStops||onRoadTrip)&&<DropdownMenuSub><DropdownMenuSubTrigger><Car size={16}/>Itinerary tools</DropdownMenuSubTrigger><DropdownMenuSubContent className="plan-tools-submenu">
     {onWholeTrip&&<DropdownMenuItem onSelect={onWholeTrip}><Sparkles size={16}/>Build whole itinerary</DropdownMenuItem>}
     {onHotels&&<DropdownMenuItem onSelect={onHotels}><FileText size={16}/>Accommodation by night</DropdownMenuItem>}
     {onRouteStops&&<DropdownMenuItem onSelect={onRouteStops}><Car size={16}/>Find stops along the route</DropdownMenuItem>}
     {onRoadTrip&&<DropdownMenuItem onSelect={onRoadTrip}><Car size={16}/>Road-trip planner</DropdownMenuItem>}
    </DropdownMenuSubContent></DropdownMenuSub>}
    {(onScenarios||onHistory||onTest||canEdit&&onImport)&&<DropdownMenuSub><DropdownMenuSubTrigger><Ellipsis size={16}/>More tools</DropdownMenuSubTrigger><DropdownMenuSubContent className="plan-tools-submenu">
     {canEdit&&onImport&&<DropdownMenuItem onSelect={onImport}><FileText size={16}/>Import booking confirmation</DropdownMenuItem>}
     {onScenarios&&<DropdownMenuItem onSelect={onScenarios}><SlidersHorizontal size={16}/>Compare trip versions</DropdownMenuItem>}
     {onHistory&&<DropdownMenuItem onSelect={onHistory}><History size={16}/>View history</DropdownMenuItem>}
     {onTest&&<DropdownMenuItem onSelect={onTest}><FileText size={16}/>Try a traveller task</DropdownMenuItem>}
    </DropdownMenuSubContent></DropdownMenuSub>}
    <DropdownMenuSub><DropdownMenuSubTrigger><Download size={16}/>Export & offline</DropdownMenuSubTrigger><DropdownMenuSubContent className="plan-tools-submenu">
     <DropdownMenuLabel>Take your plan with you</DropdownMenuLabel>
     <DropdownMenuItem onSelect={()=>downloadFile(calendarExport(state),exportFilename(state.plan.name)+'.ics','text/calendar;charset=utf-8')}><Download size={16}/>Calendar export</DropdownMenuItem>
     <DropdownMenuItem onSelect={()=>window.print()}><Printer size={16}/>Print / Save PDF</DropdownMenuItem>
     <DropdownMenuItem disabled={saving} onSelect={()=>void offline()}>{saving?<LoaderCircle size={16} className="spin"/>:<WifiOff size={16}/>}Save offline</DropdownMenuItem>
     <DropdownMenuItem disabled={saving} onSelect={()=>void download()}><Download size={16}/>Download offline copy</DropdownMenuItem>
     <DropdownMenuItem asChild><a href="/offline.html">Open offline plans</a></DropdownMenuItem>
     <OfflineStatus state={state}/><div className="tools-export-note">{saved?'Copy saved on this device. Save again after changes.':'Exports are snapshots and do not sync.'}</div>
    </DropdownMenuSubContent></DropdownMenuSub>
   </DropdownMenuContent>
  </DropdownMenu></div><div className="printable-plan"><h1>{copy.name}</h1><p>{copy.destination} · {copy.start} – {copy.end}</p><p>Times in {copy.timezone} · Copy made {new Date(copy.savedAt).toLocaleString('en-CA')}</p><p>Planned itinerary. Confirm venue hours and reservations before visiting.</p>{[...new Set(copy.stops.map(s=>s.day))].map(day=><section key={day}><h2>{day}</h2>{copy.stops.filter(s=>s.day===day).map(stop=><article key={stop.number}><strong>{stop.number}. {stop.name}</strong><span>{stop.time} · {stop.duration} min · {stop.status}</span><span>{stop.location}</span><span>{stop.cost}</span>{stop.hours&&<span>Listed hours: {stop.hours}</span>}{stop.website&&<span>{stop.website}</span>}</article>)}</section>)}{!copy.stops.length&&<p>No activities scheduled yet.</p>}{copy.tasks.length>0&&<section><h2>Preparation</h2>{copy.tasks.map((task,i)=><article key={i}><strong>{task.done?'✓':'□'} {task.name}</strong><span>Due {task.due}</span></article>)}</section>}</div></section>;
}
