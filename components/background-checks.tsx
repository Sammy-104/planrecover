'use client';
import {useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
export function BackgroundChecks(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <section className="background-checks"><h3 className="settings-card-title">Payments and reminders</h3><p className="settings-card-text">Check saved payment results, invoice balances and reminders for your plans.</p>
 <div className="settings-links"><a className="resource-link" href="/flows">Review changes, cancellations, invoices and private availability<ArrowRight size={15}/></a><a className="resource-link" href="/agent-demo">Try the voice assistant demo<ArrowRight size={15}/></a></div>
 <details className="settings-disclosure background-explainer"><summary>Why are there background checks?</summary><p>When the schedule is enabled, checks update saved payment and invoice results and prepare reminders while the site is closed. They never charge you, send an invoice or issue a refund. The hourly schedule is a periodic refresh; you can use the site and checkout while it is paused.</p><p>You can run a check below whenever you need an update. A completed check does not mean an automatic schedule is enabled.</p></details>
 <div className="action-row"><button className="btn" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{
  const response=await fetch('/api/jobs/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),result=await response.json() as {error?:string;status?:string;orders?:{status:string}[];payments?:{operations:{status:string}[]};invoices?:{results:{status:string}[]};recoveries?:{proposals:{status:string}[]};delivery?:{delivered:number}};
  if(!response.ok)throw Error(result.error??'Checks could not finish.');
  const unresolved=[...(result.orders??[]),...(result.payments?.operations??[]),...(result.invoices?.results??[]),...(result.recoveries?.proposals??[])].some(entry=>['failed','manual-review','needs-review','retry','retry-or-review'].includes(entry.status));
  setMessage(result.status==='completed'?(unresolved?'Checks finished. Some saved payments need review.':`Checks finished. ${result.delivery?.delivered??0} new reminders are ready.`):'A check is already running or was completed recently.');
 }catch(error){setMessage(error instanceof Error?error.message:'Checks could not finish.');}finally{setBusy(false);}}}><RefreshCw size={15} className={busy?'spin':undefined}/>{busy?'Checking…':'Run background checks'}</button>
 {message&&<p className="settings-status-message" role="status">{message}</p>}</div></section>;
}
