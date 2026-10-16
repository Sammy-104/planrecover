import {checkPlanningConstraints,loadPlanningPreferences,type PlanningCandidate} from './planning-constraints.ts';
import {loadPlanningEvidence} from './planning-evidence.ts';
import {personalMoney,tripCatalog,type Action} from './model.ts';
import type {PlanRecord} from './plan-repository.ts';

/** The returned review is caller-private; other members' limits are never loaded. */
export async function reviewPlanning(database:D1Database,record:PlanRecord,memberId:string,candidates:PlanningCandidate[],options:{removeIds?:string[];finalChange?:number|null;newPaymentNow?:number|null;financialEffectsAlreadyIncluded?:boolean}={}){
 const state=structuredClone(record.state),removed=new Set(options.removeIds??[]);
 state.items=state.items.filter(item=>!removed.has(item.id));
 const planning=await loadPlanningPreferences(database,record.owner,state.plan.id!,memberId,state.plan.timezone);
 const evidence=await loadPlanningEvidence(database,record.owner,state.plan.id!);
 const checked=checkPlanningConstraints(state,candidates,planning.configured?{[memberId]:planning.preferences}:{},evidence);
 const issues=checked.issues.filter(issue=>(!issue.memberId||issue.memberId===memberId)&&(!options.financialEffectsAlreadyIncluded||!['BUDGET_EXCEEDED','CASH_EXCEEDED'].includes(issue.code)));
 const preferences=record.state.preferences[memberId],money=personalMoney(record.state,memberId);
 const projected=options.finalChange==null?null:money.projected+options.finalChange;
 const payment=options.newPaymentNow;
 const affordability=!preferences?{status:'review-required',newPaymentNow:payment??null,withinBudget:null,withinCash:null}:
  {status:projected===null||payment==null?'review-required':projected>preferences.budget||payment>Math.max(0,preferences.cash-preferences.reserve)?'exceeds-limit':'within-limits',
   newPaymentNow:payment??null,withinBudget:projected===null?null:projected<=preferences.budget,withinCash:payment==null?null:payment<=Math.max(0,preferences.cash-preferences.reserve)};
 return {issues,hasBlockingIssues:issues.some(issue=>issue.severity==='error')||affordability.status==='exceeds-limit',affordability,
  otherMembers:'Each affected member reviews their own private constraints.',requiresReview:true,planVersion:record.version,planningVersion:planning.version};
}
export async function reviewPlanAction(database:D1Database,record:PlanRecord,memberId:string,action:Action){
 const a=action as any,original=record.state.items.find(i=>i.id===a.itemId);
 if(!['add_item','add_suggestion','item_edit','task_edit','approve_item'].includes(a.type))return null;
 const suggestion=a.type==='add_suggestion'?tripCatalog(record.state).find(i=>i.id===a.suggestionId):null;
 const value={...(suggestion??original??{}),...a,id:undefined,evidenceId:suggestion?.id??original?.id,price:a.price===undefined?(suggestion?.price??original?.price??null):a.price};
 if(!value.name||!value.start||!value.participants?.length)return null;
 const share=value.price===null?null:Math.floor(value.price/value.participants.length),old=original?.shares[memberId]??0;
 return reviewPlanning(database,record,memberId,[value],{removeIds:original?[original.id]:[],finalChange:share===null?null:share-old,newPaymentNow:share});
}
