import type {State} from './model.ts';

/** Equal versions can still contain changed private preferences or permissions. */
export function retainEqualSnapshot<T>(previous:T,next:T):T{
 return previous===next||JSON.stringify(previous)===JSON.stringify(next)?previous:next;
}

export function freshWorkspace(previous:State|null,next:State):State{
 if(previous&&next.version<previous.version)return previous;
 return previous?retainEqualSnapshot(previous,next):next;
}

/** A read started before an edit or plan switch cannot overwrite the new view. */
export function workspaceReadIsCurrent(input:{startedEpoch:number;currentEpoch:number;startedPlanId:string|undefined;currentPlanId:string|undefined;currentVersion:number;nextVersion:number}){
 return input.startedEpoch===input.currentEpoch&&input.startedPlanId===input.currentPlanId&&input.nextVersion>=input.currentVersion;
}

export function shouldComputePersonalIdeas(view:string,tab:string,expanded:boolean,sort:string){
 return view==='plan'&&tab==='itinerary'&&expanded||view==='discover'&&sort==='personal';
}
