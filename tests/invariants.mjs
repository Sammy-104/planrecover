import assert from 'node:assert/strict';
import {initialState,fixtureReceipt,splitReceipt,allocate,applyAction,personalMoney,memberIds,catalog,tripList,tripCatalog,isDemoTrip,normalizeWorkspace,blankReceipt,financialTrip,suggestionFit,recoveryFigures} from '../lib/model.ts';
let checks=0;
function test(name,fn){fn();checks++;console.log(`PASS ${name}`)}
const run=(s,type,extra={},actor='sam')=>applyAction(s,{type,actor,...extra});
const all=(s,type,extra)=>memberIds.reduce((a,actor)=>run(a,type,extra,actor),s);
test('Exact-cent allocations sum to source amount across modes',()=>{for(let total=1;total<=1301;total+=13){for(const [mode,values] of [['equal',{}],['weight',{sam:1,alex:2,maya:3,chris:4}],['percent',{sam:10,alex:20,maya:30,chris:40}]])assert.equal(Object.values(allocate(total,[...memberIds],mode,values)).reduce((a,b)=>a+b,0),total)}assert.throws(()=>allocate(100,[...memberIds],'fixed',{sam:24,alex:25,maya:25,chris:25}));});
test('Blueprint receipt returns all four exact shares',()=>assert.deepEqual(splitReceipt(fixtureReceipt()),{sam:3537,alex:3013,maya:2751,chris:3275}));
test('Extraction mismatch and unclaimed items cannot be approved',()=>{assert.throws(()=>splitReceipt({...fixtureReceipt(),total:12575}));const r=fixtureReceipt();r.rows[0].claims=[];assert.throws(()=>splitReceipt(r));});
test('Optional dinner creates no obligations for non-participants',()=>{const s=run(initialState(),'add_suggestion',{suggestionId:'dinner',participants:['sam','alex']});const i=s.items.at(-1);assert.deepEqual(i.shares,{sam:2800,alex:2800});assert.equal(personalMoney(s,'maya').projected,24000);assert.equal(s.events.length,3);});
test('Free activity and preparation task create zero money events',()=>{let s=run(initialState(),'add_suggestion',{suggestionId:'viewpoint',participants:[...memberIds]});const i=s.items.at(-1);s=all(s,'approve_item',{itemId:i.id,revision:i.revision});assert.equal(s.items.at(-1).status,'scheduled');assert.equal(s.events.length,3);assert.equal(personalMoney(s,'sam').cost,24000);});
test('Travel and buffer are checked against locked times',()=>{const s=initialState(),view=catalog.find(c=>c.id==='viewpoint');assert.equal(suggestionFit(s,view,[...memberIds]).conflict,null);assert.equal(suggestionFit(s,catalog.find(c=>c.id==='workshop'),[...memberIds]).conflict,'Guided ridge hike');assert.throws(()=>run(s,'add_suggestion',{suggestionId:'workshop',participants:[...memberIds]}));});
test('Unknown price stays unknown and does not create a quote',()=>{const s=run(initialState(),'add_suggestion',{suggestionId:'market',participants:[...memberIds]});assert.equal(s.items.at(-1).price,null);assert.deepEqual(s.items.at(-1).shares,{});});
test('Changed participants invalidate previous approvals',()=>{let s=run(initialState(),'add_suggestion',{suggestionId:'dinner',participants:['sam','alex']});const i=s.items.at(-1);s=run(s,'approve_item',{itemId:i.id,revision:i.revision});s=run(s,'item_edit',{itemId:i.id,participants:['sam','alex','maya'],price:5600,allocation:'equal',values:{}});assert.deepEqual(s.items.at(-1).approvals,[]);assert.throws(()=>run(s,'approve_item',{itemId:i.id,revision:1}));});
test('Receipt review needs all changed shares and confirmed payer',()=>{let s=run(initialState(),'receipt',{receipt:fixtureReceipt()});const r=s.receipts[0];s=run(s,'approve_receipt',{receiptId:r.id,revision:r.revision});assert.equal(s.events.length,3);for(const actor of ['alex','maya'])s=run(s,'approve_receipt',{receiptId:r.id,revision:r.revision},actor);assert.throws(()=>run(s,'approve_receipt',{receiptId:r.id,revision:r.revision},'chris'));});
let receiptState;
test('Reviewed receipt separates personal consumption and contribution',()=>{let s=run(initialState(),'receipt',{receipt:{...fixtureReceipt(),paymentConfirmed:true}});const r=s.receipts[0];s=all(s,'approve_receipt',{receiptId:r.id,revision:r.revision});receiptState=s;assert.equal(personalMoney(s,'sam').cost,27537);assert.equal(personalMoney(s,'sam').contribution,36576);assert.equal(personalMoney(s,'sam').friendBalance,9039);assert.equal(personalMoney(s,'alex').friendBalance,-3013);assert.equal(s.events.length,4);assert.throws(()=>run(s,'receipt',{receipt:fixtureReceipt()}));});
test('Reported repayment does not settle until recipient confirms',()=>{let s=run(receiptState,'settlement_report',{to:'sam',amount:3013},'alex');const e=s.events.at(-1);assert.equal(personalMoney(s,'alex').friendBalance,-3013);assert.throws(()=>run(s,'settlement_confirm',{eventId:e.id},'alex'));s=run(s,'settlement_confirm',{eventId:e.id},'sam');assert.equal(personalMoney(s,'alex').friendBalance,0);assert.equal(personalMoney(s,'sam').cost,27537);});
test('Settled receipt edits append an adjustment and retain payment history',()=>{let s=receiptState;const original=structuredClone(s.receipts[0]);original.rows[0].claims=['alex'];s=run(s,'receipt',{receipt:original});const revised=s.receipts[0];s=all(s,'approve_receipt',{receiptId:revised.id,revision:revised.revision});assert.equal(s.events.length,5);assert.equal(s.events.at(-1).kind,'adjustment');assert.equal(personalMoney(s,'sam').contribution,36576);assert.equal(s.events[3].amount,12576);});
test('Departure keeps old obligations until every affected person agrees',()=>{let s=run(initialState(),'departure',{departing:'chris'});const p=s.proposals[0];assert.equal(personalMoney(s,'chris').cost,24000);assert.deepEqual(p.newShares,{sam:16000,alex:16000,maya:16000});assert.throws(()=>run(s,'execute_proposal',{proposalId:p.id}));s=all(s,'approve_proposal',{proposalId:p.id,revision:p.revision});s=run(s,'execute_proposal',{proposalId:p.id});assert.equal(personalMoney(s,'sam').cost,28000);assert.equal(personalMoney(s,'chris').cost,12000);assert.equal(personalMoney(s,'chris').friendBalance,12000);});
test('Recovery exactly matches blueprint replace and cancel figures',()=>{assert.deepEqual(recoveryFigures('replace'),{groupFinal:102000,eachFinal:25500,groupRefund:36000,eachRefund:9000,cash:10500,extra:1500});assert.equal(recoveryFigures('cancel').groupFinal,49000);assert.equal(recoveryFigures('cancel').groupRefund,47000);});
function approvedRecovery(option){let s=run(initialState(),'disrupt');s=run(s,'propose_recovery',{option});const p=s.proposals[0];s=all(s,'approve_proposal',{proposalId:p.id,revision:p.revision});return run(s,'execute_proposal',{proposalId:p.id});}
test('Pending refunds never reduce new cash required or confirmed cost',()=>{const s=approvedRecovery('replace');assert.equal(personalMoney(s,'maya').merchantDue,10500);assert.equal(personalMoney(s,'maya').expectedRefund,9000);assert.equal(personalMoney(s,'maya').cost,24000);assert.equal(personalMoney(s,'maya').projected,34500);assert.equal(personalMoney(s,'maya').afterExpected,25500);assert.ok(s.preferences.maya.cash<10500);});
test('One paid share does not hide other members’ planned costs',()=>{let s=approvedRecovery('replace');s=run(s,'demo_payment',{itemId:'replacement'});assert.equal(personalMoney(s,'sam').planned,0);assert.equal(personalMoney(s,'alex').planned,10500);assert.equal(personalMoney(s,'alex').merchantDue,10500);});
test('Repeated payments and refunds do not duplicate ledger entries',()=>{let s=approvedRecovery('replace');s=run(s,'demo_payment',{itemId:'replacement'});const n=s.events.length;s=run(s,'demo_payment',{itemId:'replacement'});assert.equal(s.events.length,n);s=run(s,'demo_refund',{eventId:'recovery-refund-hike'});const count=s.events.length;s=run(s,'demo_refund',{eventId:'recovery-refund-hike'});assert.equal(s.events.length,count);assert.equal(personalMoney(s,'sam').cost,25500);});
test('Cancelling all yields exact CAD 122.50 loss per person',()=>{let s=approvedRecovery('cancel');for(const e of s.events.filter(e=>e.kind==='refund'))s=run(s,'demo_refund',{eventId:e.id});for(const id of memberIds)assert.equal(personalMoney(s,id).cost,12250);});
test('Booking failure preserves completed payment and separate booking state',()=>{let s=approvedRecovery('replace');s=all(s,'demo_payment',{itemId:'replacement'});s=run(s,'booking_fail',{itemId:'replacement'});assert.equal(s.items.find(i=>i.id==='replacement').booking,'failed');assert.equal(s.items.find(i=>i.id==='replacement').paid.length,4);assert.equal(personalMoney(s,'sam').cost,34500);});
test('Changing destination archives records and starts a clean trip',()=>{
 const before=receiptState;
 const s=run(before,'plan',{plan:{...before.plan,destination:'Tokyo'}});
 assert.equal(s.plan.destination,'Tokyo');assert.equal(s.plan.name,'Tokyo trip');assert.equal(isDemoTrip(s),false);
 for(const key of ['items','events','receipts','reminders','proposals'])assert.equal(s[key].length,0);
 assert.equal(s.disruption,false);assert.equal(personalMoney(s,'sam').projected,0);
 assert.deepEqual(s.archives[0].workspace.events,before.events);assert.deepEqual(s.archives[0].workspace.receipts,before.receipts);
 assert.equal(s.archives[0].workspace.plan.destination,'Algonquin area, Ontario');assert.equal(before.plan.destination,'Algonquin area, Ontario');
 assert.equal(s.plan.goal,'A trip to Tokyo for four friends.');
});
test('Unresolved cities show no fabricated places and reject stale demo actions',()=>{
 const before=initialState(),s=run(before,'plan',{plan:{...before.plan,destination:'Vancouver'}}),suggestions=tripCatalog(s);
 assert.equal(suggestions.length,0);
 assert.ok(!suggestions.some(c=>['museum','viewpoint','pack'].includes(c.id)));
 assert.throws(()=>run(s,'add_suggestion',{suggestionId:'museum',participants:[...memberIds]}));
 assert.throws(()=>run(s,'suggestion_feedback',{suggestionId:'viewpoint',feedback:'save'}));
 assert.throws(()=>run(s,'disrupt'));assert.throws(()=>run(s,'departure',{departing:'chris'}));
});
test('Workspaces already edited by the old version migrate once without losing records',()=>{
 const stale=initialState();delete stale.plan.contentDestination;delete stale.plan.template;delete stale.archives;stale.plan.destination='Montreal';
 const repaired=normalizeWorkspace(stale);assert.equal(repaired.items.length,0);assert.equal(repaired.events.length,0);assert.deepEqual(repaired.archives[0].workspace.events,stale.events);
 const persisted=JSON.parse(JSON.stringify(repaired));assert.deepEqual(normalizeWorkspace(persisted),persisted);
 const legacyDemo=initialState();delete legacyDemo.plan.contentDestination;delete legacyDemo.plan.template;
 assert.equal(normalizeWorkspace(legacyDemo).items.length,5);assert.equal(isDemoTrip(normalizeWorkspace(legacyDemo)),true);
});
test('Name-only and whitespace edits preserve the itinerary; repeated destination changes preserve all histories',()=>{
 const initial=initialState(),renamed=run(initial,'plan',{plan:{...initial.plan,name:'Friends weekend',destination:'  algonquin area, ONTARIO  '}});
 assert.equal(renamed.items.length,5);assert.equal(renamed.archives.length,0);
 const a=run(initial,'plan',{plan:{...initial.plan,destination:'Paris'}});
 const b=run(a,'plan',{plan:{...a.plan,destination:'Rome'}});
 assert.equal(b.archives.length,2);assert.equal(b.archives[0].workspace.plan.destination,'Paris');assert.equal(b.archives[1].workspace.events.length,3);
 assert.equal(tripCatalog(b).length,0);assert.equal(b.items.length,0);
});
test('Custom trip activities and receipt entry do not inherit fixture data',()=>{
 let s=run(initialState(),'plan',{plan:{...initialState().plan,destination:'Tokyo',budget:45000}});
 assert.equal(s.preferences.sam.budget,45000);
 const blank=blankReceipt(s,'alex');assert.equal(blank.merchant,'');assert.equal(blank.total,0);assert.equal(blank.date,s.plan.start);assert.equal(blank.payer,'alex');
 s=run(s,'add_item',{name:'My chosen museum',category:'Activity',location:'Tokyo',start:s.plan.start+'T10:00:00-04:00',duration:60,price:null,participants:['sam','alex']});
 const item=s.items[0];assert.equal(item.status,'draft');assert.equal(item.price,null);assert.deepEqual(item.paid,[]);assert.equal(s.events.length,0);
 s=run(s,'item_edit',{itemId:item.id,name:'Actual venue',location:'Verified address',participants:['sam','alex'],price:8000,allocation:'equal',values:{}});
 assert.equal(s.items[0].name,'Actual venue');assert.equal(s.items[0].location,'Verified address');assert.deepEqual(s.items[0].shares,{sam:4000,alex:4000});
 s=run(s,'approve_item',{itemId:item.id,revision:2});s=run(s,'approve_item',{itemId:item.id,revision:2},'alex');assert.equal(s.items[0].status,'scheduled');assert.equal(personalMoney(s,'sam').merchantDue,0);assert.equal(personalMoney(s,'sam').projected,4000);
 assert.throws(()=>run(s,'add_item',{name:'Out of range',category:'Activity',location:'Tokyo',start:'2026-11-01T10:00:00-04:00',duration:60,price:0,participants:['sam']}));
});
test('Late provider bookkeeping targets the previous trip without contaminating current totals',()=>{
 const s=run(initialState(),'plan',{plan:{...initialState().plan,destination:'Tokyo'}});
 const previous=financialTrip(s,'hike');assert.equal(previous,s.archives[0].workspace);assert.equal(financialTrip(s,'missing'),undefined);
 previous.events.push({id:'late-capture',itemId:'hike',kind:'expense',label:'Late provider payment',shares:{sam:100},contributions:{sam:100},amount:100,status:'confirmed',evidence:'Test',mode:'sandbox',created:'2026-10-07T00:00:00Z'});
 assert.equal(personalMoney(s,'sam').cost,0);assert.equal(s.archives[0].workspace.events.at(-1).id,'late-capture');
});


