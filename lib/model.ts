import {validCitySelection,type CitySelection} from './city-search.ts';
import {cityKey,cityProfile,type CityPlace,type PlacePhoto,type PlaceLocation} from './cities.ts';
import {zonedStart} from './trip-time.ts';
import {formatMoney,planCurrency,validCurrency,currencyLocked} from './money.ts';
import {destinationSettings,validTimezone} from './localization.ts';
import {planKind,planType,parsePlanKind,validPlanDates,defaultPlanGoal,type PlanKind} from './plan-types.ts';
import {hasMerchantCheckout,requireMerchantCheckout} from './merchant-scope.ts';
import {previewMove,type TravelMode} from './schedule.ts';
import type {PlanPerson} from './people.ts';
import {placeInfo} from './place-info.ts';
import {captureMove,undoMoveAvailable,type ScheduleUndo} from './plan-history.ts';
export const memberIds = ['sam','alex','maya','chris'] as const;
export type MemberId = string;
export const members = [{id:'sam',name:'Sam',initials:'SL',color:'#315be8'},{id:'alex',name:'Alex',initials:'AC',color:'#ac5ac6'},{id:'maya',name:'Maya',initials:'MR',color:'#0b8d88'},{id:'chris',name:'Chris',initials:'CW',color:'#c77a28'}] as const;
export type Shares = Record<string,number>;
export type Allocation = 'equal'|'fixed'|'percent'|'weight';
export type Item = PlacePhoto & PlaceLocation & {id:string;name:string;category:string;start:string;duration:number;price:number|null;participants:string[];shares:Shares;funding?:{revision:number;participants:string[];shares:Shares;price:number;source:string};allocation:Allocation;values:Shares;revision:number;approvals:string[];required?:string[];status:'draft'|'scheduled'|'cancelled'|'awaiting-payment';booking:'demo-confirmed'|'unconfirmed'|'failed';policy:string;source:string;expires:string|null;deadline:string|null;depends:string[];paid:string[];taskOwner?:string;done?:boolean;location:string;sourceUrl?:string};
export type MoneyEvent = {id:string;itemId:string;kind:'expense'|'refund'|'adjustment'|'settlement';label:string;shares:Shares;contributions:Shares;amount:number;status:'confirmed'|'pending'|'reported';evidence:string;mode:'fixture'|'simulation'|'manual'|'sandbox';created:string;from?:string;to?:string;providerId?:string};
export type ReceiptRow={id:string;name:string;amount:number;claims:string[];quantityMilli?:number;unitPrice?:number;lineDiscount?:number};
export type Receipt={id:string;merchant:string;date:string;rows:ReceiptRow[];tax:number;tip:number;discount:number;total:number;payer:string;paymentConfirmed:boolean;tipRule:'proportional'|'equal';shares:Shares;revision:number;approvals:string[];status:'review'|'approved';fileKey?:string;source:string;linkedItemId:string|null;previousShares?:Shares};
export type Proposal={id:string;kind:'recovery'|'departure';title:string;revision:number;required:string[];approved:string[];status:'pending'|'approved'|'executed';option?:'replace'|'cancel';departing?:string;itemId?:string;newShares?:Shares;snapshot:string};
export type Preferences={budget:number;cash:number;reserve:number;pace:string;interests:string[];paypalMe:string;financing:number};
export type State={reimbursementLinks?:Record<string,string>;deletedTrips?:DeletedTrip[];scheduleUndo?:ScheduleUndo[];people?:PlanPerson[];empty?:boolean;demoRemoved?:boolean;plan:{id?:string;kind?:PlanKind;scheduleTravelMode?:TravelMode;currency?:string;city?:CitySelection;name:string;destination:string;goal:string;start:string;end:string;timezone:string;budget:number;contentDestination?:string;template?:'algonquin'|'custom'};archives?:ArchivedTrip[];recommendations?:{destinationKey:string;resolvedCity:string;fetchedAt:string;source:'city-guide'|'wikipedia'|'open-places';entries:CityPlace[];radiusKm?:number;photosChecked?:boolean;detailsVersion?:number;discoveryVersion?:number;sourcesUnavailable?:boolean};items:Item[];events:MoneyEvent[];receipts:Receipt[];proposals:Proposal[];preferences:Record<string,Preferences>;dismissed:string[];saved:string[];votes:Record<string,Record<string,string>>;muted:string[];reminders:{id:string;itemId:string;title:string;due:string;consequence:string;done:boolean}[];audit:{id:string;at:string;text:string;detail?:string;actorId?:string;actorName?:string}[];disruption:boolean;recoveryDone:boolean;version:number};
export type ArchivedTrip={id:string;archivedAt:string;workspace:Omit<State,'archives'|'deletedTrips'>};
export type DeletedTrip={id:string;deletedAt:string;expiresAt:string;workspace:Omit<State,'archives'|'deletedTrips'>};
export type Suggestion=PlacePhoto&PlaceLocation&import('./place-popularity.ts').PlacePopularity&{id:string;name:string;category:string;start:string;duration:number;travelIn:number;travelOut:number;buffer:number;price:number|null;reason:string;policy:string;location:string;tag:string;sourceUrl?:string;sourceLabel?:string;tags?:string[];suggestedParticipants?:string[];flexible?:boolean};
export const catalog:Suggestion[]=[
 {id:'viewpoint',name:'Lakeside viewpoint',category:'Free stop',start:'2026-10-17T15:30:00-04:00',duration:45,travelIn:10,travelOut:10,buffer:15,price:0,reason:'A quiet stop in the 100-minute gap before dinner. No new spending.',policy:'No booking required. Access and route are demo fixtures.',location:'Lakeshore',tag:'Fits your gap'},
 {id:'pack',name:'Pack rain layers & refill bottles',category:'Preparation',start:'2026-10-16T11:00:00-04:00',duration:20,travelIn:0,travelOut:0,buffer:0,price:0,reason:'A preparation task before the guided hike. Assign it to one person.',policy:'Preparation task; no payment or reservation.',location:'Before departure',tag:'Ready for the trail'},
 {id:'museum',tags:['Indoor','Museums','Culture'],name:'Local history museum',category:'Activity',start:'2026-10-17T15:30:00-04:00',duration:45,travelIn:10,travelOut:10,buffer:15,price:6400,reason:'An indoor stop for four at CAD 16 each, within the afternoon gap.',policy:'Demo estimate. Opening hours and accessibility require confirmation.',location:'Village centre',tag:'Indoor option'},
 {id:'dinner',suggestedParticipants:['sam','alex'],name:'Dinner for Sam & Alex',category:'Meal',start:'2026-10-16T18:00:00-04:00',duration:75,travelIn:10,travelOut:10,buffer:10,price:5600,reason:'An optional meal for just the interested friends. Others keep their existing obligations.',policy:'Estimate only; tax, tip, dietary needs and reservation require review.',location:'Near the lodge',tag:'Choose who joins'},
 {id:'picnic',name:'Shared picnic groceries',category:'Practical stop',start:'2026-10-16T14:00:00-04:00',duration:30,travelIn:5,travelOut:5,buffer:10,price:4800,reason:'Supplies before check-in, with four equal shares of CAD 12.',policy:'Estimated shopping budget. Review the receipt afterward.',location:'Village market',tag:'Under CAD 20 each'},
 {id:'walk',name:'Sunday self-guided walk',category:'Free stop',start:'2026-10-18T10:00:00-04:00',duration:60,travelIn:10,travelOut:10,buffer:15,price:0,reason:'Keeps a relaxed morning open after checkout.',policy:'Demo route; public access and mobility suitability unverified.',location:'Lodge loop',tag:'A slower morning'},
 {id:'workshop',tags:['Indoor','Culture'],name:'Pottery workshop',category:'Activity',start:'2026-10-17T10:00:00-04:00',duration:120,travelIn:15,travelOut:15,buffer:15,price:20000,reason:'A creative option, but its slot overlaps the already scheduled hike.',policy:'Demo estimate; no live availability.',location:'Village studio',tag:'Time conflict'},
 {id:'dining',name:'Chef’s tasting dinner',category:'Meal',start:'2026-10-18T17:00:00-04:00',duration:90,travelIn:15,travelOut:15,buffer:10,price:40000,reason:'An optional experience at CAD 100 each; exceeds the original CAD 300 trip budget.',policy:'Demo estimate. Outside booking; no integrated checkout.',location:'Village centre',tag:'Budget conflict'},
 {id:'market',name:'Seasonal community market',category:'Activity',start:'2026-10-18T13:00:00-04:00',duration:45,travelIn:10,travelOut:10,buffer:15,price:null,reason:'A possible local stop. Price, event date and availability are still unknown.',policy:'Unverified demo candidate. Keep as a draft until checked.',location:'Town square',tag:'Price unknown'},
 {id:'checkin',name:'Confirm lodge arrival instructions',category:'Preparation',start:'2026-10-16T10:00:00-04:00',duration:15,travelIn:0,travelOut:0,buffer:0,price:0,reason:'Closes a practical gap before a prepaid stay.',policy:'Assigned task; no financial event.',location:'Before departure',tag:'What are we missing?'}
];
export const dollars=formatMoney;
export function cents(value:unknown):number {const n=typeof value==='number'?value:Number(value);if(!Number.isSafeInteger(n)||n<0||n>1000000000000)throw Error('Amounts must be valid non-negative currency units.');return n;}
export function allocate(total:number, ids:string[], mode:Allocation='equal', values:Shares={},allowed:readonly string[]=memberIds):Shares {
 cents(total); if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!allowed.includes(id)))throw Error('Select valid participants.');
 let weights=ids.map(id=>mode==='equal'?1:values[id]??0);
 if(weights.some(n=>!Number.isFinite(n)||n<0))throw Error('Share values must be non-negative.');
 const sum=weights.reduce((a,b)=>a+b,0);
 if(mode==='fixed'){if(weights.some(n=>!Number.isSafeInteger(n))||sum!==total)throw Error('Fixed shares must sum to the exact total.');return Object.fromEntries(ids.map((id,i)=>[id,weights[i]]));}
 if(mode==='percent'&&Math.abs(sum-100)>0.000001)throw Error('Percentages must add up to 100.');
 if(sum<=0)throw Error('At least one share must be greater than zero.');
 const raw=weights.map(n=>total*n/sum), out=raw.map(Math.floor);let remainder=total-out.reduce((a,b)=>a+b,0);
 const order=ids.map((id,i)=>({i,f:raw[i]-out[i],id})).sort((a,b)=>b.f-a.f||a.id.localeCompare(b.id));
 for(let i=0;i<remainder;i++)out[order[i%order.length].i]++;
 return Object.fromEntries(ids.map((id,i)=>[id,out[i]]));
}
const allocateForMembers=allocate;
export function splitReceipt(r:Pick<Receipt,'rows'|'tax'|'tip'|'discount'|'total'|'tipRule'>,memberIds:readonly string[]= ['sam','alex','maya','chris'],currency='CAD'):Shares {
 const base:Shares=Object.fromEntries(memberIds.map(id=>[id,0]));
 for(const row of r.rows){if(row.quantityMilli!==undefined||row.unitPrice!==undefined||row.lineDiscount!==undefined){
  if(!Number.isSafeInteger(row.quantityMilli)||row.quantityMilli!<=0||row.quantityMilli!>1e9||!Number.isSafeInteger(row.unitPrice)||row.unitPrice!<0||!Number.isSafeInteger(row.lineDiscount)||row.lineDiscount!<0)throw Error('Enter the quantity, unit price and line discount together.');
  const gross=(BigInt(row.quantityMilli!)*BigInt(row.unitPrice!)+BigInt(500))/BigInt(1000),net=gross-BigInt(row.lineDiscount!);if(net<0||net!==BigInt(row.amount))throw Error('The quantity, unit price and line discount must match the line amount.');
 }const shares=allocate(cents(row.amount),row.claims,'equal',{},memberIds);for(const [id,n]of Object.entries(shares))base[id]+=n;}
 const subtotal=r.rows.reduce((n,row)=>n+row.amount,0);const expected=subtotal+cents(r.tax)+cents(r.tip)-cents(r.discount);
 if(expected!==cents(r.total))throw Error(`Receipt differs by ${dollars(Math.abs(expected-r.total),currency)}. Correct the items, tax, tip or total before saving.`);
 if(r.discount>subtotal)throw Error('The discount exceeds the item subtotal.');
 const ids=memberIds.filter(id=>base[id]>0);if(!ids.length&&r.total>0)throw Error('Claim at least one priced item.');
 if(!ids.length)return base;
 const tax=allocate(r.tax,ids,'weight',base,memberIds),disc=allocate(r.discount,ids,'weight',base,memberIds),tip=allocate(r.tip,ids,r.tipRule==='equal'?'equal':'weight',base,memberIds);
 for(const id of ids)base[id]+=tax[id]+tip[id]-disc[id];
 if(Object.values(base).reduce((a,b)=>a+b,0)!==r.total)throw Error('The receipt allocation could not reconcile.');return base;
}
export function fixtureReceipt():Receipt{return {id:'',merchant:'Trailhead Kitchen',date:'2026-10-17',rows:[{id:'burger',name:'Sam · Burger',amount:2400,claims:['sam']},{id:'pasta',name:'Alex · Pasta',amount:2000,claims:['alex']},{id:'salad',name:'Maya · Salad',amount:1800,claims:['maya']},{id:'bowl',name:'Chris · Rice bowl',amount:2200,claims:['chris']},{id:'fries',name:'Shared fries',amount:1200,claims:[...memberIds]}],tax:1248,tip:1728,discount:0,total:12576,payer:'sam',paymentConfirmed:false,tipRule:'proportional',shares:{},revision:1,approvals:[],status:'review',source:'Synthetic receipt from blueprint',linkedItemId:null};}
function item(id:string,name:string,category:string,start:string,duration:number,price:number|null,policy:string):Item {return {id,name,category,start,duration,price,participants:[...memberIds],shares:price===null?{}:allocate(price,[...memberIds]),allocation:'equal',values:{},revision:1,approvals:[...memberIds],status:'scheduled',booking:price? 'demo-confirmed':'unconfirmed',policy,source:'Fictional demo merchant · blueprint fixture',expires:null,deadline:null,depends:[],paid:price?[...memberIds]:[],location:'Algonquin area'};}
export function initialState():State {
 const items=[item('lodge','Lakeside lodge','Accommodation','2026-10-16T16:00:00-04:00',60,48000,'CAD 480 for two nights. Non-refundable. Demo supplier terms.'),item('shuttle','Trail shuttle','Transport','2026-10-17T08:15:00-04:00',45,12000,'Refund less CAD 10 group cancellation fee. Demo cutoff: Oct 16, 6:00 PM Toronto.'),item('hike','Guided ridge hike','Activity','2026-10-17T09:00:00-04:00',360,36000,'Full refund if the provider cancels. No cancellation cutoff supplied.'),item('return','Return shuttle','Transport','2026-10-17T15:00:00-04:00',20,0,'Included in the trail shuttle booking.'),item('dinner-slot','Dinner & downtime','Buffer','2026-10-17T17:00:00-04:00',90,null,'Protected dinner window. Restaurant and cost not confirmed.')];
 items[1].depends=['hike'];items[1].deadline='2026-10-16T18:00:00-04:00';items[3].depends=['shuttle'];
 return {plan:{id:crypto.randomUUID(),kind:'trip',currency:'CAD',name:'The Algonquin weekend',destination:'Algonquin area, Ontario',goal:'A hiking weekend for four friends, under CAD 300 each.',start:'2026-10-16',end:'2026-10-18',timezone:'America/Toronto',budget:30000,contentDestination:'Algonquin area, Ontario',template:'algonquin'},archives:[],items,events:items.filter(i=>i.price).map(i=>({id:`seed-${i.id}`,itemId:i.id,kind:'expense',label:i.name,shares:i.shares,contributions:i.shares,amount:i.price!,status:'confirmed',evidence:'Seeded historical payment; no PayPal transaction took place.',mode:'fixture',created:'2026-10-06T18:00:00Z'})),receipts:[],proposals:[],preferences:Object.fromEntries(memberIds.map(id=>[id,{budget:30000,cash:id==='maya'?10000:15000,reserve:0,pace:'balanced',interests:['outdoors'],paypalMe:'',financing:0}])),dismissed:[],saved:[],muted:[],votes:{},reminders:[{id:'cutoff-shuttle-1',itemId:'shuttle',title:'Shuttle cancellation cutoff',due:'2026-10-16T18:00:00-04:00',consequence:'Demo supplier deadline. After this cutoff, refund terms require supplier review.',done:false},{id:'prepare-hike-1',itemId:'hike',title:'Check gear before departure',due:'2026-10-16T11:00:00-04:00',consequence:'Bring water, footwear and rain layers for the planned hike.',done:false}],audit:[],disruption:false,recoveryDone:false,version:0};
}
export const destinationKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-CA');
export function isDemoTrip(s:State){return s.plan.template==='algonquin'&&destinationKey(s.plan.destination)===destinationKey('Algonquin area, Ontario');}
function moveDestination(s:State,nextPlan:State['plan'],previousDestination:string):State {
 const {archives:previous=[],deletedTrips:ignoredDeleted,...snapshot}=structuredClone(s);
 snapshot.plan={...snapshot.plan,id:snapshot.plan.id??crypto.randomUUID(),destination:previousDestination,contentDestination:previousDestination};
 s.archives=[{id:snapshot.plan.id!,archivedAt:new Date().toISOString(),workspace:snapshot},...previous];
 const original=initialState().plan;
 s.plan={...nextPlan,city:validCitySelection(nextPlan.city,nextPlan.destination),id:crypto.randomUUID(),timezone:nextPlan.timezone,name:nextPlan.name===original.name?`${nextPlan.destination} ${planType(nextPlan).label.toLowerCase()}`:nextPlan.name,goal:nextPlan.goal===original.goal?defaultPlanGoal(planKind(nextPlan),nextPlan.destination):nextPlan.goal,contentDestination:nextPlan.destination,template:'custom'};
 s.items=[];s.events=[];s.receipts=[];s.proposals=[];s.reminders=[];s.audit=[];
 s.scheduleUndo=[];s.recommendations=undefined;s.dismissed=[];s.saved=[];s.votes={};s.disruption=false;s.recoveryDone=false;
 for(const id of planMembers(s).map(p=>p.id))s.preferences[id]={...s.preferences[id],budget:s.plan.budget,cash:s.plan.budget,reserve:0,financing:0};
 audit(s,`Destination changed to ${s.plan.destination}. Previous plan preserved in History.`);
 return s;
}
/** Read repair for workspaces saved before destination changes affected the trip. */
export function normalizeWorkspace(input:State):State {
 const s=structuredClone(input);
 const seeded=s.items.some(i=>['lodge','hike','shuttle','replacement'].includes(i.id));
 const previous=s.plan.contentDestination??(seeded?'Algonquin area, Ontario':s.plan.destination);
 if(destinationKey(previous)!==destinationKey(s.plan.destination))return normalizeWorkspace(moveDestination(s,s.plan,previous));
 for(const workspace of [s,...(s.archives??[]).map(archive=>archive.workspace),...(s.deletedTrips??[]).map(trip=>trip.workspace)])workspace.plan.currency??='CAD';
 for(const workspace of [s,...(s.archives??[]).map(archive=>archive.workspace)])for(const item of workspace.items)if(item.status==='awaiting-payment'&&!hasMerchantCheckout(item))item.status='scheduled';
 s.plan.kind=planKind(s.plan);
 s.plan.contentDestination=previous;
 s.plan.template??=seeded?'algonquin':'custom';
 s.archives??=[];
 s.deletedTrips=(s.deletedTrips??[]).filter(t=>Date.parse(t.expiresAt)>Date.now());
 s.plan.id??=crypto.randomUUID();
 for(const trip of s.archives){trip.workspace.plan.kind=planKind(trip.workspace.plan);trip.workspace.plan.id??=trip.id;trip.workspace.plan.template??=trip.workspace.items.some(i=>i.id==='lodge')?'algonquin':'custom';trip.workspace.plan.contentDestination??=trip.workspace.plan.destination;}
 if(!s.empty&&!s.demoRemoved&&!isDemoTrip(s)&&!s.archives.some(a=>isDemoTrip(a.workspace))){const {archives:_,...demo}=initialState();s.archives.push({id:demo.plan.id!,archivedAt:new Date().toISOString(),workspace:demo});}
 return s;
}
export function tripCatalog(s:State):Suggestion[] {
 const curated=cityProfile(s.plan.destination,s.plan.city);
 const stored=s.recommendations?.destinationKey===cityKey(s.plan.destination)?s.recommendations.entries:[];
 const places=[...(curated?.places??[]).map(p=>({...p,...stored.find(r=>r.id===p.id)})),...stored.filter(p=>!curated?.places.some(c=>c.id===p.id))];
 return [...(isDemoTrip(s)?catalog:[]),...places.map(p=>({...placeInfo(p),popularityCoverage:p.popularityCoverage,popularitySourceUrl:p.popularitySourceUrl,id:p.id,name:p.name,category:p.category,start:zonedStart(`${s.plan.start}T10:00`,s.plan.timezone),duration:60,travelIn:0,travelOut:0,buffer:0,price:null,reason:p.description,policy:'Check the source for current opening hours, admission costs and reservation requirements. Your time and duration are planning choices; no booking has been made.',location:p.area,tag:'City recommendation',sourceUrl:p.sourceUrl,sourceLabel:p.sourceLabel,tags:p.tags,flexible:true,imageUrl:p.imageUrl,imagePageUrl:p.imagePageUrl,imageCredit:p.imageCredit,imageLicense:p.imageLicense,imageLicenseUrl:p.imageLicenseUrl,latitude:p.latitude,longitude:p.longitude,wikiTitle:p.wikiTitle,wikidataId:p.wikidataId,locationVersion:p.locationVersion,locationSourceUrl:p.locationSourceUrl,locationPrecision:p.locationPrecision,photoStatus:p.photoStatus,placeDetailsVersion:p.placeDetailsVersion}))];
}
export function tripList(s:State){if(s.empty)return [];return [{id:s.plan.id!,plan:s.plan,itemCount:s.items.length,active:true},...(s.archives??[]).map(a=>({id:a.workspace.plan.id!,plan:a.workspace.plan,itemCount:a.workspace.items.length,active:false}))];}
export function planReminders(s:Pick<State,'items'|'reminders'>){
 const tasks=s.items.filter(item=>item.category==='Preparation'&&item.status!=='cancelled');
 const stored=s.reminders.filter(reminder=>!tasks.some(task=>task.id===reminder.itemId)&&!s.items.some(item=>item.id===reminder.itemId&&item.status==='cancelled')).map(reminder=>({...reminder,taskId:undefined as string|undefined}));
 const derived=tasks.map(task=>({id:`task-due-${task.id}`,itemId:task.id,taskId:task.id,title:task.name,due:task.start,consequence:'Preparation task due at this time.',done:!!task.done}));
 return [...stored,...derived].sort((a,b)=>a.due.localeCompare(b.due));
}
export function planAttention(s:Pick<State,'items'|'reminders'|'receipts'|'proposals'>){
 const decisions=s.items.filter(item=>item.status==='draft').length+s.receipts.filter(receipt=>receipt.status==='review').length+s.proposals.filter(proposal=>proposal.status!=='executed').length;
 return {decisions,nextDue:planReminders(s).find(reminder=>!reminder.done)};
}
function snapshotTrip(s:State){const {archives:_,deletedTrips:__,...workspace}=structuredClone(s);return {id:workspace.plan.id!,archivedAt:new Date().toISOString(),workspace};}
function selectTrip(s:State,id:string):State {
 if(id===s.plan.id)return s;
 const index=s.archives?.findIndex(a=>a.workspace.plan.id===id)??-1;
 if(index<0)throw Error('This plan is no longer available. Refresh and try again.');
 const others=[...(s.archives??[])];const selected=others.splice(index,1)[0];others.unshift(snapshotTrip(s));
 return {...structuredClone(selected.workspace),empty:false,demoRemoved:s.demoRemoved,deletedTrips:s.deletedTrips,archives:others,version:s.version};
}
/** Route late provider events to the trip that owns the booking. */
export function financialTrip(s:State,itemId:string,tripId?:string){const trips=[s,...(s.archives??[]).map(a=>a.workspace),...(s.deletedTrips??[]).map(a=>a.workspace)];return trips.find(t=>(!tripId||t.plan.id===tripId)&&t.items.some(i=>i.id===itemId));}
export function blankReceipt(s:State,payer='sam'):Receipt {
 return {...fixtureReceipt(),merchant:'',date:s.plan.start,rows:[{id:crypto.randomUUID(),name:'',amount:0,claims:[payer]}],tax:0,tip:0,discount:0,total:0,payer,source:'Manual receipt entry'};
}
export function personalMoney(s:State,id:string){let cost=0,contribution=0,expectedRefund=0,confirmedRefund=0,settlement=0;for(const e of s.events){if(e.status==='confirmed'){if(e.kind==='settlement'){if(e.from===id)settlement+=e.amount;if(e.to===id)settlement-=e.amount;}else{cost+=e.shares[id]??0;contribution+=e.contributions[id]??0;if(e.kind==='refund')confirmedRefund-=e.contributions[id]??0;}}else if(e.kind==='refund')expectedRefund-=e.shares[id]??0;}
 let planned=0,merchantDue=0;for(const item of s.items){if(item.status==='cancelled')continue;const recorded=s.events.filter(e=>e.itemId===item.id&&e.status==='confirmed'&&['expense','adjustment'].includes(e.kind)).reduce((n,e)=>n+(e.shares[id]??0),0);const remaining=Math.max(0,(item.shares[id]??0)-recorded);planned+=remaining;if(item.status==='awaiting-payment'&&hasMerchantCheckout(item)&&!item.paid.includes(id))merchantDue+=remaining;}
 return {cost,contribution,planned,projected:cost+planned,afterExpected:cost+planned-expectedRefund,friendBalance:contribution+settlement-cost,expectedRefund,confirmedRefund,merchantDue,financing:s.preferences[id]?.financing??0};}
