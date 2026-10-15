import assert from 'node:assert/strict';
import {initialState,applyAction,normalizeWorkspace,personalMoney,planReminders,planAttention,tripCatalog} from '../lib/model.ts';
import {hasMerchantCheckout,requireMerchantCheckout} from '../lib/merchant-scope.ts';
const run=(state,type,action={},actor='sam')=>applyAction(state,{type,actor,...action});

// Real venue planning cannot become a fictional merchant invoice or payment.
let state=run(initialState(),'create_trip',{plan:{kind:'event',name:'Dinner together',destination:'Lisbon, Portugal',start:'2027-04-04',end:'2027-04-04',budget:30000}});
state=run(state,'add_item',{name:'Outside restaurant',category:'Meal',start:'2027-04-04T18:00:00+01:00',duration:90,price:8000,participants:['sam','alex']});
const venueId=state.items[0].id;
assert.equal(hasMerchantCheckout(state.items[0]),false);assert.throws(()=>requireMerchantCheckout(state.items[0]));
state=run(state,'approve_item',{itemId:venueId,revision:1});assert.equal(state.items[0].status,'draft');
state=run(state,'approve_item',{itemId:venueId,revision:1},'alex');
assert.equal(state.items[0].status,'scheduled');assert.equal(state.items[0].booking,'unconfirmed');assert.deepEqual(state.events,[]);
assert.equal(personalMoney(state,'sam').projected,4000);assert.equal(personalMoney(state,'sam').cost,0);assert.equal(personalMoney(state,'sam').merchantDue,0);
assert.equal(personalMoney(state,'maya').projected,0);
assert.throws(()=>run(state,'demo_payment',{itemId:venueId}));assert.throws(()=>run(state,'confirm_booking',{itemId:venueId}));
const legacy=structuredClone(state);legacy.items[0].status='awaiting-payment';
const repaired=normalizeWorkspace(legacy);assert.equal(repaired.items[0].status,'scheduled');assert.deepEqual(repaired.events,legacy.events);assert.deepEqual(repaired.items[0].shares,legacy.items[0].shares);

// A real discovery place stays outside booking even after a planned cost is entered.
state.recommendations={destinationKey:'lisbon, portugal',resolvedCity:'Lisbon',fetchedAt:new Date().toISOString(),source:'open-places',entries:[{id:'osm-node-1',name:'Mapped Museum',category:'Activity',description:'A sourced museum',area:'Lisbon',sourceLabel:'OpenStreetMap',sourceUrl:'https://www.openstreetmap.org/node/1',latitude:38.72,longitude:-9.13}]};
const suggestion=tripCatalog(state).find(place=>place.id==='osm-node-1');assert.ok(suggestion);assert.equal(suggestion.price,null);
state=run(state,'add_suggestion',{suggestionId:suggestion.id,start:'2027-04-04T10:00:00+01:00',duration:60,participants:['sam']});
assert.equal(hasMerchantCheckout(state.items[1]),false);assert.deepEqual(state.events,[]);

// Deadline edits replace the same reminder; completion and refresh stay consistent.
state=run(state,'add_item',{name:'Confirm venue access',category:'Preparation',start:'2027-04-02T10:00:00+01:00',duration:20,price:0,participants:['maya'],taskOwner:'maya'});
const taskId=state.items.at(-1).id,reminder=planReminders(state).find(reminder=>reminder.itemId===taskId);
assert.ok(reminder);assert.equal(reminder.due,'2027-04-02T10:00:00+01:00');
state=run(state,'task_edit',{itemId:taskId,name:'Confirm guest list',taskOwner:'alex',start:'2027-04-03T11:00:00+01:00'});
const updated=planReminders(state).filter(reminder=>reminder.itemId===taskId);assert.equal(updated.length,1);assert.equal(updated[0].id,reminder.id);assert.equal(updated[0].due,'2027-04-03T11:00:00+01:00');assert.equal(updated[0].title,'Confirm guest list');assert.equal(state.items.at(-1).taskOwner,'alex');assert.deepEqual(state.events,[]);
assert.equal(planAttention(state).nextDue.id,reminder.id);
const refreshed=normalizeWorkspace(JSON.parse(JSON.stringify(state)));assert.deepEqual(planReminders(refreshed),planReminders(state));
state=run(state,'task',{itemId:taskId,done:true});assert.equal(planReminders(state).find(reminder=>reminder.itemId===taskId).done,true);assert.equal(planAttention(state).nextDue,undefined);
state.items.at(-1).status='cancelled';assert.equal(planReminders(state).length,0);
assert.throws(()=>run(state,'task_edit',{itemId:venueId,name:'Wrong type',taskOwner:'sam',start:'2027-04-03T10:00:00+01:00'}));

// The original fictional merchant still supports the complete payment demo.
let demo=initialState();assert.ok(hasMerchantCheckout(demo.items[0]));assert.equal(planReminders(demo).length,2);
demo=run(demo,'add_suggestion',{suggestionId:'picnic',participants:['sam','alex']});const fixture=demo.items.at(-1);
assert.ok(hasMerchantCheckout(fixture));demo=run(demo,'approve_item',{itemId:fixture.id,revision:1});demo=run(demo,'approve_item',{itemId:fixture.id,revision:1},'alex');assert.equal(demo.items.at(-1).status,'awaiting-payment');
demo=run(demo,'demo_payment',{itemId:fixture.id});assert.ok(demo.events.some(event=>event.itemId===fixture.id&&event.mode==='simulation'));
console.log('Blueprint alignment: external estimates versus merchant invoices, subset approval and costs, source discovery, preserved legacy data, task reminders/rescheduling/refresh, and retained fictional merchant checkout passed.');
