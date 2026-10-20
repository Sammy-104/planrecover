import {z} from 'zod';
import {applyAction,planMembers,tripCatalog,type State,type Action} from './model.ts';
import {updateActivityDecision} from './activity-decisions.ts';
import {validateCityStays,itemDay} from './city-stays.ts';
import {validatePlanningStyle,validatePlanningCosts} from './traveller-planning.ts';
import {validatePlanningIdeas} from './idea-collections.ts';
import {validateRoadTrip} from './road-trip.ts';
import {validateScenario} from './trip-workbench.ts';
import {getPlanReminders,validateReminderSettings} from './reminders.ts';
import {applyBookingImport} from './booking-import.ts';
import {localDateTime,validTripDates} from './trip-time.ts';
import {planCurrency} from './money.ts';
import {optimizeDay} from './schedule-optimizer.ts';
import {captureMove,scheduleUndoContext} from './plan-history.ts';
import type {TravelMatrix} from './route-matrix.ts';
import {hasMerchantCheckout} from './merchant-scope.ts';

const id=z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const text=(n:number)=>z.string().max(n);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>validTripDates(v,v));
const instant=z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/).refine(v=>Number.isFinite(Date.parse(v)));
const money=z.number().finite().int().min(0).max(1e12);
const ids=z.array(id).max(100).refine(v=>new Set(v).size===v.length);
const city=z.object({id,name:text(180).min(1),country:text(180).min(1),region:text(180),label:text(180).min(1),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)}).strict();
const timezone=text(100).min(1).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
export const frontendStaySchema=z.object({id,city,start:day,end:day,timezone,kind:z.enum(['stay','overnight']),note:text(300)}).strict();
export const frontendPlanningIdeaSchema=z.object({id,name:text(180).min(1),url:text(2000).optional(),note:text(1000),done:z.boolean().optional()}).strict();
const common={actor:id.optional(),tripId:id.optional()};
const style=z.object({pace:z.enum(['relaxed','balanced','busy']),interests:z.array(text(80).min(1)).max(30),dietary:text(160).optional(),mobility:z.enum(['any','step-free','short-walks']).optional(),availableFrom:text(5).optional(),availableTo:text(5).optional(),travelBuffer:z.number().int().min(0).max(90).optional(),queueMinutes:z.number().int().min(0).max(120).optional(),restMinutes:z.number().int().min(0).max(180).optional(),maxWalkMinutes:z.number().int().min(0).max(180).optional()}).strict();
const planningCosts=z.object({currency:z.string().regex(/^[A-Z]{3}$/),entries:z.array(z.object({id,label:text(100).min(1),amount:money.nullable(),participants:ids}).strict()).max(20)}).strict();
const terms=z.object({refund:z.enum(['unknown','full','none','fee','percent']),fee:money,percent:z.number().finite().min(0).max(100),cutoff:instant.nullable(),source:text(500),sourceUrl:text(2000).optional(),checkedAt:text(40)}).strict();
const journeyInput=z.object({selections:z.array(z.object({stayId:id,ids:z.array(id).max(60)}).strict()).min(1).max(30),pace:z.enum(['relaxed','balanced','busy']),mode:z.enum(['walk','drive'])}).strict();
const scenario=z.object({id,name:text(100).min(1),start:day,end:day,travelMode:z.enum(['walk','drive']),omitted:ids,prices:z.array(z.object({itemId:id,price:money.nullable(),label:text(120).optional(),placeId:id.optional()}).strict()).max(100),extras:z.array(z.object({label:text(120).min(1),price:money.nullable()}).strict()).max(20),currency:z.string().regex(/^[A-Z]{3}$/),source:text(600000),createdBy:id}).strict();
const roadTrip=z.object({enabled:z.boolean(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),vehicles:z.number().int().min(1).max(20),consumption:z.number().finite().min(0).max(100).nullable(),fuelPrice:money.nullable(),tolls:money,parking:money,restEvery:z.number().int().min(30).max(360),restMinutes:z.number().int().min(5).max(120),breaks:z.array(z.object({id,legId:id,day,name:text(150).min(1),minutes:z.number().int().min(5).max(240),itemId:id.optional()}).strict()).max(60)}).strict();
export const frontendPlanFields={stays:z.array(frontendStaySchema).max(30).optional(),planningIdeas:z.array(frontendPlanningIdeaSchema).max(100).optional(),roadTrip:roadTrip.optional(),scenarios:z.array(scenario).max(8).optional(),planningCosts:planningCosts.optional()};
export const frontendActionSchema:z.ZodType<Omit<Action,'actor'>&{actor?:string},z.ZodTypeDef,unknown>=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('activity_comment'),targetId:id,commentId:id,text:text(1000).min(1)}).strict(),
 z.object({...common,type:z.literal('activity_comment_delete'),targetId:id,commentId:id}).strict(),
 z.object({...common,type:z.literal('activity_vote'),targetId:id,vote:z.enum(['interested','pass']).nullable()}).strict(),
 z.object({...common,type:z.literal('activity_priority'),targetId:id,mustVisit:z.boolean()}).strict(),
 z.object({...common,type:z.literal('city_stays'),stays:z.array(frontendStaySchema).max(30)}).strict(),
 z.object({...common,type:z.literal('planning_style'),style}).strict(),
 z.object({...common,type:z.literal('planning_costs'),costs:planningCosts}).strict(),
 z.object({...common,type:z.literal('planning_idea_done'),ideaId:id,done:z.boolean()}).strict(),
 z.object({...common,type:z.literal('scenario_save'),scenario}).strict(),
 z.object({...common,type:z.literal('scenario_delete'),scenarioId:id}).strict(),
 z.object({...common,type:z.literal('accommodation_dates'),itemId:id,revision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),checkout:day,reviewed:z.literal(true)}).strict(),
 z.object({...common,type:z.literal('schedule_mode'),travelMode:z.enum(['walk','drive','transit'])}).strict(),
 z.object({...common,type:z.literal('optimize_order'),day,travelMode:z.enum(['walk','drive']),fingerprint:text(600000).min(1)}).strict(),
 z.object({...common,type:z.literal('apply_draft'),draftId:id,entries:z.array(z.object({suggestionId:id,start:instant,duration:z.number().int().min(1).max(1440)}).strict()).min(1).max(12),travelMode:z.enum(['walk','drive']).optional(),routeSourceIds:z.array(id).max(24).optional(),planningDay:day.optional()}).strict(),
 z.object({...common,type:z.literal('apply_journey'),draftId:id,input:journeyInput,fingerprint:text(600000).min(1)}).strict(),
 z.object({...common,type:z.literal('import_booking'),booking:z.object({importId:id,itemId:id.optional(),reviewed:z.literal(true),name:text(180).min(1),category:z.enum(['Activity','Accommodation','Transport','Meal','Practical stop']),start:instant,duration:z.number().int().min(1).max(1440),endDate:day.optional(),currency:z.string().regex(/^[A-Z]{3}$/),price:money.nullable(),participants:ids,reference:text(180),location:text(250),terms,confirmedBooking:z.boolean()}).strict()}).strict(),
 z.object({...common,type:z.literal('reminder_settings'),settings:z.object({leadMinutes:z.object({task:z.number().int().min(0).max(43200),payment:z.number().int().min(0).max(43200),quote:z.number().int().min(0).max(43200),cancellation:z.number().int().min(0).max(43200),custom:z.number().int().min(0).max(43200)}).strict(),browser:z.boolean()}).strict()}).strict(),
 z.object({...common,type:z.literal('reminder_personal'),reminderId:id,done:z.boolean().optional(),snoozedUntil:instant.optional()}).strict(),
 z.object({...common,type:z.literal('reminder_create'),title:text(180).min(3),due:instant,itemId:id,consequence:text(500).optional()}).strict(),
 z.object({...common,type:z.literal('item_deadlines'),itemId:id,expires:instant.nullable(),deadline:instant.nullable()}).strict(),
 z.object({...common,type:z.literal('road_trip'),settings:z.object({enabled:z.boolean(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),vehicles:z.number().int().min(1).max(20),consumption:z.number().finite().min(0).max(100).nullable(),fuelPrice:money.nullable(),tolls:money,parking:money,restEvery:z.number().int().min(30).max(360),restMinutes:z.number().int().min(5).max(120),breaks:z.array(z.object({id,legId:id,day,name:text(150).min(1),minutes:z.number().int().min(5).max(240),itemId:id.optional()}).strict()).max(60)}).strict()}).strict(),
]);
export function parseFrontendAction(value:unknown):Action|null{const parsed=frontendActionSchema.safeParse(value);return parsed.success?parsed.data as Action:null;}

