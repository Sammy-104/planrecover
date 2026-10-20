import assert from 'node:assert/strict';
import {initialState,applyAction,tripCatalog} from '../lib/model.ts';
import {starterPlaces} from '../lib/plan-starter.ts';
import {previewSuggestionBatch} from '../lib/suggestion-batch.ts';
import {cityKey} from '../lib/cities.ts';

const state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{kind:'trip',name:'All chosen places',destination:'Toronto, Canada',start:'2027-05-01',end:'2027-05-03',timezone:'America/Toronto',currency:'CAD',budget:30000}});
const sourceIds=Array.from({length:12},(_,index)=>'starter-selected-'+index);
state.recommendations={destinationKey:cityKey(state.plan.destination),resolvedCity:'Toronto',fetchedAt:'2027-05-01T08:00:00Z',source:'open-places',entries:sourceIds.map((id,index)=>({id,name:'Selected venue '+index,category:'Activity',area:'Toronto',description:'Synthetic mapped place for selection persistence.',sourceUrl:'https://example.test/'+id,sourceLabel:'Synthetic fixture',latitude:43.65,longitude:-79.38,tags:['Culture']}))};
const available=starterPlaces(state,['Culture']);
assert.ok(sourceIds.every(id=>available.some(place=>place.id===id)));
const catalog=tripCatalog(state),selected=sourceIds.map(id=>catalog.find(place=>place.id===id));
assert.ok(selected.every(Boolean));
const before=structuredClone(state),review=previewSuggestionBatch(state,'sam',selected,'2027-05-01');
assert.equal(review.entries.length,12,'Review every chosen place, rather than taking the legacy pace cap.');
assert.deepEqual(review.entries.map(entry=>entry.suggestion.id),sourceIds);
assert.deepEqual(state,before,'Review must not mutate the saved itinerary.');

const failed=previewSuggestionBatch(state,'sam',selected,'2027-05-01',{'starter-selected-4':'2027-05-01Tnot-a-time'});
assert.equal(failed.blocked,true,'One unresolved time blocks the full batch instead of permitting a partial add.');
assert.equal(failed.entries.length,12);
assert.match(failed.entries.find(entry=>entry.suggestion.id==='starter-selected-4').error,/valid date and time/);
assert.deepEqual(state,before);

const restored=previewSuggestionBatch(state,'sam',selected,'2027-05-01',{'starter-selected-4':'2027-05-02T10:00'});
assert.equal(restored.entries.length,12);
assert.equal(restored.entries.find(entry=>entry.suggestion.id==='starter-selected-4').action.start.slice(0,10),'2027-05-02');
console.log('First-itinerary review retains every selected venue, blocks partial adds, preserves state and supports moving a visit to another plan day.');
