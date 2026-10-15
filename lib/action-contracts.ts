import {z} from 'zod';

// Bounds apply before the action reaches state mutation. Membership, ownership,
// current revisions and reconciliation remain checks against server state.
export const MAX_MONEY_UNITS=1_000_000_000_000;
const id=z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
 .refine(value=>!['__proto__','constructor','prototype'].includes(value),'Invalid identifier.');
const text=(max:number)=>z.string().max(max);
const name=text(180).refine(value=>!!value.trim(),'Enter a name.');
const money=z.number().finite().int().min(0).max(MAX_MONEY_UNITS);
const count=z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revision=count.refine(value=>value>0,'A current revision is required.');
const duration=z.number().finite().int().min(1).max(1440);
const latitude=z.number().finite().min(-90).max(90);
const longitude=z.number().finite().min(-180).max(180);
const calendarDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const date=new Date(`${value}T12:00:00Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},'Choose a valid calendar date.');
const timestamp=z.string().max(40)
 .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/)
 .refine(value=>calendarDate.safeParse(value.slice(0,10)).success&&Number.isFinite(Date.parse(value))&&Number(value.slice(11,13))<24,'Choose a valid date and time with a timezone.');
const ids=z.array(id).min(1).max(100).refine(values=>new Set(values).size===values.length,'Each participant must appear once.');
const optionalIds=z.array(id).max(100).refine(values=>new Set(values).size===values.length,'Each participant must appear once.');
const amounts=z.record(id,money).refine(value=>Object.keys(value).length<=100,'Too many share values.');
const weights=z.record(id,z.number().finite().min(0).max(MAX_MONEY_UNITS)).refine(value=>Object.keys(value).length<=100,'Too many share values.');
const travelMode=z.enum(['walk','drive']);
const kind=z.enum(['trip','day-out','event']);
const categories=z.enum(['Activity','Meal','Accommodation','Transport','Preparation','Free stop','Practical stop']);
const city=z.object({id,name,country:name,region:text(180),label:name,latitude,longitude}).strict();
const timezone=text(100).min(1).refine(value=>{
 try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}
},'Choose a valid timezone.');
const plan=z.object({
 id:id.optional(),kind:kind.optional(),scheduleTravelMode:travelMode.optional(),
 name,destination:text(120).refine(value=>!!value.trim(),'Enter a destination.'),
 goal:text(2000).optional(),start:calendarDate.optional(),end:calendarDate.optional(),
 timezone:timezone.optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),
 city:city.optional(),budget:money.optional(),contentDestination:text(120).optional(),
 template:z.enum(['algonquin','custom']).optional(),
}).strict();
const createPlan=plan.extend({start:calendarDate,end:calendarDate}).refine(value=>{
 const days=(Date.parse(`${value.end}T12:00:00Z`)-Date.parse(`${value.start}T12:00:00Z`))/86_400_000;
 return days>=0&&days<=366&&(value.kind!=='day-out'||value.start===value.end);
},'Choose plan dates within one year; a day out must use one date.');
const preferences=z.object({
 budget:money,cash:money,reserve:money,financing:money,
 pace:z.enum(['relaxed','balanced','busy']),interests:z.array(text(80).min(1)).max(30),
 paypalMe:text(200).refine(value=>!value||/^https:\/\/(www\.)?paypal\.me\/[a-zA-Z0-9._-]+\/?$/.test(value),'Enter your approved PayPal.Me profile URL.'),
}).strict();
const receipt=z.object({
 id:z.union([id,z.literal('')]).default(''),merchant:name,date:calendarDate,
 rows:z.array(z.object({id,name,amount:money,claims:ids,quantityMilli:z.number().int().min(1).max(1e9).optional(),unitPrice:money.optional(),lineDiscount:money.optional()}).strict()).min(1).max(100)
  .refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'Receipt lines must have unique identifiers.'),
 tax:money,tip:money,discount:money,total:money,payer:id,paymentConfirmed:z.boolean(),
 tipRule:z.enum(['proportional','equal']),
 // Existing UI sends a full receipt. These values are rederived by the model.
 shares:amounts.default({}),revision:revision.default(1),approvals:optionalIds.default([]),
 status:z.enum(['review','approved']).default('review'),previousShares:amounts.optional(),
 fileKey:z.string().max(101).regex(/^[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).optional(),
 source:text(2000).default('Manually entered receipt · review required'),linkedItemId:id.nullable().default(null),
}).strict();

const common={actor:id.optional(),tripId:id.optional()};
const itemAction={...common,itemId:id};
export const actionSchema=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('select_trip'),tripId:id}).strict(),
 z.object({...common,type:z.literal('delete_trip'),deleteTripId:id,confirmed:z.literal(true)}).strict(),
 z.object({...common,type:z.literal('restore_trip'),deletedTripId:id}).strict(),
 z.object({...common,type:z.literal('create_trip'),plan:createPlan}).strict(),
 z.object({...common,type:z.literal('reset')}).strict(),
 z.object({...common,type:z.literal('plan'),plan}).strict(),
 z.object({...common,type:z.literal('add_item'),name,category:categories,start:timestamp,duration,
  price:money.nullable(),participants:ids,location:text(300).optional(),policy:text(4000).optional(),taskOwner:id.optional()}).strict(),
 z.object({...common,type:z.literal('preferences'),preferences}).strict(),
 z.object({...common,type:z.literal('suggestion_feedback'),suggestionId:id,
  feedback:z.enum(['save','unsave','dismiss','vote']),vote:z.enum(['interested','not-interested']).optional()}).strict(),
 z.object({...common,type:z.literal('mute'),category:categories}).strict(),
 z.object({...common,type:z.literal('add_suggestion'),suggestionId:id,participants:ids,start:timestamp.optional(),duration:duration.optional()}).strict(),
 z.object({...itemAction,type:z.literal('item_location'),latitude,longitude}).strict(),
 z.object({...itemAction,type:z.literal('move_item'),day:calendarDate,beforeId:id.nullable().optional(),travelMode:travelMode.optional()}).strict(),
 z.object({...common,type:z.literal('undo_move'),undoId:id}).strict(),
 z.object({...itemAction,type:z.literal('item_edit'),participants:ids,price:money.nullable(),
  allocation:z.enum(['equal','fixed','percent','weight']),values:weights.optional(),name:name.optional(),
  location:text(300).optional(),start:timestamp.optional()}).strict(),
 z.object({...itemAction,type:z.literal('approve_item'),revision}).strict(),
 z.object({...itemAction,type:z.literal('task_edit'),name,taskOwner:id,start:timestamp}).strict(),
 z.object({...itemAction,type:z.literal('task'),done:z.boolean()}).strict(),
 z.object({...common,type:z.literal('reminder'),reminderId:id,done:z.boolean()}).strict(),
 z.object({...common,type:z.literal('receipt'),receipt}).strict(),
 z.object({...common,type:z.literal('approve_receipt'),receiptId:id,revision}).strict(),
 z.object({...common,type:z.literal('settlement_report'),to:id,amount:money.refine(value=>value>0,'Enter a positive repayment amount.')}).strict(),
 z.object({...common,type:z.literal('settlement_confirm'),eventId:id}).strict(),
 z.object({...common,type:z.literal('disrupt')}).strict(),
 z.object({...common,type:z.literal('propose_recovery'),option:z.enum(['replace','cancel'])}).strict(),
 z.object({...common,type:z.literal('departure'),departing:id}).strict(),
 z.object({...common,type:z.literal('approve_proposal'),proposalId:id,revision}).strict(),
 z.object({...common,type:z.literal('execute_proposal'),proposalId:id}).strict(),
 z.object({...common,type:z.literal('demo_refund'),eventId:id}).strict(),
 z.object({...itemAction,type:z.literal('demo_payment')}).strict(),
 z.object({...itemAction,type:z.literal('booking_fail')}).strict(),
 z.object({...itemAction,type:z.literal('confirm_booking')}).strict(),
]).superRefine((action,context)=>{
 if(action.type==='suggestion_feedback'&&action.feedback==='vote'&&!action.vote){
  context.addIssue({code:z.ZodIssueCode.custom,path:['vote'],message:'Choose a vote.'});
 }
 if(action.type==='item_edit'&&action.allocation==='fixed'&&Object.values(action.values??{}).some(value=>!Number.isSafeInteger(value))){
  context.addIssue({code:z.ZodIssueCode.custom,path:['values'],message:'Fixed shares must be integer currency units.'});
 }
});
export const workspaceMutationSchema=z.object({version:count,action:actionSchema}).strict();
export type ValidatedAction=z.infer<typeof actionSchema>;
export type WorkspaceMutation=z.infer<typeof workspaceMutationSchema>;

export class ActionValidationError extends Error {
 readonly status=400;
 constructor(message:string){super(message);this.name='ActionValidationError';}
}

/** Parse untrusted JSON before any action executes; identity is bound separately. */
export function parseWorkspaceMutation(input:unknown,options:{requireActor?:boolean}={}):WorkspaceMutation {
 const result=workspaceMutationSchema.safeParse(input);
 if(!result.success){
  const first=result.error.issues[0];
  // Do not echo arbitrary input values or oversized record keys into API logs.
  const path=first.path.slice(0,5).map(part=>String(part).slice(0,40)).join('.')||'request';
  const message=first.code==='unrecognized_keys'?'Unexpected fields.':
   first.code==='invalid_enum_value'||first.code==='invalid_literal'?'Choose a supported value.':first.message;
  throw new ActionValidationError(`Invalid request at ${path}: ${message.slice(0,240)}`);
 }
 if(options.requireActor&&!result.data.action.actor)throw new ActionValidationError('Choose a demo member.');
 return result.data;
}
