import {planMembers,tripCatalog,type State,type Item} from './model.ts';
import {tripDays,localDateTime,validTripDates,zonedStart} from './trip-time.ts';
import {dayCity,itemDay} from './city-stays.ts';
import {cityKey} from './cities.ts';
import {planCurrency} from './money.ts';
import {costOutlook} from './traveller-planning.ts';
import {placeInfo} from './place-info.ts';
export function accommodationNights(state:State){
 const nights=tripDays(state.plan.start,state.plan.end).slice(0,-1),people=planMembers(state).filter(p=>!['viewer','legacy'].includes(p.role)),hotels=state.items.filter(i=>i.category==='Accommodation'&&i.status!=='cancelled'&&!i.financialOnly);
 return nights.map(day=>{const city=dayCity(state,day);return {day,city:city.city?.name??city.destination,people:people.map(person=>{const stays=hotels.filter(h=>h.participants.includes(person.id)&&!!h.bookingEndDate&&itemDay(h,state.plan.timezone)<=day&&day<h.bookingEndDate),wrongCity=stays.some(h=>h.stayId?state.plan.stays?.find(s=>s.id===h.stayId)?.city.id!==city.city?.id:!!state.plan.stays?.length&&cityKey(city.destination)!==cityKey(state.plan.destination));return {person,stays,status:stays.length>1?'overlap':!stays.length?'missing':wrongCity?'wrong-city':stays[0].booking==='confirmed'||stays[0].booking==='demo-confirmed'?'confirmed':'planned'};})};});
}
export type SearchHit={id:string;tripId:string;tripName:string;kind:'trip'|'activity'|'booking'|'receipt'|'document';title:string;detail:string;day?:string};
const fold=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function searchWorkspace(state:State,query:string,kind='all'){
 const words=fold(query.trim()).split(/\s+/).filter(Boolean);if(query.length>120)throw Error('Use a shorter search.');if(query.trim().length<2)return [];
 const matches=(text:string)=>words.every(w=>fold(text).includes(w)),result:SearchHit[]=[];
 for(const trip of [...(!state.empty?[state]:[]),...(state.archives??[]).map(a=>a.workspace)]){
  const base={tripId:trip.plan.id!,tripName:trip.plan.name};if(matches([trip.plan.name,trip.plan.destination,...trip.plan.stays?.map(s=>s.city.label)??[]].join(' ')))result.push({...base,id:trip.plan.id!,kind:'trip',title:trip.plan.name,detail:trip.plan.destination+' · '+trip.plan.start+' – '+trip.plan.end});
  for(const i of trip.items.filter(i=>!i.financialOnly)){const booking=!!i.externalBooking;if(matches([i.name,i.category,i.address??i.location,i.externalBooking??''].join(' ')))result.push({...base,id:i.id,kind:booking?'booking':'activity',title:i.name,detail:(i.externalBooking?'Reference '+i.externalBooking+' · ':'')+(i.status==='cancelled'?'Cancelled · ':'')+(i.address??i.location),day:itemDay(i,trip.plan.timezone)});}
  for(const r of trip.receipts)if(matches(r.merchant+' '+r.date))result.push({...base,id:r.id,kind:'receipt',title:r.merchant||'Receipt',detail:r.date+' · '+r.status,day:r.date});
 }
 return result.filter(r=>kind==='all'||r.kind===kind||kind==='activity'&&r.kind==='booking').slice(0,100);
}
export type TripScenario={id:string;name:string;start:string;end:string;travelMode:'walk'|'drive';omitted:string[];prices:{itemId:string;price:number|null;label?:string;placeId?:string}[];extras:{label:string;price:number|null}[];currency:string;source:string;createdBy:string};
export function scenarioSource(state:State){return JSON.stringify([state.plan.start,state.plan.end,state.plan.stays,state.plan.currency,state.items.map(i=>[i.id,i.revision,i.start,i.duration,i.price,i.status]),state.events.map(e=>[e.id,e.status,e.amount]),state.plan.planningCosts]);}
export function validateScenario(input:TripScenario,state:State,actor:string):TripScenario{
 const amount=(n:number|null)=>{if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>1e12))throw Error('Use a valid price or leave it unknown.');return n;};
 if(!input||typeof input.id!=='string'||!input.id||input.id.length>100||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||input.currency!==planCurrency(state.plan)||!validTripDates(input.start,input.end)||!['walk','drive'].includes(input.travelMode))throw Error('Choose a scenario name, dates, travel mode and current plan currency.');
 if(!Array.isArray(input.omitted)||input.omitted.length>500||new Set(input.omitted).size!==input.omitted.length||input.omitted.some(id=>!state.items.some(i=>i.id===id))||!Array.isArray(input.prices)||input.prices.length>100||new Set(input.prices.map(p=>p.itemId)).size!==input.prices.length||input.prices.some(p=>!state.items.some(i=>i.id===p.itemId))||!Array.isArray(input.extras)||input.extras.length>20)throw Error('Choose scenario items from this plan.');
 const catalog=tripCatalog(state),prices=input.prices.map(p=>{const place=p.placeId?catalog.find(c=>c.id===p.placeId):undefined;if(p.placeId&&(!place||place.category!=='Accommodation'||state.items.find(i=>i.id===p.itemId)?.category!=='Accommodation'||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude)))throw Error('Choose an alternative hotel from this plan’s mapped places.');return {itemId:p.itemId,price:amount(p.price),label:place?.name??String(p.label??'').trim().slice(0,120),...(place?{placeId:place.id}:{})};}),extras=input.extras.map(e=>{if(typeof e.label!=='string'||!e.label.trim()||e.label.length>120)throw Error('Name each extra scenario cost.');return {label:e.label.trim(),price:amount(e.price)};});
 return {id:input.id,name:input.name.trim(),start:input.start,end:input.end,travelMode:input.travelMode,omitted:input.omitted,prices,extras,currency:input.currency,source:scenarioSource(state),createdBy:actor};
}
export function scenarioOverview(state:State,scenario:TripScenario){
 const days=tripDays(scenario.start,scenario.end),offset=(Date.parse(scenario.start+'T12:00:00Z')-Date.parse(state.plan.start+'T12:00:00Z'))/86400000,items:Item[]=[],retained:string[]=[],warnings:string[]=[],catalog=tripCatalog(state);let total=costOutlook(state,'guest').total,unknown=0;
 for(const item of state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation')){
  const originalDay=itemDay(item,state.plan.timezone),d=new Date(Date.parse(originalDay+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10),omit=scenario.omitted.includes(item.id)||!days.includes(d),protectedCost=!!item.externalBooking||item.booking==='confirmed'||item.booking==='demo-confirmed'||state.events.some(e=>e.itemId===item.id&&e.status==='confirmed'&&e.kind!=='settlement'),override=scenario.prices.find(p=>p.itemId===item.id);
  if(omit){if(protectedCost){retained.push(item.name);if(item.price===null)unknown++;}else if(item.price!==null)total-=item.price;continue;}
  const price=override?override.price:item.price;if(price===null)unknown++;if(override){if(protectedCost){retained.push(item.name);total+=price??0;if(item.price===null)unknown++;}else{total-=item.price??0;total+=price??0;}}
  const alternative=override?.placeId?catalog.find(p=>p.id===override.placeId):undefined,hypothetical={...item};
  if(alternative||override?.label&&override.label!==item.name){
   for(const field of ['address','officialWebsite','openingHours','indoor','stepFree','cuisines','admission','listedPrice','detailsSourceUrl','detailsCheckedAt','sourceUrl','latitude','longitude','wikiTitle','wikidataId','locationVersion','placeDetailsVersion','locationSourceUrl','locationPrecision','imageUrl','imagePageUrl','imageCredit','imageLicense','imageLicenseUrl','commonsFile','photoStatus','ideaId'] as const)delete hypothetical[field];
   hypothetical.location=alternative?.location??override!.label!;hypothetical.source='Hypothetical alternative';hypothetical.policy='Confirm availability, terms and prices with the venue.';hypothetical.placeLookupManual=!alternative;
   if(alternative)Object.assign(hypothetical,{...placeInfo(alternative),ideaId:alternative.id,timezone:alternative.timezone,sourceUrl:alternative.sourceUrl,source:alternative.sourceLabel??'Mapped place',latitude:alternative.latitude,longitude:alternative.longitude,wikiTitle:alternative.wikiTitle,wikidataId:alternative.wikidataId,locationVersion:alternative.locationVersion,locationSourceUrl:alternative.locationSourceUrl,locationPrecision:alternative.locationPrecision,placeDetailsVersion:alternative.placeDetailsVersion,imageUrl:alternative.imageUrl,imagePageUrl:alternative.imagePageUrl,imageCredit:alternative.imageCredit,imageLicense:alternative.imageLicense,imageLicenseUrl:alternative.imageLicenseUrl,commonsFile:alternative.commonsFile,photoStatus:alternative.photoStatus});
  }
  const local=localDateTime(item.start,item.timezone??state.plan.timezone);items.push({...hypothetical,name:alternative?.name||override?.label||item.name,start:zonedStart(d+'T'+local.slice(11),hypothetical.timezone??state.plan.timezone),price});
 }
 for(const e of scenario.extras){if(e.price===null)unknown++;else total+=e.price;}if(!Number.isSafeInteger(total)||total>1e12)throw Error('The scenario estimate is too large.');
 if(retained.length)warnings.push('Existing booked or paid obligations remain in the estimate. Replacement estimates are added to those obligations; no refund or cancellation savings are assumed.');if(scenario.start!==state.plan.start||scenario.end!==state.plan.end)warnings.push('Alternative dates are hypothetical. Hotels, transport and availability need rechecking.');if(state.plan.planningCosts?.currency===scenario.currency)unknown+=state.plan.planningCosts.entries.filter(e=>e.amount===null).length;
 return {items,total,unknown,retained:[...new Set(retained)],warnings,visits:items.filter(i=>!['Accommodation','Transport','Buffer'].includes(i.category)).length,visitMinutes:items.filter(i=>!['Accommodation','Transport','Buffer'].includes(i.category)).reduce((n,i)=>n+i.duration,0),days:days.length,stale:scenario.source!==scenarioSource(state)};
}
