'use client';
import {type State,type Item,planReminders,isDemoTrip} from '@/lib/model';
import {useContext,useState} from 'react';
import {ArrowRight,Bell,CheckCheck,FileCheck2,ReceiptText,Users,Vote} from 'lucide-react';
import {RemindersInbox} from '@/components/reminders-inbox';
import {ReminderCenter} from '@/components/reminder-center';
import {Checkbox} from '@/components/ui/checkbox';
import {receiptRequiredMembers} from '@/lib/receipt-accounting';
import {useMoney,useGroup,EditingContext,jsonFetch,Pill,datetime,Choose} from './shared';
import {PreparationTasks} from './plan';
export function Decisions({state,actor,busy,act,onItem}:{state:State;actor:string;busy:boolean;act:any;onItem:(i:Item)=>void}){const {dollars}=useMoney();const {members,memberIds,name}=useGroup();const canEdit=useContext(EditingContext);busy=busy||!canEdit;const [departing,setDeparting]=useState('chris');
 const drafts=state.items.filter(i=>i.status==='draft'),proposals=state.proposals.filter(p=>p.status!=='executed'),receipts=state.receipts.filter(r=>r.status==='review'),reminders=planReminders(state),openReminders=reminders.filter(r=>!r.done);
 const decisionTotal=drafts.length+proposals.length+receipts.length;
 return <div className="todo-page">
  <div className="page-heading"><div><p className="eyebrow">Agreement before action</p><h1>To do</h1><p className="page-subtitle">Review group decisions and upcoming reminders.</p></div></div>
  <div className="todo-summary" role="list" aria-label="To do summary">
   <div role="listitem" className={`todo-stat ${decisionTotal?'attention':''}`}><span className="todo-stat-icon"><Vote size={18}/></span><div><strong>{decisionTotal}</strong><span>{decisionTotal===1?'decision waiting':'decisions waiting'}</span></div></div>
   <div role="listitem" className={`todo-stat ${openReminders.length?'attention':''}`}><span className="todo-stat-icon"><Bell size={18}/></span><div><strong>{openReminders.length}</strong><span>{openReminders.length===1?'open reminder':'open reminders'}</span></div></div>
   <div role="listitem" className="todo-stat"><span className="todo-stat-icon"><Users size={18}/></span><div><strong>{memberIds.length}</strong><span>{memberIds.length===1?'planner':'planners'} in this plan</span></div></div>
  </div>
  {state.people&&<div className="todo-flows"><FileCheck2 size={20}/><div><strong>Changes, refunds and invoices</strong><p>Continue saved proposals, review exact shares and manage payment terms.</p></div><a className="btn primary" href={`/flows?plan=${encodeURIComponent(state.plan.id!)}`}>Open reviews<ArrowRight size={16}/></a></div>}
  <div className="todo-layout">
   <div className="todo-main">
    <section className="todo-group" aria-labelledby="todo-agreement">
     <header className="todo-group-head"><h2 id="todo-agreement">Items awaiting agreement</h2><span className="tab-count">{decisionTotal}</span></header>
     {decisionTotal===0&&<div className="todo-empty"><CheckCheck size={22}/><div><strong>You’re all caught up</strong><p>No item approvals pending. Add a suggestion to try the flow.</p></div></div>}
     {drafts.length>0&&<ul className="todo-list">{drafts.map(i=>{const required=(i.required??i.participants).length;return <li className="todo-row" key={i.id}>
      <span className="todo-row-icon"><Vote size={17}/></span>
      <div className="todo-row-text"><strong>{i.name}</strong><small>{i.approvals.length}/{required} approvals · revision {i.revision}</small><span className="todo-progress" aria-hidden><span style={{width:`${required?Math.min(100,i.approvals.length/required*100):0}%`}}/></span></div>
      <strong className="todo-row-amount">{i.price===null?'Unknown':dollars(i.shares[actor]??0)}</strong>
      <button className="btn small-btn" onClick={()=>onItem(i)}>Review</button>
     </li>;})}</ul>}
     {receipts.length>0&&<ul className="todo-list">{receipts.map(r=>{const required=receiptRequiredMembers(r,memberIds);return <li className="todo-row" key={r.id}>
      <span className="todo-row-icon receipt"><ReceiptText size={17}/></span>
      <div className="todo-row-text"><strong>{r.merchant}</strong><small>Receipt · {r.approvals.filter(id=>required.includes(id)).length}/{required.length} approvals · revision {r.revision}</small></div>
      <strong className="todo-row-amount">{dollars(r.shares[actor]??0)}</strong>
      <Pill tone={r.approvals.includes(actor)||!required.includes(actor)?'green':'amber'}>{!required.includes(actor)?'Not affected':r.approvals.includes(actor)?'Approved':'Review in Receipts'}</Pill>
     </li>;})}</ul>}
     {proposals.map(p=><article key={p.id} className="todo-proposal">
      <div className="todo-proposal-head"><div><Pill tone={p.status==='approved'?'green':'amber'}>{p.status==='approved'?'Approved':'Proposal'}</Pill><h3>{p.title}</h3></div><span className="todo-proposal-count">{p.approved.length}/{p.required.length}</span></div>
      <p>{p.approved.length}/{p.required.length} affected members approved</p>
      <div className="todo-approvers">{p.required.map(id=><span key={id} className={p.approved.includes(id)?'approved':''}>{name(id)}</span>)}</div>
      {p.newShares&&<p className="muted">Proposed lodge shares: {Object.entries(p.newShares).map(([id,n])=>`${name(id)} ${dollars(n)}`).join(' · ')}. Existing commitments stay in force until approval.</p>}
      <div className="action-row">{!p.approved.includes(actor)&&<button className="btn primary" disabled={busy} onClick={()=>act({type:'approve_proposal',proposalId:p.id,revision:p.revision},'Proposal approved as current demo member')}>Approve as {name(actor)}</button>}{p.status==='approved'&&<button className="btn primary" disabled={busy} onClick={()=>act({type:'execute_proposal',proposalId:p.id},'Approved change applied with a ledger adjustment')}>Apply approved change</button>}</div>
     </article>)}
    </section>
    <ReminderCenter state={state} actor={actor} busy={busy} readOnly={!canEdit} act={act} onItem={onItem}/>
   </div>
   <aside className="todo-side">
    {state.people&&state.plan.id&&<RemindersInbox key={`${state.plan.id}-${actor}`} planId={state.plan.id} memberId={actor} version={state.version} timezone={state.plan.timezone} jsonFetch={jsonFetch}/>}
    <section className="todo-group" aria-labelledby="todo-upcoming">
     <header className="todo-group-head"><h2 id="todo-upcoming">Upcoming reminders</h2><Pill>In-app</Pill></header>
     {!reminders.length&&<p className="muted todo-pad">Nothing scheduled yet.</p>}
     <ul className="todo-checklist">{reminders.map(r=><li key={r.id} className={`todo-check ${r.done?'done':''}`}><Checkbox disabled={!canEdit||busy} aria-label={`Mark ${r.title} done`} checked={r.done} onCheckedChange={v=>act(r.taskId?{type:'task',itemId:r.taskId,done:v}:{type:'reminder',reminderId:r.id,done:v})}/><div><strong>{r.title}</strong><span>{datetime(r.due,state.plan.timezone)} · {state.plan.timezone}</span>{r.consequence&&<p>{r.consequence}</p>}{state.items.some(item=>item.id===r.itemId)&&<button className="text-button" onClick={()=>onItem(state.items.find(item=>item.id===r.itemId)!)}>View {r.taskId?'task':'item'}</button>}</div></li>)}</ul>
     <p className="source-footnote todo-pad">Provider cutoffs are labelled demo terms. Unknown cutoffs are shown as unknown. Saved notifications appear in your private inbox above when available.</p>
    </section>
    <PreparationTasks state={state} busy={busy||!canEdit} act={act} onItem={onItem}/>
    {isDemoTrip(state)&&<section className="todo-group todo-member-change"><div className="todo-member-head"><span className="todo-row-icon"><Users size={17}/></span><div><h2>A friend’s availability changed?</h2><p>Inspect the non-refundable lodge commitment, then propose a new split. Reporting a departure never rewrites approved costs.</p></div></div><div className="todo-member-controls"><Choose label="Departing member" value={departing} onChange={setDeparting} options={members.filter(m=>memberIds.includes(m.id)).map(m=>({value:m.id,label:m.name}))}/><button className="btn" disabled={busy} onClick={()=>act({type:'departure',departing},'Departure proposal created; existing shares preserved')}>Propose departure</button></div></section>}
   </aside>
  </div>
 </div>;}
