'use client';
import {useState} from 'react';
import {Check,LoaderCircle} from 'lucide-react';
import {formatMoney,planCurrency} from '@/lib/money';
import {reviewedAiDraftActions,selectableAiDraftItems,type ReviewedAiDraft,type AddDraftActions} from '@/lib/ai-draft-review';
import type {State} from '@/lib/model';

export function AiDraftReview({review,state,memberId,canEdit,onActions,onAdded}:{review:ReviewedAiDraft;state:State;memberId:string;canEdit:boolean;onActions:AddDraftActions;onAdded?:()=>void}){
 const eligible=selectableAiDraftItems(review.draft);
 const [selected,setSelected]=useState<number[]>(eligible),[adding,setAdding]=useState(false),[added,setAdded]=useState(false),[error,setError]=useState('');
 const stale=review.planId!==state.plan.id||review.version!==state.version||review.memberId!==memberId;
 const disabled=adding||added||!canEdit||stale;
 async function addSelected(){
  if(disabled||!selected.length)return;
  setError('');setAdding(true);
  try{
   const actions=reviewedAiDraftActions(review,state,memberId,selected);
   const saved=await onActions(actions,'Selected AI suggestions added as drafts',{planId:review.planId,version:review.version,batchId:review.batchId});
   if(saved){setAdded(true);onAdded?.();}
   else setError('The addition could not be confirmed. Check your itinerary before trying again.');
  }catch(value){setError((value as Error).message);}finally{setAdding(false);}
 }
 return <section className="ai-draft-review" aria-label="Review AI suggestions">
  <div className="section-top"><div><h3>{review.draft.items.length} AI suggestions</h3><p>{review.draft.summary}</p></div><span className="pill amber">Review before adding</span></div>
  <p className="source-footnote">Choose several suggestions and add them together. They stay unapproved until you review them. Prices and venue details need checking.</p>
  {!review.draft.items.length&&<p className="notice info">No activities fitted this request. Try a different day, interests or budget.</p>}
  {review.draft.items.length>0&&<div className="draft-selection-toolbar"><span aria-live="polite">{selected.length} selected</span><button className="text-button" disabled={disabled||!eligible.length} onClick={()=>setSelected(selected.length===eligible.length?[]:eligible)}>{selected.length===eligible.length?'Clear selection':'Select available'}</button></div>}
  <div className="chat-draft-items">{review.draft.items.map((item,index)=>{
   const issues=review.draft.constraints.items[index]?.issues??[],blocked=issues.some(issue=>issue.severity==='error');
   return <article key={index} className={blocked?'blocked':added&&selected.includes(index)?'added':''}>
    <label className="check-label"><input type="checkbox" checked={selected.includes(index)} disabled={disabled||blocked} onChange={event=>setSelected(current=>event.target.checked?[...current,index]:current.filter(value=>value!==index))}/><strong>{item.name}</strong></label>
    <p className="chat-draft-meta">{item.localStart.replace('T',' ')} · {item.duration} min</p>
    <p>{item.price===null?'Price unknown':formatMoney(item.price,planCurrency(state.plan))}</p>
    {blocked&&<p className="inline-error">{issues.find(issue=>issue.severity==='error')?.message}</p>}
    <details><summary>Why this suggestion & checks</summary><p>{item.reason}</p>{item.location&&<p>{item.location}</p>}{item.dependsOn.length>0&&<p className="chat-draft-deps">Proposed prerequisites: {item.dependsOn.map(id=>state.items.find(saved=>saved.id===id)?.name??id).join(', ')}. {item.dependencyReason} Confirm these in activity details after adding.</p>}{issues.map((issue,key)=><p key={key}>{issue.message}</p>)}</details>
   </article>;
  })}</div>
  {review.draft.warnings.length>0&&<details className="draft-review-notes"><summary>Planning notes ({review.draft.warnings.length})</summary>{review.draft.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>}
  {!added&&stale&&<p className="notice warning" role="status">Your plan changed. Generate fresh suggestions before adding them.</p>}
  {error&&<p className="notice warning" role="alert">{error}</p>}
  <div className="action-row draft-add-actions">{added?<p className="notice info" role="status"><Check size={16}/>Selected suggestions were added to your itinerary as drafts.</p>:<button className="btn primary" disabled={disabled||!selected.length} onClick={()=>void addSelected()}>{adding?<LoaderCircle size={16} className="spin"/>:null}{adding?'Adding suggestions…':selected.length?`Add ${selected.length} selected to itinerary`:'Select suggestions to add'}</button>}</div>
 </section>;
}
