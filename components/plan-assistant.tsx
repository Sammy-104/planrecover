'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles,Send,MessageCircle,ReceiptText,ArrowRight,LoaderCircle,Check,RotateCcw} from 'lucide-react';
import {assistantBrief,type AssistantTarget} from '@/lib/plan-assistant';
import {formatMoney,planCurrency} from '@/lib/money';
import {isDemoTrip,type State,type Action} from '@/lib/model';
import type {previewPlanDraft} from '@/lib/ai-plan';
type JsonFetch=(url:string,init?:RequestInit)=>Promise<any>;
type Draft=ReturnType<typeof previewPlanDraft>;
type ChatMessage={id:string;role:'user'|'assistant';text:string;mode?:string;notice?:string;prepared?:unknown[]};
type SavedConversation={id:string;version:number;title:string;pending:boolean;hasMore:boolean;nextBefore:string|null;prepared?:unknown[]};
function reviewLinks(prepared:unknown[]=[]){return prepared.flatMap(value=>{const url=(value as {result?:{reviewUrl?:unknown}})?.result?.reviewUrl;if(typeof url!=='string'||!url.startsWith('/flows?')||url.length>2000)return [];try{const parsed=new URL(url,'https://planrecover.invalid');return parsed.origin==='https://planrecover.invalid'&&parsed.pathname==='/flows'?[parsed.pathname+parsed.search]:[];}catch{return [];}});}
export function AssistantNudge({state,memberId,onAsk}:{state:State;memberId:string;onAsk:(prompt:string)=>void}){
 const brief=assistantBrief(state,memberId);
 return <section className="assistant-nudge" aria-label="PlanRecover assistant"><div className="assistant-avatar"><Sparkles size={20}/></div><div><strong>Your planning companion</strong><p>{brief[0].title}. Ask about your plan, costs or what to do next.</p></div><button className="btn" onClick={()=>onAsk('What needs my attention?')}>Ask PlanRecover<ArrowRight size={16}/></button></section>;
}
export function PlanAssistant({state,memberId,jsonFetch,onNavigate,onReceipt,onAction,canEdit,connected,visitorDemo=false,prompt,active}:{
 state:State;memberId:string;jsonFetch:JsonFetch;onNavigate:(target:AssistantTarget)=>void;onReceipt:()=>void;
 onAction:(action:Omit<Action,'actor'>,message?:string)=>Promise<State|undefined>;canEdit:boolean;connected:boolean;visitorDemo?:boolean;prompt?:{id:number;text:string};active:boolean;
}){
 const [messages,setMessages]=useState<ChatMessage[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [followUps,setFollowUps]=useState(['Show my schedule','Explain my money','What needs my attention?']),[draft,setDraft]=useState<Draft|null>(null),[draftBusy,setDraftBusy]=useState(false),[added,setAdded]=useState<number[]>([]),[adding,setAdding]=useState<number|null>(null);
 const [model,setModel]=useState(connected),[personalize,setPersonalize]=useState(false),[preferences,setPreferences]=useState<any>(null),[needs,setNeeds]=useState({diet:'',access:'',buffer:'15'}),[saving,setSaving]=useState(false);
 const [conversation,setConversation]=useState<SavedConversation|null>(null),[savedConversations,setSavedConversations]=useState<{id:string;title:string}[]>([]),[loadingHistory,setLoadingHistory]=useState(true);
 const fetchRef=useRef(jsonFetch),generation=useRef(0);fetchRef.current=jsonFetch;
 const end=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null),life=useRef<AbortController|null>(null),mounted=useRef(true);
 const lastPrompt=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;life.current?.abort();};},[]);
 useEffect(()=>{if(active)end.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages,busy,active]);
 useEffect(()=>{if(prompt&&prompt.id!==lastPrompt.current){lastPrompt.current=prompt.id;setInput(prompt.text);textarea.current?.focus();}},[prompt]);
 const planId=state.empty?undefined:state.plan.id;
 const demoMember=isDemoTrip(state)&&!state.people?memberId:undefined;
 const conversationQuery=new URLSearchParams({...planId?{planId}:{},...demoMember?{demoMember}:{}}).toString();
 async function loadConversation(id:string,older=false){
  const currentGeneration=generation.current,query=new URLSearchParams(conversationQuery);query.set('id',id);
  if(older&&conversation?.nextBefore)query.set('before',conversation.nextBefore);
  const value=await fetchRef.current(`/api/conversations?${query}`);
  if(!mounted.current||currentGeneration!==generation.current)return value;
  const restored:ChatMessage[]=value.messages.map((message:any)=>({id:message.id,role:message.role,text:message.text,mode:message.mode,prepared:message.metadata?.prepared,
   notice:message.role==='assistant'?(message.metadata?.planVersion!==undefined&&message.metadata.planVersion!==value.planVersion?'Saved answer from an earlier plan version. Ask again for current details.':message.metadata?.notice):message.mode==='interrupted'||message.mode==='pending'&&!value.pending?'This reply was interrupted. No AI request will be restarted automatically.':message.mode==='pending'?'A reply is still in progress. Check the saved reply below.':undefined}));
  setMessages(current=>older?[...restored,...current]:restored);setConversation(value);
  return value;
 }
 async function refreshConversations(){const currentGeneration=generation.current,value=await fetchRef.current(`/api/conversations?${conversationQuery}`);if(mounted.current&&currentGeneration===generation.current)setSavedConversations(value.conversations);return value.conversations;}
 useEffect(()=>{
  const currentGeneration=++generation.current;life.current?.abort();setBusy(false);setConversation(null);setMessages([]);setError('');setLoadingHistory(true);setDraft(null);setPreferences(null);setPersonalize(false);
  if(visitorDemo){setSavedConversations([]);setLoadingHistory(false);return;}
  void (async()=>{try{const value=await fetchRef.current(`/api/conversations?${conversationQuery}`);if(!mounted.current||currentGeneration!==generation.current)return;setSavedConversations(value.conversations);if(value.conversations[0])await loadConversation(value.conversations[0].id);}
   catch(error){if(mounted.current&&currentGeneration===generation.current)setError((error as Error).message);}
   finally{if(mounted.current&&currentGeneration===generation.current)setLoadingHistory(false);}})();
 },[planId,memberId,visitorDemo]);
 function newConversation(){generation.current++;life.current?.abort();setBusy(false);setConversation(null);setMessages([]);setInput('');setError('');setDraft(null);}
 async function send(text=input){
  const value=text.trim();if(!value||busy||loadingHistory||conversation?.pending)return;
  if(visitorDemo){setError('Sign in to chat with your saved PlanRecover plans.');return;}
  setError('');setBusy(true);setInput('');const currentGeneration=generation.current;let saved=conversation;
  life.current?.abort();const controller=new AbortController();life.current=controller;
  try{if(!saved){saved=await jsonFetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({planId:planId??null,...demoMember?{demoMember}:{},title:value.slice(0,100)})});if(mounted.current&&currentGeneration===generation.current)setConversation(saved);}
   if(!mounted.current||currentGeneration!==generation.current)return;
   setMessages(current=>[...current,{id:crypto.randomUUID(),role:'user',text:value}]);
   const result=await jsonFetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({planId,...demoMember?{demoMember}:{agent:true},message:value,conversationId:saved!.id,conversationVersion:saved!.version,requestId:crypto.randomUUID()})});
   if(!mounted.current||currentGeneration!==generation.current)return;setModel(result.modelConnected??connected);setFollowUps(result.followUps??[]);
   await loadConversation(saved!.id);if(mounted.current&&currentGeneration===generation.current)await refreshConversations();
  }catch(error){if(!controller.signal.aborted&&mounted.current&&currentGeneration===generation.current){setError((error as Error).message);setInput(value);if(saved)await loadConversation(saved.id).catch(()=>{});}}
  finally{if(mounted.current&&currentGeneration===generation.current)setBusy(false);}
 }
 async function buildDraft(){
  if(!planId||!canEdit||visitorDemo)return;
  if(!model){setError('Personalized AI drafts need the owner’s Bedrock connection. Saved-plan answers and receipt scanning work now.');return;}
  const question=input.trim()||'Suggest a practical itinerary that fits my interests, schedule and budget.';
  setDraftBusy(true);setError('');setDraft(null);setAdded([]);
  try{const current=await jsonFetch(`/api/plans/${encodeURIComponent(planId)}`);
   const result=await jsonFetch(`/api/plans/${encodeURIComponent(planId)}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({version:current.version,prompt:question})});if(mounted.current)setDraft(result.draft);
  }catch(error){if(mounted.current)setError((error as Error).message);}finally{if(mounted.current)setDraftBusy(false);}
 }
 async function loadPreferences(){
  setPersonalize(value=>!value);if(preferences||!planId)return;
  try{const value=await jsonFetch(`/api/plans/${encodeURIComponent(planId)}/me/planning-preferences`);setPreferences(value);
   setNeeds({diet:value.preferences.dietaryNeeds.join(', '),access:value.preferences.accessibilityNeeds.join(', '),buffer:String(value.preferences.bufferMinutes)});
  }catch(error){setError((error as Error).message);}
 }
 async function savePreferences(){
  if(!preferences||!planId)return;setSaving(true);setError('');
  try{const result=await jsonFetch(`/api/plans/${encodeURIComponent(planId)}/me/planning-preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({version:preferences.version,preferences:{...preferences.preferences,dietaryNeeds:[...new Set(needs.diet.split(',').map(value=>value.trim()).filter(Boolean))],
    accessibilityNeeds:[...new Set(needs.access.split(',').map(value=>value.trim()).filter(Boolean))],bufferMinutes:Number(needs.buffer)}})});setPreferences(result);setPersonalize(false);
  }catch(error){setError((error as Error).message);}finally{setSaving(false);}
 }
 const currency=planCurrency(state.plan),brief=state.empty?[]:assistantBrief(state,memberId),chatDisabled=busy||loadingHistory||!!conversation?.pending||visitorDemo;
 return <section className="assistant-page" aria-label="Chat with PlanRecover Sandbox">
  <div className="page-heading"><div><span className="assistant-eyebrow"><Sparkles size={16}/>A little help, right when you need it</span><h1>Chat with PlanRecover</h1><p className="muted">Your schedule, your money and a clearer next step.</p></div><span className="pill">{model?'AI + saved plan':'Saved-plan answers'}</span></div>
  <div className="assistant-layout"><div className="assistant-conversation panel">
   <div className="assistant-context"><span><MessageCircle size={17}/>{planId?state.plan.name:'Your saved plans'}</span><button className="text-button" disabled={busy||loadingHistory||!messages.length} onClick={newConversation}><RotateCcw size={14}/>New conversation</button></div>
   {!visitorDemo&&<div className="assistant-saved"><label className="field"><span>Private saved conversations</span><select aria-label="Saved conversations" value={conversation?.id??''} disabled={busy||loadingHistory} onChange={event=>{if(!event.target.value)newConversation();else{setLoadingHistory(true);void loadConversation(event.target.value).catch(error=>setError(error.message)).finally(()=>setLoadingHistory(false));}}}><option value="">New conversation</option>{savedConversations.map(saved=><option value={saved.id} key={saved.id}>{saved.title}</option>)}</select></label>{conversation&&<button className="text-button" disabled={busy||loadingHistory} onClick={()=>{void loadConversation(conversation.id).catch(error=>setError(error.message));}}>Check saved reply</button>}</div>}
   {reviewLinks(conversation?.prepared).length>0&&<aside className="notice"><strong>Your saved reviews</strong>{[...new Set(reviewLinks(conversation?.prepared))].map(url=><p key={url}><a href={url}>Open prepared review</a></p>)}<small>These remain available even if a reply was interrupted.</small></aside>}
   <div className="assistant-messages" role="log" aria-label="Conversation" aria-live="polite">
    {loadingHistory&&<p role="status">Loading your private conversation…</p>}{conversation?.hasMore&&<button className="text-button" disabled={loadingHistory||busy} onClick={()=>{setLoadingHistory(true);void loadConversation(conversation.id,true).catch(error=>setError(error.message)).finally(()=>setLoadingHistory(false));}}>Load earlier messages</button>}
    {!messages.length&&!loadingHistory&&<div className="assistant-welcome"><div className="assistant-avatar"><Sparkles size={26}/></div><h2>What would make planning easier?</h2><p>Ask me to explain costs, find the next thing to review, or walk through your day.</p><div className="assistant-starters">{['List my plans','Show my schedule','Explain my money','Help me scan a receipt'].map(question=><button className="btn" disabled={chatDisabled} key={question} onClick={()=>send(question)}>{question}<ArrowRight size={15}/></button>)}</div></div>}
    {messages.map(message=><article key={message.id} className={`assistant-message ${message.role}`}><strong>{message.role==='user'?'You':'PlanRecover'}</strong><p>{message.text}</p>{message.notice&&<small>{message.notice}</small>}{message.role==='assistant'&&<>{reviewLinks(message.prepared).map((url,index)=><p key={index}><a href={url}>Review prepared change{index?' '+(index+1):''}</a></p>)}<small className="assistant-source">{message.mode==='bedrock'?'AI answer using your saved plan':'From your saved PlanRecover records'}</small></>}</article>)}
    {busy&&<div className="assistant-thinking" role="status"><LoaderCircle size={17} className="spin"/>Checking your saved plan…</div>}<div ref={end}/>
   </div>
   {messages.length>0&&<div className="assistant-follow-ups">{followUps.map(question=><button className="text-button" key={question} disabled={chatDisabled} onClick={()=>send(question)}>{question}</button>)}</div>}
   {error&&<p className="notice warning" role="alert">{error}</p>}
   <form className="assistant-composer" onSubmit={event=>{event.preventDefault();void send();}}><label className="sr-only" htmlFor="assistant-message">Message PlanRecover</label><textarea ref={textarea} id="assistant-message" rows={2} maxLength={2000} value={input} disabled={chatDisabled} onChange={event=>setInput(event.target.value)} placeholder="Ask about your plan, costs or next steps…" onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/><button className="btn primary" disabled={chatDisabled||!input.trim()} type="submit" aria-label="Send message">{busy?<LoaderCircle size={18} className="spin"/>:<Send size={18}/>}<span>Send</span></button></form>
   <p className="assistant-footnote">{model?'AI can make mistakes. Check suggested details before adding them.':'Saved-plan answers work now. Connect Bedrock in Settings for flexible AI conversations and personalized drafts.'} Changes and payments always use the app’s review steps.</p>
  </div><aside className="assistant-side">
   <section className="panel"><h2>Make the next step easier</h2>{brief.map(item=><button className={`assistant-brief ${item.tone}`} key={item.title} onClick={()=>item.target==='draft'?void buildDraft():onNavigate(item.target)}><strong>{item.title}</strong><span>{item.detail}</span><ArrowRight size={16}/></button>)}
    <button className="btn full" disabled={!canEdit||!planId} onClick={onReceipt}><ReceiptText size={17}/>Scan a receipt</button>
   </section>
   <section className="panel"><h2>Plan with me</h2><p>Describe the day you want in the message box, then preview suggestions before adding any.</p><button className="btn primary full" disabled={!planId||!canEdit||draftBusy||visitorDemo} onClick={buildDraft}>{draftBusy?<LoaderCircle size={17} className="spin"/>:<Sparkles size={17}/>}Build a draft</button>{!model&&<p className="source-footnote">Personalized drafts need a Bedrock connection.</p>}
    <button className="text-button" disabled={!planId||!canEdit||visitorDemo} onClick={loadPreferences}>Personalize my suggestions</button>
    {personalize&&preferences&&<form className="assistant-preferences" onSubmit={event=>{event.preventDefault();void savePreferences();}}><p className="source-footnote">Private to you. Existing availability and reminder settings stay saved.</p><label className="field"><span>Dietary needs</span><input value={needs.diet} maxLength={1000} placeholder="Vegetarian, nut allergy" onChange={event=>setNeeds({...needs,diet:event.target.value})}/></label><label className="field"><span>Accessibility needs</span><input value={needs.access} maxLength={1000} placeholder="Step-free access, quiet spaces" onChange={event=>setNeeds({...needs,access:event.target.value})}/></label><label className="field"><span>Buffer between activities (minutes)</span><input type="number" min="0" max="240" value={needs.buffer} onChange={event=>setNeeds({...needs,buffer:event.target.value})}/></label><button className="btn" disabled={saving} type="submit">{saving?'Saving…':'Save my preferences'}</button></form>}
   </section>
  </aside></div>
  {draft&&<section className="panel assistant-draft"><div className="section-top"><div><h2>Your draft itinerary</h2><p>{draft.summary}</p></div><span className="pill">Review before adding</span></div>{draft.warnings.map((warning,index)=><p className="source-footnote" key={index}>{warning}</p>)}
   <div className="assistant-draft-items">{draft.items.map((item,index)=>{const problems=draft.constraints.items[index]?.issues??[],blocked=problems.some(issue=>issue.severity==='error');return <article key={index}><h3>{item.name}</h3><p>{item.localStart.replace('T',' ')} · {item.duration} minutes</p><p>{item.price===null?'Price unknown':formatMoney(item.price,currency)} · {item.reason}</p>{problems.map((issue,i)=><small key={i}>{issue.message}</small>)}<button className="btn" disabled={blocked||added.includes(index)||adding!==null||!canEdit} onClick={async()=>{setAdding(index);try{if(await onAction(item.action,'Suggestion added as an unapproved draft'))setAdded(current=>[...current,index]);}finally{setAdding(null);}}}>{added.includes(index)?<><Check size={16}/>Added as draft</>:blocked?'Resolve conflicts first':adding===index?'Adding…':'Add this draft'}</button></article>;})}</div>
  </section>}
 </section>;
}
