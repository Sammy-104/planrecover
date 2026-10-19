'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {controlledEmailReview,controlledEmailAttemptMessage,type ControlledEmailPreview,type ControlledEmailAttempt} from '@/lib/controlled-reminder-email-review';

type Job={id:string;title:string;due_at:number;timezone:string;channel:string;status:string};
type SendResult={status:ControlledEmailAttempt['status'];accepted:boolean;attemptId:string;reused:boolean;inboxDelivery:'unverified';normalEmailEnabled:false;canonicalReminderUnchanged:true};
function when(value:number|string,timezone:string){try{return new Date(value).toLocaleString('en-CA',{timeZone:timezone});}catch{return new Date(value).toISOString();}}
export function ControlledReminderEmailTest({planId,memberId,version,timezone}:{planId:string;memberId:string;version:number;timezone:string}){
 const [jobs,setJobs]=useState<Job[]>([]),[selected,setSelected]=useState(''),[preview,setPreview]=useState<ControlledEmailPreview|null>(null);
 const [loading,setLoading]=useState(true),[sending,setSending]=useState(false),[error,setError]=useState(''),[unavailable,setUnavailable]=useState(''),[outcome,setOutcome]=useState(''),[retainedAttempt,setRetainedAttempt]=useState<ControlledEmailAttempt|null>(null),[now,setNow]=useState(Date.now);
 const generation=useRef(0),controller=useRef<AbortController|null>(null),attempted=useRef(false);
 const path=`/api/plans/${encodeURIComponent(planId)}/reminders`,context=`${planId}:${memberId}:${version}`;
 const activeContext=useRef(context);activeContext.current=context;
 const inspect=useCallback(async()=>{
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const current=++generation.current;
  setLoading(true);setError('');setUnavailable('');setPreview(null);setRetainedAttempt(null);
  try{
   const [inboxResponse,testResponse]=await Promise.all([fetch(path,{credentials:'same-origin',signal:abort.signal}),fetch(path+'/test-email',{credentials:'same-origin',signal:abort.signal})]);
   const [inbox,test]=await Promise.all([inboxResponse.json(),testResponse.json()]) as [{jobs?:Job[];error?:string},Omit<Partial<ControlledEmailPreview>,'available'>&{available?:boolean;lastAttempt?:ControlledEmailAttempt;error?:string;code?:string}];
   if(abort.signal.aborted||current!==generation.current||activeContext.current!==context)return;
   if(!inboxResponse.ok)throw Error(inbox.error??'Your due reminders could not be loaded.');
   setJobs((Array.isArray(inbox.jobs)?inbox.jobs:[]).filter((job:Job)=>job.channel==='in-app'&&Number.isFinite(job.due_at)&&job.due_at<=Date.now()&&job.status!=='cancelled'));
   if(testResponse.ok){
    if(test.planId!==planId)throw Error('The saved test preview does not match this plan.');
    if(test.available===false){setUnavailable('No email test is currently enabled for this plan. Any last saved test result remains available below.');if(test.lastAttempt){setRetainedAttempt(test.lastAttempt);setOutcome(`Last saved controlled email test: ${controlledEmailAttemptMessage(test.lastAttempt)}`);}}
    else{if(test.available!==true||!test.reminder||!test.versions)throw Error('The saved test preview is incomplete. Refresh its details.');setPreview(test as ControlledEmailPreview);if(test.attempt)setOutcome(`Test for ${test.reminder.title}: ${controlledEmailAttemptMessage(test.attempt)}`);}
   }
   else if(testResponse.status===503&&test.code==='SES_CONTROLLED_TEST_UNAVAILABLE')setUnavailable('A one-time email test has not been prepared for this plan. You can inspect a due reminder below.');
   else throw Error(test.error??'The controlled email test details could not be loaded.');
  }catch(reason){if(!abort.signal.aborted&&current===generation.current&&activeContext.current===context)setError((reason as Error).message);}
  finally{if(!abort.signal.aborted&&current===generation.current&&activeContext.current===context)setLoading(false);}
 },[path,context]);
 useEffect(()=>{setJobs([]);setSelected('');setPreview(null);setOutcome('');setRetainedAttempt(null);setSending(false);attempted.current=false;void inspect();return()=>{generation.current++;controller.current?.abort();};},[inspect]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const job=jobs.find(value=>value.id===selected),review=controlledEmailReview(preview,planId,version,selected,now),matchingPreview=preview?.planId===planId&&preview.reminder?.id===selected?preview:null,savedAttempt=preview?.attempt??retainedAttempt;
 async function send(){
  const current=controlledEmailReview(preview,planId,version,selected);
  if(!current.canSend||!preview||attempted.current||loading||sending)return;
  attempted.current=true;setSending(true);setError('');setOutcome('');const originContext=context;
  try{
   const response=await fetch(path+'/test-email',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({reminderJobId:selected,planVersion:preview.versions.planVersion,preferencesVersion:preview.versions.preferencesVersion,destinationVersion:preview.versions.destinationVersion,confirm:true})});
   const value=await response.json() as SendResult&{error?:string};
   if(activeContext.current!==originContext)return;
   if(!response.ok)throw Error(value.error??'The test request could not be completed.');
   if(value.normalEmailEnabled!==false||value.inboxDelivery!=='unverified'||value.canonicalReminderUnchanged!==true)throw Error('Refresh the saved test result before drawing a delivery conclusion.');
   setOutcome(`Test for ${preview.reminder.title}: ${controlledEmailAttemptMessage(value)}`);
   // Read durable status after the explicit send. Never submit another send.
   await inspect();
  }catch(reason){if(activeContext.current===originContext){setError((reason as Error).message);setOutcome('The request outcome could not be confirmed. Refresh its saved status and check your inbox. No email will be retried automatically.');}}
  finally{if(activeContext.current===originContext)setSending(false);}
 }
 return <section className="panel" style={{overflowWrap:'anywhere'}} aria-label="Controlled reminder email test"><div className="section-top"><h2>Send one reminder email test</h2><button className="btn small-btn" disabled={loading||sending} onClick={()=>void inspect()}>{loading?'Refreshing…':'Refresh test details'}</button></div>
  <p>Choose one due in-app reminder and review the prepared test copy. It can be sent once to your own confirmed email address. This test does not enable normal email reminders or automatic sending.</p>
  {error&&<p className="notice warning" role="alert">{error}</p>}{unavailable&&<p className="muted">{unavailable}</p>}{loading&&!jobs.length&&<p role="status">Loading your private reminder test details…</p>}
  <label className="field"><span>Due in-app reminder</span><select value={selected} disabled={loading||sending} onChange={event=>setSelected(event.target.value)}><option value="">Choose one reminder</option>{jobs.map(value=><option key={value.id} value={value.id}>{value.title} · {when(value.due_at,value.timezone||timezone)}</option>)}</select></label>
  {!loading&&!jobs.length&&<p>No current, due in-app reminder is available for this plan.</p>}
  {job&&<><p><strong>{job.title}</strong><br/>Due {when(job.due_at,job.timezone||timezone)} · {job.timezone||timezone}</p><details><summary>Reminder test details</summary><dl><dt>Plan ID</dt><dd>{planId}</dd><dt>Reminder job ID</dt><dd>{job.id}</dd><dt>Current plan version</dt><dd>{version}</dd><dt>In-app reminder status</dt><dd>{job.status}</dd>{matchingPreview&&<><dt>Preferences version</dt><dd>{matchingPreview.versions.preferencesVersion}</dd><dt>Destination version</dt><dd>{matchingPreview.versions.destinationVersion}</dd></>}</dl></details></>}
  {matchingPreview&&<div className="financial-review"><dl><dt>Recipient</dt><dd>{matchingPreview.recipient}</dd><dt>Test copy</dt><dd>{matchingPreview.reminder.body}</dd><dt>Test expires</dt><dd>{when(matchingPreview.expiresAt,timezone)} · {timezone}</dd></dl></div>}
  {outcome&&<p className="notice" role="status">{outcome}</p>}
  {savedAttempt&&<details><summary>Saved test evidence</summary><dl><dt>Attempt ID</dt><dd>{savedAttempt.id}</dd><dt>Provider status</dt><dd>{savedAttempt.status}</dd><dt>Recorded</dt><dd>{when(savedAttempt.recordedAt,timezone)} · {timezone}</dd>{savedAttempt.messageId&&<><dt>SES message ID</dt><dd>{savedAttempt.messageId}</dd></>}<dt>Inbox delivery</dt><dd>Unverified</dd></dl></details>}
  {preview&&!review.canSend&&!outcome&&<p className="muted">{review.reason}</p>}
  <button className="btn primary" disabled={loading||sending||attempted.current||!review.canSend} onClick={()=>void send()}>{sending?'Submitting one test…':'Send one test email to my confirmed address'}</button>
  <p className="source-footnote">Amazon SES acceptance means the provider accepted a request. Inbox delivery remains unverified until checked separately. This test does not mark the in-app reminder read or delivered.</p>
 </section>;
}
