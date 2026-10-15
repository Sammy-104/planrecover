import assert from 'node:assert/strict';
import {initialState,applyAction,normalizeWorkspace,allocate,splitReceipt} from '../lib/model.ts';
import {parseMoney,moneyInput,formatMoney,currencyDigits,planCurrency} from '../lib/money.ts';
import {destinationSettings,worldTimezones} from '../lib/localization.ts';
import {localDateTime,zonedStart} from '../lib/trip-time.ts';
import {routeSegments,routeUrl,readRoute} from '../lib/travel-routes.ts';
import {directionsUrl,dayDirections} from '../lib/map-planning.ts';

for(const [currency,value,units] of [['CAD','123.45',12345],['JPY','123',123],['KRW','123',123],['KWD','123.456',123456]]){
 assert.equal(parseMoney(value,currency),units);assert.equal(parseMoney(moneyInput(units,currency),currency),units);
 assert.equal(Object.values(allocate(units,['sam','alex','maya'])).reduce((a,b)=>a+b,0),units);
 assert.ok(formatMoney(units,currency).includes(currency));
 assert.equal(Number.isNaN(parseMoney(value+'1',currency)),currencyDigits(currency)>0);
}
assert.ok(Number.isNaN(parseMoney('10.1','JPY')));assert.equal(parseMoney('300.00','JPY'),300);assert.ok(Number.isNaN(parseMoney('1e3','USD')));
assert.ok(worldTimezones.length>350);
for(const [country,lat,lon,timezone,currency] of [['Japan',35.68,139.76,'Asia/Tokyo','JPY'],['United Kingdom',51.51,-.13,'Europe/London','GBP'],['Kenya',-1.29,36.82,'Africa/Nairobi','KES'],['Nepal',27.71,85.32,'Asia/Kathmandu','NPR'],['United States',34.05,-118.24,'America/Los_Angeles','USD'],['New Zealand',-36.85,174.76,'Pacific/Auckland','NZD']]){
 const settings=destinationSettings('Test city',{country,latitude:lat,longitude:lon});assert.equal(settings.timezone,timezone);assert.equal(settings.currency,currency);
}
assert.equal(zonedStart('2027-04-04T10:00','Asia/Kathmandu'),'2027-04-04T10:00:00+05:45');
assert.throws(()=>zonedStart('2027-03-14T02:30','America/New_York'),/not available/);
const legacy=initialState();delete legacy.plan.currency;assert.equal(normalizeWorkspace(legacy).plan.currency,'CAD');
let state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Tokyo in yen',destination:'Tokyo, Japan',start:'2027-04-04',end:'2027-04-06',currency:'JPY',timezone:'Asia/Tokyo',budget:30000}});
assert.equal(planCurrency(state.plan),'JPY');assert.equal(state.preferences.sam.cash,30000);assert.equal(state.preferences.sam.reserve,0);
state=applyAction(state,{type:'add_item',actor:'sam',name:'Garden',category:'Activity',location:'Tokyo',start:'2027-04-04T10:00:00+09:00',duration:60,price:1001,participants:['sam','alex']});
assert.equal(state.items[0].price,1001);assert.equal(Object.values(state.items[0].shares).reduce((a,b)=>a+b,0),1001);
assert.throws(()=>applyAction(state,{type:'plan',actor:'sam',plan:{...state.plan,currency:'USD'}}),/already has costs/);
const instant=state.items[0].start;state=applyAction(state,{type:'plan',actor:'sam',plan:{...state.plan,timezone:'Asia/Kathmandu'}});assert.equal(state.items[0].start,instant);assert.equal(localDateTime(instant,state.plan.timezone),'2027-04-04T06:45');
assert.throws(()=>applyAction(state,{type:'plan',actor:'sam',plan:{...state.plan,timezone:'Invalid/Zone'}}),/valid time zone/);
assert.throws(()=>applyAction(state,{type:'plan',actor:'sam',plan:{...state.plan,currency:'ZZZ'}}),/supported currency/);
const bill={rows:[{amount:1001,claims:['sam','alex']}],tax:0,tip:0,discount:0,total:1001,tipRule:'equal'};assert.equal(Object.values(splitReceipt(bill,undefined,'JPY')).reduce((a,b)=>a+b,0),1001);
assert.throws(()=>splitReceipt({...bill,total:1002},undefined,'JPY'),/JPY/);
const a={...state.items[0],id:'a',latitude:35.68,longitude:139.76},b={...a,id:'b',start:'2027-04-04T11:00:00+09:00',longitude:139.77},missing={...a,id:'missing',start:'2027-04-04T12:00:00+09:00',latitude:undefined},c={...a,id:'c',start:'2027-04-04T13:00:00+09:00'};
state.plan.timezone='Asia/Tokyo';state.items=[a,b,missing,c];assert.deepEqual(routeSegments(state,'2027-04-04').map(s=>s.map(i=>i.id)),[['a','b']]);
assert.ok(routeUrl([a,b],'walk').includes('/routed-foot/'));assert.ok(routeUrl([a,b],'drive').includes('/routed-car/'));
assert.throws(()=>routeUrl([a,b],'transit'));assert.throws(()=>routeUrl([a,missing],'walk'));
const body={code:'Ok',waypoints:[{distance:1},{distance:2}],routes:[{legs:[{duration:1440,distance:1800,steps:[{geometry:{type:'LineString',coordinates:[[139.76,35.68],[139.761,35.681],[139.77,35.68]]}}]}]}]};
const legs=readRoute(body,[a,b]);assert.equal(legs[0].minutes,24);assert.equal(legs[0].km,1.8);assert.deepEqual(legs[0].coordinates[0],[35.68,139.76]);
assert.throws(()=>readRoute({...body,waypoints:[{distance:2000},{distance:2}]},[a,b]),/too far/);assert.throws(()=>readRoute({code:'NoRoute'},[a,b]));
assert.equal(new URL(directionsUrl([a,b],'transit')).searchParams.get('travelmode'),'transit');assert.equal(directionsUrl([a,b,c],'transit'),undefined);
state.items=[a,b,c];assert.equal(dayDirections(state,'2027-04-04','transit').length,2);assert.ok(dayDirections(state,'2027-04-04','transit').every(r=>!new URL(r.url).searchParams.has('waypoints')));
console.log('Worldwide planning: exact currency units, legacy history, city defaults, local time, currency locks, routed paths, unknown-location gaps and transit directions passed.');
