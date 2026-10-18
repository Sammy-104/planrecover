'use client';
import {useState} from 'react';
import {dependencyReviewGroup,validateDependencies} from '@/lib/dependencies';
import type {Item,State} from '@/lib/model';

export function DependencyReview({state,item,actor,busy,canEdit,onAction}:{state:State;item:Item;actor:string;busy:boolean;canEdit:boolean;onAction:(action:Record<string,unknown>,message?:string)=>Promise<unknown>}){
 const suggested=item.suggestedDependencies;
 const [selected,setSelected]=useState<string[]>(suggested?.ids??item.depends),[source,setSource]=useState(suggested?.source??item.dependencyEvidence?.source??''),[confirmed,setConfirmed]=useState(false);
 let error='';try{validateDependencies(state.items.map(current=>({...current,depends:current.id===item.id?selected:current.depends})));}catch(reason){error=(reason as Error).message;}
 const names=(ids:string[])=>ids.map(id=>state.items.find(item=>item.id===id)?.name??id).join(', ');
 const affected=dependencyReviewGroup(state.items,item.id,selected).filter(id=>state.items.find(item=>item.id===id)?.status!=='cancelled');
 const person=state.people?.find(person=>person.id===item.dependencyEvidence?.confirmedBy)?.name??item.dependencyEvidence?.confirmedBy;
 return <section className="dependency-review terms-box" aria-label={`Prerequisites for ${item.name}`}>
  <h3>Required prerequisites</h3><p>{item.depends.length?`${item.name} requires ${names(item.depends)}.`:'No required prerequisites have been recorded.'}</p>
  <small>A prerequisite is required for this activity to remain useful. A useful shared hotel or optional support can stay independent.</small>
  {item.dependencyReviewPending&&<p className="notice info">These changed relationships await group approval. Recovery stays blocked until all affected activity revisions are approved.</p>}
  {item.dependencyEvidence?<p className="source-footnote">Source: {item.dependencyEvidence.source}<br/>Confirmed by {person} on {new Date(item.dependencyEvidence.confirmedAt).toLocaleDateString('en-CA')}.</p>:item.depends.length>0&&<p className="source-footnote">Source: {item.source}. These are pre-existing plan relationships.</p>}
  {item.dependencyReviewPending&&item.category==='Preparation'&&item.price===0&&<div><p>{item.approvals.length} of {(item.required??item.participants).length} approvals · revision {item.revision}</p>{canEdit&&(item.required??item.participants).includes(actor)&&!item.approvals.includes(actor)&&<button className="btn" disabled={busy} onClick={()=>onAction({type:'approve_item',itemId:item.id,revision:item.revision},'Your prerequisite revision approval was saved')}>Approve task prerequisites</button>}</div>}
  {canEdit&&item.status!=='cancelled'&&<details className="activity-options"><summary>{suggested?'Review suggested prerequisites':'Edit prerequisites'}</summary>
   {suggested&&<p className="notice info">AI proposed: {names(suggested.ids)}. These relationships are unconfirmed and are excluded from recovery until you confirm them.</p>}
   <fieldset className="dependency-choices"><legend>{item.name} requires:</legend>{state.items.filter(current=>current.id!==item.id&&current.status!=='cancelled').map(current=><label className="check-label" key={current.id}><input type="checkbox" disabled={busy} checked={selected.includes(current.id)} onChange={event=>{setSelected(event.target.checked?[...selected,current.id]:selected.filter(id=>id!==current.id));setConfirmed(false);}}/>{current.name}</label>)}{state.items.filter(current=>current.id!==item.id&&current.status!=='cancelled').length===0&&<p>Add another activity before linking prerequisites.</p>}</fieldset>
   <label className="field"><span>Source or reason for this relationship</span><textarea rows={2} maxLength={600} value={source} disabled={busy} placeholder="Supplier terms, reservation details or a planning decision" onChange={event=>{setSource(event.target.value);setConfirmed(false);}}/></label>
   <p className="source-footnote">Saving creates a new revision for {names(affected)}. Each affected activity needs fresh group approval; recorded payments stay in its history.</p>
   <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I confirm these are required prerequisites and have reviewed the source.</label>
   {error&&<p className="inline-error" role="alert">{error}</p>}<button className="btn" disabled={busy||!confirmed||!source.trim()||!!error} onClick={async()=>{if(await onAction({type:'item_dependencies',itemId:item.id,revision:item.revision,depends:selected,source,confirm:true},'Prerequisites saved; affected activities need fresh approval'))setConfirmed(false);}}>Save prerequisites</button>
  </details>}
 </section>;
}
