import assert from 'node:assert/strict';
import {initialState,tripCatalog,applyAction} from '../lib/model.ts';
import {previewSuggestionBatch} from '../lib/suggestion-batch.ts';
import {cityKey} from '../lib/cities.ts';
const state=initialState();state.items=[];state.events=[];state.reminders=[];
const fixed=tripCatalog(state).filter(c=>!c.flexible&&['dinner','walk'].includes(c.id));
assert.equal(fixed.length,2);{const result=previewSuggestionBatch(state,'sam',fixed,'2026-10-17');assert.equal(result.blocked,false,JSON.stringify(result.entries.map(e=>e.error)));assert.equal(result.entries.length,2);}
assert.throws(()=>previewSuggestionBatch(state,'sam',[],'2026-10-17'),/Select/);
const candidate=tripCatalog(state)[0];assert.throws(()=>previewSuggestionBatch(state,'sam',[candidate,candidate],'2026-10-17'),/once/);
const before=structuredClone(state);previewSuggestionBatch(state,'sam',[candidate],'2026-10-17');assert.deepEqual(state,before);
state.recommendations={destinationKey:cityKey(state.plan.destination),entries:[{id:'keyboard-visit',name:'Keyboard visit',category:'Activity',description:'Synthetic source',area:'Town',tags:[],latitude:45.8,longitude:-78.4}]};
const flexible=tripCatalog(state).find(c=>c.id==='keyboard-visit');
assert.equal(previewSuggestionBatch(state,'sam',[flexible],'2026-10-17',{'keyboard-visit':'2026-10-17Tbad'}).blocked,true);
const valid=previewSuggestionBatch(state,'sam',[flexible],'2026-10-17',{'keyboard-visit':'2026-10-17T14:30'});assert.equal(valid.blocked,false);assert.match(valid.entries[0].action.start,/T14:30/);
const added=applyAction(state,{...valid.entries[0].action,actor:'sam'});assert.equal(previewSuggestionBatch(added,'sam',[flexible],'2026-10-17').blocked,true);
console.log('Selected suggestion review: fixed multi-day visits, invalid typed time, duplicate prevention and unchanged source state passed.');
