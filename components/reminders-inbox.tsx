'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

type Notification={id:string;title:string;body:string;created:string;readAt:string|null};
type Inbox={notifications:Notification[];delivery:{inApp:string;email:string;push:string}};
type JsonFetch=(url:string,init?:RequestInit)=>Promise<unknown>;
export function RemindersInbox({planId,memberId,version,timezone,jsonFetch}:{planId:string;memberId:string;version:number;timezone:string;jsonFetch:JsonFetch}){
 const [inbox,setInbox]=useState<Inbox|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(''),[showRead,setShowRead]=useState(false);
 const request=useRef<AbortController|null>(null);
 const url=`/api/plans/${encodeURIComponent(planId)}/reminders`;
 const refresh=useCallback(async()=>{request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError('');try{const value=await jsonFetch(url,{signal:controller.signal}) as Inbox;if(!controller.signal.aborted)setInbox(value);}catch(reason){if(!controller.signal.aborted)setError((reason as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}},[jsonFetch,url]);
 useEffect(()=>{const initial=setTimeout(()=>void refresh(),0),onFocus=()=>{if(document.visibilityState!=='hidden')void refresh();};const timer=setInterval(onFocus,30000);window.addEventListener('focus',onFocus);return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',onFocus);request.current?.abort();};},[refresh,memberId,version]);
 async function markRead(id:string){request.current?.abort();setLoading(false);setSaving(id);setError('');try{await jsonFetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({notificationId:id,read:true})});request.current?.abort();setLoading(false);setInbox(current=>current?{...current,notifications:current.notifications.map(row=>row.id===id?{...row,readAt:row.readAt??new Date().toISOString()}:row)}:current);}catch(reason){setError((reason as Error).message);}finally{setSaving('');}}
 const unread=inbox?.notifications.filter(row=>!row.readAt)??[],visible=inbox?.notifications.filter(row=>showRead||!row.readAt)??[];
 return <section className="panel reminders-inbox" aria-label="Your reminder inbox"><div className="section-top"><div><h2>Your reminder inbox</h2><p className="muted">{inbox?`${unread.length} unread`:'Saved notifications for your signed-in account'}</p></div><button className="btn small-btn" disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'Refresh inbox'}</button></div>
  <label className="check-label"><input type="checkbox" checked={showRead} onChange={event=>setShowRead(event.target.checked)}/>Include read notifications</label>
  {error&&<p className="inline-error" role="alert">{error}</p>}{loading&&!inbox&&<p role="status">Loading your notifications…</p>}
  {inbox&&!visible.length&&<p className="muted">{showRead?'No saved notifications yet.':'You have no unread notifications.'}</p>}
  {visible.map(row=><article className="inbox-message" key={row.id}><div><strong>{row.title}</strong><small>{new Date(row.created).toLocaleString('en-CA',{timeZone:timezone})} · {row.readAt?'Read':'Unread'}</small><p>{row.body}</p></div>{!row.readAt&&<button className="btn small-btn" disabled={!!saving} onClick={()=>void markRead(row.id)}>{saving===row.id?'Saving…':'Mark as read'}</button>}</article>)}
  {inbox&&<p className="source-footnote">These notifications are private to your account. Email: {inbox.delivery.email}. Push: {inbox.delivery.push}. Delivery configuration does not establish that a message reached an inbox or device.</p>}
 </section>;
}