const create=(s,city,name=city)=>run(s,'create_trip',{plan:{name,destination:city,start:'2027-04-03',end:'2027-04-06',budget:50000}});
test('Multiple trips round-trip independently, including two visits to the same city',()=>{
 const demo=initialState(),demoId=demo.plan.id;
 let s=create(demo,'Tokyo','Spring Tokyo'),tokyoId=s.plan.id;
 s=run(s,'add_suggestion',{suggestionId:tripCatalog(s)[0].id,start:'2027-04-04T11:00:00+09:00',duration:90,participants:['sam']});
 s=run(s,'suggestion_feedback',{suggestionId:tripCatalog(s)[1].id,feedback:'save'});
 const originalItems=structuredClone(s.items),originalSaved=[...s.saved];
 s=create(s,'Busan');const busanId=s.plan.id;
 assert.equal(s.plan.timezone,'Asia/Seoul');assert.equal(s.items.length,0);assert.equal(s.saved.length,0);assert.equal(personalMoney(s,'sam').cost,0);
 assert.equal(tripList(s).length,3);assert.equal(new Set(tripList(s).map(t=>t.id)).size,3);
 s=run(s,'select_trip',{tripId:tokyoId});assert.deepEqual(s.items,originalItems);assert.deepEqual(s.saved,originalSaved);assert.equal(s.plan.timezone,'Asia/Tokyo');
 s=create(s,'Tokyo','Summer Tokyo');assert.notEqual(s.plan.id,tokyoId);assert.equal(s.items.length,0);
 s=run(s,'select_trip',{tripId:demoId});assert.equal(isDemoTrip(s),true);assert.equal(s.items.length,5);assert.equal(personalMoney(s,'sam').cost,24000);
 s=run(s,'select_trip',{tripId:busanId});assert.equal(s.plan.destination,'Busan');assert.equal(s.items.length,0);
 assert.deepEqual(normalizeWorkspace(JSON.parse(JSON.stringify(s))),JSON.parse(JSON.stringify(s)));
});
test('City recommendations follow aliases and cannot leak to another trip',()=>{
 const tokyo=create(initialState(),'Tokyo, Japan'),busan=create(tokyo,'Busan, South Korea');
 assert.ok(tripCatalog(tokyo).some(c=>c.name==='Senso-ji Temple'));
 assert.ok(tripCatalog(busan).some(c=>c.name==='Haeundae Beach'));
 assert.ok(tripCatalog(tokyo).every(c=>c.sourceUrl.startsWith('https://www.gotokyo.org/')&&c.price===null));
 assert.ok(tripCatalog(busan).every(c=>c.sourceUrl.startsWith('https://www.visitbusan.net/')&&c.flexible));
 assert.throws(()=>run(busan,'add_suggestion',{suggestionId:tripCatalog(tokyo)[0].id,participants:['sam']}));
 assert.throws(()=>run(busan,'preferences',{tripId:tokyo.plan.id,preferences:tokyo.preferences.sam}),/Refresh/);
});
test('Custom receipts and cash stay in their trip across switches',()=>{
 let s=create(initialState(),'Tokyo'),id=s.plan.id;
 const receipt={...blankReceipt(s,'sam'),merchant:'My cafe',rows:[{id:'coffee',name:'Coffee',amount:500,claims:['sam']}],total:500,paymentConfirmed:true};
 s=run(s,'receipt',{receipt});s=run(s,'approve_receipt',{receiptId:s.receipts[0].id,revision:s.receipts[0].revision});
 assert.equal(personalMoney(s,'sam').cost,500);
 s=create(s,'Busan');assert.equal(s.receipts.length,0);assert.equal(personalMoney(s,'sam').cost,0);
 s=run(s,'select_trip',{tripId:id});assert.equal(s.receipts[0].merchant,'My cafe');assert.equal(personalMoney(s,'sam').cost,500);
});
test('Reset preserves other trips and gives the new demo a unique identity',()=>{
 let s=create(initialState(),'Tokyo');const tokyoId=s.plan.id;
 s=run(s,'reset');assert.ok(isDemoTrip(s));assert.equal(new Set(tripList(s).map(t=>t.id)).size,tripList(s).length);
 s=run(s,'select_trip',{tripId:tokyoId});assert.equal(s.plan.destination,'Tokyo');
});
console.log(`${checks} meaningful invariant checks passed.`);
