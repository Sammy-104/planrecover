'use client';
import {useEffect,useState} from 'react';
export function PlanningFitReview({planId,version,action,memberId}:{planId:string;version:number;action:unknown;memberId:string}){
 const actionKey=JSON.stringify(action),invitation=typeof window==='undefined'?'':new URLSearchParams(window.location.hash.slice(1)).get('trip')??'';
 // The member ID only scopes visible client state. The server derives the
 // actual caller from authentication and never accepts a client-selected actor.
 const key=JSON.stringify([planId,memberId,version,actionKey,invitation]);
 const [result,setResult]=useState<{key:string;review:any;error:string}>({key:'',review:null,error:''});
 const value=result.key===key?result.review:null,error=result.key===key?result.error:'';
 useEffect(()=>{
  const abort=new AbortController();setResult({key,review:null,error:''});
  const timer=setTimeout(()=>{const headers=new Headers({'Content-Type':'application/json'});if(invitation)headers.set('x-trip-share',invitation);
   void fetch(`/api/plans/${encodeURIComponent(planId)}/review`,{method:'POST',credentials:'same-origin',headers,
    body:JSON.stringify({workspaceVersion:version,action:JSON.parse(actionKey)}),signal:abort.signal})
    .then(async response=>{const body=await response.json() as any;if(!response.ok)throw Error(body.error??'Fit needs another check.');return body.review;})
    .then(review=>{if(!abort.signal.aborted)setResult({key,review,error:''});})
    .catch(e=>{if(!abort.signal.aborted)setResult({key,review:null,error:e.message});});
  },250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[key,planId,version,actionKey,invitation]);
 return <section className="notice planning-fit-review" aria-live="polite"><strong>Your private fit review</strong>{error?<p>{error}</p>:!value?<p>Checking saved availability, travel and your limits…</p>:<><p>{value.hasBlockingIssues?'Some constraints need attention. You can keep this as an unverified draft.':'No conflict was found in the available facts. Missing facts still need review.'}</p>{value.issues.map((issue:any,index:number)=><p key={index}>{issue.message}</p>)}<p>Affordability: {value.affordability.status.replaceAll('-',' ')}. Other participants review their own limits.</p></>}</section>;
}
