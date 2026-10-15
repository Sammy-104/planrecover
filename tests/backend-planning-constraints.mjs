import assert from 'node:assert/strict';
import {applyAction,initialState} from '../lib/model.ts';
import {initializePeople,addPerson} from '../lib/people.ts';
import {checkPlanningConstraints,defaultPlanningPreferences,parsePlanningPreferenceMutation} from '../lib/planning-constraints.ts';

const alice={id:'person-alice',name:'Alice'},bob={id:'person-bob',name:'Bob'},now=Date.parse('2027-04-04T12:00:00Z');
function state(){const result=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{kind:'day-out',name:'Constraint test',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000}});
 initializePeople(result,alice);addPerson(result,bob,'editor');return result;}
function candidate(overrides={}){return {id:'draft-museum',name:'Museum',category:'Activity',start:'2027-04-04T14:00:00-04:00',duration:60,participants:[alice.id],price:1000,...overrides};}
function prefs(){return {[alice.id]:{...defaultPlanningPreferences('America/Toronto'),availability:[{start:'2027-04-04T08:00:00-04:00',end:'2027-04-04T20:00:00-04:00',status:'available'}]}};}
function evidence(overrides={}){return {itemId:'draft-museum',sourceUrl:'https://supplier.test/hours',checkedAt:new Date(now).toISOString(),openIntervals:[{start:'2027-04-04T10:00:00-04:00',end:'2027-04-04T17:00:00-04:00'}],...overrides};}
const codes=result=>result.issues.map(issue=>issue.code);let checks=0;
function check(name,run){run();checks++;console.log(`PASS ${name}`);}

