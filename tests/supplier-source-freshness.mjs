import assert from 'node:assert/strict';
import {mappedInfo,mappedVenueInfo,mappedVenueId} from '../lib/mapped-place-info.ts';
import {freshPlaceInfo,mergePlaceInfo,PLACE_INFO_FRESHNESS_MS} from '../lib/place-info.ts';
import {hoursChecks,readForecast,FORECAST_FRESHNESS_MS} from '../lib/plan-conditions.ts';
import {planConditions} from '../lib/plan-conditions-server.ts';
import {initialState,applyAction} from '../lib/model.ts';

const now=Date.parse('2026-10-19T14:00:00Z'),at=new Date(now).toISOString(),day='2026-10-19';
const snapshot=(id,tags={},extra={})=>({osm3s:{timestamp_osm_base:at},elements:[{type:'node',id,timestamp:'2024-01-01T00:00:00Z',tags,...extra}]});
let calls=0;
const first=await mappedInfo('osm-node-983001',async(url,options)=>{
 calls++;assert.equal(new URL(url).hostname,'overpass.private.coffee');assert.equal(options.redirect,'manual');
 assert.equal(options.body.get('data'),'[out:json][timeout:5];node(983001);out meta;');
 assert.equal(Object.keys(options.headers).some(key=>/auth|member|plan/i.test(key)),false);
 return Response.json(snapshot(983001,{opening_hours:'24/7',charge:'CAD 10',website:'https://example.org/venue'}));
},{now});
assert.equal(calls,1);assert.equal(first.detailsProvenance,'community-map');assert.equal(first.detailsLiveInventoryVerified,false);
assert.equal(first.detailsSourceUpdatedAt,'2024-01-01T00:00:00.000Z');assert.equal(first.detailsDataAsOf,at);
assert.equal(Date.parse(first.detailsExpiresAt)-now,PLACE_INFO_FRESHNESS_MS);assert.ok(freshPlaceInfo(first,now));
assert.equal((await mappedInfo('osm-node-983001',()=>{throw Error('A normal cache hit must not send another request.');},{now:now+1000})).openingHours,'24/7');
const changed=await mappedInfo('osm-node-983001',async()=>{calls++;return Response.json(snapshot(983001,{website:'https://example.org/current'}));},{refresh:true,now:now+2000});
assert.equal(calls,2);assert.equal(changed.openingHours,undefined);
const merged=mergePlaceInfo({...first,name:'Real venue',price:null},JSON.parse(JSON.stringify(changed)));
assert.equal(merged.name,'Real venue');assert.equal(merged.openingHours,undefined);assert.equal(merged.listedPrice,undefined);assert.equal(merged.price,null);
assert.equal(merged.officialWebsite,'https://example.org/current');
const manual={name:'Manual venue',openingHours:'Mo 09:00-17:00',officialWebsite:'https://example.org/official',listedPrice:'Owner note'};
assert.deepEqual(mergePlaceInfo(manual,{}),manual,'Unmapped/manual venue metadata must survive an unavailable public lookup.');
for(const id of ['osm-node-0','osm-node-01','osm-node-9999999999999999','https://example.org/private','osm-node-1);out;'])
 assert.deepEqual(await mappedInfo(id,()=>{throw Error('Invalid identity must never reach a public provider.');}),{});
