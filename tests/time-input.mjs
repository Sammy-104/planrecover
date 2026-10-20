import assert from 'node:assert/strict';
import {parseTimeInput,validLocalDateTime} from '../lib/time-input.ts';
for(const [input,result] of [['9:30 AM','09:30'],['2:30pm','14:30'],['12 a.m.','00:00'],['12pm','12:00'],['14:30','14:30'],['1430','14:30'],['9','09:00'],['','']])assert.equal(parseTimeInput(input),result,input);
for(const input of ['24:00','12:60','0am','13pm','tomorrow','2:3','9:30xyz'])assert.equal(parseTimeInput(input),null,input);
assert.equal(validLocalDateTime('2026-10-20T14:30'),true);
assert.equal(validLocalDateTime('2026-02-30T14:30'),false);
assert.equal(validLocalDateTime('2026-10-20T25:00'),false);
assert.equal(validLocalDateTime(''),true);assert.equal(validLocalDateTime('',true),false);
console.log('Typed 12/24-hour times, midnight/noon, invalid ranges and local calendar dates passed.');