check('Private preference schema validates availability, zones, strict caller fields and bounded delivery settings',()=>{
 const preferences=defaultPlanningPreferences('America/Toronto');assert.deepEqual(parsePlanningPreferenceMutation({version:0,preferences}).preferences,preferences);
 for(const bad of [{...preferences,timezone:'Not/AZone'},{...preferences,leadMinutes:[60,60]},
  {...preferences,availability:[{start:'2027-04-04T12:00:00Z',end:'2027-04-04T11:00:00Z',status:'available'}]},
  {...preferences,availability:[{start:'2027-04-04T12:00:00',end:'2027-04-04T13:00:00',status:'available'}]},
  {...preferences,bufferMinutes:241},{...preferences,dietaryNeeds:['vegan','vegan']}])assert.throws(()=>parsePlanningPreferenceMutation({version:0,preferences:bad}));
 assert.throws(()=>parsePlanningPreferenceMutation({version:0,preferences,memberId:bob.id}));
});
check('Confirmed positive availability and fresh supplier facts permit a review-only preview without mutation',()=>{
 const input=state(),before=structuredClone(input),result=checkPlanningConstraints(input,[candidate()],prefs(),{now,supplierEvidence:[evidence()]});
 assert.equal(result.hasBlockingIssues,false);assert.equal(result.requiresReview,true);assert.deepEqual(result.issues,[]);assert.deepEqual(input,before);
});
check('Unknown facts and prices remain explicit rather than fabricated',()=>{
 const result=checkPlanningConstraints(state(),[candidate({price:null})],{}, {now});
 assert.ok(codes(result).includes('PREFERENCES_UNKNOWN'));assert.ok(codes(result).includes('PRICE_UNKNOWN'));assert.ok(codes(result).includes('HOURS_UNKNOWN'));
 assert.equal(result.hasBlockingIssues,false);
});
check('Subset participation protects Bob’s independent schedule and detects Alice’s own overlap',()=>{
 const input=state();input.items=[{...candidate({id:'other',participants:[bob.id]}),status:'scheduled',shares:{},paid:[]}];
 assert.ok(!codes(checkPlanningConstraints(input,[candidate()],prefs(),{now})).includes('SCHEDULE_CONFLICT'));
 input.items[0].participants=[alice.id];assert.ok(codes(checkPlanningConstraints(input,[candidate()],prefs(),{now})).includes('SCHEDULE_CONFLICT'));
});
check('Availability rejects unavailable intervals and requires full inclusion in a positive available window',()=>{
 const preferences=prefs();preferences[alice.id].availability.push({start:'2027-04-04T14:30:00-04:00',end:'2027-04-04T15:30:00-04:00',status:'unavailable'});
 assert.ok(codes(checkPlanningConstraints(state(),[candidate()],preferences,{now})).includes('UNAVAILABLE'));
 preferences[alice.id].availability=[{start:'2027-04-04T14:30:00-04:00',end:'2027-04-04T18:00:00-04:00',status:'available'}];
 assert.ok(codes(checkPlanningConstraints(state(),[candidate()],preferences,{now})).includes('UNAVAILABLE'));
});
check('Dietary and accessibility requirements need fresh, matching supplier evidence',()=>{
 const preferences=prefs();preferences[alice.id].dietaryNeeds=['vegan'];preferences[alice.id].accessibilityNeeds=['step-free'];
 const missing=checkPlanningConstraints(state(),[candidate()],preferences,{now,supplierEvidence:[evidence()]});
 assert.ok(codes(missing).includes('DIETARY_UNKNOWN'));assert.ok(codes(missing).includes('ACCESSIBILITY_UNKNOWN'));
 const supplied=evidence({dietary:{vegan:'supported'},accessibility:{'step-free':'unsupported'}});
 const result=checkPlanningConstraints(state(),[candidate()],preferences,{now,supplierEvidence:[supplied]});assert.ok(codes(result).includes('ACCESSIBILITY_UNSUPPORTED'));
 assert.ok(!codes(result).includes('DIETARY_UNKNOWN'));
});
check('Stale, future-dated, expired and untrusted supplier evidence cannot establish opening hours',()=>{
 for(const supplied of [evidence({checkedAt:'2027-04-02T12:00:00Z'}),evidence({checkedAt:'2027-04-04T12:10:00Z'}),evidence({expiresAt:'2027-04-04T11:59:00Z'}),evidence({sourceUrl:'http://supplier.test'}),evidence({openIntervals:[{start:'unknown',end:'unknown'}]})])
  assert.ok(codes(checkPlanningConstraints(state(),[candidate()],prefs(),{now,supplierEvidence:[supplied]})).includes('HOURS_UNKNOWN'));
 const closed=checkPlanningConstraints(state(),[candidate()],prefs(),{now,supplierEvidence:[evidence({openIntervals:[]})]});assert.ok(codes(closed).includes('CLOSED'));
});
check('Known travel plus a member buffer must fit; unknown travel and estimates remain qualified',()=>{
 const input=state();input.items=[{...candidate({id:'previous',start:'2027-04-04T12:45:00-04:00'}),status:'scheduled',shares:{},paid:[]}];
 const options={now,travelEvidence:[{fromId:'previous',toId:'draft-museum',minutes:10,checkedAt:new Date(now).toISOString(),basis:'provider'}]};
 assert.ok(codes(checkPlanningConstraints(input,[candidate()],prefs(),options)).includes('TRAVEL_CONFLICT'));
 assert.ok(codes(checkPlanningConstraints(input,[candidate()],prefs(),{now})).includes('TRAVEL_UNKNOWN'));
 options.travelEvidence[0].basis='estimate';assert.ok(codes(checkPlanningConstraints(input,[candidate()],prefs(),options)).includes('TRAVEL_ESTIMATE'));
});
check('Draft items constrain one another and required buffer is enforced without a travel estimate',()=>{
 const result=checkPlanningConstraints(state(),[candidate(),candidate({id:'next',name:'Lunch',start:'2027-04-04T15:05:00-04:00'})],prefs(),{now});
 assert.ok(codes(result).includes('BUFFER_CONFLICT'));assert.ok(codes(result).includes('TRAVEL_UNKNOWN'));
 const overlap=checkPlanningConstraints(state(),[candidate(),candidate({id:'next',start:'2027-04-04T14:30:00-04:00'})],prefs(),{now});assert.ok(codes(overlap).includes('SCHEDULE_CONFLICT'));
});
check('Cash reserve and cumulative budget exclude expected refund cash and other members’ hidden preferences',()=>{
 const input=state();input.preferences[alice.id]={...input.preferences[alice.id],budget:1200,cash:1000,reserve:400};
 input.events=[{id:'expected-refund',itemId:'old',kind:'refund',status:'pending',shares:{[alice.id]:-10000},contributions:{[alice.id]:-10000},amount:-10000,mode:'sandbox'}];
 const result=checkPlanningConstraints(input,[candidate(),candidate({id:'later',start:'2027-04-04T17:00:00-04:00',price:500})],prefs(),{now});
 assert.ok(codes(result).includes('CASH_EXCEEDED'));assert.ok(codes(result).includes('BUDGET_EXCEEDED'));
 delete input.preferences[bob.id];const other=checkPlanningConstraints(input,[candidate({participants:[bob.id]})],prefs(),{now});assert.ok(codes(other).includes('FINANCIAL_PREFERENCES_UNKNOWN'));
});
check('Invalid participants, duplicate IDs and times outside local plan dates cannot pass',()=>{
 for(const item of [candidate({participants:['stranger']}),candidate({participants:[alice.id,alice.id]}),candidate({duration:NaN}),candidate({price:1.5}),candidate({start:'2027-04-04T14:00:00'})])
  assert.ok(codes(checkPlanningConstraints(state(),[item],prefs(),{now})).includes('INVALID_ITEM'));
 assert.ok(codes(checkPlanningConstraints(state(),[candidate({start:'2027-04-05T01:00:00Z'})],prefs(),{now})).includes('HOURS_UNKNOWN'));
 assert.ok(codes(checkPlanningConstraints(state(),[candidate({start:'2027-04-05T00:00:00-04:00'})],prefs(),{now})).includes('OUTSIDE_PLAN'));
});
console.log(`Planning constraints: ${checks} checks passed. No provider calls or financial effects.`);
