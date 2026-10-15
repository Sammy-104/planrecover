import assert from 'node:assert/strict';
import {parseWorkspaceMutation,ActionValidationError} from '../lib/action-contracts.ts';
import {initialState,fixtureReceipt,applyAction} from '../lib/model.ts';

const parse=(action,version=0)=>parseWorkspaceMutation({version,action});
const rejects=action=>assert.throws(()=>parse(action),error=>error instanceof ActionValidationError&&error.status===400);
const actor='sam';
const repayment={type:'settlement_report',actor,to:'alex',amount:2500};
assert.deepEqual(parse(repayment).action,repayment);
assert.equal(parse({...repayment,actor:undefined}).action.actor,undefined,'Signed-in requests may omit a client actor; the server binds identity.');
assert.throws(()=>parseWorkspaceMutation({version:0,action:{...repayment,actor:undefined}},{requireActor:true}),ActionValidationError);

for(const action of [null,[],{},'approve_item',{type:'unrecognized',actor},
 {type:'approve_item',actor,itemId:'lodge'},
 {type:'task',actor,itemId:'lodge',done:'false'},
 {type:'item_location',actor,itemId:'lodge',latitude:91,longitude:0},
 {type:'move_item',actor,itemId:'lodge',day:'2027-02-30'},
 {type:'suggestion_feedback',actor,suggestionId:'museum',feedback:'vote'},
 {type:'delete_trip',actor,deleteTripId:'trip-id',confirmed:'true'},
 {type:'reset',actor,preferences:{budget:0}},
 {...repayment,to:'../../other-account'},
 {...repayment,to:'constructor'},
])rejects(action);
for(const amount of [-1,0,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,1_000_000_000_001,'2500'])rejects({...repayment,amount});
for(const version of [-1,0.5,'0',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>parse(repayment,version),ActionValidationError);
assert.throws(()=>parseWorkspaceMutation({version:0,action:repayment,workspace:{}}),ActionValidationError);

const state=initialState();
assert.deepEqual(parse({type:'plan',actor,plan:state.plan}).action.plan,state.plan,'A full plan from the existing editor stays compatible.');
const receipt=fixtureReceipt();
assert.deepEqual(parse({type:'receipt',actor,receipt}).action.receipt,receipt,'The existing receipt editor stays compatible.');
rejects({type:'receipt',actor,receipt:{...receipt,date:'2026-02-30'}});
rejects({type:'receipt',actor,receipt:{...receipt,rows:[{...receipt.rows[0],amount:-1}]}});
rejects({type:'receipt',actor,receipt:{...receipt,rows:Array.from({length:101},(_,i)=>({...receipt.rows[0],id:`line-${i}`}))}});
rejects({type:'receipt',actor,receipt:{...receipt,fileKey:'../../other-workspace/receipt'}});
rejects({type:'preferences',actor,preferences:{...state.preferences.sam,budget:1.5}});
rejects({type:'preferences',actor,preferences:{...state.preferences.sam,paypalMe:'https://evil.example/paypal.me/sam'}});

const add={type:'add_item',actor,name:'Museum',category:'Activity',start:'2026-10-17T10:00:00-04:00',duration:60,price:1200,participants:['sam','alex']};
assert.equal(applyAction(state,parse(add).action).items.at(-1).name,'Museum');
for(const change of [{name:'x'.repeat(181)},{participants:['sam','sam']},{participants:Array.from({length:101},(_,i)=>`member-${i}`)},
 {start:'2026-02-30T10:00:00Z'},{start:'2026-10-17T24:00:00Z'},{start:'tomorrow'},
 {start:'2026-10-17T10:00:00'},{duration:1.5},{price:-1},{price:'1200'},
])rejects({...add,...change});
rejects({type:'item_edit',actor,itemId:'lodge',participants:['sam'],price:1200,allocation:'fixed',values:{sam:1200.5}});

// Passing validation never grants membership or stale-revision authorization.
assert.throws(()=>applyAction(state,{...parse({...add,actor:'person-outsider'}).action}),/editing access/);
assert.throws(()=>applyAction(state,parse({type:'approve_item',actor,itemId:'lodge',revision:999}).action),/revision changed/);
assert.throws(()=>applyAction(state,parse({type:'settlement_confirm',actor:'alex',eventId:'missing-payment'}).action),/recipient/);
console.log('Action contract tests passed: malformed requests, money, dates, receipt bounds, UI compatibility and state authorization.');
