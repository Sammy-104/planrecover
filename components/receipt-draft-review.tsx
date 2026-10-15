'use client';
import { useEffect,useState,useCallback } from 'react';
import type { Receipt } from '@/lib/model';
import type { ReceiptDraft } from '@/lib/receipt-drafts';
import {formatMoney} from '@/lib/money';
import {ReceiptExtractionHistory} from './receipt-extraction-history';

type Response = {draft:ReceiptDraft;receipt:Receipt;reviewFields:string[];note?:string};
type JsonFetch = (url:string,init?:RequestInit)=>Promise<any>;
export function useReceiptDraft(planId:string,fileKey:string|undefined,jsonFetch:JsonFetch,setReceipt:(receipt:Receipt)=>void,setNote:(note:string)=>void) {
  const [draft,setDraft]=useState<ReceiptDraft|null>(null),[drafts,setDrafts]=useState<ReceiptDraft[]>([]);
  const [fields,setFields]=useState<string[]>([]),[resolved,setResolved]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false);
  const base=`/api/receipt?tripId=${encodeURIComponent(planId)}`;
  const attach=useCallback((response:Response,replace=true)=>{
    setDraft(response.draft);setFields(response.reviewFields);setConfirmed(false);
    setResolved(response.draft.status==='reviewed'?response.reviewFields:[]);
    setNote(response.note??response.draft.warnings.join(' · '));
    if(replace)setReceipt(response.receipt);
    setDrafts(current=>[response.draft,...current.filter(entry=>entry.id!==response.draft.id)]);
  },[setReceipt,setNote]);
  useEffect(()=>{
    let cancelled=false;
    void jsonFetch(base).then(response=>{if(!cancelled)setDrafts(response.drafts);}).catch(()=>{});
    return ()=>{cancelled=true;};
  },[base,jsonFetch]);
  useEffect(()=>{
    if(!fileKey){setDraft(null);setFields([]);setResolved([]);setConfirmed(false);return;}
    if(draft?.fileKey===fileKey)return;
    let cancelled=false;
    void jsonFetch(`${base}&draftFileKey=${encodeURIComponent(fileKey)}`).then(response=>{if(!cancelled)attach(response,false);}).catch(()=>{});
    return ()=>{cancelled=true;};
  },[fileKey,draft?.fileKey,base,jsonFetch,attach]);
  function resolve(field:string){setResolved(current=>[...new Set([...current,field])]);setConfirmed(false);}
  function resolveKey(key:keyof Receipt){
    if(key==='tax'||key==='tip'||key==='discount'||key==='total')resolve(`${key}Cents`);
    else if(key==='merchant'||key==='date')resolve(key);
    else if(key==='rows')setConfirmed(false);
    else setConfirmed(false);
  }
  const unresolved=fields.filter(field=>!resolved.includes(field));
  return {draft,drafts,unresolved,confirmed,setConfirmed,attach,resolve,resolveKey,
    async history(before?:number){if(!draft)return null;return jsonFetch(`/api/receipt/history?tripId=${encodeURIComponent(planId)}&draftId=${encodeURIComponent(draft.id)}${before===undefined?'':`&before=${before}`}`);},
    unresolve(field:string){setResolved(current=>current.filter(value=>value!==field));setConfirmed(false);},
    resolveRemovedRows(rows:Receipt['rows']){for(const field of fields){const match=/^items\.(\d+)\.amountCents$/.exec(field);if(match&&!rows.some(row=>row.id===`line-${match[1]}`))resolve(field);}},
    blank:(field:string)=>!!draft&&unresolved.includes(field),
    blocked:!!draft&&(!confirmed||unresolved.length>0),
    async load(id:string){attach(await jsonFetch(`${base}&draftId=${encodeURIComponent(id)}`));},
    async review(receipt:Receipt,currency:string){
      if(!draft)return;
      if(!confirmed||unresolved.length)throw Error('Enter every unclear value and confirm the source review before saving.');
      const result=await jsonFetch(base,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draftId:draft.id,version:draft.version,receipt,resolvedFields:resolved,currency})});
      setDraft(result.draft);setDrafts(current=>[result.draft,...current.filter(entry=>entry.id!==result.draft.id)]);
    },
  };
}
export function ReceiptDraftReview({control,currency}:{control:ReturnType<typeof useReceiptDraft>;currency:string}){
  return <>
    {control.drafts.length>0&&<div className="field"><label>Saved uploads</label><select aria-label="Saved receipt uploads" value={control.draft?.id??''} onChange={event=>{if(event.target.value)void control.load(event.target.value);}}><option value="">Choose a saved receipt</option>{control.drafts.map(draft=><option key={draft.id} value={draft.id}>{draft.sourceFacts?.merchant??'Receipt upload'} · {draft.status==='reviewed'?'reviewed':'needs review'} · {draft.created.slice(0,10)}</option>)}</select></div>}
    {control.draft&&<div className="notice info"><span>Your upload is saved. Unclear source values remain unknown until you enter them. Review items, totals and currency against the original.</span></div>}
    {control.draft&&<ReceiptExtractionHistory key={control.draft.id} draft={control.draft} fetchPage={control.history}/>}
    {control.draft?.warnings.filter(warning=>/difficult|do not match|included/i.test(warning)).slice(0,3).map((warning,index)=><p className="notice warning" key={index}>{warning}</p>)}
    {control.draft?.sourceFacts?.currency&&control.draft.sourceFacts.currency!==currency&&<div className="notice warning receipt-source-currency"><strong>Source receipt: {control.draft.sourceFacts.currency} · Plan: {currency}</strong><p>Item names have been filled in. The original prices below are kept in their printed currency. Enter documented converted {currency} amounts in the editor; no exchange rate was assumed.</p><ul>{control.draft.sourceFacts.items.map((item,index)=><li key={index}>{item.name}<strong>{item.amountCents===null?'Unclear':formatMoney(item.amountCents!,control.draft!.sourceFacts!.currency!)}</strong></li>)}</ul>{control.draft.sourceFacts.totalCents!==null&&<p>Scanned total (verify against photo): <strong>{formatMoney(control.draft.sourceFacts.totalCents,control.draft.sourceFacts.currency)}</strong></p>}</div>}
    {control.draft&&control.draft.sourceFacts?.currency!==currency&&<label className="check-label"><input type="checkbox" style={{width:18,height:18,minHeight:18,flex:'0 0 18px',margin:0}} checked={!control.unresolved.includes('currency')} onChange={event=>event.target.checked?control.resolve('currency'):control.unresolve('currency')}/>I verified or manually converted these amounts to {currency}. No conversion was performed automatically.</label>}
    {control.draft&&control.unresolved.length>0&&<p className="source-footnote">Still required: {control.unresolved.map(field=>field.startsWith('items.')?`item ${Number(field.split('.')[1])+1} amount`:field.replace('Cents','')).join(', ')}.</p>}
    {control.draft&&<label className="check-label"><input type="checkbox" style={{width:18,height:18,minHeight:18,flex:'0 0 18px',margin:0}} checked={control.confirmed} disabled={control.unresolved.length>0} onChange={event=>control.setConfirmed(event.target.checked)}/>I checked the source, entered unclear values and verified the exact total.</label>}
  </>;
}
