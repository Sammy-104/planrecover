import assert from 'node:assert/strict';
import {availabilityInputWindows,parseAvailabilityInputWindows} from '../lib/planning-preferences-input.ts';

const saved=[{start:'2027-03-13T10:00:00-05:00',end:'2027-03-13T12:00:00-05:00',status:'available'}];
let checks=0;
function check(name,run){run();checks++;console.log('PASS '+name);}
check('partial or invalid edits cannot silently reuse the previous saved timestamp',()=>{
 const original=structuredClone(saved);
 for(const start of ['2027-03-13T9:','2027-03-13T','2027-03-13T25:00','']){
  const draft=availabilityInputWindows(saved,'America/Toronto',{0:{start}});
  assert.equal(draft[0].start,start);
  assert.throws(()=>parseAvailabilityInputWindows(draft,'America/Toronto'),/valid date and time/);
 }
 assert.deepEqual(saved,original);
});
check('manually typed AM/PM times become exact zoned instants only at save',()=>{
 const draft=availabilityInputWindows(saved,'America/Toronto',{0:{start:'2027-03-13T9:30 PM',end:'2027-03-13T10:45 PM'}});
 const result=parseAvailabilityInputWindows(draft,'America/Toronto');
 assert.equal(result[0].start,'2027-03-13T21:30:00-05:00');
 assert.equal(result[0].end,'2027-03-13T22:45:00-05:00');
 assert.equal(result[0].status,'available');
 assert.equal(saved[0].start,'2027-03-13T10:00:00-05:00');
});
check('unchanged saved instants survive changing their display timezone',()=>{
 const draft=availabilityInputWindows(saved,'America/Vancouver');
 assert.notEqual(draft[0].start,'2027-03-13T10:00');
 const result=parseAvailabilityInputWindows(draft,'America/Vancouver');
 assert.equal(Date.parse(result[0].start),Date.parse(saved[0].start));
 assert.equal(Date.parse(result[0].end),Date.parse(saved[0].end));
});
check('nonexistent daylight-saving times and invalid timezones are rejected',()=>{
 assert.throws(()=>parseAvailabilityInputWindows([{start:'2027-03-14T2:30 AM',end:'2027-03-14T4:00 AM',status:'available'}],'America/Toronto'),/not available/);
 assert.throws(()=>parseAvailabilityInputWindows([],'Invalid/Zone'),/valid time zone/);
});
check('reversed windows and nonexistent dates cannot be saved',()=>{
 assert.throws(()=>parseAvailabilityInputWindows([{start:'2027-03-13T12:00',end:'2027-03-13T10:00',status:'available'}],'America/Toronto'),/end after/);
 assert.throws(()=>parseAvailabilityInputWindows([{start:'2027-02-30T10:00',end:'2027-03-01T10:00',status:'available'}],'America/Toronto'),/valid date and time/);
});
check('clearing all windows stays explicit and unavailable windows retain status',()=>{
 assert.deepEqual(parseAvailabilityInputWindows([],'America/Toronto'),[]);
 const result=parseAvailabilityInputWindows([{start:'2027-03-13T9AM',end:'2027-03-13T10AM',status:'unavailable'}],'America/Toronto');
 assert.equal(result[0].status,'unavailable');
});
console.log(`${checks} private availability keyboard-input checks passed.`);
