'use client';
import {CalendarDays,Compass,Sun,Wallet} from 'lucide-react';
const destinations=[{id:'plan',label:'Plan',icon:CalendarDays},{id:'discover',label:'Discover',icon:Compass},{id:'today',label:'Today',icon:Sun},{id:'money',label:'Money',icon:Wallet}] as const;
export function MobileNavigation({view,onGo,disabled=false}:{view:string;onGo:(view:'plan'|'discover'|'today'|'money')=>void;disabled?:boolean}){
 return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{destinations.map(d=><button key={d.id} disabled={disabled} aria-current={view===d.id?'page':undefined} onClick={()=>onGo(d.id)}><d.icon size={21}/><span>{d.label}</span></button>)}</nav>;
}
