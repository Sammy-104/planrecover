import assert from 'node:assert/strict';
import {controlledEmailReview,controlledEmailAttemptMessage} from '../lib/controlled-reminder-email-review.ts';
const now=Date.parse('2026-10-19T17:00:00Z'),planId='fixture-plan',version=3,jobId='fixture-reminder';
const preview={available:true,planId,expiresAt:'2026-10-19T17:30:00Z',recipient:'self@example.com',
 reminder:{id:jobId,title:'Synthetic due reminder',body:'Review your saved task.',dueAt:'2026-10-19T16:30:00Z',timezone:'America/Toronto'},
 versions:{planVersion:version,preferencesVersion:2,destinationVersion:1},normalEmailEnabled:false,inboxDelivery:'unverified',canonicalReminderUnchanged:true};
const review=(input=preview,targetPlan=planId,targetVersion=version,selected=jobId)=>controlledEmailReview(input,targetPlan,targetVersion,selected,now);
let checks=0;const check=(name,work)=>{work();checks++;console.log('PASS '+name);};
check('Only the exact visible plan, current plan version and selected due reminder can enable the test',()=>{
 assert.equal(review().canSend,true);assert.equal(review(null).canSend,false);assert.equal(review(preview,'another-plan').canSend,false);
 assert.equal(review(preview,planId,version+1).canSend,false);assert.equal(review(preview,planId,version,'').canSend,false);
 assert.equal(review(preview,planId,version,'another-reminder').canSend,false);
});
check('Every recorded attempt blocks another send, including uncertain and reserved attempts',()=>{
 for(const status of ['accepted','pending','uncertain','rejected','not-sent'])assert.equal(review({...preview,attempt:{id:'fixture-attempt',status,accepted:status==='accepted'}}).canSend,false);
});
check('Grant-free saved acceptance remains inspectable without enabling another send or requiring a recipient',()=>{
 const saved={available:false,planId,lastAttempt:{id:'retained-attempt',status:'accepted',accepted:true,messageId:'provider-reference'}};
 assert.equal(review(saved).canSend,false);assert.match(controlledEmailAttemptMessage(saved.lastAttempt),/does not verify inbox delivery/);
 assert.equal('recipient' in saved,false);assert.equal('reminder' in saved,false);
});
check('Expired or malformed grants and future reminders remain unavailable',()=>{
 for(const expiresAt of ['2026-10-19T17:00:00Z','invalid'])assert.equal(review({...preview,expiresAt}).canSend,false);
 assert.equal(review({...preview,reminder:{...preview.reminder,dueAt:'2026-10-19T17:01:00Z'}}).canSend,false);
 assert.equal(review({...preview,reminder:{...preview.reminder,dueAt:'invalid'}}).canSend,false);
});
check('Missing or invalid preference/destination versions cannot be submitted as a current review',()=>{
 for(const field of ['planVersion','preferencesVersion','destinationVersion'])for(const value of [undefined,-1,0.5,'1'])assert.equal(review({...preview,versions:{...preview.versions,[field]:value}}).canSend,false);
});
check('Unexpected activation/delivery claims or an invalid confirmed recipient prevent sending',()=>{
 for(const extra of [{normalEmailEnabled:true},{canonicalReminderUnchanged:false},{inboxDelivery:'delivered'},{recipient:'unconfirmed'},{recipient:'@'}])assert.equal(review({...preview,...extra}).canSend,false);
});
check('Provider acceptance is described separately from inbox delivery and uncertain outcomes never claim success',()=>{
 assert.match(controlledEmailAttemptMessage({status:'accepted',accepted:true}),/does not verify inbox delivery/);
 assert.match(controlledEmailAttemptMessage({status:'accepted',accepted:false}),/uncertain/);
 assert.match(controlledEmailAttemptMessage({status:'uncertain',accepted:false}),/will not be resent automatically/);
 for(const status of ['pending','rejected','not-sent'])assert.doesNotMatch(controlledEmailAttemptMessage({status,accepted:false}),/SES accepted/);
});
console.log(`${checks} controlled reminder email review checks passed; no network or sends.`);
