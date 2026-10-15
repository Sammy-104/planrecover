'use client';
import {useEffect,useRef,useState} from 'react';
import type {ReceiptDraft} from '@/lib/receipt-drafts';
import {formatMoney} from '@/lib/money';
export function ReceiptExtractionHistory({draft,fetchPage}:{draft:ReceiptDraft;fetchPage:(before?:number)=>Promise<any>}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<any[]>([]),[before,setBefore]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const fetchRef=useRef(fetchPage),generation=useRef(0);fetchRef.current=fetchPage;
 async function load(older=false){const current=++generation.current;setBusy(true);setError('');try{const result=await fetchRef.current(older&&before!==null?before:undefined);if(current!==generation.current||!result)return;setRows(rows=>older?[...rows,...result.revisions]:result.revisions);setBefore(result.hasMore?result.nextBefore:null);}catch(error){if(current===generation.current)setError((error as Error).message);}finally{if(current===generation.current)setBusy(false);}}
 useEffect(()=>{if(open)void load();return()=>{generation.current++;};},[open,draft.version]);
 return <details className="receipt-history" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Saved extraction history</summary>
  {open&&<div><p className="source-footnote">Each scan, retry and source review is kept here. These records are read-only; retries do not approve expenses.</p>{busy&&<p role="status">Loading saved revisions…</p>}{error&&<p role="alert">{error}</p>}
   {rows.map(row=><article className="receipt-history-entry" key={row.version}><strong>Revision {row.version} · {String(row.status).replaceAll('-',' ')}</strong><p className="source-footnote">{row.created.replace('T',' ').slice(0,19)} UTC · {row.provider??'Source upload'}{row.current?' · Current':''}{row.legacySnapshot?' · Earlier history was not recorded':''}</p>
    {row.sourceFacts?<><p>{row.sourceFacts.merchant??'Merchant unclear'} · {row.sourceFacts.currency??'Currency unclear'} · {row.sourceFacts.date??'Date unclear'}</p><ul>{row.sourceFacts.items.map((item:any,index:number)=><li key={index}>{item.name} — {item.amountCents===null?'Amount unclear':row.sourceFacts.currency?formatMoney(item.amountCents,row.sourceFacts.currency):`${item.amountCents} minor units (currency unverified)`}</li>)}</ul><p>Scanned total: {row.sourceFacts.totalCents===null?'Unclear':row.sourceFacts.currency?formatMoney(row.sourceFacts.totalCents,row.sourceFacts.currency):'Currency unverified'}</p></>:<p>No extracted values in this revision.</p>}
    {row.warnings?.slice(0,4).map((warning:string,index:number)=><p className="source-footnote" key={index}>{warning}</p>)}
   </article>)}{before!==null&&<button className="btn" disabled={busy} onClick={()=>void load(true)}>Load earlier revisions</button>}</div>}
 </details>;
}
