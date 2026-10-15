import {z} from 'zod';
import {BackendError,conflict,forbidden,missingPlan} from './backend-errors.ts';
import {allocate,personalMoney,planMembers,type State} from './model.ts';
import type {Identity} from './people.ts';
import {localDateTime} from './trip-time.ts';

const instant=z.string().datetime({offset:true});
const availabilityWindow=z.object({start:instant,end:instant,status:z.enum(['available','unavailable'])}).strict()
 .refine(value=>Date.parse(value.end)>Date.parse(value.start),'Availability must end after it starts.');
const needs=z.array(z.string().trim().min(1).max(120)).max(30).refine(values=>new Set(values).size===values.length);
export const planningPreferencesSchema=z.object({
 timezone:z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}),
 availability:z.array(availabilityWindow).max(100),dietaryNeeds:needs,accessibilityNeeds:needs,
 bufferMinutes:z.number().int().min(0).max(240),
 leadMinutes:z.array(z.number().int().min(0).max(10080)).min(1).max(10).refine(values=>new Set(values).size===values.length),
 delivery:z.object({inApp:z.boolean(),email:z.boolean(),push:z.boolean()}).strict(),
}).strict();
export type PlanningPreferences=z.infer<typeof planningPreferencesSchema>;
export function defaultPlanningPreferences(timezone='UTC'):PlanningPreferences {
 return {timezone,availability:[],dietaryNeeds:[],accessibilityNeeds:[],bufferMinutes:15,leadMinutes:[60,0],delivery:{inApp:true,email:false,push:false}};
}
export function parsePlanningPreferenceMutation(input:unknown){
 const result=z.object({version:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),preferences:planningPreferencesSchema}).strict().safeParse(input);
 if(!result.success)throw new BackendError('INVALID_PLANNING_PREFERENCES','Provide valid availability, needs, time zone and reminder preferences with their current version.');
 return result.data;
}

export async function loadPlanningPreferences(database:D1Database,owner:string,planId:string,memberId:string,timezone='UTC') {
 const row=await database.prepare('SELECT body,version FROM member_planning_preferences WHERE owner=? AND plan_id=? AND member_id=?')
  .bind(owner,planId,memberId).first<{body:string;version:number}>();
 return row?{preferences:planningPreferencesSchema.parse(JSON.parse(row.body)),version:row.version,configured:true}
  :{preferences:defaultPlanningPreferences(timezone),version:0,configured:false};
}

