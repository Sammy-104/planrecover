import assert from 'node:assert/strict';
import {initialState,applyAction,tripCatalog} from '../lib/model.ts';
import {parseWorkspaceMutation} from '../lib/action-contracts.ts';
import {frontendActionSchema} from '../lib/frontend-actions.ts';
import {enrichCatalog} from '../lib/frontend-catalog.ts';
import {applyBookingImport} from '../lib/booking-import.ts';
import {dayCity} from '../lib/city-stays.ts';
import {planCurrency} from '../lib/money.ts';
import {cityKey} from '../lib/cities.ts';
import {paymentOverview,checkoutDisplayAmount,checkoutDisplayPayer} from '../lib/payment-overview.ts';

let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const base=initialState(),actor='sam';
const create=()=>applyAction(base,{type:'create_trip',actor,plan:{name:'Frontend integration',destination:'Toronto, Canada',kind:'trip',start:'2027-05-01',end:'2027-05-06',timezone:'America/Toronto',currency:'CAD',budget:100000}});
const city=(id,name,latitude,longitude)=>({id,name,country:'Canada',region:'Ontario',label:name+', Canada',latitude,longitude});
const toronto=city('toronto','Toronto',43.65,-79.38),ottawa=city('ottawa','Ottawa',45.42,-75.69);
const stays=[{id:'stay-toronto',city:toronto,start:'2027-05-01',end:'2027-05-03',timezone:'America/Toronto',kind:'stay',note:''},{id:'stay-ottawa',city:ottawa,start:'2027-05-03',end:'2027-05-06',timezone:'America/Toronto',kind:'stay',note:''}];
check('strict frontend schemas reject internal provider checks and unknown fields',()=>{
 assert.equal(frontendActionSchema.safeParse({type:'apply_draft',draftId:'preview-1',entries:[{suggestionId:'a',start:'2027-05-02T10:00:00Z',duration:60}],_draftEntries:[]}).success,false);
 assert.equal(frontendActionSchema.safeParse({type:'planning_style',style:{pace:'relaxed',interests:[]},providerConfirmed:true}).success,false);
 assert.equal(frontendActionSchema.safeParse({type:'road_trip',settings:{enabled:true}}).success,false);
});
check('new metadata action parser requires exact bounded revision and numbers',()=>{
 assert.throws(()=>parseWorkspaceMutation({version:0,action:{type:'accommodation_dates',actor,itemId:'hotel',checkout:'2027-05-02',reviewed:true}}));
 assert.throws(()=>parseWorkspaceMutation({version:0,action:{type:'planning_costs',actor,costs:{currency:'CAD',entries:[{id:'a',label:'Meal estimate',amount:1.5,participants:['sam']}]}}}));
});
check('city stays persist without altering existing financial facts',()=>{
 const state=create(),events=structuredClone(state.events),next=applyAction(state,{type:'city_stays',actor,stays});
 assert.equal(dayCity(next,'2027-05-04').city.name,'Ottawa');assert.deepEqual(next.events,events);
 assert.throws(()=>applyAction(next,{type:'city_stays',actor,stays:[stays[0],{...stays[1],start:'2027-05-02'}]}));
});
check('multi-city catalog retains source identity, zone and route stops',()=>{
 const state=create();state.plan.stays=stays;state.cityRecommendations={'ottawa canada':{destinationKey:'ottawa canada',resolvedCity:'Ottawa',fetchedAt:'2026-10-18T00:00:00Z',source:'open-places',entries:[]}};
 const entry={id:'osm-node-99001',name:'Ottawa test venue',category:'Activity',area:'Ottawa',description:'Synthetic source venue',sourceUrl:'https://www.openstreetmap.org/node/99001',sourceLabel:'OpenStreetMap',tags:[],latitude:45.42,longitude:-75.69};
 // Use the exact canonical key rather than assuming its punctuation folding.
 state.cityRecommendations={};importKey(state,'Ottawa, Canada',entry);
 state.routeCatalog=[{...entry,id:'route-venue--transfer',routeLegId:'stay-toronto--stay-ottawa',timezone:'America/Toronto'}];
 const catalog=enrichCatalog(state,[]),venue=catalog.find(p=>p.id===entry.id),route=catalog.find(p=>p.id==='route-venue--transfer');
 assert.equal(venue?.stayId,'stay-ottawa');assert.equal(venue?.timezone,'America/Toronto');assert.equal(route?.routeLegId,'stay-toronto--stay-ottawa');
 assert.equal(tripCatalog(state).find(p=>p.id===entry.id)?.stayId,'stay-ottawa','The canonical catalog exposes the imported city source.');
});
check('merchant expiry cannot be cleared by planning metadata',()=>{
 const before=JSON.stringify(base);
 assert.throws(()=>applyAction(base,{type:'item_deadlines',actor,itemId:'lodge',expires:null,deadline:null}),/merchant|paid|confirmed|saved change/i);
 assert.equal(JSON.stringify(base),before);
});
const terms={refund:'unknown',fee:0,percent:0,cutoff:null,source:'Synthetic reviewed confirmation',checkedAt:''};
const booking={importId:'import-test-1001',reviewed:true,name:'Reviewed hotel',category:'Accommodation',start:'2027-05-01T16:00:00-04:00',duration:60,endDate:'2027-05-03',currency:'CAD',price:20000,participants:['sam','alex'],reference:'TEST-REFERENCE',location:'Toronto',terms,confirmedBooking:true};
check('booking import creates draft metadata and no payment/provider confirmation',()=>{
 const state=create(),next=applyBookingImport(state,actor,booking),item=next.items.at(-1);
 assert.equal(item.status,'draft');assert.equal(item.booking,'unconfirmed');assert.equal(item.externalBooking,'TEST-REFERENCE');assert.equal(item.bookingEndDate,'2027-05-03');assert.equal(next.events.length,state.events.length);assert.deepEqual(item.paid,[]);
 assert.throws(()=>applyBookingImport(next,actor,booking),/already|new import|review/i);
});
check('booking import cannot rewrite a recorded fixed allocation',()=>{
 const state=create(),item=applyAction(state,{type:'add_item',actor,name:'Fixed shared hotel',category:'Accommodation',start:'2027-05-01T16:00:00-04:00',duration:60,price:20000,participants:['sam','alex'],location:'Toronto'}).items.at(-1);
 item.allocation='fixed';item.values={sam:18000,alex:2000};item.shares={sam:18000,alex:2000};state.items=[item];state.events=[{id:'paid-existing',itemId:item.id,kind:'expense',label:'Original fixed allocation',amount:20000,shares:{sam:18000,alex:2000},contributions:{sam:20000},status:'confirmed',evidence:'Synthetic original payment',mode:'manual',created:'2026-10-18T00:00:00Z'}];
 const before=JSON.stringify(state);assert.throws(()=>applyBookingImport(state,actor,{...booking,itemId:item.id}),/recorded spending|confirmation evidence/i);assert.equal(JSON.stringify(state),before);
});
check('booked or funded accommodation checkout is protected',()=>{
 assert.throws(()=>applyAction(base,{type:'accommodation_dates',actor,itemId:'lodge',revision:base.items.find(i=>i.id==='lodge').revision,checkout:'2026-10-19',reviewed:true}),/booked|funded|saved change/i);
});
check('unpaid accommodation date changes need exact revision and fresh approval',()=>{
 let state=create();state=applyAction(state,{type:'add_item',actor,name:'Hotel draft',category:'Accommodation',start:'2027-05-01T16:00:00-04:00',duration:60,price:20000,participants:['sam','alex'],location:'Toronto'});const item=state.items.at(-1),old=item.revision;
 const next=applyAction(state,{type:'accommodation_dates',actor,itemId:item.id,revision:old,checkout:'2027-05-03',reviewed:true});assert.equal(next.items.at(-1).revision,old+1);assert.deepEqual(next.items.at(-1).approvals,[]);assert.equal(next.items.at(-1).bookingEndDate,'2027-05-03');assert.throws(()=>applyAction(next,{type:'accommodation_dates',actor,itemId:item.id,revision:old,checkout:'2027-05-04',reviewed:true}),/latest/i);
});
check('new plan does not inherit prior discussion or route metadata',()=>{
 const state=create();state.activityDecisions={old:{comments:[],votes:{sam:'interested'},mustVisit:['sam']}};state.appliedDrafts=['old-draft'];state.bookingImports=['old-booking'];state.routeCatalog=[];state.cityRecommendations={old:{destinationKey:'old',resolvedCity:'Old',fetchedAt:'2026-10-18T00:00:00Z',source:'open-places',entries:[]}};
 const next=applyAction(state,{type:'create_trip',actor,plan:{...state.plan,name:'Another plan'}});assert.equal(next.activityDecisions,undefined);assert.equal(next.routeCatalog,undefined);assert.equal(next.cityRecommendations,undefined);assert.ok(!next.appliedDrafts?.includes('old-draft'));assert.ok(!next.bookingImports?.includes('old-booking'));assert.equal(planCurrency(next.plan),'CAD');
});
check('whole-group checkout display shows exact full amount only to designated payer',()=>{
 const state=initialState(),item=structuredClone(state.items.find(i=>i.id==='hike'));item.status='awaiting-payment';item.paid=[];item.merchantFunding={mode:'whole-group',payerId:'sam'};state.items=[item];
 assert.equal(checkoutDisplayPayer(item,'sam'),true);assert.equal(checkoutDisplayAmount(item,'sam'),item.price);assert.equal(checkoutDisplayPayer(item,'alex'),false);assert.equal(checkoutDisplayAmount(item,'alex'),0);
 assert.equal(paymentOverview(state,'sam',[]).total,item.price);assert.equal(paymentOverview(state,'alex',[]).directDue.length,0);assert.deepEqual(item.shares,state.items[0].shares);
 delete item.merchantFunding;assert.equal(checkoutDisplayAmount(item,'sam'),item.shares.sam);assert.equal(paymentOverview(state,'alex',[]).total,item.shares.alex);
});
function importKey(state,destination,entry){const key=cityKey(destination);state.cityRecommendations[key]={destinationKey:key,resolvedCity:destination,fetchedAt:'2026-10-18T00:00:00Z',source:'open-places',entries:[entry]};}
console.log(`${count} frontend planning integration checks passed.`);
