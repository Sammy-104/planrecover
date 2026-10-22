'use client';
import {useEffect,useRef,useState} from 'react';
import {formatMoney} from '@/lib/money';
import {AgentDemoClient} from '@/lib/agent-demo-client';
async function send(path:string,body?:unknown,signal?:AbortSignal){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),result=await response.json() as any;
 if(!response.ok)throw Error(result.error??'This request could not finish. Your reviews stay saved.');return result;
}
export default function AgentDemo(){
 const client=useRef<AgentDemoClient|null>(null);
 const [connection,setConnection]=useState<'connecting'|'ready'|'error'>('connecting'),[connectionAttempt,setConnectionAttempt]=useState(0);
 const [restoring,setRestoring]=useState(false),[restored,setRestored]=useState(false),[restoreError,setRestoreError]=useState(false);
 async function tool(name:string,args:Record<string,unknown>){if(!client.current)throw Error('Connect to the planning tools first.');return client.current.call(name,args);}

 const [question,setQuestion]=useState(''),[conversation,setConversation]=useState<any>(null);
 const [plans,setPlans]=useState<any[]>([]),[planId,setPlanId]=useState(''),[answer,setAnswer]=useState('Choose a saved plan, then try a request.'),[busy,setBusy]=useState(false),[review,setReview]=useState(''),[name,setName]=useState(''),[destination,setDestination]=useState(''),[date,setDate]=useState('');
 async function run(action:()=>Promise<void>){if(busy||restoring||connection!=='ready')return;setBusy(true);setReview('');try{await action();}catch(error){setAnswer((error as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{
  let stopped=false;const current=new AgentDemoClient(new URL('/api/agent-client',window.location.origin));client.current=current;setConnection('connecting');
  void(async()=>{try{await current.connect();const result=await current.call('list_plans',{});if(stopped)return;setPlans(result.plans);setPlanId(previous=>result.plans.some((plan:any)=>plan.id===previous)?previous:result.plans[0]?.id??'');setConnection('ready');}catch(error){if(!stopped){setConnection('error');setAnswer((error as Error).message);}}})();
  return()=>{stopped=true;if(client.current===current)client.current=null;void current.close().catch(()=>{});};
 },[connectionAttempt]);
 const selected=plans.find(p=>p.id===planId),display=(value:number)=>formatMoney(value,selected?.currency??'CAD');
 useEffect(()=>{
  const controller=new AbortController();setConversation(null);setReview('');setRestored(false);setRestoreError(false);
  if(!planId||connection!=='ready'){setRestoring(false);return()=>controller.abort();}
  setRestoring(true);setAnswer('Reopening your saved conversation.');
  void(async()=>{try{
   const list=await send('/api/conversations?planId='+encodeURIComponent(planId),undefined,controller.signal),latest=list.conversations?.[0];
   if(!latest){if(!controller.signal.aborted)setAnswer('Your saved plan is ready. Ask a question or prepare a change.');return;}
   const saved=await send('/api/conversations?id='+encodeURIComponent(latest.id)+'&planId='+encodeURIComponent(planId),undefined,controller.signal);
   if(controller.signal.aborted)return;setConversation({id:saved.id,version:saved.version});
   const last=saved.messages?.filter((message:any)=>message.role==='assistant').at(-1);setAnswer(last?.text??'Your saved plan is ready. Ask a question or prepare a change.');
   const reviews=[...(last?.metadata?.prepared??[]),...(saved.prepared??[])],url=reviews.find((entry:any)=>typeof entry.result?.reviewUrl==='string'&&entry.result.reviewUrl.startsWith('/flows?'))?.result.reviewUrl;if(url)setReview(url);setRestored(true);
  }catch(error){if(!controller.signal.aborted){setRestoreError(true);setAnswer((error as Error).message);}}finally{if(!controller.signal.aborted)setRestoring(false);}})();
  return()=>controller.abort();
 },[planId,connection]);
 async function ask(){await run(async()=>{
  const send=async(path:string,body?:unknown)=>{const response=await fetch(path,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),result=await response.json() as any;if(!response.ok)throw Error(result.error??'This request could not finish. Your reviews stay saved.');return result;};
  const saved=conversation??await send('/api/conversations',{planId:planId||null,title:question.slice(0,100)});setConversation(saved);
  const current=await send(`/api/conversations?id=${encodeURIComponent(saved.id)}${planId?'&planId='+encodeURIComponent(planId):''}`);
  const response=await send('/api/assistant',{...(planId?{planId}:{}),agent:true,message:question,conversationId:saved.id,conversationVersion:current.version,requestId:crypto.randomUUID()});
  setAnswer(response.reply+(response.notice?'\n'+response.notice:''));setQuestion('');setConversation({...saved,version:response.conversationVersion});
  const url=response.prepared?.find((p:any)=>typeof p.result?.reviewUrl==='string'&&p.result.reviewUrl.startsWith('/flows?'))?.result.reviewUrl;if(url)setReview(url);
 });}
 return <main className="agent-demo"><a href="/">← Back to Knota</a><h1>Voice assistant demo</h1><p>This simulated client uses your authenticated Knota tools. A physical Alexa+ connection is still a separate setup step.</p>
 <label>Saved plan<select value={planId} disabled={busy||restoring||connection!=='ready'} onChange={event=>setPlanId(event.target.value)}><option value="">Create a new plan</option>{plans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
 <p role="status">{connection==='connecting'?'Connecting to your planning tools.':connection==='ready'?'Planning tools connected.':'The planning tools could not connect.'}</p>{connection==='error'&&<button className="btn" onClick={()=>setConnectionAttempt(value=>value+1)}>Try connecting again</button>}
 <form className="panel" onSubmit={event=>{event.preventDefault();void ask();}}><h2>Ask in your own words</h2>{restoring&&<p role="status">Reopening your saved conversation.</p>}{restored&&<p>Saved conversation restored for this plan.</p>}{restoreError&&<p>Your saved conversation could not be restored. Reconnect to try again, or explicitly start a new conversation.</p>}{planId&&<button className="btn" type="button" disabled={busy||restoring||connection!=='ready'} onClick={()=>{setConversation(null);setRestored(false);setRestoreError(false);setAnswer('A new conversation will start with your next request. Your saved plan and reviews stay available.');}}>Start a new conversation</button>}<label>Your request<input value={question} onChange={event=>setQuestion(event.target.value)} maxLength={2000} placeholder="Plan a day in Toronto, or help me change my saved plan"/></label><button className="btn primary" disabled={busy||restoring||connection!=='ready'||restoreError||!question.trim()}>Send request</button><p>Changes are prepared for your review. Payment and refund approval stay separate.</p><a href={'/flows'+(planId?'?plan='+encodeURIComponent(planId):'')}>Reopen saved reviews</a></form>
 <div className="demo-actions"><button className="btn" disabled={busy||restoring||connection!=='ready'||!planId} onClick={()=>run(async()=>{const data=await tool('get_plan',{planId});setAnswer(`${data.plan.name}: ${data.schedule.length?data.schedule.map((item:any)=>`${item.name}, ${new Date(item.start).toLocaleString(undefined,{timeZone:data.plan.timezone})}`).join('. '):'No saved activities yet.'}`);})}>“Show my schedule”</button>
 <button className="btn" disabled={busy||restoring||connection!=='ready'||!planId} onClick={()=>run(async()=>{const data=await tool('get_my_money',{planId}),amounts=data.amounts;setAnswer(`Your recorded cost is ${display(amounts.cost)}. Your contribution is ${display(amounts.contribution)}. Expected refunds are ${display(amounts.expectedRefund)}; confirmed refunds are ${display(amounts.confirmedRefund)}. Pending refunds cannot fund a new payment.`);})}>“Explain my money”</button>
 <button className="btn" disabled={busy||restoring||connection!=='ready'||!planId} onClick={()=>run(async()=>{const data=await tool('get_decisions',{planId});setAnswer(`You have ${data.approvals.length} item approvals, ${data.proposals.length} plan proposals, ${data.invoices?.length??0} invoice actions and ${(data.recoveries?.length??0)+(data.changes?.length??0)} recovery actions to review. Open Knota to review the exact terms.`);setReview('/flows?plan='+encodeURIComponent(planId));})}>“What needs my attention?”</button></div>
 <section className="panel" aria-live="polite"><h2>Assistant response</h2><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{busy?'Checking your saved records…':answer}</p>{review&&<a className="btn primary" href={review}>Review in Knota</a>}<button className="btn" disabled={busy} onClick={()=>{if('speechSynthesis'in window){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer));}}}>Read response aloud</button></section>
 <section className="panel"><h2>“Prepare a day out for me”</h2><p>Enter the details this simulated request should carry. The tool saves a preview for your confirmation.</p><label>Name<input value={name} onChange={event=>setName(event.target.value)} maxLength={180}/></label><label>Destination<input value={destination} onChange={event=>setDestination(event.target.value)} maxLength={120}/></label><label>Date<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><button className="btn primary" disabled={busy||restoring||connection!=='ready'||!name.trim()||!destination.trim()||!date} onClick={()=>run(async()=>{const result=await tool('prepare_plan',{plan:{name,destination,start:date,end:date,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,currency:'CAD',kind:'day-out'}});setAnswer('Your day-out preview is ready. Review the details and confirm it in Knota to create the plan.');setReview(result.reviewUrl);})}>Prepare review preview</button></section>
 <style>{`.agent-demo{max-width:840px;margin:auto;padding:36px 20px 80px}.agent-demo h1{margin:22px 0 12px}.agent-demo p{line-height:1.7;margin:12px 0}.agent-demo label{display:flex;flex-direction:column;gap:8px;margin:14px 0}.agent-demo input,.agent-demo select{padding:10px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#172a3a}.agent-demo .panel{padding:24px;margin:24px 0}.demo-actions{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}.agent-demo .panel .btn{margin:10px 10px 0 0}`}</style>
 </main>;
}
