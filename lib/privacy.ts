import type {State,Preferences} from './model.ts';

export function limitsNeedReview(pref:Preferences|undefined,currency:string){return !!pref&&!pref.publicOnly&&!!pref.currency&&pref.currency!==currency;}
export function cashLimit(pref:Preferences|undefined,currency?:string){if(!pref||pref.publicOnly||currency&&limitsNeedReview(pref,currency))return undefined;const enabled=pref.cashLimitSet??(pref.cash!==pref.budget||pref.reserve!==0);return enabled?Math.max(0,pref.cash-pref.reserve):undefined;}

export function allPlanWorkspaces(state:State){return [state,...(state.archives??[]).map(p=>p.workspace),...(state.deletedTrips??[]).map(p=>p.workspace)];}
export function publicPreference(pref:Preferences){return {publicOnly:true,paypalMe:pref.paypalMe??''} as Preferences;}
export function privatePreference(pref:Preferences){const {paypalMe:_,publicOnly:__,...privateFields}=pref;return privateFields;}
/** Public workspace rows carry reimbursement links; private limits live in their own table. */
export function storedWorkspace(state:State){
 const copy=structuredClone(state);
 for(const plan of allPlanWorkspaces(copy))if(plan.people)plan.preferences=Object.fromEntries(Object.entries(plan.preferences).map(([id,pref])=>[id,publicPreference(pref)]));
 return copy;
}
/** Never send another member's preferences, including in saved or deleted plans. */
export function visibleWorkspace(state:State,memberId?:string){
 const copy=structuredClone(state);
 for(const plan of allPlanWorkspaces(copy))if(plan.people){
  const joined=plan.people.some(person=>person.id===memberId);
  plan.preferences=Object.fromEntries(Object.entries(plan.preferences).map(([id,pref])=>[id,joined&&id===memberId?pref:publicPreference(pref)]));
 }
 return copy;
}
