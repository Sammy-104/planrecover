import {formatMoney,validCurrency} from './money.ts';
import {localDateTime,validTripDates} from './trip-time.ts';

type Person={id:string;name:string;role?:string};
type Item={id:string;name:string;category:string;start:string;duration:number;price:number|null;participants:string[];taskOwner?:string;location?:string;done?:boolean};
type ReviewRecord={state:{plan:{id?:string;name:string;currency?:string;timezone:string};people?:Person[];items:Item[];reminders?:{id:string;itemId:string;title:string;due:string;done:boolean}[]};version:number;role:string;memberId?:string};
type Proposal={id?:string;plan_id?:string|null;plan_version?:number;status?:string;preview?:{kind?:string;plan?:Record<string,any>;action?:Record<string,any>}};
export type ProposalReview={heading:string;description:string;targetPlanId:string|null;canApply:boolean;blockedReason:string|null;fields:{label:string;value:string}[]};
const actionLabels:Record<string,string>={add_item:'Add a plan item',item_edit:'Update a plan item',task_edit:'Update a task',task:'Update task status',reminder:'Update reminder status'};
const text=(value:unknown,fallback='Unknown')=>typeof value==='string'&&value.trim()?value:fallback;
function amount(value:unknown,currency:string){if(value===null||value===undefined)return 'Unknown';try{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?formatMoney(value,currency):'Unknown';}catch{return 'Unknown';}}
function start(value:unknown,timezone:string){try{return `${localDateTime(String(value),timezone).replace('T',' ')} · ${timezone}`;}catch{return 'Unknown';}}
const owns=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);

/** Authenticated proposal identity decides its target; a first-listed plan or a
 * conflicting query parameter cannot supply the context for an action review. */
export function resolveProposalPlanSelection(plans:{id:string;name?:string}[],explicitPlanId:string|null,proposal:Proposal|null){
 const target=proposal?.preview?.kind==='plan-action'?proposal.plan_id:null;
 if(target)return {planId:target,notice:explicitPlanId&&explicitPlanId!==target?'This proposal belongs to a different plan than the link selected. Showing its correct plan for review.':null};
 return {planId:explicitPlanId??plans[0]?.id??'',notice:null};
}

/** Display and approval eligibility share one target/version check. This is a
 * UI guard; the authenticated apply endpoint retains its authoritative checks. */
