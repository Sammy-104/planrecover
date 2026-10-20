'use client';
import {draftCityState} from '@/lib/city-stays';
import {useEffect,useRef,useState} from 'react';
import {DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Sparkles,LoaderCircle} from 'lucide-react';
import {createPlanDraft,type PlanDraft,type DraftEntry} from '@/lib/plan-draft';
import {localDateTime,zonedStart} from '@/lib/trip-time';
import {formatMoney} from '@/lib/money';
import {DateTimeField} from '@/components/time-field';
import {AiDraftReview} from '@/components/ai-draft-review';
import type {ReviewedAiDraft,AddDraftActions} from '@/lib/ai-draft-review';
import type {State,Action} from '@/lib/model';

export function PlanDraftDialog({state:original,selectedDay,actor,ai,visitorDemo,busy,request,act,onActions,onState,onClose}:{
 state:State;selectedDay?:string;actor:string;ai:boolean;visitorDemo:boolean;busy:boolean;
 request:(url:string,options?:RequestInit)=>Promise<any>;
 act:(a:Omit<Action,'actor'>,message?:string)=>Promise<unknown>;onActions:AddDraftActions;
 onState:(s:State)=>void;onClose:()=>void;
}){
 const day=selectedDay??original.plan.start,state=draftCityState(original,day);
 const [goal,setGoal]=useState(state.plan.goal),[draft,setDraft]=useState<PlanDraft|null>(null),[aiDraft,setAiDraft]=useState<ReviewedAiDraft|null>(null);
 const [selected,setSelected]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[useAI,setUseAI]=useState(ai&&!visitorDemo),[timeErrors,setTimeErrors]=useState<Record<string,string>>({});
 const life=useRef<AbortController|null>(null),mounted=useRef(true),current=useRef({planId:original.plan.id,version:original.version,actor,day});
 current.current={planId:original.plan.id,version:original.version,actor,day};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;life.current?.abort();};},[]);
 function changeMode(value:boolean){life.current?.abort();setLoading(false);setUseAI(value);setDraft(null);setAiDraft(null);setTimeErrors({});setError('');}
 async function generate(){
  if(loading||busy)return;
  const scope={...current.current},controller=new AbortController();life.current?.abort();life.current=controller;
  const isCurrent=()=>mounted.current&&!controller.signal.aborted&&current.current.planId===scope.planId&&current.current.version===scope.version&&current.current.actor===scope.actor&&current.current.day===scope.day;
  setLoading(true);setError('');setTimeErrors({});setDraft(null);setAiDraft(null);
  try{
   if(useAI&&ai&&!visitorDemo){
    const record=await request(`/api/plans/${encodeURIComponent(scope.planId!)}`,{signal:controller.signal});
    if(!isCurrent())return;
    const result=await request(`/api/plans/${encodeURIComponent(scope.planId!)}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
     body:JSON.stringify({version:record.version,prompt:`Focus on ${day} in ${state.plan.destination}. ${goal}`})});
    if(isCurrent())setAiDraft({planId:scope.planId!,version:scope.version,memberId:scope.actor,batchId:crypto.randomUUID(),draft:result.draft});
   }else{
    const result=visitorDemo?{draft:createPlanDraft(state,goal,actor),note:'Demo suggestions from saved places.'}:await request('/api/plan-draft',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({tripId:state.plan.id,day,goal,ai:false})});
    if(!isCurrent())return;
    if(result.state)onState(result.state);
    setDraft(result.draft);setSelected(result.draft.entries.map((entry:DraftEntry)=>entry.suggestionId));setNote(result.note);
   }
   if(!isCurrent()&&mounted.current&&!controller.signal.aborted)setError('Your plan changed while suggestions were being prepared. Generate fresh suggestions.');
  }catch(value){if(isCurrent())setError((value as Error).message);}
  finally{if(mounted.current&&life.current===controller)setLoading(false);}
 }
 function update(id:string,change:Partial<DraftEntry>){setDraft(value=>value?{...value,entries:value.entries.map(entry=>entry.suggestionId===id?{...entry,...change}:entry)}:value);}
 const stale=draft&&(draft.tripId!==state.plan.id||draft.version!==state.version);
 return <DialogContent className="modal-large plan-draft-dialog">
  <DialogHeader><DialogTitle>Plan activities</DialogTitle><DialogDescription>{state.plan.destination} · {day} · Choose suggestions before adding them</DialogDescription></DialogHeader>
  <div className="modal-body">
   <label className="field"><span>What would you like to do?</span><textarea value={goal} onChange={event=>setGoal(event.target.value)} maxLength={1200} placeholder="A relaxed day with a museum, local food and time between stops"/></label>
   <div className="segmented draft-mode-picker" role="group" aria-label="Suggestion source">
    <button type="button" aria-pressed={useAI} disabled={!ai||visitorDemo||loading} onClick={()=>changeMode(true)}><Sparkles size={15}/>AI suggestions</button>
    <button type="button" aria-pressed={!useAI} disabled={loading} onClick={()=>changeMode(false)}>Saved places</button>
   </div>
   {!ai&&!visitorDemo&&<p className="source-footnote">AI suggestions need the owner’s Bedrock connection. You can use saved places now.</p>}
   <button className="btn primary" disabled={loading||busy||goal.trim().length<8} onClick={()=>void generate()}>{loading?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {loading?'Preparing suggestions…':'Suggest activities'}</button>
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {aiDraft&&<AiDraftReview key={aiDraft.batchId} review={aiDraft} state={original} memberId={actor} canEdit={!busy} onActions={onActions} onAdded={onClose}/>}
   {draft&&<>
    <div className="draft-result-heading"><h3>{draft.entries.length} suggested visits</h3><span className="pill">Saved places</span></div>
    <div className="draft-selection-toolbar"><span aria-live="polite">{selected.length} selected</span><button className="text-button" disabled={busy||loading||!!stale} onClick={()=>setSelected(selected.length===draft.entries.length?[]:draft.entries.map(entry=>entry.suggestionId))}>{selected.length===draft.entries.length?'Clear selection':'Select all'}</button></div>
    <div className="draft-entries">{draft.entries.map(entry=><article key={entry.suggestionId} className="draft-entry">
     <label className="check-label"><input type="checkbox" disabled={busy||loading||!!stale} checked={selected.includes(entry.suggestionId)} onChange={event=>setSelected(current=>event.target.checked?[...current,entry.suggestionId]:current.filter(id=>id!==entry.suggestionId))}/><strong>{entry.place.name}</strong></label>
     <p>{localDateTime(entry.start,entry.place.timezone??state.plan.timezone).replace('T',' ')} · {entry.duration} min · {entry.place.price===null?'Cost unknown':formatMoney(entry.place.price,state.plan.currency)}</p>
     <details><summary>Time, duration & place details</summary><p>{entry.reason}</p><div className="form-grid"><label className="field"><span>Start ({entry.place.timezone??state.plan.timezone})</span><DateTimeField value={localDateTime(entry.start,entry.place.timezone??state.plan.timezone)} onChange={value=>{try{update(entry.suggestionId,{start:zonedStart(value,entry.place.timezone??state.plan.timezone)});setTimeErrors(current=>({...current,[entry.suggestionId]:''}));}catch{setTimeErrors(current=>({...current,[entry.suggestionId]:'Enter a valid date and time.'}));}}}/>{timeErrors[entry.suggestionId]&&<small className="inline-error">{timeErrors[entry.suggestionId]}</small>}</label><label className="field"><span>Visit minutes</span><input type="number" min="1" max="1440" value={entry.duration} onChange={event=>update(entry.suggestionId,{duration:Number(event.target.value)})}/></label></div><small>{entry.place.sourceLabel??'Demo catalog'}</small>{entry.place.sourceUrl&&<p><a href={entry.place.sourceUrl} target="_blank" rel="noreferrer">View place source</a></p>}{entry.warnings.map(warning=><p key={warning}>{warning}</p>)}</details>
    </article>)}</div>
    <details className="draft-review-notes"><summary>Planning notes</summary><p>{note}</p>{draft.warnings.map(warning=><p key={warning}>{warning}</p>)}{draft.assumptions.map(assumption=><p key={assumption}>{assumption}</p>)}</details>
    {stale&&<p className="notice warning">Your plan changed after this draft. Generate a fresh one before adding.</p>}
   </>}
  </div>
  <DialogFooter><button className="btn" onClick={onClose}>Close</button>{draft&&<button className="btn primary" disabled={busy||loading||!!stale||!selected.length||selected.some(id=>!!timeErrors[id])} onClick={async()=>{if(await act({type:'apply_draft',draftId:draft.id,planningDay:draft.planningDay,travelMode:draft.travelMode,routeSourceIds:draft.routeSourceIds,entries:draft.entries.filter(entry=>selected.includes(entry.suggestionId)).map(({suggestionId,start,duration})=>({suggestionId,start,duration}))},'Selected activities added as drafts'))onClose();}}>Add {selected.length||''} selected to itinerary</button>}</DialogFooter>
 </DialogContent>;
}
