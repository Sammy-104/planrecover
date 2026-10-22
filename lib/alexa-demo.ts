import {allocate} from './model.ts';
export const DEMO_VERSION='knota-nyc-recovery-2';
export const people=[{id:'sam',name:'Sam'},{id:'alex',name:'Alex'},{id:'maya',name:'Maya'},{id:'chris',name:'Chris'}] as const;
export type Scenario='rain'|'cancelled'|'late';
export type OptionId='gallery'|'library'|'workshop';
export type Context={scenario:Scenario;choice?:OptionId;approvals:string[];applied:boolean;cashLimit:number};
export const freshContext=():Context=>({scenario:'rain',approvals:[],applied:false,cashLimit:5000});
export const alternatives=[
 {id:'gallery',name:'Indoor gallery visit',tag:'A similar afternoon',description:'Keep the culture stop, move indoors, and leave the evening together.',start:'11:00',duration:90,price:12000},
 {id:'library',name:'Library & architecture walk',tag:'Lowest new cost',description:'An indoor public-space visit with no new ticket cost in this sample.',start:'11:00',duration:90,price:0},
 {id:'workshop',name:'Indoor art workshop',tag:'Try something together',description:'A hands-on indoor session before dinner. It needs more cash upfront.',start:'11:00',duration:120,price:20000},
] as const;
const ids=people.map(p=>p.id),paid=52000,tour=14000,refund=10000;
export const ledger=()=>({currency:'USD',recordedPaid:paid,receivedRefund:0,confirmedNewPayment:0});
export function validateContext(input:unknown):Context{
 if(input===undefined)return freshContext();
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Use a valid sample-trip context.');
 const c=input as Context;
 if(Object.keys(c).some(k=>!['scenario','choice','approvals','applied','cashLimit'].includes(k))||!['rain','cancelled','late'].includes(c.scenario)||c.choice!==undefined&&!alternatives.some(o=>o.id===c.choice)||!Array.isArray(c.approvals)||c.approvals.length>4||new Set(c.approvals).size!==c.approvals.length||c.approvals.some(id=>!ids.includes(id as typeof ids[number]))||typeof c.applied!=='boolean'||!Number.isSafeInteger(c.cashLimit)||c.cashLimit<0||c.cashLimit>1000000)throw Error('Review the sample scenario, selection and cash limit.');
 if((c.approvals.length>0||c.applied)&&!c.choice||c.applied&&c.approvals.length!==4)throw Error('Select an option and review all four fictional travellers.');
 if(c.applied&&alternatives.find(o=>o.id===c.choice)!.price/4>c.cashLimit)throw Error('Expected refunds cannot fund the upfront cash shortfall.');
 return {scenario:c.scenario,...(c.choice?{choice:c.choice}:{}),approvals:[...c.approvals],applied:c.applied,cashLimit:c.cashLimit};
}
export function compare(context:Context,optionId:OptionId){
 const option=alternatives.find(o=>o.id===optionId);if(!option)throw Error('Choose gallery, library or workshop.');
 return {option:{...option,start:context.scenario==='late'?'15:00':option.start},currency:'USD',originalPaid:paid,originalTourCost:tour,retainedCost:paid-tour,expectedRefund:refund,receivedRefund:0,upfront:option.price,projectedFinal:paid-refund+option.price,upfrontShares:allocate(option.price,ids),refundShares:allocate(refund,ids),finalShares:allocate(paid-refund+option.price,ids),cashShortfall:Math.max(0,option.price/4-context.cashLimit),reviewToken:JSON.stringify([DEMO_VERSION,context.scenario,optionId,context.cashLimit])};
}
export function itinerary(context:Context){
 const chosen=context.applied?alternatives.find(o=>o.id===context.choice):undefined;
 return [{id:'hotel',time:'08:30',name:'Midtown hotel · breakfast',status:'Retained booking',kind:'hotel'},{id:'visit',time:chosen?(context.scenario==='late'?'15:00':chosen.start):'11:00',name:chosen?.name??'Guided outdoor neighbourhood tour',status:chosen?'Reviewed sample draft':context.scenario==='rain'?'Heavy rain reported':context.scenario==='late'?'Arrival delayed':'Supplier cancellation reported',kind:chosen?'replacement':'affected'},{id:'dinner',time:'18:00',name:'Dinner with the group',status:'Retained booking',kind:'dinner'}];
}
export type Comparison=ReturnType<typeof compare>;
export type ToolResult={context:Context;message:string;options?:Comparison[];comparison?:Comparison;applied?:boolean;nextActions?:string[];overview?:{itinerary:ReturnType<typeof itinerary>;ledger:ReturnType<typeof ledger>}};
export const toolNames=['get_trip_overview','report_trip_disruption','find_recovery_options','preview_recovery','get_cost_breakdown','apply_reviewed_recovery'] as const;
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n%100?2:0}).format(n/100);
const nextActions=['Confirm the original tour cancellation and refund terms with its supplier.','Check the replacement venue’s real opening hours, price and availability.','Review any new booking and payment separately.'];
export function runTool(name:string,input:unknown):ToolResult{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Use sample-trip tool arguments.');
 const a=input as Record<string,unknown>;
 const allowed:Record<string,string[]>={get_trip_overview:[],report_trip_disruption:['scenario'],find_recovery_options:[],preview_recovery:['optionId'],get_cost_breakdown:[],apply_reviewed_recovery:['confirmed','reviewToken']};
 if(!Object.hasOwn(allowed,name))throw Error('Unknown sample-trip tool.');
 if(Object.keys(a).some(k=>k!=='context'&&!allowed[name].includes(k)))throw Error('This tool only accepts fictional sample-trip arguments.');
 let context=validateContext(a.context);
 const selected=()=>{if(!context.choice)throw Error('Choose an alternative first.');return compare(context,context.choice);};
 if(name==='get_trip_overview')return {context,message:context.applied?'Your reviewed sample itinerary is ready. The hotel and dinner stay in place.':'Four friends are travelling Toronto → New York → Miami. On December 28, the New York outdoor tour is affected. Your paid hotel and dinner can stay.',overview:{itinerary:itinerary(context),ledger:ledger()},...(context.applied?{nextActions}:{})};
 if(name==='report_trip_disruption'){
  if(!['rain','cancelled','late'].includes(String(a.scenario)))throw Error('Choose rain, cancelled or late.');
  context={...context,scenario:a.scenario as Scenario,choice:undefined,approvals:[],applied:false};
  return {context,message:context.scenario==='rain'?'I’ve noted heavy rain. Let’s compare indoor alternatives and keep your hotel and dinner.':context.scenario==='late'?'I’ve noted a late arrival. The sample alternatives move to 3 PM, ahead of the 6 PM dinner.':'I’ve noted the supplier cancellation. Let’s compare alternatives before changing the sample plan.'};
 }
 if(name==='find_recovery_options')return {context,message:'Here are three sample alternatives. Compare cash needed now with the expected refund later. Each keeps your hotel and dinner.',options:alternatives.map(o=>compare(context,o.id))};
 if(name==='preview_recovery'){
  if(!alternatives.some(o=>o.id===a.optionId))throw Error('Choose gallery, library or workshop.');
  context={...context,choice:a.optionId as OptionId,approvals:[],applied:false};const c=selected();
  return {context,comparison:c,message:c.option.name+' needs '+money(c.upfrontShares.sam)+' per person upfront. The expected refund is '+money(c.refundShares.sam)+' each and has not arrived. '+(c.cashShortfall?'Your sample cash limit falls short. Try the free library alternative.':'Review the four fictional travellers before applying the sample draft.')};
 }
 if(name==='get_cost_breakdown'){const c=selected();return {context,comparison:c,message:'The group has '+money(paid)+' recorded as paid. This alternative needs '+money(c.upfront)+' new cash. '+money(refund)+' is an expected refund; '+money(0)+' has been received. Projected final cost is '+money(c.projectedFinal)+' for the sample day.'};}
 const c=selected();
 if(a.confirmed!==true||a.reviewToken!==c.reviewToken)throw Error('Review the current costs and explicitly confirm the sample change.');
 if(context.approvals.length!==4)throw Error('All four fictional travellers must be marked as reviewed.');
 if(c.cashShortfall)throw Error('Expected refunds cannot fund the upfront cash shortfall.');
 context={...context,applied:true};
 return {context,comparison:c,applied:true,message:'The sample itinerary now has your reviewed alternative. Your original hotel, dinner and paid ledger are retained. No booking, payment or refund was executed.',nextActions};
}
export type Operation={name:string;arguments:Record<string,unknown>};
export function intent(text:string,context:Context):{steps:Operation[];help?:string;reset?:boolean}{
 const t=text.toLowerCase().trim().replace(/^(?:(?:hey|hi|hello)[, ]+)?(?:alexa|knota)[, :]+/,'');
 if(!t||t.length>500)return {steps:[],help:'Try “It’s raining”, “Choose the gallery”, or “Explain the refund”.'};
 if(/\b(reset|restart|start over|undo)\b/.test(t))return {steps:[],reset:true};
 const scenario:Scenario|undefined=/\b(rain|raining|storm|wet)\b/.test(t)?'rain':/\b(cancelled|canceled|cancellation|closed|closure)\b/.test(t)?'cancelled':/\b(late|delay|delayed)\b/.test(t)?'late':undefined;
 if(scenario)return {steps:[{name:'get_trip_overview',arguments:{}},{name:'report_trip_disruption',arguments:{scenario}},{name:'find_recovery_options',arguments:{}}]};
 if(/\b(apply|approve|approval|confirm|book|reserve)\b/.test(t))return {steps:[],help:'Select an alternative, review the exact costs, mark the four simulated reviews, then use “Apply sample change”. A message cannot approve for anyone.'};
 const optionId:OptionId|undefined=/\b(free|cheapest|library|second|option 2)\b/.test(t)?'library':/\b(workshop|third|option 3)\b/.test(t)?'workshop':/\b(gallery|museum|first|option 1)\b/.test(t)?'gallery':undefined;
 if(optionId)return {steps:[{name:'preview_recovery',arguments:{optionId}}]};
 if(/\b(refund|money|cash|afford|cost|pay|paid|spend)\b/.test(t))return {steps:[{name:context.choice?'get_cost_breakdown':'find_recovery_options',arguments:{}}]};
 if(/\b(alternative|alternatives|option|options|indoor|indoors|help|recover|instead|compare|recommend)\b/.test(t))return {steps:[{name:'find_recovery_options',arguments:{}}]};
 if(/\b(plan|planned|itinerary|trip|schedule|next|today|tomorrow|overview|brief|doing)\b/.test(t))return {steps:[{name:'get_trip_overview',arguments:{}}]};
 return {steps:[],help:'This focused Alexa+ web simulation can explain the sample itinerary, compare alternatives and show costs. Try “It’s raining” or “Choose the free option”.'};
}
