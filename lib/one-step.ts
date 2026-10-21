import {planMembers,personalMoney,type State} from './model.ts';
import {costOutlook} from './traveller-planning.ts';
import {parseMoney,planCurrency} from './money.ts';
import {zonedStart,localDateTime} from './trip-time.ts';
import type {PlanSummary} from './plan-repository.ts';
import type {PlanChangeService} from './plan-changes.ts';

export const oneStepPages=['overview','itinerary','recovery','money','group','home'] as const;
export type OneStepPage=typeof oneStepPages[number];
export type OneStepRecord={state:State;version:number;role:string;memberId:string};
export type OneStepChange=Awaited<ReturnType<PlanChangeService['list']>>[number];
export type OneStepBootstrap={plans:PlanSummary[];profile:{id:string;name:string};config:{paypal:boolean;clientId:string}};
export type ReplacementDraft={name:string;start:string;duration:string;price:string;participants:string[]};
export type RecoveryOption='keep'|'cancel'|'replace';
export type Comparison={affected:{id:string;name:string}[];required:string[];warnings:string[];figures:OneStepChange['terms']['figures'];review:{planVersion:number;hasBlockingIssues:boolean;issues:{message?:string;title?:string}[]}};

export function oneStepLocation(search:string){const query=new URLSearchParams(search),view=query.get('view');return {view:oneStepPages.includes(view as OneStepPage)?view as OneStepPage:'overview' as OneStepPage,planId:query.get('plan')??''};}
export function oneStepHref(view:OneStepPage,planId=''){const query=new URLSearchParams({view});if(planId)query.set('plan',planId);return '/?'+query;}
export function oneStepAccess(record:OneStepRecord){const personal=!!record.state.people,member=record.state.people?.find(person=>person.id===record.memberId),editable=personal&&['owner','editor'].includes(record.role)&&!!member&&['owner','editor'].includes(member.role);return {personal,member,editable,owner:editable&&record.role==='owner'};}
export function oneStepMoney(record:OneStepRecord){return {outlook:costOutlook(record.state,record.memberId),personal:oneStepAccess(record).member?personalMoney(record.state,record.memberId):null};}
export function firstReplacement(record:OneStepRecord,itemIds:string[]):ReplacementDraft{const first=record.state.items.find(item=>itemIds.includes(item.id)),participants=[...new Set(record.state.items.filter(item=>itemIds.includes(item.id)).flatMap(item=>item.participants))].filter(id=>record.state.people?.some(person=>person.id===id&&['owner','editor'].includes(person.role)));return {name:'',start:first?localDateTime(first.start,record.state.plan.timezone):record.state.plan.start+'T12:00',duration:String(first?.duration??60),price:'',participants};}
export function oneStepAmount(value:string,currency:string):number|null{if(!value.trim())return null;const amount=parseMoney(value,currency);if(!Number.isSafeInteger(amount)||amount<0||amount>1e12)throw Error('Enter a valid non-negative amount in '+currency+', or leave it unknown.');return amount;}
export function oneStepRecoveryInput(record:OneStepRecord,itemIds:string[],option:RecoveryOption,draft:ReplacementDraft){
 if(!oneStepAccess(record).editable)throw Error('Choose a personal plan with editing access to prepare a change.');
 if(!itemIds.length||itemIds.length>20||new Set(itemIds).size!==itemIds.length||itemIds.some(id=>!record.state.items.some(item=>item.id===id&&item.status!=='cancelled')))throw Error('Choose current activities to review.');
 if(!['keep','cancel','replace'].includes(option))throw Error('Choose a supported recovery option.');
 const replacements=[];
 if(option==='replace'){
  const name=draft.name.trim(),duration=Number(draft.duration),eligible=planMembers(record.state).filter(person=>['owner','editor'].includes(person.role));
  if(!name||name.length>180)throw Error('Name the replacement activity.');
  if(!Number.isInteger(duration)||duration<1||duration>1440)throw Error('Choose a duration from 1 to 1,440 minutes.');
  if(!draft.participants.length||new Set(draft.participants).size!==draft.participants.length||draft.participants.some(id=>!eligible.some(person=>person.id===id)))throw Error('Choose current participants for the replacement.');
  if(draft.start.slice(0,10)<record.state.plan.start||draft.start.slice(0,10)>record.state.plan.end)throw Error('Keep the replacement within the plan dates.');
  replacements.push({name,category:'Activity' as const,start:zonedStart(draft.start,record.state.plan.timezone),duration,price:oneStepAmount(draft.price,planCurrency(record.state.plan)),participants:[...draft.participants],location:record.state.plan.destination});
 }
 return {type:'recovery' as const,version:record.version,itemIds:[...itemIds],option,replacements};
}
export function comparisonFingerprint(record:OneStepRecord,input:ReturnType<typeof oneStepRecoveryInput>){return JSON.stringify({planId:record.state.plan.id,memberId:record.memberId,version:record.version,input});}
export function changeApprovalAllowed(record:OneStepRecord,change:OneStepChange){return oneStepAccess(record).editable&&change.planId===record.state.plan.id&&change.status==='review'&&change.terms.required.includes(record.memberId)&&!change.approved.includes(record.memberId);}
export function changeApplicationAllowed(record:OneStepRecord,change:OneStepChange){return oneStepAccess(record).owner&&change.planId===record.state.plan.id&&change.status==='review'&&change.fullyApproved;}