export function suggestionFit(s:State,c:Suggestion,ids:string[]){const start=new Date(c.start).getTime()-c.travelIn*60000,end=new Date(c.start).getTime()+(c.duration+c.travelOut+c.buffer)*60000;const date=c.start.slice(0,10);const conflict=s.items.find(i=>i.status!=='cancelled'&&i.category!=='Preparation'&&i.start.slice(0,10)===date&&start<new Date(i.start).getTime()+i.duration*60000&&end>new Date(i.start).getTime());const shares=c.price===null?{}:allocate(c.price,ids,'equal',{},planMembers(s).map(p=>p.id));const over=ids.filter(id=>s.preferences[id]&&personalMoney(s,id).projected+(shares[id]??0)>s.preferences[id].budget);const unknownBudgets=ids.filter(id=>!s.preferences[id]);return {unknownBudgets,conflict:conflict?.name??null,over,shares,known:c.price!==null,minutes:c.duration+c.travelIn+c.travelOut+c.buffer};}
export function affectedItems(s:State,id:string){const found=new Set([id]);let changed=true;while(changed){changed=false;for(const i of s.items)if(i.depends.some(d=>found.has(d))&&!found.has(i.id)){found.add(i.id);changed=true;}}return s.items.filter(i=>found.has(i.id));}
export function recoveryFigures(option:'replace'|'cancel'){return option==='replace'?{groupFinal:102000,eachFinal:25500,groupRefund:36000,eachRefund:9000,cash:10500,extra:1500}:{groupFinal:49000,eachFinal:12250,groupRefund:47000,eachRefund:11750,cash:0,extra:-11750};}
export type Action={type:string;actor:string;[key:string]:unknown};
export function planMembers(s:State):readonly PlanPerson[]{return s.people??members.map(m=>({...m,role:'editor' as const}));}
function validActor(s:State,a:Action){if(!planMembers(s).some(p=>p.id===a.actor&&p.role!=='viewer'&&p.role!=='legacy'))throw Error('Choose a member with editing access.');}
function audit(s:State,text:string,detail?:string){s.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),text,detail});}
export function applyAction(input:State,a:Action):State {
 const s=normalizeWorkspace(input);validActor(s,a);if(a.tripId&&a.type!=='select_trip'&&a.tripId!==s.plan.id)throw Error('The active plan changed. Refresh and try again.');const actor=a.actor;const now=new Date().toISOString();
 const memberIds=planMembers(s).map(p=>p.id),allocate=(total:number,ids:string[],mode:Allocation='equal',values:Shares={})=>allocateForMembers(total,ids,mode,values,memberIds);
 const audit=(target:State,text:string,detail?:string)=>{const person=planMembers(s).find(p=>p.id===actor)!;target.audit.unshift({id:crypto.randomUUID(),at:now,text:text.replaceAll(actor,person.name),detail,actorId:person.id,actorName:person.name});};
 const findItem=()=>{const i=s.items.find(i=>i.id===a.itemId);if(!i)throw Error('Plan item not found.');return i;};
 switch(a.type){
 case 'select_trip':return selectTrip(s,String(a.tripId));
 case 'delete_trip':{
  if(a.confirmed!==true)throw Error('Confirm which plan you want to delete.');
  const target=String(a.deleteTripId),workspace=target===s.plan.id&&!s.empty?s:s.archives?.find(t=>t.workspace.plan.id===target)?.workspace;
  if(!workspace)throw Error('This plan is no longer available. Refresh and try again.');
  const {archives:ignoredArchives,deletedTrips:ignoredDeleted,...copy}=structuredClone(workspace as State);
  const deletedTrips=[{id:target,deletedAt:now,expiresAt:new Date(Date.now()+30*86400000).toISOString(),workspace:copy},...(s.deletedTrips??[])];
  const others=(s.archives??[]).filter(t=>t.workspace.plan.id!==target),demoRemoved=s.demoRemoved||workspace.plan.template==='algonquin';
  if(target!==s.plan.id)return {...s,demoRemoved,deletedTrips,archives:others};
  if(others.length){const next=others.shift()!;return {...structuredClone(next.workspace),empty:false,demoRemoved,deletedTrips,archives:others,version:s.version};}
  const blank=initialState();blank.empty=true;blank.demoRemoved=true;blank.plan={...blank.plan,name:'Your plans',destination:'',contentDestination:'',template:'custom',goal:''};
  blank.items=[];blank.events=[];blank.reminders=[];blank.archives=[];blank.deletedTrips=deletedTrips;blank.people=s.people;blank.preferences=structuredClone(s.preferences);blank.version=s.version;return blank;
 }
 case 'restore_trip':{
  const deleted=s.deletedTrips?.find(t=>t.id===a.deletedTripId);if(!deleted)throw Error('This deleted plan has expired or was already restored.');
  const restored=structuredClone(deleted.workspace),originalId=restored.plan.id;restored.plan.id=crypto.randomUUID();restored.scheduleUndo=[];
  // A fresh plan identity prevents old invitation links becoming active again.
  const next={...restored,empty:false,demoRemoved:s.demoRemoved,deletedTrips:s.deletedTrips!.filter(t=>t.id!==deleted.id),archives:[...(s.empty?[]:[snapshotTrip(s)]),...(s.archives??[])],version:s.version};
  audit(next,'Plan restored from Recently deleted. Create a new sharing link to invite friends.',`Previous plan ID: ${originalId}`);return normalizeWorkspace(next);
 }

 case 'create_trip':{
  const p=a.plan as Partial<State['plan']>;
  const kind=parsePlanKind(p?.kind);
  if(!p||typeof p.destination!=='string'||!p.destination.trim()||p.destination.length>120)throw Error('Enter a city and country.');
  if(typeof p.name!=='string'||!p.name.trim())throw Error('Enter a plan name.');
  if(typeof p.start!=='string'||typeof p.end!=='string'||!validPlanDates(kind,p.start,p.end))throw Error(kind==='day-out'?'A day out must start and end on the same date.':'Choose valid plan dates within one year of each other.');
  const timezone=validTimezone(p.timezone??destinationSettings(p.destination,p.city).timezone??'UTC'),currency=validCurrency(p.currency??'CAD');
  const next=initialState(),budget=cents(p.budget??30000);
  next.plan={id:crypto.randomUUID(),kind,city:validCitySelection(p.city,p.destination),name:p.name.trim(),destination:p.destination.trim(),goal:p.goal??defaultPlanGoal(kind,p.destination.trim()),start:p.start,end:p.end,timezone,currency,budget,contentDestination:p.destination.trim(),template:'custom'};
  next.items=[];next.events=[];next.reminders=[];next.people=s.people?structuredClone(s.people):undefined;next.preferences=structuredClone(s.preferences);for(const id of memberIds)next.preferences[id]={...next.preferences[id],budget,cash:budget,reserve:0,financing:0};
  next.archives=[...(s.empty?[]:[snapshotTrip(s)]),...(s.archives??[])];next.deletedTrips=s.deletedTrips;next.demoRemoved=s.demoRemoved;next.version=s.version;audit(next,`${planType(next.plan).label} created.`);return normalizeWorkspace(next);
 }
 case 'reset':{
  const demo=isDemoTrip(s)?s.plan.id:s.archives?.find(a=>isDemoTrip(a.workspace))?.workspace.plan.id;
  const selected=demo?selectTrip(s,demo):s;
  const fresh=initialState();const backup=snapshotTrip(selected);backup.workspace.plan.name+=' (before reset)';
  return {...fresh,deletedTrips:s.deletedTrips,demoRemoved:false,archives:s.empty?[]:[backup,...(selected.archives??[])],version:s.version};
 }
 case 'plan':{
  const p=a.plan as Partial<State['plan']>;
  if(!p||typeof p.name!=='string'||!p.name.trim()||typeof p.destination!=='string'||!p.destination.trim())throw Error('Name and destination are required.');
  const currency=validCurrency(p.currency??planCurrency(s.plan)),timezone=validTimezone(p.timezone??s.plan.timezone);
  const differentCity=destinationKey(p.destination)!==destinationKey(s.plan.destination);
  if(!differentCity&&currency!==planCurrency(s.plan)&&currencyLocked(s))throw Error('This plan already has costs or financial records. Create a new plan to use another currency.');
  const next={...s.plan,currency,timezone,kind:parsePlanKind(p.kind??s.plan.kind),city:validCitySelection(p.city,p.destination),name:p.name.trim(),destination:p.destination.trim(),goal:typeof p.goal==='string'?p.goal:s.plan.goal,budget:cents(p.budget??s.plan.budget)};
  if(!validPlanDates(next.kind,s.plan.start,s.plan.end))throw Error('A day out must use a single date. Create a new day out instead.');
  if(destinationKey(next.destination)!==destinationKey(s.plan.destination))moveDestination(s,next,s.plan.destination);
  else {if(currency!==planCurrency(s.plan))for(const id of memberIds)s.preferences[id]={...s.preferences[id],cash:next.budget,reserve:0,financing:0};if(next.budget!==s.plan.budget)for(const id of memberIds)s.preferences[id].budget=next.budget;s.plan=next;audit(s,'Plan details updated.');}
  break;
 }
 case 'add_item':{
  const title=typeof a.name==='string'?a.name.trim():'';
  const category=String(a.category),ids=a.participants as string[],start=String(a.start);
  if(!title||title.length>180)throw Error('Enter an activity name under 180 characters.');
  if(!['Activity','Meal','Accommodation','Transport','Preparation','Free stop','Practical stop'].includes(category))throw Error('Choose a valid category.');
  allocate(0,ids);
  if(isNaN(new Date(start).getTime())||(category!=='Preparation'&&start.slice(0,10)<s.plan.start)||start.slice(0,10)>s.plan.end)throw Error(category==='Preparation'?'Choose a task due time on or before the plan ends.':'Choose a time within the plan dates.');
  const duration=Number(a.duration);if(!Number.isInteger(duration)||duration<1||duration>1440)throw Error('Choose a duration from 1 to 1440 minutes.');
  const price=a.price===null?null:cents(a.price);
  const i=item(crypto.randomUUID(),title,category,start,duration,price,String(a.policy??'Terms not supplied. Verify before booking.'));
  i.location=String(a.location??s.plan.destination).trim()||s.plan.destination;i.participants=ids;i.shares=price===null?{}:allocate(price,ids);i.approvals=[];i.status='draft';i.booking='unconfirmed';i.paid=[];i.source='Manually entered plan item';
  if(category==='Preparation'){const owner=String(a.taskOwner??actor);if(!memberIds.includes(owner as MemberId))throw Error('Choose a valid task owner.');i.taskOwner=owner;if(price===0){i.status='scheduled';i.approvals=[...ids];}}s.items.push(i);audit(s,`${category==='Preparation'&&price===0?'Task':'Draft'} added: ${i.name}.`);break;
 }
 case 'preferences':{const p=a.preferences as Preferences;if(!p)throw Error('Preferences are required.');if(p.paypalMe&&!/^https:\/\/(www\.)?paypal\.me\/[a-zA-Z0-9._-]+\/?$/.test(p.paypalMe))throw Error('Enter your approved paypal.me profile URL.');s.preferences[actor]={budget:cents(p.budget),cash:cents(p.cash),reserve:cents(p.reserve),pace:p.pace,interests:p.interests,paypalMe:p.paypalMe,financing:cents(p.financing)};audit(s,`${actor} updated private demo preferences.`);break;}
 case 'suggestion_feedback':{const id=String(a.suggestionId);if(!tripCatalog(s).some(c=>c.id===id))throw Error('Suggestion not found.');if(a.feedback==='save')s.saved=[...new Set([...s.saved,id])];if(a.feedback==='unsave')s.saved=s.saved.filter(saved=>saved!==id);if(a.feedback==='dismiss')s.dismissed=[...new Set([...s.dismissed,id])];if(a.feedback==='vote'){s.votes[id]??={};s.votes[id][actor]=String(a.vote);}break;}
 case 'mute':{const category=String(a.category);s.muted=s.muted.includes(category)?s.muted.filter(c=>c!==category):[...s.muted,category];break;}
 case 'add_suggestion':{const c=tripCatalog(s).find(c=>c.id===a.suggestionId);if(!c)throw Error('Suggestion not found.');const ids=a.participants as string[];allocate(0,ids);const candidate=c.flexible?{...c,start:String(a.start??c.start),duration:Number(a.duration??c.duration)}:c;const fit=suggestionFit(s,candidate,ids);if(fit.conflict)throw Error(`Overlaps ${fit.conflict}. Choose a different time before adding.`);const chosenStart=c.flexible?String(a.start??c.start):c.start;const chosenDuration=c.flexible?Number(a.duration??c.duration):c.duration;if(isNaN(new Date(chosenStart).getTime())||chosenStart.slice(0,10)<s.plan.start||chosenStart.slice(0,10)>s.plan.end||!Number.isInteger(chosenDuration)||chosenDuration<1||chosenDuration>1440)throw Error('Choose a valid time and duration within this plan.');const i=item(crypto.randomUUID(),c.name,c.category,chosenStart,chosenDuration,c.price,c.policy);i.participants=ids;i.shares=fit.shares;i.approvals=[];i.status='draft';i.booking='unconfirmed';i.paid=[];i.source=!c.flexible&&isDemoTrip(s)?'Seeded demo catalog · estimated or unknown data':c.sourceLabel??'City recommendation · details require confirmation';Object.assign(i,{...placeInfo(c),sourceUrl:c.sourceUrl,imageUrl:c.imageUrl,imagePageUrl:c.imagePageUrl,imageCredit:c.imageCredit,imageLicense:c.imageLicense,imageLicenseUrl:c.imageLicenseUrl,latitude:c.latitude,longitude:c.longitude,wikiTitle:c.wikiTitle,wikidataId:c.wikidataId,locationVersion:c.locationVersion,locationSourceUrl:c.locationSourceUrl,locationPrecision:c.locationPrecision,photoStatus:c.photoStatus,placeDetailsVersion:c.placeDetailsVersion});i.location=c.location;i.policy=c.sourceUrl?`${c.policy} Source: ${c.sourceUrl}`:c.policy;i.expires=isDemoTrip(s)&&c.price? '2026-10-15T23:59:00-04:00':null;if(c.category==='Preparation')i.taskOwner=actor;s.items.push(i);audit(s,`Draft added: ${c.name}.`,JSON.stringify(i));break;}
 case 'item_location':{const i=findItem();if(typeof a.latitude!=='number'||typeof a.longitude!=='number'||!Number.isFinite(a.latitude)||!Number.isFinite(a.longitude)||Math.abs(a.latitude)>90||Math.abs(a.longitude)>180)throw Error('Choose a valid point on the map.');i.latitude=a.latitude;i.longitude=a.longitude;audit(s,`Map location saved: ${i.name}.`);break;}
 case 'move_item':{
  const changes=previewMove(s,String(a.itemId),String(a.day),a.beforeId==null?null:String(a.beforeId),String(a.travelMode??'walk') as TravelMode);
  if(changes.length)s.scheduleUndo=[...(s.scheduleUndo??[]).filter(move=>move.actor!==actor),captureMove(s.items,changes,actor,s.plan.scheduleTravelMode)].slice(-20);
  for(const change of changes){const i=s.items.find(item=>item.id===change.itemId)!;audit(s,`Schedule revision ${i.revision} archived: ${i.name}.`,JSON.stringify(i));i.start=change.start;i.revision++;i.required=[...new Set([...(i.required??[]),...i.participants])];i.approvals=[];i.status='draft';}
  if(changes.length)s.plan.scheduleTravelMode=a.travelMode==='drive'?'drive':'walk';
  if(changes.length)audit(s,`${changes.length} ${changes.length===1?'activity':'activities'} rescheduled with ${a.travelMode==='drive'?'driving':'walking'} estimates. Group review required.`);
  break;
 }
 case 'undo_move':{
  const move=s.scheduleUndo?.find(move=>move.id===a.undoId&&move.actor===actor);if(!move)throw Error('This move is no longer available to undo.');
  if(!undoMoveAvailable(s,move))throw Error('An affected activity was edited, approved or paid since this move. Review its latest details instead.');
  for(const change of move.changes){const item=s.items.find(i=>i.id===change.itemId)!;audit(s,`Schedule revision ${item.revision} archived: ${item.name}.`,JSON.stringify(item));item.start=change.before;item.revision++;item.approvals=[];item.status='draft';}
  s.plan.scheduleTravelMode=move.previousMode;s.scheduleUndo=s.scheduleUndo!.filter(saved=>saved.id!==move.id);audit(s,'Last move undone. Restored times need group review.');break;
 }
 case 'item_edit':{const i=findItem();const ids=a.participants as string[];allocate(0,ids);const price=a.price===null?null:cents(a.price);const allocation=a.allocation as Allocation;if(!['equal','fixed','percent','weight'].includes(allocation))throw Error('Invalid allocation rule.');const shares=price===null?{}:allocate(price,ids,allocation,a.values as Shares);audit(s,`Revision ${i.revision} archived: ${i.name}.`,JSON.stringify(i));i.required=[...new Set([...i.participants,...ids])];i.participants=ids;i.price=price;i.shares=shares;i.allocation=allocation;i.values=(a.values as Shares)??{};i.revision++;i.approvals=[];i.status='draft';let placeChanged=false;if(a.name!==undefined){if(typeof a.name!=='string'||!a.name.trim())throw Error('Enter an item name.');placeChanged=a.name.trim()!==i.name;i.name=a.name.trim();}if(a.location!==undefined){const location=String(a.location).trim()||s.plan.destination;placeChanged=placeChanged||location!==i.location;i.location=location;}if(placeChanged){for(const field of ['address','officialWebsite','openingHours','indoor','detailsSourceUrl','detailsCheckedAt','sourceUrl','latitude','longitude','wikiTitle','wikidataId','locationVersion','placeDetailsVersion','locationSourceUrl','locationPrecision','imageUrl','imagePageUrl','imageCredit','imageLicense','imageLicenseUrl','photoStatus'] as const)delete i[field];i.placeLookupManual=true;}if(a.start){if(isNaN(new Date(String(a.start)).getTime()))throw Error('Invalid date.');i.start=String(a.start);}audit(s,`New approval required for ${i.name}, revision ${i.revision}.`);break;}
 case 'approve_item':{const i=findItem();if(a.revision!==i.revision)throw Error('This revision changed. Review the new amounts.');if(!(i.required??i.participants).includes(actor))throw Error('This revision does not affect you.');if(i.price!==null&&i.expires&&new Date(i.expires)<new Date())throw Error('This quote expired. Request a new revision.');i.approvals=[...new Set([...i.approvals,actor])];if((i.required??i.participants).every(id=>i.approvals.includes(id))){const original=s.events.filter(e=>e.itemId===i.id&&e.status==='confirmed'&&e.kind!=='settlement').reduce((o,e)=>{for(const id of memberIds)o[id]=(o[id]??0)+(e.shares[id]??0);return o;},{} as Shares);if(Object.keys(original).length){if(Object.values(i.shares).reduce((a,b)=>a+b,0)!==Object.values(original).reduce((a,b)=>a+b,0))throw Error('A price change to a paid booking needs a merchant adjustment. Use recovery instead.');s.events.push({id:`allocation-${i.id}-${i.revision}`,itemId:i.id,kind:'adjustment',label:`Approved share revision · ${i.name}`,shares:Object.fromEntries(memberIds.map(id=>[id,(i.shares[id]??0)-(original[id]??0)])),contributions:{},amount:0,status:'confirmed',evidence:`All affected members approved revision ${i.revision}.`,mode:'manual',created:now});i.status='scheduled';}else i.status=i.price&&hasMerchantCheckout(i)? 'awaiting-payment':'scheduled';}audit(s,`${actor} approved ${i.name} · revision ${i.revision}.`);break;}
 case 'task_edit':{
  const i=findItem();if(i.category!=='Preparation'||i.price!==0||s.events.some(event=>event.itemId===i.id))throw Error('Only a preparation task with no payments can use task editing.');
  const title=typeof a.name==='string'?a.name.trim():'',owner=String(a.taskOwner),start=String(a.start);
  if(!title||title.length>180)throw Error('Enter a task name under 180 characters.');
  if(!memberIds.includes(owner as MemberId))throw Error('Choose a valid task owner.');
  if(isNaN(new Date(start).getTime())||start.slice(0,10)>s.plan.end)throw Error('Choose a task due time on or before the plan ends.');
  audit(s,`Task revision ${i.revision} archived: ${i.name}.`,JSON.stringify(i));
  i.name=title;i.start=start;i.taskOwner=owner;i.participants=[owner];i.shares=allocate(0,[owner]);i.values={};i.allocation='equal';i.required=undefined;i.approvals=[owner];i.revision++;i.status='scheduled';
  audit(s,`Task updated: ${i.name}.`);break;
 }
 case 'task':{const i=findItem();if(i.category!=='Preparation')throw Error('This is not a task.');i.done=Boolean(a.done);audit(s,`${i.name}: ${i.done?'complete':'reopened'}.`);break;}
 case 'reminder':{const r=s.reminders.find(r=>r.id===a.reminderId);if(!r)throw Error('Reminder not found.');r.done=Boolean(a.done);break;}
 case 'receipt':{const r=a.receipt as Receipt;if(!r||typeof r.merchant!=='string'||!r.merchant.trim()||!Array.isArray(r.rows)||r.rows.length>100)throw Error('Enter a valid receipt with up to 100 lines.');if(!memberIds.includes(r.payer as MemberId))throw Error('Choose the person who paid.');const old=s.receipts.find(x=>x.id===r.id);if(!old&&s.receipts.some(x=>x.merchant===r.merchant&&x.date===r.date&&x.total===r.total&&JSON.stringify(x.rows.map(y=>[y.name,y.amount]))===JSON.stringify(r.rows.map(y=>[y.name,y.amount]))))throw Error('This receipt is already in the plan. Review or correct the existing record.');const shares=splitReceipt(r,memberIds,planCurrency(s.plan));if(old?.status==='approved'&&old.total!==r.total)throw Error('A recorded receipt adjustment must retain the total. Add a separate expense for additional spending.');const next:Receipt={...r,id:old?.id??crypto.randomUUID(),shares,revision:(old?.revision??0)+1,approvals:[],status:'review',previousShares:old?.status==='approved'?old.shares:old?.previousShares};if(old){audit(s,`Receipt revision archived: ${old.merchant}.`,JSON.stringify(old));s.receipts=s.receipts.filter(x=>x.id!==old.id);}s.receipts.push(next);audit(s,`${next.merchant} receipt ready for share approval.`);break;}
 case 'approve_receipt':{const r=s.receipts.find(r=>r.id===a.receiptId);if(!r||a.revision!==r.revision)throw Error('Review the latest receipt revision.');const required=memberIds.filter(id=>r.shares[id]>0||((r.previousShares?.[id]??0)>0));if(!required.includes(actor as MemberId))throw Error('You have no share in this receipt.');if(r.status==='approved')break;r.approvals=[...new Set([...r.approvals,actor])];if(required.every(id=>r.approvals.includes(id))){if(!r.paymentConfirmed)throw Error('Confirm the payer’s reported payment before recording an expense.');const itemId=r.linkedItemId??r.id;if(r.previousShares){s.events.push({id:`receipt-adjust-${r.id}-${r.revision}`,itemId,kind:'adjustment',label:`Receipt correction · ${r.merchant}`,shares:Object.fromEntries(memberIds.map(id=>[id,r.shares[id]-(r.previousShares![id]??0)])),contributions:{},amount:0,status:'confirmed',evidence:`Reviewed receipt revision ${r.revision}. Existing payment preserved.`,mode:'manual',created:now});}else {if(s.events.some(e=>e.itemId===itemId&&e.kind==='expense'&&e.status==='confirmed'))throw Error('This purchase is already recorded. Edit its allocation instead of adding another expense.');s.events.push({id:`receipt-${r.id}`,itemId,kind:'expense',label:r.merchant,shares:r.shares,contributions:{[r.payer]:r.total},amount:r.total,status:'confirmed',evidence:`Receipt ${r.id} · payer reported payment; reviewed by participating demo members.`,mode:'manual',created:now});}r.status='approved';}audit(s,`${actor} approved ${r.merchant} receipt revision ${r.revision}.`);break;}
 case 'settlement_report':{const to=String(a.to),amount=cents(a.amount);if(!memberIds.includes(to as MemberId)||to===actor||amount===0)throw Error('Choose another member and an amount.');s.events.push({id:crypto.randomUUID(),itemId:'settlement',kind:'settlement',label:`${actor} to ${to}`,shares:{},contributions:{},amount,status:'reported',evidence:'Sender reported a friend repayment. Recipient confirmation required.',mode:'manual',created:now,from:actor,to});break;}
 case 'settlement_confirm':{const e=s.events.find(e=>e.id===a.eventId&&e.kind==='settlement');if(!e||e.to!==actor)throw Error('Only the recipient can confirm this repayment.');e.status='confirmed';e.evidence='Recipient manually confirmed repayment. No API verification.';audit(s,`${actor} confirmed a friend repayment of ${dollars(e.amount,planCurrency(s.plan))}.`);break;}
 case 'disrupt':{if(!isDemoTrip(s))throw Error('This cancellation scenario belongs to the Algonquin demo trip.');if(s.disruption)break;s.disruption=true;const h=s.items.find(i=>i.id==='hike')!;h.status='cancelled';audit(s,'Demo supplier cancelled the guided hike.','Simulated supplier event. Shuttle and return transfer depend on the hike; lodge remains useful.');break;}
 case 'propose_recovery':{if(!isDemoTrip(s))throw Error('The fixed recovery quotes belong to the Algonquin demo trip.');if(!s.disruption||s.recoveryDone)throw Error('Trigger a cancellation before comparing recovery.');if(s.proposals.some(p=>p.kind==='recovery'&&p.status==='executed'))throw Error('Recovery already executed.');const option=a.option as 'replace'|'cancel';if(!['replace','cancel'].includes(option))throw Error('Select a recovery option.');const f=recoveryFigures(option);s.proposals=s.proposals.filter(p=>p.kind!=='recovery');s.proposals.push({id:crypto.randomUUID(),kind:'recovery',title:option==='replace'?'Replace hike; keep lodge & shuttle':'Cancel all three bookings',revision:1,required:[...memberIds],approved:[],status:'pending',option,snapshot:JSON.stringify(f)});audit(s,'Recovery option proposed. No charges or refunds authorized yet.');break;}
 case 'departure':{const departing=String(a.departing);if(!memberIds.includes(departing as MemberId))throw Error('Choose a departing member.');const i=s.items.find(i=>i.id==='lodge');if(!i)throw Error('No demo lodge booking is available for this trip.');const ids=i.participants.filter(id=>id!==departing);if(!ids.length)throw Error('At least one member must remain.');s.proposals.push({id:crypto.randomUUID(),kind:'departure',title:`${departing} cannot attend · lodge share review`,revision:i.revision+1,required:[...new Set([...i.participants,...ids])],approved:[],status:'pending',departing,itemId:i.id,newShares:allocate(i.price!,ids),snapshot:JSON.stringify({oldShares:i.shares,participants:ids,nonRefundable:i.policy})});audit(s,'Member departure proposed. Original obligations remain in force.');break;}
 case 'approve_proposal':{const p=s.proposals.find(p=>p.id===a.proposalId);if(!p||a.revision!==p.revision||!p.required.includes(actor))throw Error('Review a current proposal affecting you.');if(p.status==='executed')break;p.approved=[...new Set([...p.approved,actor])];if(p.required.every(id=>p.approved.includes(id)))p.status='approved';audit(s,`${actor} approved ${p.title}.`);break;}
 case 'execute_proposal':{const p=s.proposals.find(p=>p.id===a.proposalId);if(!p||p.status!=='approved')throw Error('All affected members must approve the current proposal.');if(p.kind==='departure'){const i=s.items.find(i=>i.id===p.itemId)!;const snap=JSON.parse(p.snapshot);if(JSON.stringify(i.shares)!==JSON.stringify(snap.oldShares))throw Error('The booking shares changed. Create a new proposal.');s.events.push({id:`depart-${p.id}`,itemId:i.id,kind:'adjustment',label:'Approved lodge share adjustment',shares:Object.fromEntries(memberIds.map(id=>[id,(p.newShares![id]??0)-(i.shares[id]??0)])),contributions:{},amount:0,status:'confirmed',evidence:'All affected demo members approved; original contributions preserved.',mode:'manual',created:now});i.participants=snap.participants;i.shares=p.newShares!;i.approvals=[...i.participants];i.revision++;}else{if(s.items.find(i=>i.id==='hike')?.price!==36000||s.items.find(i=>i.id==='shuttle')?.price!==12000||s.items.find(i=>i.id==='lodge')?.price!==48000)throw Error('Demo recovery quotes no longer match. Reset or review merchant terms.');const refund=(id:string,amount:number)=>{if(s.events.some(e=>e.id===`recovery-refund-${id}`))return;s.events.push({id:`recovery-refund-${id}`,itemId:id,kind:'refund',label:`${id==='hike'?'Hike':'Shuttle'} refund`,shares:Object.fromEntries(Object.entries(allocate(amount,[...memberIds])).map(([k,v])=>[k,-v])),contributions:Object.fromEntries(Object.entries(allocate(amount,[...memberIds])).map(([k,v])=>[k,-v])),amount:-amount,status:'pending',evidence:'Simulated refund request against seeded historical payments. Bank availability unverified.',mode:'simulation',created:now});};refund('hike',36000);if(p.option==='replace'){const i=item('replacement','Forest canyon experience','Activity','2026-10-17T09:00:00-04:00',360,42000,'Demo current quote: CAD 420. Uses existing shuttle. New buyer checkout required.');i.status='awaiting-payment';i.booking='unconfirmed';i.paid=[];i.source='Fictional demo merchant · fixed quote';s.items.push(i);s.items.find(i=>i.id==='shuttle')!.depends=['replacement'];}else{refund('shuttle',11000);for(const i of s.items.filter(i=>['lodge','shuttle','return'].includes(i.id)))i.status='cancelled';}s.reminders=s.reminders.filter(r=>!['hike','shuttle'].includes(r.itemId));s.recoveryDone=true;}p.status='executed';audit(s,`Approved action executed: ${p.title}.`);break;}
 case 'demo_refund':{const e=s.events.find(e=>e.id===a.eventId&&e.kind==='refund');if(!e||e.mode!=='simulation')throw Error('Only simulated refunds can be changed here.');e.status='confirmed';e.evidence='Simulated refund completed; this is not a provider-confirmed PayPal refund.';audit(s,'Simulated refund marked complete.');break;}
 case 'demo_payment':{const i=findItem();requireMerchantCheckout(i);if(i.status!=='awaiting-payment'||!i.approvals.includes(actor))throw Error('Review and approve the share before payment.');if(i.paid.includes(actor))break;i.paid.push(actor);s.events.push({id:`demo-capture-${i.id}-${actor}-${i.revision}`,itemId:i.id,kind:'expense',label:`${i.name} · ${actor} share`,shares:{[actor]:i.shares[actor]},contributions:{[actor]:i.shares[actor]},amount:i.shares[actor],status:'confirmed',evidence:'Explicitly simulated checkout. No PayPal funds moved.',mode:'simulation',created:now});if(i.participants.every(id=>i.paid.includes(id))){i.status='scheduled';i.booking='demo-confirmed';}audit(s,`${actor} completed simulated checkout for ${i.name}.`);break;}
 case 'booking_fail':{const i=findItem();i.booking='failed';audit(s,`Booking failed for ${i.name}. Captured payments remain visible; merchant review required.`);break;}
 case 'confirm_booking':{const i=findItem();requireMerchantCheckout(i);if(!i.participants.every(id=>i.paid.includes(id)))throw Error('All merchant shares must be paid before confirming.');i.booking='demo-confirmed';audit(s,`Demo supplier confirmed ${i.name}.`);break;}
 default:throw Error('Unknown action.');
 }
 return s;
}