export function agentProposalReview(proposal:Proposal,selectedPlanId:string,record:ReviewRecord|null):ProposalReview{
 const preview=proposal.preview,result:ProposalReview={heading:'Prepared change',description:'Review the complete proposal before applying it.',targetPlanId:null,canApply:false,blockedReason:null,fields:[]};
 const field=(label:string,value:string)=>result.fields.push({label,value});
 if(preview?.kind==='create-plan'){
  const plan=preview.plan??{},currency=text(plan.currency),timezone=text(plan.timezone);
  result.heading=text(plan.name,'New plan');result.description='Create a new plan with these details.';
  field('Destination',text(plan.destination));field('Dates',`${text(plan.start)} to ${text(plan.end)}`);field('Time zone',timezone);field('Currency',currency);
  field('Budget',`${amount(plan.budget??30000,currency)}${plan.budget===undefined?' (default)':''}`);field('Plan type',text(plan.kind,'trip').replaceAll('-',' '));if(plan.goal)field('Goal',text(plan.goal));
  let complete=!!plan.name&&!!plan.destination&&typeof plan.start==='string'&&typeof plan.end==='string'&&validTripDates(plan.start,plan.end)&&!!plan.timezone&&!!plan.currency&&Number.isSafeInteger(plan.budget??30000)&&(plan.budget??30000)>=0&&(plan.kind!=='day-out'||plan.start===plan.end);
  try{validCurrency(currency);new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{complete=false;}
  if(!complete)result.blockedReason='This preview is incomplete. Prepare a new proposal with exact dates, time zone and currency before applying it.';
  else if(proposal.status!=='review')result.blockedReason=proposal.status==='applied'?'This proposal has already been applied.':'This proposal is no longer awaiting review.';
  else result.canApply=true;
  return result;
 }
 if(preview?.kind!=='plan-action'||!proposal.plan_id){result.blockedReason='This proposal has no valid target plan. Prepare a new proposal.';return result;}
 result.targetPlanId=proposal.plan_id;
 const action=preview.action??{},type=text(action.type,''),label=actionLabels[type];
 result.heading=text(action.name,label??'Prepared change');result.description=label??'Review this plan change.';
 if(selectedPlanId!==proposal.plan_id){result.blockedReason='Choose the proposal’s target plan to review and apply this change.';return result;}
 if(!record||record.state.plan.id!==proposal.plan_id){result.blockedReason='Loading the proposal’s target plan. Applying stays disabled until its details are checked.';return result;}
 const {state}=record,currency=state.plan.currency??'CAD',timezone=state.plan.timezone;
 field('Plan',state.plan.name);field('Currency',currency);
 if(!label){result.blockedReason='This action needs a different review screen.';return result;}
 const reminder=type==='reminder'?state.reminders?.find(reminder=>reminder.id===action.reminderId):undefined;
 const item=type==='add_item'?undefined:state.items.find(item=>item.id===(reminder?.itemId??action.itemId));
 if(type!=='add_item'&&(!item||type==='reminder'&&!reminder)){result.blockedReason='The proposed item or reminder is no longer available. Prepare a new proposal.';return result;}
 const people=state.people?.filter(person=>person.role!=='legacy')??[],person=(id:unknown)=>people.find(person=>person.id===id)?.name??'Unknown member';
 const category=text(action.category,item?.category??'Unknown'),taskOwner=action.taskOwner??item?.taskOwner??(category==='Preparation'?record.memberId:undefined);
 const participants=type==='task_edit'?[taskOwner]:Array.isArray(action.participants)?action.participants:item?.participants??[];
 field('Item',text(action.name,item?.name??reminder?.title??'Unknown'));field('Category',category);
 if(reminder)field('Reminder',reminder.title);
 field(type==='reminder'?'Reminder due':'Start',start(type==='reminder'?reminder?.due:action.start??item?.start,timezone));
 field('Duration',`${action.duration??item?.duration??'Unknown'} minutes`);field('Proposed price',amount(owns(action,'price')?action.price:item?.price,currency));
 field('Participants',participants.length?participants.map(person).join(', '):'Unknown');if(taskOwner)field('Task owner',person(taskOwner));
 const location=action.location??item?.location;if(location)field('Location',text(location));
 if(type==='task'||type==='reminder')field(type==='task'?'Task status':'Reminder status',action.done?'Complete':'Open');
 if(type==='item_edit'){
  field('Cost split',({equal:'Equal shares',fixed:'Fixed amounts',percent:'Percentages',weight:'Weighted shares'} as Record<string,string>)[action.allocation]??'Unknown');
  if(action.allocation!=='equal')for(const id of participants){const value=action.values?.[id]??0;field(`${person(id)} share`,action.allocation==='fixed'?amount(value,currency):`${value}${action.allocation==='percent'?'%':' weight'}`);}
 }
 if(action.policy)field('Terms',text(action.policy));
 if(proposal.status!=='review')result.blockedReason=proposal.status==='applied'?'This proposal has already been applied.':'This proposal is no longer awaiting review.';
 else if(record.version!==proposal.plan_version)result.blockedReason='This plan changed after the proposal was prepared. Ask for a new proposal before applying it.';
 else if(!['owner','editor'].includes(record.role))result.blockedReason='You need editing access to apply this proposal.';
 else if(participants.some(id=>!people.some(person=>person.id===id))||taskOwner&&!people.some(person=>person.id===taskOwner))result.blockedReason='Participant details changed or are unavailable. Refresh the plan and prepare a new proposal.';
 else result.canApply=true;
 return result;
}