/** Only planning metadata and canonical draft additions. This never appends,
 * adjusts, confirms or deletes financial events or provider operations. */
export function applyFrontendAction(s:State,a:Action):boolean{
 const actor=a.actor,now=new Date().toISOString();
 const audit=(message:string)=>s.audit.unshift({id:crypto.randomUUID(),at:now,text:message,actorId:actor,actorName:planMembers(s).find(p=>p.id===actor)?.name});
 const item=()=>{const i=s.items.find(i=>i.id===a.itemId);if(!i)throw Error('Choose an activity in this plan.');return i;};
 switch(a.type){
 case 'activity_comment':case 'activity_comment_delete':case 'activity_vote':case 'activity_priority':updateActivityDecision(s,a,now);return true;
 case 'city_stays':{const stays=validateCityStays(a.stays,s.plan);for(const i of s.items){if(i.status==='cancelled'||i.category==='Preparation'||!i.stayId||i.stayId==='base')continue;const stay=stays.find(stay=>stay.id===i.stayId),day=itemDay(i,s.plan.timezone);if(!stay||day<stay.start||day>stay.end)throw Error('Keep city stays covering the existing activities. Move or review those activities first.');}s.plan.stays=stays;audit('City stays updated; existing bookings, payments and activity times retained.');return true;}
 case 'planning_style':s.preferences[actor]={...s.preferences[actor],...validatePlanningStyle(a.style as Parameters<typeof validatePlanningStyle>[0])};audit('Private planning preferences updated.');return true;
 case 'planning_costs':s.plan.planningCosts=validatePlanningCosts(a.costs as Parameters<typeof validatePlanningCosts>[0],s);audit('Planning allowances updated. No spending recorded.');return true;
 case 'planning_idea_done':{const idea=s.plan.planningIdeas?.find(i=>i.id===a.ideaId);if(!idea)throw Error('Choose an idea in this plan.');idea.done=a.done===true;return true;}
 case 'scenario_save':{const scenario=validateScenario(a.scenario as Parameters<typeof validateScenario>[0],s,actor),list=s.plan.scenarios??[];if(!list.some(v=>v.id===scenario.id)&&list.length>=8)throw Error('Keep up to eight comparisons.');s.plan.scenarios=[...list.filter(v=>v.id!==scenario.id),scenario];audit('Hypothetical trip comparison saved; live itinerary and financial history retained.');return true;}
 case 'scenario_delete':s.plan.scenarios=s.plan.scenarios?.filter(v=>v.id!==a.scenarioId);return true;
 case 'accommodation_dates':{const i=item(),checkout=String(a.checkout),checkin=localDateTime(i.start,i.timezone??s.plan.timezone).slice(0,10);if(a.revision!==i.revision)throw Error('Review the latest accommodation revision.');if(hasMerchantCheckout(i)||i.paid.length||i.externalBooking||['confirmed','pending','demo-confirmed'].includes(i.booking)||s.events.some(e=>e.itemId===i.id&&e.status==='confirmed'&&e.kind!=='settlement'))throw Error('Use the saved change review for a booked or funded accommodation.');if(i.category!=='Accommodation'||i.status==='cancelled'||a.reviewed!==true||!validTripDates(checkin,checkout)||checkout<=checkin||checkout>s.plan.end)throw Error('Review a checkout date after check-in within the plan dates.');i.bookingEndDate=checkout;i.revision++;i.required=[...new Set([...(i.required??[]),...i.participants])];i.approvals=[];i.status='draft';audit('Reviewed accommodation checkout proposed; affected participants must approve the new revision.');return true;}
 case 'schedule_mode':if(!['walk','drive','transit'].includes(String(a.travelMode)))throw Error('Choose walking, driving or transit.');s.plan.scheduleTravelMode=a.travelMode as State['plan']['scheduleTravelMode'];return true;
 case 'optimize_order':{const mode=a.travelMode==='drive'?'drive':'walk',preview=optimizeDay(s,String(a.day),mode,actor,a._travelMatrix as TravelMatrix|undefined);if(a.fingerprint!==preview.fingerprint)throw Error('The itinerary changed. Preview its order again.');if(!preview.changes.length)throw Error('No shorter feasible order is available.');const undo=captureMove(s.items,preview.changes,actor,s.plan.scheduleTravelMode);for(const change of preview.changes){const i=s.items.find(i=>i.id===change.itemId)!;i.start=change.start;i.revision++;i.required=[...new Set([...(i.required??[]),...i.participants])];i.approvals=[];i.status='draft';}s.plan.scheduleTravelMode=mode;undo.context=scheduleUndoContext(s);s.scheduleUndo=[...(s.scheduleUndo??[]).filter(m=>m.actor!==actor),undo].slice(-20);audit('Reviewed itinerary order applied; changed times require fresh participant approvals.');return true;}
 case 'import_booking':{const next=applyBookingImport(s,actor,a.booking as Parameters<typeof applyBookingImport>[2]);Object.assign(s,next);audit('Reviewed supplier confirmation imported as planning metadata; payment and booking verification remain separate.');return true;}
 case 'apply_draft':case 'apply_journey':{
  const draftId=String(a.draftId);if(s.appliedDrafts?.includes(draftId))throw Error('This draft was already added.');
  const entries=a.type==='apply_journey'?a._journeyEntries:a._draftEntries;if(!Array.isArray(entries)||!entries.length||entries.length>(a.type==='apply_journey'?100:12))throw Error('Preview this itinerary again before adding it.');
  let next=s;const participants=planMembers(s).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id);
  for(const entry of entries as {suggestionId:string;start:string;duration:number}[]){if(!tripCatalog(next).some(c=>c.id===entry.suggestionId))throw Error('A selected place is no longer in this plan.');next=applyAction(next,{type:'add_suggestion',actor,tripId:s.plan.id,suggestionId:entry.suggestionId,start:entry.start,duration:entry.duration,participants});}
  next.appliedDrafts=[...(next.appliedDrafts??[]),draftId].slice(-100);Object.assign(s,next);audit('Reviewed itinerary added as draft activities; no booking or payment created.');return true;
 }
 case 'road_trip':s.plan.roadTrip=validateRoadTrip(a.settings,s);audit('Road-trip estimates updated; no spending recorded.');return true;
 case 'reminder_settings':s.preferences[actor]={...s.preferences[actor],reminders:validateReminderSettings(a.settings as Parameters<typeof validateReminderSettings>[0])};return true;
 case 'reminder_personal':{const id=String(a.reminderId);if(!getPlanReminders(s,actor).some(r=>r.id===id))throw Error('Choose a current reminder.');const until=a.snoozedUntil?String(a.snoozedUntil):undefined;if(until&&(!Number.isFinite(Date.parse(until))||Date.parse(until)<Date.now()||Date.parse(until)>Date.now()+30*86400000))throw Error('Snooze for a time within the next 30 days.');const pref=s.preferences[actor];pref.reminderState={...pref.reminderState,[id]:{done:a.done===true,snoozedUntil:until}};return true;}
 case 'reminder_create':{const title=String(a.title??'').trim(),due=String(a.due),itemId=String(a.itemId);if(title.length<3||title.length>180||!Number.isFinite(Date.parse(due))||!s.items.some(i=>i.id===itemId&&i.status!=='cancelled'))throw Error('Enter a title, due time and current activity.');s.reminders.push({id:crypto.randomUUID(),itemId,title,due,consequence:String(a.consequence??'Reminder entered by a plan member.').slice(0,500),done:false});return true;}
 case 'item_deadlines':{const i=item();if(i.status==='cancelled')throw Error('This activity is cancelled.');if(hasMerchantCheckout(i)||i.paid.length||i.externalBooking||['confirmed','pending','demo-confirmed'].includes(i.booking)||s.events.some(e=>e.itemId===i.id&&e.status==='confirmed'&&e.kind!=='settlement'))throw Error('Use the saved change review for a merchant, paid or confirmed booking.');for(const key of ['expires','deadline'] as const){const value=a[key];if(value!==null&&(typeof value!=='string'||!Number.isFinite(Date.parse(value))))throw Error('Enter a valid supplier deadline.');i[key]=value as string|null;}i.revision++;i.approvals=[];i.status='draft';audit('Supplier deadlines updated; affected members must review the new revision.');return true;}
 default:return false;
 }
}
