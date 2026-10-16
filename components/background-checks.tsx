'use client';
import {useState} from 'react';
export function BackgroundChecks(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <section className="panel"><h2>Payments and reminders</h2><p>Check saved payment results, invoice balances and reminders for your plans.</p><p><a href="/flows">Review changes, cancellations, invoices and private availability →</a></p><p><a href="/agent-demo">Try the voice assistant demo →</a></p>
 <details className="background-explainer"><summary>Why are there background checks?</summary><p>When the schedule is enabled, checks update saved payment and invoice results and prepare reminders while the site is closed. They never charge you, send an invoice or issue a refund. The hourly schedule is a periodic refresh; you can use the site and checkout while it is paused.</p><p>You can run a check below whenever you need an update. A completed check does not mean an automatic schedule is enabled.</p></details>
 <button className="btn" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{
  const response=await fetch('/api/jobs/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),result=await response.json() as {error?:string;status?:string;orders?:{status:string}[];payments?:{operations:{status:string}[]};invoices?:{results:{status:string}[]};recoveries?:{proposals:{status:string}[]};delivery?:{delivered:number}};
  if(!response.ok)throw Error(result.error??'Checks could not finish.');
  const unresolved=[...(result.orders??[]),...(result.payments?.operations??[]),...(result.invoices?.results??[]),...(result.recoveries?.proposals??[])].some(entry=>['failed','manual-review','needs-review','retry','retry-or-review'].includes(entry.status));
  setMessage(result.status==='completed'?(unresolved?'Checks finished. Some saved payments need review.':`Checks finished. ${result.delivery?.delivered??0} new reminders are ready.`):'A check is already running or was completed recently.');
 }catch(error){setMessage(error instanceof Error?error.message:'Checks could not finish.');}finally{setBusy(false);}}}>{busy?'Checking…':'Run background checks'}</button>
 {message&&<p role="status">{message}</p>}</section>;
}