let wrongCalls=0;assert.deepEqual(await mappedInfo('osm-node-983002',async()=>{wrongCalls++;return Response.json(snapshot(999999,{opening_hours:'24/7'}));},{now}),{});assert.equal(wrongCalls,2);
assert.deepEqual(await mappedInfo('osm-node-983003',async()=>Response.json(snapshot(983003,{name:'x'.repeat(70000)})),{now}),{});
assert.deepEqual(await mappedInfo('osm-node-983004',async()=>Response.json({...snapshot(983004,{}),remark:'partial result'}),{now}),{});
const malformed=await mappedInfo('osm-node-983005',async()=>Response.json(snapshot(983005,{opening_hours:{unsafe:'24/7'},fee:'no'})),{now});
assert.equal(malformed.openingHours,undefined);assert.equal(malformed.admission,'free');
let resolve;const concurrentResponse=new Promise(done=>resolve=done);let concurrentCalls=0;
const provider=async()=>{concurrentCalls++;await concurrentResponse;return Response.json(snapshot(983006,{opening_hours:'24/7'}));};
const pending=[mappedInfo('osm-node-983006',provider,{now}),mappedInfo('osm-node-983006',provider,{refresh:true,now})];resolve();await Promise.all(pending);assert.equal(concurrentCalls,1);
const lagging=await mappedInfo('osm-node-983007',async()=>Response.json({...snapshot(983007,{opening_hours:'24/7'}),osm3s:{timestamp_osm_base:new Date(now-25*3600000).toISOString()}}),{now});
assert.equal(freshPlaceInfo(lagging,now),false,'A freshly read lagging mirror must not certify fresh venue facts.');
assert.equal(freshPlaceInfo({...first,detailsCheckedAt:new Date(now+600000).toISOString()},now),false);
assert.equal(freshPlaceInfo({...first,detailsExpiresAt:new Date(now-1).toISOString()},now),false);
assert.equal(freshPlaceInfo(first,now+PLACE_INFO_FRESHNESS_MS),false);
assert.equal(freshPlaceInfo({detailsCheckedAt:at,detailsSourceUrl:'https://www.wikidata.org/wiki/Q134883',officialWebsite:'https://example.org'},now),false,'A recent website-only legacy snapshot is not a full current venue snapshot.');
for(const stamp of ['not-a-date',new Date(now+600000).toISOString()])assert.deepEqual(await mappedInfo('osm-node-983008',async()=>Response.json({...snapshot(983008,{opening_hours:'24/7'}),osm3s:{timestamp_osm_base:stamp}}),{refresh:true,now}),{});
await mappedInfo('osm-node-983009',async()=>Response.json(snapshot(983009,{opening_hours:'24/7'})),{now});
assert.deepEqual(await mappedInfo('osm-node-983009',async()=>{throw Error('offline');},{refresh:true,now:now+1000}),{});
let retriedAfterFailure=0;await mappedInfo('osm-node-983009',async()=>{retriedAfterFailure++;return Response.json(snapshot(983009,{}));},{now:now+2000});assert.equal(retriedAfterFailure,1,'Failed explicit refresh invalidates the process cache.');
let lagRetry=0;await mappedInfo('osm-node-983007',async()=>{lagRetry++;return Response.json(snapshot(983007,{}));},{now:now+2000});assert.equal(lagRetry,1,'Expired mirror snapshots cannot be served as a fresh process-cache hit.');
assert.equal(mappedVenueId({id:'saved-item',sourceUrl:'https://booking.example.org/event',locationSourceUrl:'https://openstreetmap.org/way/8822'}),'osm-way-8822');
const wikiVenue={id:'wiki-123',wikidataId:'Q913416',latitude:43.66771,longitude:-79.39491};
assert.equal(mappedVenueId(wikiVenue),'wikidata-Q913416');assert.equal(mappedVenueId({...wikiVenue,latitude:undefined}),'wikidata-Q913416');
const entityResult=await mappedVenueInfo(wikiVenue,async(url,options)=>{
 if(new URL(url).hostname==='www.wikidata.org')return Response.json({entities:{Q913416:{id:'Q913416',modified:at,claims:{}}}});
 assert.equal(options.body.get('data'),'[out:json][timeout:5];nwr(around:500,43.66771,-79.39491)["wikidata"="Q913416"];out meta center 3;');
 return Response.json(snapshot(983010,{wikidata:'Q913416',opening_hours:'24/7'},{lat:43.66771,lon:-79.39491}));
},{refresh:true,now});assert.equal(entityResult.detailsSourceUrl,'https://www.openstreetmap.org/node/983010');
const ambiguous=await mappedVenueInfo(wikiVenue,async(url)=>new URL(url).hostname==='www.wikidata.org'?Response.json({}):Response.json({...snapshot(983010,{wikidata:'Q913416'}),elements:[983010,983011].map(id=>({type:'node',id,lat:43.66771,lon:-79.39491,tags:{wikidata:'Q913416'}}))}),{refresh:true,now});assert.deepEqual(ambiguous,{});
assert.deepEqual(await mappedVenueInfo(wikiVenue,async(url)=>new URL(url).hostname==='www.wikidata.org'?Response.json({}):Response.json(snapshot(983010,{wikidata:'Q913416'},{lat:43.7,lon:-79.5})),{refresh:true,now}),{});
const claim=(value,rank='normal')=>({rank,mainsnak:{snaktype:'value',datavalue:{value}}});
let wikiCalls=0;
const fallback=await mappedVenueInfo(wikiVenue,async(url)=>{if(new URL(url).hostname!=='www.wikidata.org')throw Error('Map source offline');wikiCalls++;assert.equal(new URL(url).searchParams.get('ids'),'Q913416');return Response.json({entities:{Q913416:{id:'Q913416',modified:at,claims:{P856:[claim('https://example.org/official'),claim('https://retired.example.org','deprecated')]}}}});},{refresh:true,now});
assert.equal(wikiCalls,1);assert.equal(fallback.detailsProvenance,'community-knowledge');assert.equal(fallback.detailsSourceUrl,'https://www.wikidata.org/wiki/Q913416');assert.equal(fallback.officialWebsite,'https://example.org/official');assert.ok(freshPlaceInfo(fallback,now));assert.equal(mergePlaceInfo(first,JSON.parse(JSON.stringify(fallback))).openingHours,undefined);assert.equal(fallback.listedPrice,undefined);assert.equal(fallback.detailsLiveInventoryVerified,false);
const ambiguousWebsite=await mappedVenueInfo({...wikiVenue,latitude:undefined},async()=>Response.json({entities:{Q913416:{id:'Q913416',modified:at,claims:{P856:[claim('https://a.example.org'),claim('https://b.example.org')]}}}}),{refresh:true,now});assert.equal(ambiguousWebsite.officialWebsite,undefined);
assert.deepEqual(await mappedVenueInfo({...wikiVenue,latitude:undefined},async()=>Response.json({entities:{Q913416:{id:'Q999',modified:at,claims:{}}}}),{refresh:true,now}),{});

