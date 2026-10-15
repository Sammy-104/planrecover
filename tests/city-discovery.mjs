import assert from 'node:assert/strict';
import {lookupCity,activitySearchTerms} from '../lib/city-lookup.ts';
import {zonedStart,localDateTime,tripDays,validTripDates} from '../lib/trip-time.ts';
import {initialState,applyAction,financialTrip} from '../lib/model.ts';
import {searchCities,validCitySelection} from '../lib/city-search.ts';

assert.equal(zonedStart('2027-04-04T10:00','Asia/Tokyo'),'2027-04-04T10:00:00+09:00');
assert.equal(zonedStart('2027-04-04T10:00','Asia/Seoul'),'2027-04-04T10:00:00+09:00');
assert.equal(zonedStart('2027-01-04T10:00','America/Toronto'),'2027-01-04T10:00:00-05:00');
assert.equal(zonedStart('2027-07-04T10:00','America/Toronto'),'2027-07-04T10:00:00-04:00');
assert.equal(localDateTime('2027-04-04T01:00:00Z','Asia/Tokyo'),'2027-04-04T10:00');
assert.throws(()=>zonedStart('2027-03-14T02:30','America/Toronto'));
assert.equal(validTripDates('2027-02-30','2027-03-03'),false);
assert.equal(validTripDates('2027-13-01','2027-13-03'),false);
assert.deepEqual(tripDays('2027-04-03','2027-04-06'),['2027-04-03','2027-04-04','2027-04-05','2027-04-06']);

const replies=[{query:{pages:[{title:'Vancouver',description:'City in British Columbia, Canada',coordinates:[{lat:49.26,lon:-123.11}]}]}},{query:{pages:[{pageid:2,title:'Stanley Park',description:'Public park in Vancouver'},{pageid:3,title:'University Museum',description:'University institution'},{pageid:4,title:'City Museum',description:'Museum in Vancouver'}]}}];
const calls=[];
const lookup=await lookupCity('Vancouver',async url=>{calls.push(new URL(url));return Response.json(replies.shift());});
assert.equal(calls[1].searchParams.get('ggscoord'),'49.26|-123.11');
assert.equal(calls[1].searchParams.get('ggsradius'),'10000');
assert.deepEqual(lookup.entries.map(p=>p.name).sort(),['City Museum','Stanley Park']);
assert.equal(lookup.destinationKey,'vancouver');
assert.ok(lookup.entries.every(p=>p.area.includes('Vancouver')&&p.sourceUrl.startsWith('https://en.wikipedia.org/')));
await assert.rejects(()=>lookupCity('Unclear city',async()=>Response.json({query:{pages:[{title:'Unclear city',pageprops:{disambiguation:''},description:'City',coordinates:[{lat:1,lon:2}]}]}})));
const tokyo=await lookupCity('TOKYO, JAPAN',async()=>{throw Error('Curated city should not need a network request');});
assert.equal(tokyo.source,'city-guide');assert.ok(tokyo.entries.length>=5);

const before=initialState(),reset=applyAction(before,{type:'reset',actor:'sam'});
assert.equal(financialTrip(reset,'hike',before.plan.id),reset.archives[0].workspace);
assert.equal(financialTrip(reset,'hike','nonexistent'),undefined);
const features=[
 {properties:{name:'Springfield',state:'Illinois',country:'United States',osm_key:'place',osm_value:'city',osm_type:'N',osm_id:1},geometry:{coordinates:[-89.65,39.78]}},
 {properties:{name:'Springfield',state:'Massachusetts',country:'United States',osm_key:'place',osm_value:'city',osm_type:'N',osm_id:2},geometry:{coordinates:[-72.59,42.1]}},
 {properties:{name:'Shop',country:'United States',osm_key:'shop',osm_value:'mall'},geometry:{coordinates:[0,0]}}
];
const cities=features.slice(0,2).map(f=>{const p=f.properties,label=[p.name,p.state,p.country].join(', ');return validCitySelection({id:`N-${p.osm_id}`,name:p.name,country:p.country,region:p.state,label,latitude:f.geometry.coordinates[1],longitude:f.geometry.coordinates[0]},label);});
const offlineCities=await searchCities('Springfield',async()=>{throw Error('Suggestions must not depend on an external service.');});
assert.ok(offlineCities.some(c=>c.region==='Illinois'));assert.ok(offlineCities.some(c=>c.region==='Massachusetts'));
for(const q of ['Lisbon','Busan','Toronto, Ontario, Canada'])assert.ok((await searchCities(q)).length>0);
assert.ok((await searchCities('Portugal')).every(c=>c.country==='Portugal'));
assert.ok((await searchCities('Toronto'))[0].latitude>43.6&&(await searchCities('Toronto'))[0].latitude<43.8);
assert.equal(validCitySelection(cities[0],'Another city'),undefined);
const chosenLookup=await lookupCity(cities[0].label,async url=>{
 assert.equal(new URL(url).searchParams.get('ggscoord'),'39.78|-89.65');
 return Response.json({query:{pages:[{pageid:8,title:'City Museum',description:'Museum'}]}});
},cities[0]);
assert.equal(chosenLookup.entries[0].area,'In and around Springfield');
const cityTrip=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Springfield trip',destination:cities[0].label,city:cities[0],start:'2027-04-04',end:'2027-04-06',budget:30000}});
assert.deepEqual(cityTrip.plan.city,cities[0]);
console.log('City resolution, geographic matching, time zones and payment trip isolation passed.');

