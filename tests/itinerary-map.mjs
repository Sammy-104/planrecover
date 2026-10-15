import assert from 'node:assert/strict';
import {initialState,applyAction} from '../lib/model.ts';
import {itineraryStops,validPoint} from '../lib/itinerary-map.ts';
import {existingActivityLocations} from '../lib/activity-locations.ts';
let state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Toronto map',destination:'Toronto, Ontario, Canada',start:'2027-04-04',end:'2027-04-06',budget:30000}});
state=applyAction(state,{type:'add_item',actor:'sam',name:'Second-day stop',category:'Activity',location:'Toronto',start:'2027-04-05T10:00:00-04:00',duration:60,price:null,participants:['sam']});
state=applyAction(state,{type:'add_item',actor:'sam',name:'First-day stop',category:'Activity',location:'Toronto',start:'2027-04-04T10:00:00-04:00',duration:60,price:null,participants:['sam']});
const id=state.items[0].id,before=structuredClone(state.items[0]);
state=applyAction(state,{type:'item_location',actor:'sam',itemId:id,latitude:43.6677,longitude:-79.3948});
assert.equal(state.items[0].revision,before.revision);assert.deepEqual(state.items[0].shares,before.shares);assert.deepEqual(state.events,[]);
assert.deepEqual(itineraryStops(state).map(stop=>stop.item.name),['First-day stop','Second-day stop']);
assert.deepEqual(itineraryStops(state).map(stop=>stop.number),[1,2]);
const chronology={...state,items:[
 {...state.items[0],id:'later',name:'Later',start:'2027-04-05T00:30:00-04:00'},
 {...state.items[0],id:'middle',name:'Middle',start:'2027-04-05T00:15:00-04:00'},
 {...state.items[0],id:'earliest',name:'Earliest',start:'2027-04-05T03:45:00Z'},
 {...state.items[0],id:'task',category:'Preparation',start:'2027-04-03T10:00:00Z'},
 {...state.items[0],id:'cancelled',status:'cancelled',start:'2027-04-02T10:00:00Z'}
]};
assert.deepEqual(itineraryStops(chronology).map(({item,number})=>[item.id,number]),[['earliest',1],['middle',2],['later',3]],'Numbers follow scheduled instants across days and time offsets, not creation order or coordinates');
chronology.items[0].start='2027-04-04T08:00:00-04:00';
assert.deepEqual(itineraryStops(chronology).map(({item,number})=>[item.id,number]),[['later',1],['earliest',2],['middle',3]],'Changing a scheduled time renumbers the entire plan');
assert.deepEqual(chronology.items.map(item=>item.id),['later','middle','earliest','task','cancelled'],'Numbering does not mutate saved item order');
assert.ok(validPoint(state.items[0]));assert.ok(!validPoint(state.items[1]));
assert.throws(()=>applyAction(state,{type:'item_location',actor:'sam',itemId:id,latitude:91,longitude:0}));
assert.throws(()=>applyAction(state,{type:'item_location',actor:'sam',itemId:id,latitude:NaN,longitude:0}));
state.items[1].policy='Source: https://en.wikipedia.org/?curid=10';
const resolved=await existingActivityLocations(state,async url=>{assert.equal(new URL(url).searchParams.get('pageids'),'10');return Response.json({query:{pages:[{pageid:10,title:'Royal Ontario Museum',coordinates:[{lat:43.6677,lon:-79.3948}]}]}});});
assert.equal(resolved.resolved.get(state.items[1].id).latitude,43.6677);assert.equal(resolved.resolved.get(state.items[1].id).longitude,-79.3948);
assert.equal(resolved.unavailable,false);
state.items[0].status='cancelled';assert.equal(itineraryStops(state).length,1);
const manual={...state,items:[{...state.items[1],name:'Visit Royal Ontario Museum',policy:'Manual stop',source:'Manual'}]};
const automatic=await existingActivityLocations(manual,async url=>{const params=new URL(url).searchParams;assert.equal(params.get('generator'),'search');assert.match(params.get('gsrsearch'),/"royal ontario museum" nearcoord:50km,43\./);return Response.json({query:{pages:[{title:'Royal Ontario Museum',coordinates:[{lat:43.6677,lon:-79.3948}]}]}});});
assert.equal(automatic.resolved.get(manual.items[0].id).latitude,43.6677,'A named activity resolves automatically');assert.equal(automatic.resolved.get(manual.items[0].id).longitude,-79.3948);
const wrongCity=await existingActivityLocations(manual,async()=>Response.json({query:{pages:[{title:'Royal Ontario Museum',coordinates:[{lat:51.5,lon:-0.1}]}]}}));
assert.equal(wrongCity.resolved.size,0,'Never accept a matching name in the wrong city');
const ambiguous=await existingActivityLocations(manual,async()=>Response.json({query:{pages:[{title:'Royal Ontario Museum (east)',coordinates:[{lat:43.6677,lon:-79.3948}]},{title:'Royal Ontario Museum (west)',coordinates:[{lat:43.66,lon:-79.39}]}]}}));
assert.equal(ambiguous.resolved.size,0,'Ambiguous venues must not get an arbitrary pin');
const customLocation=await existingActivityLocations({...manual,items:[{...manual.items[0],name:'Lunch',location:'Royal Ontario Museum'}]},async()=>Response.json({query:{pages:[{title:'Royal Ontario Museum',coordinates:[{lat:43.6677,lon:-79.3948}]}]}}));
assert.equal(customLocation.resolved.size,1,'A venue in the location field resolves automatically');
const unknown=await existingActivityLocations({...manual,items:[{...manual.items[0],name:'Dinner',location:'Toronto, Ontario, Canada'}]},async()=>{throw Error('Generic activities must not be guessed');});
assert.equal(unknown.resolved.size,0);
assert.equal(unknown.unavailable,false);
const fictional=await existingActivityLocations(initialState(),async()=>{throw Error('Fictional stops must not be geocoded');});assert.equal(fictional.resolved.size,0);assert.equal(fictional.unavailable,false);
const unavailable=await existingActivityLocations(manual,async()=>{throw Error('offline');});assert.equal(unavailable.unavailable,true);
const subset=await existingActivityLocations(manual,async()=>{throw Error('Only requested stops should be looked up');},[]);assert.equal(subset.unavailable,false);
console.log('Full-itinerary ordering, saved coordinates, automatic venue lookup, exact locations, city boundaries, ambiguous venues, fictional stops and service failures passed.');

