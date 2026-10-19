export type ControlledEmailAttempt={id:string;status:'accepted'|'pending'|'uncertain'|'rejected'|'not-sent';accepted:boolean;messageId?:string;recordedAt:string;evidence:string};
export type ControlledEmailPreview={available:true;planId:string;expiresAt:string;recipient:string;
 reminder:{id:string;title:string;body:string;dueAt:string;timezone:string};
 versions:{planVersion:number;preferencesVersion:number;destinationVersion:number};
 normalEmailEnabled:false;inboxDelivery:'unverified';canonicalReminderUnchanged:true;attempt?:ControlledEmailAttempt};
/** A visible, current preview is required. This helper authorizes no delivery;
 * the server independently checks every version and the one-use grant. */
export function controlledEmailReview(value:ControlledEmailPreview|null,planId:string,planVersion:number,reminderJobId:string,now=Date.now()){
 if(!value||value.available!==true)return {canSend:false,reason:'This email test has not been prepared yet.'};
 if(value.planId!==planId||value.versions?.planVersion!==planVersion)return {canSend:false,reason:'The plan changed. Refresh the saved test details before sending.'};
 if(!reminderJobId||value.reminder?.id!==reminderJobId)return {canSend:false,reason:'Choose the due reminder prepared for this test.'};
 if(value.attempt)return {canSend:false,reason:'A test attempt is already recorded. Read its saved result below.'};
 if(value.normalEmailEnabled!==false||value.canonicalReminderUnchanged!==true||value.inboxDelivery!=='unverified')return {canSend:false,reason:'The test settings need review before sending.'};
 if(!Number.isFinite(now)||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=now)return {canSend:false,reason:'This email test expired. It must be prepared again.'};
 if(!value.reminder.title||!Number.isFinite(Date.parse(value.reminder.dueAt))||Date.parse(value.reminder.dueAt)>now)return {canSend:false,reason:'Choose a current, due in-app reminder.'};
 if(![value.versions.planVersion,value.versions.preferencesVersion,value.versions.destinationVersion].every(version=>Number.isSafeInteger(version)&&version>=0)||typeof value.recipient!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipient))return {canSend:false,reason:'Refresh the confirmed destination and current test details.'};
 return {canSend:true,reason:''};
}
export function controlledEmailAttemptMessage(attempt:Pick<ControlledEmailAttempt,'status'|'accepted'>){
 if(attempt.status==='accepted'&&attempt.accepted)return 'Amazon SES accepted the test email. This does not verify inbox delivery; check your email inbox.';
 if(attempt.status==='pending')return 'This test has already been reserved. Refresh its saved status; it will not be sent again automatically.';
 if(attempt.status==='rejected')return 'The provider rejected this test. No further send will be attempted for it.';
 if(attempt.status==='not-sent')return 'This test was not sent. Its saved attempt prevents another send for this test.';
 return 'The send outcome is uncertain. Refresh the saved result and check your inbox; this test will not be resent automatically.';
}
