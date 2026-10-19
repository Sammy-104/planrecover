'use client';
import {useEffect,useState} from 'react';
import {formatMoney,parseMoney} from '@/lib/money';
import {purchaseEvents} from '@/lib/receipt-accounting';

async function call(path:string,method='GET',body?:unknown){const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const result=await response.json() as any;if(!response.ok)throw Error(result.error??'Outside booking review could not be saved.');return result;}
export function ExternalRecoveryReview({record,onChanged}:{record:{state:any;version:number;role:string;memberId:string};onChanged:()=>Promise<unknown>}){
 const {state,role,memberId}=record,planId=state.plan.id,base=`/api/plans/${encodeURIComponent(planId)}`,currency=state.plan.currency??'CAD',owner=role==='owner';
 const [resolutions,setResolutions]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [form,setForm]=useState({itemId:'',refund:'0',evidence:'',sourceUrl:'',reference:''}),[received,setReceived]=useState<Record<string,string>>({}),[requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const people=state.people??[],name=(id:string)=>people.find((person:any)=>person.id===id)?.name??id,money=(amount:number)=>formatMoney(amount,currency);
 const items=state.items.filter((item:any)=>item.status!=='cancelled'&&purchaseEvents(state,item.id).some((event:any)=>event.kind==='expense'&&event.status==='confirmed'&&event.mode==='manual'));
 const contributions:Record<string,number>={};for(const event of purchaseEvents(state,form.itemId).filter((entry:any)=>entry.status==='confirmed'&&entry.kind!=='settlement'))for(const [id,amount]of Object.entries(event.contributions))contributions[id]=(contributions[id]??0)+Number(amount);
 const payers=Object.keys(contributions).filter(id=>contributions[id]>0);
 async function load(){const result=await call(base+'/external-recoveries');setResolutions(result.resolutions??[]);}
 useEffect(()=>{let live=true;setResolutions([]);setForm({itemId:'',refund:'0',evidence:'',sourceUrl:'',reference:''});setReceived({});setRequestId(crypto.randomUUID());setError('');void call(base+'/external-recoveries').then(result=>{if(live)setResolutions(result.resolutions??[]);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[base]);
 async function run(action:string,id?:string){setBusy(true);setError('');setNotice('');try{
  const fresh=await call(base);
  if(action==='prepare')await call(base+'/external-recoveries','POST',{action,version:fresh.version,requestId,itemId:form.itemId,refundAmount:parseMoney(form.refund,currency),evidence:form.evidence,sourceUrl:form.sourceUrl,reference:form.reference,...(payers.length>1?{refundContributions:Object.fromEntries(payers.map(payer=>[payer,parseMoney(received[payer]??'0',currency)]))}:{})});
  else await call(base+'/external-recoveries','POST',{action,id,version:fresh.version,confirm:true});
  await load();await onChanged();setNotice(action==='prepare'?'Exact outside cancellation evidence saved for affected-member review.':action==='apply'?'The reviewed cancellation and received refund were recorded. Original payments remain in history.':'Your review was saved.');if(action==='prepare')setRequestId(crypto.randomUUID());
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <details className="panel"><summary>Outside bookings: reviewed cancellation and received refunds</summary>
  <p>Record a cancellation already handled directly with an outside supplier. Enter only a refund that the original payer has actually received. This review does not contact the supplier or transfer money.</p>
  {error&&<p role="alert" className="notice warning">{error} <button className="text-button" onClick={()=>void load().catch(e=>setError(e.message))}>Refresh reviews</button></p>}{notice&&<p role="status">{notice}</p>}
  {owner&&<fieldset disabled={busy}><legend>Prepare evidence for affected people</legend>
   <label className="field"><span>Paid outside booking</span><select value={form.itemId} onChange={e=>{setForm({...form,itemId:e.target.value});setReceived({});setRequestId(crypto.randomUUID());}}><option value="">Choose a manual purchase</option>{items.map((item:any)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <label className="field"><span>Refund already received ({currency}); enter 0 if none</span><input inputMode="decimal" value={form.refund} onChange={e=>setForm({...form,refund:e.target.value})}/></label>
   {payers.length>1&&<><p>Assign the received refund exactly to the original cash contributors.</p>{payers.map(payer=><label className="field" key={payer}><span>{name(payer)} received ({currency}); original contribution {money(contributions[payer])}</span><input inputMode="decimal" value={received[payer]??'0'} onChange={e=>setReceived({...received,[payer]:e.target.value})}/></label>)}</>}
   <label className="field"><span>Cancellation and received-refund evidence</span><textarea minLength={10} maxLength={5000} value={form.evidence} onChange={e=>setForm({...form,evidence:e.target.value})}/></label>
   <label className="field"><span>Supplier source link (HTTPS)</span><input type="url" value={form.sourceUrl} onChange={e=>setForm({...form,sourceUrl:e.target.value})}/></label>
   <label className="field"><span>Supplier confirmation or refund reference</span><input value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></label>
   <button className="btn" disabled={!form.itemId||form.evidence.trim().length<10||!form.sourceUrl||!form.reference} onClick={()=>void run('prepare')}>Save exact evidence for review</button>
  </fieldset>}
  {!resolutions.length&&<p>No outside cancellation reviews are saved.</p>}
  {resolutions.map(resolution=>{const terms=resolution.terms;return <article className="flows-card" key={resolution.id}><h3>{terms.itemName}</h3>
   <div className="financial-review"><dl><dt>Recorded purchase cost</dt><dd>{money(terms.recordedCost)}</dd><dt>Received refund</dt><dd>{money(terms.refundAmount)}</dd><dt>Retained cost</dt><dd>{money(terms.retainedCost)}</dd><dt>Supplier reference</dt><dd>{terms.reference}</dd><dt>Reviewed evidence</dt><dd>{terms.evidence}</dd></dl>
    <p><a href={terms.sourceUrl} target="_blank" rel="noreferrer">Open supplier source</a></p>
    <h4>Refund received by original payers</h4><ul>{Object.entries(terms.refundContributions).map(([id,amount])=><li key={id}>{name(id)}: {money(Number(amount))}</li>)}</ul>
    <h4>Cost reduction for beneficiaries</h4><ul>{Object.entries(terms.refundShares).map(([id,amount])=><li key={id}>{name(id)}: {money(Number(amount))}</li>)}</ul>
    <p>{terms.required.map((id:string)=>`${name(id)}: ${resolution.approved.includes(id)?'approved':'pending'}`).join('; ')}</p><p>Manual evidence · {resolution.status}. Original obligations stay in force until all affected people approve and the owner applies this review.</p>
   </div>
   {resolution.status==='review'&&<div className="flows-buttons">
    {terms.required.includes(memberId)&&!resolution.approved.includes(memberId)&&<button className="btn" disabled={busy||role==='viewer'} onClick={()=>void run('approve',resolution.id)}>Approve this exact evidence and refund</button>}
    {owner&&<><button className="btn primary" disabled={busy||!resolution.fullyApproved} onClick={()=>void run('apply',resolution.id)}>Apply reviewed outside cancellation</button><button className="btn" disabled={busy} onClick={()=>void run('cancel',resolution.id)}>Cancel this review</button></>}
   </div>}
  </article>;})}
 </details>;
}