const stale={...manual,items:[{...manual.items[0],latitude:43.65,longitude:-79.38,policy:'Source: https://en.wikipedia.org/?curid=10',wikiTitle:'Royal Ontario Museum'}]};
const corrected=await existingActivityLocations(stale,async()=>Response.json({query:{pages:[{pageid:10,title:'Royal Ontario Museum',coordinates:[{lat:43.6677,lon:-79.3948}]}]}}));
assert.equal(corrected.resolved.get(stale.items[0].id).latitude,43.6677,'An existing finite but inaccurate pin is rechecked');
const edited=applyAction(stale,{type:'item_edit',actor:'sam',itemId:stale.items[0].id,name:'CN Tower',participants:['sam'],price:null,allocation:'equal',location:'Toronto'});
assert.equal(edited.items[0].latitude,undefined);assert.equal(edited.items[0].wikiTitle,undefined);assert.equal(edited.items[0].placeLookupManual,true);
const refreshed=await existingActivityLocations(edited,async url=>{const p=new URL(url).searchParams;assert.equal(p.get('pageids'),null,'Editing a venue must not reuse the old source page');assert.match(p.get('gsrsearch'),/"cn tower"/);return Response.json({query:{pages:[{pageid:11,title:'CN Tower',coordinates:[{lat:43.6426,lon:-79.3871}]}]}});});
assert.equal(refreshed.resolved.get(edited.items[0].id).latitude,43.6426);
console.log('Existing pin correction and clearing stale locations/photos when a venue changes passed.');