/** This store never projects private availability or needs into the shared plan. */
export class PlanningPreferencesRepository {
 private database:D1Database;
 constructor(database:D1Database){this.database=database;}
 private async access(planId:string,identity:Identity){
  const row=await this.database.prepare(`SELECT p.owner,p.body,m.role FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
   WHERE p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy'`).bind(planId,identity.id)
   .first<{owner:string;body:string;role:string}>();
  if(!row)throw missingPlan();return row;
 }
 async get(planId:string,identity:Identity){const plan=await this.access(planId,identity);
  return loadPlanningPreferences(this.database,plan.owner,planId,identity.id,(JSON.parse(plan.body) as State).plan.timezone);}
 async update(planId:string,identity:Identity,preferences:PlanningPreferences,version:number){
  const plan=await this.access(planId,identity);if(!['owner','editor'].includes(plan.role))throw forbidden();
  const parsed=parsePlanningPreferenceMutation({version,preferences}),token=crypto.randomUUID(),now=new Date().toISOString();
  try{await this.database.batch([
   this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
    SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.status<>'deleted'
    AND m.member_id=? AND m.role IN ('owner','editor')) AND COALESCE((SELECT version FROM member_planning_preferences
    WHERE owner=? AND plan_id=? AND member_id=?),0)=? THEN 1 ELSE 0 END)`)
    .bind(token,plan.owner,planId,identity.id,plan.owner,planId,identity.id,version),
   this.database.prepare(`INSERT INTO member_planning_preferences(owner,plan_id,member_id,body,version,updated) VALUES (?,?,?,?,1,?)
    ON CONFLICT(owner,plan_id,member_id) DO UPDATE SET body=excluded.body,version=member_planning_preferences.version+1,updated=excluded.updated`)
    .bind(plan.owner,planId,identity.id,JSON.stringify(parsed.preferences),now),
   this.database.prepare("UPDATE reminder_jobs SET status='cancelled',lease_token=NULL,lease_until=0,last_error='preferences-changed',updated=? WHERE owner=? AND plan_id=? AND member_id=? AND status IN ('scheduled','processing','unavailable')")
    .bind(now,plan.owner,planId,identity.id),
   this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token),
  ]);}catch(error){if(String(error).includes('CHECK constraint failed'))throw conflict();throw error;}
  return {preferences:parsed.preferences,version:version+1,configured:true};
 }
}

export type PlanningCandidate={id?:string;evidenceId?:string;name:string;category:string;start:string;duration:number;participants:string[];price:number|null;location?:string};
export type SupplierConstraintEvidence={itemId:string;sourceUrl:string;checkedAt:string;expiresAt?:string;
 openIntervals?:{start:string;end:string}[];dietary?:Record<string,'supported'|'unsupported'|'unknown'>;accessibility?:Record<string,'supported'|'unsupported'|'unknown'>};
export type PlanningTravelEvidence={fromId:string;toId:string;minutes:number;checkedAt:string;basis:'provider'|'estimate'};
export type ConstraintIssue={code:string;severity:'error'|'unknown';itemId:string;memberId?:string;message:string};
export type PlanningConstraintOptions={now?:number;freshnessMs?:number;supplierEvidence?:SupplierConstraintEvidence[];travelEvidence?:PlanningTravelEvidence[]};
const validInstant=(value:string)=>instant.safeParse(value).success&&Number.isFinite(Date.parse(value));
function fresh(checkedAt:string,now:number,age:number){return validInstant(checkedAt)&&Date.parse(checkedAt)<=now+300000&&now-Date.parse(checkedAt)<=age;}

/** Evidence must come from a trusted server adapter; model claims are never evidence. */
export function checkPlanningConstraints(state:State,candidates:PlanningCandidate[],preferences:Record<string,PlanningPreferences>,options:PlanningConstraintOptions={}) {
 const now=options.now??Date.now(),freshnessMs=options.freshnessMs??86400000,issues:ConstraintIssue[]=[],knownShares:Record<string,number>={},members=planMembers(state).map(person=>person.id);
 const add=(code:string,severity:ConstraintIssue['severity'],itemId:string,message:string,memberId?:string)=>issues.push({code,severity,itemId,message,...(memberId?{memberId}:{})});
 const intervals=state.items.filter(item=>item.status!=='cancelled').map(item=>({id:item.id,name:item.name,start:Date.parse(item.start),end:Date.parse(item.start)+item.duration*60000,participants:item.participants,category:item.category}));
 const ids=new Set(intervals.map(item=>item.id));
 for(const [index,item] of candidates.entries()){
  const id=item.id??`draft-${index}`,start=Date.parse(item.start),end=start+item.duration*60000;
  if(ids.has(id)||!validInstant(item.start)||!Number.isInteger(item.duration)||item.duration<1||item.duration>1440
   ||!item.participants.length||new Set(item.participants).size!==item.participants.length||item.participants.some(member=>!members.includes(member))
   ||item.price!==null&&(!Number.isSafeInteger(item.price)||item.price<0||item.price>1000000000000)){
   add('INVALID_ITEM','error',id,'The proposed item needs valid times, participants and money.');continue;
  }
  ids.add(id);
  if(localDateTime(item.start,state.plan.timezone).slice(0,10)<state.plan.start
   ||localDateTime(new Date(end-1).toISOString(),state.plan.timezone).slice(0,10)>state.plan.end)
   add('OUTSIDE_PLAN','error',id,'The proposed activity falls outside the plan dates in its time zone.');
  for(const member of item.participants){
   const pref=preferences[member];
   if(!pref){add('PREFERENCES_UNKNOWN','unknown',id,'This participant must review their private availability and needs.',member);continue;}
   const windows=pref.availability,available=windows.filter(window=>window.status==='available');
   if(!windows.length)add('AVAILABILITY_UNKNOWN','unknown',id,'No availability has been provided.',member);
   else if(windows.some(window=>window.status==='unavailable'&&start<Date.parse(window.end)&&end>Date.parse(window.start))
    ||available.length>0&&!available.some(window=>start>=Date.parse(window.start)&&end<=Date.parse(window.end)))
    add('UNAVAILABLE','error',id,'The proposed time conflicts with this participant’s availability.',member);
  }
  const clashes=intervals.filter(other=>start<other.end&&end>other.start&&item.participants.some(member=>other.participants.includes(member)));
  if(clashes.length)add('SCHEDULE_CONFLICT','error',id,`Overlaps ${clashes.map(other=>other.name).join(', ')} for a participating member.`);
  for(const member of item.participants){
   const pref=preferences[member],others=intervals.filter(other=>other.participants.includes(member));
   const before=others.filter(other=>other.end<=start).sort((a,b)=>b.end-a.end)[0],after=others.filter(other=>other.start>=end).sort((a,b)=>a.start-b.start)[0];
   for(const [from,to,gap] of [before?[before.id,id,(start-before.end)/60000]:null,after?[id,after.id,(after.start-end)/60000]:null].filter(Boolean) as [string,string,number][]){
    const buffer=pref?.bufferMinutes??15;
    if(gap<buffer)add('BUFFER_CONFLICT','error',id,'The schedule does not leave this participant’s required buffer.',member);
    const sourceId=(value:string)=>candidates.find(candidate=>candidate.id===value)?.evidenceId??value;
    const travel=options.travelEvidence?.find(value=>value.fromId===sourceId(from)&&value.toId===sourceId(to));
    if(!travel||!Number.isFinite(travel.minutes)||travel.minutes<0||!fresh(travel.checkedAt,now,freshnessMs))
     add('TRAVEL_UNKNOWN','unknown',id,'Travel time between adjacent activities is unknown.',member);
    else{if(travel.basis==='estimate')add('TRAVEL_ESTIMATE','unknown',id,'Travel time is a planning estimate and needs review.',member);
     if(gap<travel.minutes+buffer)add('TRAVEL_CONFLICT','error',id,'Travel and the required buffer do not fit between activities.',member);}
   }
  }
  if(item.price===null)add('PRICE_UNKNOWN','unknown',id,'The price is unknown; budget and cash fit cannot be confirmed.');
  else for(const [member,amount] of Object.entries(allocate(item.price,item.participants,'equal',{},members)))knownShares[member]=(knownShares[member]??0)+amount;
  if(item.category!=='Preparation'){
   const evidence=options.supplierEvidence?.find(value=>value.itemId===(item.evidenceId??id)),trusted=!!evidence&&/^https:\/\//.test(evidence.sourceUrl)&&fresh(evidence.checkedAt,now,freshnessMs)
    &&(!evidence.expiresAt||validInstant(evidence.expiresAt)&&Date.parse(evidence.expiresAt)>now);
   const validHours=!!evidence?.openIntervals&&evidence.openIntervals.every(window=>validInstant(window.start)&&validInstant(window.end)&&Date.parse(window.end)>Date.parse(window.start));
   if(!trusted||!validHours)add('HOURS_UNKNOWN','unknown',id,'Fresh supplier opening-hour evidence is unavailable.');
   else if(!evidence!.openIntervals!.some(window=>start>=Date.parse(window.start)&&end<=Date.parse(window.end)))
    add('CLOSED','error',id,'The proposed visit is outside the saved supplier opening interval.');
   for(const member of item.participants){const pref=preferences[member];if(!pref)continue;
    for(const [kind,values] of [['dietary',pref.dietaryNeeds],['accessibility',pref.accessibilityNeeds]] as const)for(const need of values){
     const support=trusted?evidence![kind]?.[need]:undefined;
     if(support==='unsupported')add(`${kind.toUpperCase()}_UNSUPPORTED`,'error',id,`Supplier evidence does not support a required ${kind} need.`,member);
     else if(support!=='supported')add(`${kind.toUpperCase()}_UNKNOWN`,'unknown',id,`Fresh supplier evidence for a required ${kind} need is unavailable.`,member);
    }
   }
  }
  intervals.push({id,name:item.name,start,end,participants:item.participants,category:item.category});
 }
 for(const [member,amount] of Object.entries(knownShares)){
  const pref=state.preferences[member],index=candidates.findIndex(item=>item.participants.includes(member)),itemId=candidates[index]?.id??`draft-${index}`;
  if(!pref){add('FINANCIAL_PREFERENCES_UNKNOWN','unknown',itemId,'This participant must review their private budget and available cash.',member);continue;}
  const money=personalMoney(state,member);
  if(money.projected+amount>pref.budget)add('BUDGET_EXCEEDED','error',itemId,'Known planned spending exceeds this participant’s budget.',member);
  if(money.planned+amount>Math.max(0,pref.cash-pref.reserve))add('CASH_EXCEEDED','error',itemId,'Known spending exceeds cash after keeping the reserve. Pending refunds are excluded.',member);
 }
 return {issues,items:candidates.map((item,index)=>({id:item.id??`draft-${index}`,issues:issues.filter(issue=>issue.itemId===(item.id??`draft-${index}`))})),
  hasBlockingIssues:issues.some(issue=>issue.severity==='error'),requiresReview:true as const};
}