let state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Public source isolation test',destination:'Toronto, Ontario, Canada',start:day,end:day,timezone:'America/Toronto',budget:30000}});
state=applyAction(state,{type:'add_item',actor:'sam',name:'Public source venue',category:'Activity',start:day+'T12:00:00-04:00',duration:60,price:null,participants:['sam'],location:'Toronto'});
Object.assign(state.items[0],first,{sourceUrl:'https://www.openstreetmap.org/node/983001',latitude:43.66,longitude:-79.39});
assert.equal(hoursChecks(state,day,state.items,now)[0].status,'fits');
assert.equal(hoursChecks(state,day,state.items,now+PLACE_INFO_FRESHNESS_MS)[0].status,'unknown');
state.items[0].openingHours='Mo 08:00-10:00';assert.equal(hoursChecks(state,day,state.items,now)[0].status,'closed');
state.items[0].openingHours='Mo 08:00-18:00; PH off';assert.equal(hoursChecks(state,day,state.items,now)[0].status,'unknown');
state.items[0].openingHours='24/7';
const weather={daily:{time:[day],temperature_2m_min:[5],temperature_2m_max:[14],weather_code:[1],precipitation_probability_max:[20],wind_speed_10m_max:[10]}};
const forecast=readForecast(weather,day,at,'Toronto');assert.equal(forecast.provenance,'weather-forecast');assert.equal(Date.parse(forecast.expiresAt)-now,FORECAST_FRESHNESS_MS);
assert.throws(()=>readForecast(weather,day,'not-a-date','Toronto'));
const cached=(fetchedAt=at,body=weather)=>({match:async()=>Response.json({body,fetchedAt}),put:async()=>{}});
const original=JSON.stringify(state);
const freshCached=await planConditions(state,day,'https://private.example',undefined,false,{now,cache:cached(),request:()=>{throw Error('Fresh forecast cache hit must not call upstream.');}});
assert.equal(freshCached.weatherStatus,'available');assert.equal(JSON.stringify(state),original);
for(const fetchedAt of [new Date(now-FORECAST_FRESHNESS_MS-1).toISOString(),new Date(now+600000).toISOString(),'invalid']){
 let refreshed=0;const result=await planConditions(state,day,'https://private.example',undefined,false,{now,cache:cached(fetchedAt),request:async(url,options)=>{
  refreshed++;const source=new URL(url);assert.equal(source.hostname,'api.open-meteo.com');assert.equal(source.searchParams.has('planId'),false);assert.equal(source.searchParams.has('memberId'),false);assert.equal(source.href.includes(state.plan.id),false);assert.equal(options.redirect,'manual');return Response.json(weather);
 }});assert.equal(refreshed,1);assert.equal(result.weatherStatus,'available');
}
let forcedWeather=0,forcedVenue=0;
const forced=await planConditions(state,day,'https://private.example',state.items[0].id,true,{now,cache:cached(),request:async(url)=>{
 if(new URL(url).hostname==='api.open-meteo.com'){forcedWeather++;return Response.json(weather);}
 forcedVenue++;return Response.json(snapshot(983001,{opening_hours:'Mo 08:00-10:00'}));
}});
assert.equal(forcedWeather,1);assert.equal(forcedVenue,1);assert.equal(forced.hours[0].status,'closed');assert.equal(JSON.stringify(state),original);
const failed=await planConditions(state,day,'https://private.example',state.items[0].id,true,{now,cache:cached(),request:async()=>{throw Error('offline');}});
assert.equal(failed.weatherStatus,'unavailable','A manual failed refresh must not fall back to an older forecast.');
assert.equal(failed.hours[0].status,'unknown');assert.equal(failed.hours[0].hours,undefined,'An unsuccessful explicit source refresh must not retain old hours.');
const emptyForecast=await planConditions(state,day,'https://private.example',undefined,false,{now,cache:cached(at,{}),request:async()=>Response.json({})});assert.equal(emptyForecast.weatherStatus,'unavailable');
const outside=await planConditions(state,day,'https://private.example',undefined,false,{now:now+20*86400000,cache:null,request:()=>{throw Error('Past plan date must not request a forecast.');}});assert.equal(outside.weatherStatus,'outside-range');
assert.equal(JSON.stringify(state),original,'Read-only public source checks cannot change itinerary, approvals, prices or payments.');
console.log('Fresh public venue sources: bounded exact-identity lookups, refresh/cache isolation, removed-tag clearing, source ages/provenance, honest unknown inventory, 24-hour hours expiry, forecast expiry, and failed refresh protection passed.');
