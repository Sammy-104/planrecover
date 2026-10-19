'use client';
import {useEffect,useState} from 'react';
import {WifiOff,CheckCircle2} from 'lucide-react';
import type {State} from '@/lib/model';
import {offlinePlan,type OfflinePlan} from '@/lib/plan-export';
import {readOfflinePlan} from '@/lib/offline-plans';
export function OfflineStatus({state}:{state:State}){
 const [copy,setCopy]=useState<OfflinePlan>(),[checked,setChecked]=useState(false),[unavailable,setUnavailable]=useState(false),[online,setOnline]=useState(true);const current=offlinePlan(state);
 useEffect(()=>{let active=true;const load=async()=>{try{const saved=await readOfflinePlan(state.plan.id!);if(active){setCopy(saved);setUnavailable(false);}}catch{if(active)setUnavailable(true);}finally{if(active)setChecked(true);}};void load();const network=()=>setOnline(navigator.onLine);network();window.addEventListener('planrecover-offline-saved',load);window.addEventListener('online',network);window.addEventListener('offline',network);return()=>{active=false;window.removeEventListener('planrecover-offline-saved',load);window.removeEventListener('online',network);window.removeEventListener('offline',network);};},[state.plan.id]);
 const changed=!!copy&&copy.contentKey!==current.contentKey,old=!!copy&&Date.now()-Date.parse(copy.savedAt)>86400000;return <div className={`offline-freshness ${!online||changed||old?'needs-refresh':''}`} role="status">{copy&&!changed&&!old?<CheckCircle2 size={17}/>:<WifiOff size={17}/>}<span><strong>{!online?'You appear to be offline':!checked?'Checking this device’s saved copy…':unavailable?'Device storage unavailable':!copy?'No offline copy saved on this device':changed?'Your saved copy needs updating':old?'Saved copy is over a day old':'Saved copy matches this itinerary'}</strong><small>{copy?`Saved ${new Date(copy.savedAt).toLocaleString()}. `:''}{unavailable?'Download a copy to take your plan with you.':!online?copy?'Open saved plans for the read-only travel copy. Edits and directions need a connection.':'Reconnect to save or download your itinerary.':changed||old?'Save again before travelling.':'Map backgrounds, live services and directions need a connection.'}</small></span></div>;
}
