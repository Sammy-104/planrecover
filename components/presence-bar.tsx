'use client';
import {useEffect,useRef,useState} from 'react';
import {Users} from 'lucide-react';
import type {PresenceEntry} from '@/lib/presence';
import type {State} from '@/lib/model';

export function PresenceBar({state,actor,enabled,canEdit,view,itemId}:{state:State;actor:string;enabled:boolean;canEdit:boolean;view:string;itemId?:string}){
 const [entries,setEntries]=useState<PresenceEntry[]>([]),[offline,setOffline]=useState(false),context=useRef({view,itemId}),sendRef=useRef<(()=>void)|null>(null);context.current={view,itemId};
 useEffect(()=>{sendRef.current?.();},[view,itemId]);
 const hasGroup=!!state.people&&state.people.filter(person=>person.role!=='legacy').length>1;
 useEffect(()=>{
  setEntries([]);setOffline(false);if(!enabled||!hasGroup||state.empty)return;
  const life=new AbortController(),sessionId=crypto.randomUUID(),tripId=state.plan.id!,headers=new Headers({'Content-Type':'application/json'}),token=new URLSearchParams(window.location.hash.slice(1)).get('trip');if(token)headers.set('x-trip-share',token);
  let typingUntil=0,timer:ReturnType<typeof setTimeout>|undefined,inFlight=false,queued=false;
  const send=async()=>{if(life.signal.aborted||document.visibilityState==='hidden')return;if(inFlight){queued=true;return;}inFlight=true;
   try{const response=await fetch(canEdit?'/api/presence':'/api/presence?'+new URLSearchParams({tripId}),canEdit?{method:'POST',headers,body:JSON.stringify({tripId,sessionId,...context.current,status:Date.now()<typingUntil?'editing':'viewing'}),signal:life.signal}:{headers,signal:life.signal});if(!response.ok)throw Error();const result=await response.json() as {entries:PresenceEntry[]};if(!life.signal.aborted){setEntries(result.entries.filter(p=>p.memberId!==actor));setOffline(false);}}catch{if(!life.signal.aborted){setOffline(true);setEntries([]);}}finally{inFlight=false;if(queued&&!life.signal.aborted){queued=false;void send();}}
  };
  const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void send(),800);};
  const input=(event:Event)=>{if((event.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]')){typingUntil=Date.now()+10000;schedule();}};
  const blur=()=>{typingUntil=0;schedule();};const visibility=()=>{if(document.visibilityState!=='hidden')void send();};
  sendRef.current=()=>void send();void send();const heartbeat=setInterval(()=>void send(),15000);
  document.addEventListener('input',input);document.addEventListener('focusout',blur);document.addEventListener('visibilitychange',visibility);
  return()=>{life.abort();sendRef.current=null;clearInterval(heartbeat);if(timer)clearTimeout(timer);document.removeEventListener('input',input);document.removeEventListener('focusout',blur);document.removeEventListener('visibilitychange',visibility);if(canEdit)void fetch('/api/presence',{method:'POST',headers,body:JSON.stringify({tripId,sessionId,...context.current,status:'viewing',leave:true}),keepalive:true}).catch(()=>{});};
 },[state.plan.id,enabled,canEdit,actor,hasGroup]);
 if(!enabled||!hasGroup||state.empty||!entries.length)return null;
 return <aside className="presence-bar" aria-label="People here now"><div><Users size={16}/><strong>{entries.length?`${entries.length+ (canEdit?1:0)} here now`:offline?'Presence reconnecting':'You’re here'}</strong><span>{offline?'Live presence is temporarily unavailable.':!entries.length?'Friends appear here while the plan is open.':''}</span></div>{entries.length>0&&<ul>{entries.slice(0,5).map(person=><li key={person.memberId}><span className="presence-avatar" style={{background:person.color}}>{person.initials}<i/></span><span><strong>{person.name}</strong><small>{person.status==='editing'?'Editing':'Viewing'} {person.itemName??({planner:'the planner',activity:'an activity',recovery:'plan changes',discover:'places',people:'the group',decisions:'decisions'}[person.view]??'the plan')}</small></span></li>)}</ul>}</aside>;
}
