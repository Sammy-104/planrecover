import {planMembers,tripCatalog,type State,type Action} from './model.ts';

export type ActivityComment={id:string;author:string;text:string;created:string;deletedAt?:string};
export type ActivityDecision={comments:ActivityComment[];votes:Record<string,'interested'|'pass'>;mustVisit:string[]};
export type ActivityDecisions=Record<string,ActivityDecision>;

export function decisionTarget(state:State,targetId:string){
 const item=state.items.find(i=>i.id===targetId&&!i.financialOnly&&i.category!=='Preparation');
 const target=item??tripCatalog(state).find(c=>c.id===targetId&&c.category!=='Preparation');
 if(!target)throw Error('Choose an activity in this plan.');
 return {target,key:item?.ideaId??target.id};
}
export function activityDecision(state:State,targetId:string):ActivityDecision{
 const {key}=decisionTarget(state,targetId);
 return state.activityDecisions?.[key]??{comments:[],votes:{},mustVisit:[]};
}
export function decisionSummary(state:State,targetId:string){
 const decision=activityDecision(state,targetId),eligible=new Set(planMembers(state).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id));
 return {decision,interested:Object.keys(decision.votes).filter(id=>eligible.has(id)&&decision.votes[id]==='interested'),pass:Object.keys(decision.votes).filter(id=>eligible.has(id)&&decision.votes[id]==='pass'),mustVisit:decision.mustVisit.filter(id=>eligible.has(id)),comments:decision.comments.filter(c=>!c.deletedAt)};
}
export function updateActivityDecision(state:State,action:Action,now:string){
 const {target,key}=decisionTarget(state,String(action.targetId));
 state.activityDecisions??={};
 const decision=state.activityDecisions[key]??={comments:[],votes:{},mustVisit:[]};
 if(action.type==='activity_comment'){
  const text=typeof action.text==='string'?action.text.trim():'';
  if(!text||text.length>1000)throw Error('Write a comment of 1–1,000 characters.');
  const id=String(action.commentId??'');if(!/^[a-zA-Z0-9-]{8,100}$/.test(id))throw Error('Refresh and try posting the comment again.');
  const existing=decision.comments.find(c=>c.id===id);if(existing){if(existing.author!==action.actor||existing.text!==text)throw Error('This comment changed. Refresh before posting.');return;}
  if(decision.comments.length>=150)throw Error('This activity already has 150 comments. Start a new discussion on another activity.');
  decision.comments.push({id,author:action.actor,text,created:now});return;
 }
 if(action.type==='activity_comment_delete'){
  const comment=decision.comments.find(c=>c.id===action.commentId);
  if(!comment||comment.author!==action.actor&&state.people?.find(p=>p.id===action.actor)?.role!=='owner')throw Error('Only the author or plan owner can remove this comment.');
  comment.text='';comment.deletedAt=now;return;
 }
 if('status' in target&&target.status==='cancelled')throw Error('This activity is cancelled. Its discussion is kept for reference.');
 if(action.type==='activity_vote'){
  if(![null,'interested','pass'].includes(action.vote as any))throw Error('Choose interested, pass, or clear your vote.');
  if(action.vote===null)delete decision.votes[action.actor];else decision.votes[action.actor]=action.vote as 'interested'|'pass';
  if(action.vote!=='interested')decision.mustVisit=decision.mustVisit.filter(id=>id!==action.actor);
  return;
 }
 if(action.type==='activity_priority'){
  if(typeof action.mustVisit!=='boolean')throw Error('Choose whether this is a must-visit.');
  decision.mustVisit=decision.mustVisit.filter(id=>id!==action.actor);
  if(action.mustVisit){decision.mustVisit.push(action.actor);decision.votes[action.actor]='interested';}return;
 }
 throw Error('Choose a supported activity discussion action.');
}
