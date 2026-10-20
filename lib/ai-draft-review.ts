import type {previewPlanDraft} from './ai-plan.ts';
import type {Action,State} from './model.ts';

export type AiDraft=ReturnType<typeof previewPlanDraft>;
export type DraftReviewScope={planId:string;version:number;batchId:string};
export type ReviewedAiDraft=DraftReviewScope & {memberId:string;draft:AiDraft};
export type AddDraftActions=(actions:Omit<Action,'actor'>[],message?:string,review?:DraftReviewScope)=>Promise<State|undefined>;

export function selectableAiDraftItems(draft:AiDraft){
 return draft.items.flatMap((_,index)=>(draft.constraints.items[index]?.issues??[]).some(issue=>issue.severity==='error')?[]:[index]);
}

/** Keep the displayed review bound to the workspace and person that requested it.
 * The server still validates every selected action and saves the whole batch atomically. */
export function reviewedAiDraftActions(review:ReviewedAiDraft,state:State,memberId:string,selected:number[]){
 if(review.planId!==state.plan.id||review.version!==state.version||review.memberId!==memberId)
  throw Error('Your plan changed. Generate fresh suggestions before adding them.');
 if(!selected.length||selected.length>8||new Set(selected).size!==selected.length)
  throw Error('Select one or more distinct suggestions.');
 const available=new Set(selectableAiDraftItems(review.draft));
 if(selected.some(index=>!Number.isInteger(index)||!available.has(index)))
  throw Error('Resolve the selected suggestion’s planning conflicts before adding it.');
 return [...selected].sort((a,b)=>a-b).map(index=>review.draft.items[index].action);
}