// A keyword search must not accept search operators or attractions in a different city.
const selectedToronto={id:'toronto',name:'Toronto',country:'Canada',region:'Ontario',label:'Toronto, Ontario, Canada',latitude:43.6532,longitude:-79.3832};
const placeReplies=[{query:{pages:[
 {pageid:10,index:1,title:'Royal Ontario Museum',description:'Museum in Toronto',coordinates:[{lat:43.6677,lon:-79.3948}],thumbnail:{source:'https://upload.wikimedia.org/wikipedia/commons/rom.jpg'},pageimage:'ROM.jpg'},
 {pageid:11,index:2,title:'Other City Museum',description:'Museum',coordinates:[{lat:35.7,lon:139.7}]}
]}},{query:{pages:[{title:'File:ROM.jpg',imageinfo:[{descriptionurl:'https://commons.wikimedia.org/wiki/File:ROM.jpg',extmetadata:{Artist:{value:'<a>Jane Photographer</a>'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]}]}}];
const searched=await lookupCity(selectedToronto.label,async url=>{const u=new URL(url);if(u.hostname==='photon.komoot.io')return Response.json({features:[]});if(u.hostname==='overpass.private.coffee')return Response.json({elements:[]});if(u.hostname==='en.wikipedia.org'){assert.ok(u.searchParams.get('gsrsearch').endsWith('nearcoord:20km,43.6532,-79.3832'));assert.equal(u.searchParams.get('pilicense'),'free');}return Response.json(placeReplies.shift());},selectedToronto,'museum nearcoord:1000km,1,2');
assert.deepEqual(searched.entries.map(p=>p.name),['Royal Ontario Museum']);
assert.equal(searched.entries[0].imageCredit,'Jane Photographer');
assert.equal(searched.entries[0].imageLicense,'CC BY-SA 4.0');
const searchState=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Toronto trip',destination:selectedToronto.label,city:selectedToronto,start:'2027-04-04',end:'2027-04-06',budget:30000}});
searchState.recommendations=searched;
const added=applyAction(searchState,{type:'add_suggestion',actor:'sam',suggestionId:'wiki-10',participants:['sam'],start:zonedStart('2027-04-04T10:00','America/Toronto'),duration:60});
assert.equal(added.items[0].imageUrl,searched.entries[0].imageUrl);
assert.equal(added.items[0].latitude,43.6677);
assert.equal(added.items[0].longitude,-79.3948);
assert.equal(added.items[0].price,null);assert.equal(added.events.length,0);
assert.equal(added.items[0].status,'draft');
const noMatch=await lookupCity(selectedToronto.label,async()=>Response.json({query:{pages:[]}}),selectedToronto,'no matching place');assert.deepEqual(noMatch.entries,[]);
console.log('Keyword search, city boundaries, photo attribution and selected activity persistence passed.');

assert.equal(activitySearchTerms('best museums in Lisbon','Lisbon'),'(museum OR gallery)');
assert.ok(activitySearchTerms('cn tow','Toronto').includes('tow*'));
assert.ok(activitySearchTerms('hiking near Busan','Busan').includes('trail OR park'));
const lisbon=(await searchCities('Lisbon'))[0];
const partial=await lookupCity(lisbon.label,async()=>Response.json({query:{pages:[
 {pageid:21,index:1,title:'Lisbon Oceanarium',description:'Oceanarium in Lisbon',coordinates:[{lat:38.7636,lon:-9.0938}]},
 {pageid:22,index:2,title:'Lisbon Palace',description:'Historic palace',coordinates:[{lat:38.72,lon:-9.13}]}
]}}),lisbon,'oceanar');
assert.deepEqual(partial.entries.map(p=>p.name),['Lisbon Oceanarium']);
console.log('Offline worldwide city autocomplete and forgiving activity queries passed.');
