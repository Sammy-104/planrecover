import assert from 'node:assert/strict';
import {localDateTime,zonedStart} from '../lib/trip-time.ts';
const NativeDateTimeFormat=Intl.DateTimeFormat;let created=0;
Intl.DateTimeFormat=class extends NativeDateTimeFormat{constructor(...args){super(...args);created++;}};
try{
 for(let index=0;index<1000;index++)assert.equal(localDateTime('2027-04-04T10:00:00Z','Asia/Kathmandu'),'2027-04-04T15:45');
 assert.equal(created,1,'Repeated planner instants reuse the time-zone formatter.');
 assert.equal(localDateTime('2027-04-04T10:01:00Z','Asia/Kathmandu'),'2027-04-04T15:46');assert.equal(created,1);
 assert.equal(localDateTime('2026-11-01T05:30:00Z','America/New_York'),'2026-11-01T01:30');
 assert.equal(localDateTime('2026-11-01T06:30:00Z','America/New_York'),'2026-11-01T01:30');
 assert.equal(zonedStart('2027-04-04T15:45','Asia/Kathmandu'),'2027-04-04T15:45:00+05:45');
 assert.throws(()=>zonedStart('2027-03-14T02:30','America/New_York'),/not available/);
 assert.throws(()=>localDateTime('not-a-date','America/New_York'),RangeError);
 assert.throws(()=>localDateTime('2027-04-04T10:00:00Z','Invalid/Zone'),RangeError);
 const zones=Intl.supportedValuesOf('timeZone').slice(0,70);for(const zone of zones)localDateTime('2027-04-04T10:00:00Z',zone);
 const after=created;localDateTime('2027-04-04T10:02:00Z','Asia/Kathmandu');assert.equal(created,after+1,'Many zones evict old formatters rather than retaining an unbounded cache.');
}finally{Intl.DateTimeFormat=NativeDateTimeFormat;}
console.log('Repeated local-time formatting reuses bounded formatters while preserving offsets, invalid-input errors and DST checks.');
