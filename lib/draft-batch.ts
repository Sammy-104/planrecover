import {applyAction,type Action,type State} from './model.ts';
import {parseWorkspaceMutation} from './action-contracts.ts';

/** Draft additions share one versioned save. Failure leaves the original intact. */
export function draftBatchActions(state:State,action:Action):Action[]{
 const parsed=parseWorkspaceMutation({version:state.version,action:{type:'add_drafts',batchId:action.batchId,actions:action.actions}}).action;
 if(state.appliedDrafts?.includes(String(parsed.batchId)))throw Error('These selected ideas were already added.');
 if(action.tripId&&action.tripId!==state.plan.id)throw Error('The active plan changed. Review your suggestions again.');
 return (parsed.actions as Record<string,unknown>[]).map(value=>({...value,type:String(value.type),actor:action.actor,tripId:state.plan.id}));
}

export function applyDraftBatch(state:State,action:Action,prepared?:Action[]):State{
 const actions=draftBatchActions(state,action);
 if(prepared&&prepared.length!==actions.length)throw Error('Review all selected drafts before adding.');
 let next=structuredClone(state);
 for(const [index,child] of actions.entries()){
  const addition=prepared?.[index]??child;
  if(addition.type!==child.type||addition.actor!==action.actor||addition.tripId!==state.plan.id)throw Error('Review these suggestions in the current plan.');
  if(addition.type==='add_item'&&addition.category!=='Preparation'){
   const start=Date.parse(String(addition.start)),end=start+Number(addition.duration)*60000,ids=addition.participants as string[];
   const overlap=next.items.find(item=>item.status!=='cancelled'&&item.category!=='Preparation'&&item.participants.some(id=>ids.includes(id))&&start<Date.parse(item.start)+item.duration*60000&&end>Date.parse(item.start));
   if(overlap)throw Error(`Overlaps ${overlap.name}. Adjust the suggested times before adding.`);
  }
  const existing=new Set(next.items.map(item=>item.id));
  next=applyAction(next,addition);
  // Unlike a manually saved free task, a reviewed AI batch never grants approvals.
  for(const item of next.items)if(!existing.has(item.id)){item.status='draft';item.approvals=[];item.paid=[];item.booking='unconfirmed';}
 }
 next.appliedDrafts=[...(next.appliedDrafts??[]),String(action.batchId)].slice(-100);
 return next;
}
