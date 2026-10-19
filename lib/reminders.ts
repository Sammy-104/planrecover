import type {State} from './model.ts';
export type ReminderKind='task'|'payment'|'quote'|'cancellation'|'custom';
export type ReminderSettings={leadMinutes:Record<ReminderKind,number>;browser:boolean};
export type ReminderState={done?:boolean;snoozedUntil?:string};
export type PlanReminder={id:string;itemId:string;taskId?:string;title:string;due:string;consequence:string;done:boolean;kind:ReminderKind;leadMinutes:number;remindAt:string;snoozedUntil?:string;derived?:boolean};
export const defaultReminderSettings:ReminderSettings={leadMinutes:{task:60,payment:1440,quote:180,cancellation:1440,custom:60},browser:false};
export function validateReminderSettings(input:ReminderSettings){
 if(!input?.leadMinutes)throw Error('Choose reminder lead times.');const leadMinutes={...defaultReminderSettings.leadMinutes};for(const key of Object.keys(leadMinutes) as ReminderKind[]){const n=input.leadMinutes[key];if(!Number.isInteger(n)||n<0||n>43200)throw Error('Reminder lead times must be from 0 minutes to 30 days.');leadMinutes[key]=n;}return {leadMinutes,browser:input.browser===true};
}
export function getPlanReminders(s:Pick<State,'items'|'reminders'> & Partial<Pick<State,'events'|'preferences'|'plan'>>,actor?:string):PlanReminder[]{
 const settings=actor?s.preferences?.[actor]?.reminders:undefined,personal=actor?s.preferences?.[actor]?.reminderState:undefined;
 const tasks=s.items.filter(i=>i.category==='Preparation'&&i.status!=='cancelled');
 const base=s.reminders.filter(r=>!tasks.some(t=>t.id===r.itemId)&&!s.items.some(i=>i.id===r.itemId&&i.status==='cancelled')).map(r=>({...r,kind:'custom' as ReminderKind,taskId:undefined as string|undefined,derived:false}));
 const list=[...base,...tasks.filter(t=>!actor||t.taskOwner===actor||t.participants.includes(actor)).map(t=>({id:`task-due-${t.id}`,itemId:t.id,taskId:t.id,title:t.name,due:t.start,consequence:'Preparation task due at this time.',done:!!t.done,kind:'task' as ReminderKind,derived:true}))];
 for(const item of s.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly)){
  if(actor&&!item.participants.includes(actor))continue;
  const cutoff=item.cancellationTerms?.cutoff??item.deadline;
  for(const [kind,due,label] of [['cancellation',cutoff,'Cancellation cutoff'],['quote',item.expires,'Quote expires']] as const)if(due&&!base.some(r=>r.itemId===item.id&&r.due===due))list.push({id:`${kind}-${item.id}-${due}`,itemId:item.id,taskId:undefined,title:`${item.name} · ${label}`,due,consequence:kind==='quote'?'Review the current price before this quote expires.':'Check the supplier policy before the deadline. Unknown terms remain unverified.',done:false,kind,derived:true});
 }
 return list.filter(r=>Number.isFinite(Date.parse(r.due))).map(r=>{const leadMinutes=settings?.leadMinutes[r.kind]??defaultReminderSettings.leadMinutes[r.kind],choice=personal?.[r.id],remindAt=new Date(Date.parse(r.due)-leadMinutes*60000).toISOString();return {...r,leadMinutes,remindAt,done:r.done||choice?.done===true,snoozedUntil:choice?.snoozedUntil};}).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
}
export function reminderIsDue(r:PlanReminder,now=Date.now()){return !r.done&&now>=Date.parse(r.remindAt)&&(!r.snoozedUntil||now>=Date.parse(r.snoozedUntil));}
