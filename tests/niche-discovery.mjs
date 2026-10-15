import assert from 'node:assert/strict';
import {lookupCity,activitySearchTerms} from '../lib/city-lookup.ts';
import {osmQuery} from '../lib/osm-places.ts';
import {CITY_CATALOG_LIMIT,DISCOVERY_VERSION,discoveryCollections,discoveryCollection,matchesDiscoverySearch} from '../lib/discovery.ts';
import {searchCities} from '../lib/city-search.ts';
import {initialState,applyAction} from '../lib/model.ts';
const city=(await searchCities('Toronto'))[0],point={lat:city.latitude,lon:city.longitude};
const nicheTags=[{amenity:'cafe'},{shop:'bakery'},{amenity:'marketplace'},{leisure:'escape_game'},{leisure:'amusement_arcade'},{leisure:'sports_centre',sport:'climbing;bouldering'},{leisure:'bowling_alley'},{leisure:'miniature_golf'},{leisure:'ice_rink'},{amenity:'music_venue'},{shop:'antiques'},{shop:'books'},{shop:'music'},{shop:'craft'},{leisure:'garden'},{tourism:'viewpoint'},{tourism:'artwork'},{leisure:'swimming_pool'},{historic:'ruins'},{historic:'castle'},{amenity:'place_of_worship'},{leisure:'nature_reserve'},{natural:'waterfall'},{natural:'cave_entrance'},{leisure:'playground'},{tourism:'aquarium'},{tourism:'theme_park'},{amenity:'cinema'},{leisure:'sauna'},{leisure:'stadium'}];
const venues=nicheTags.map((tags,i)=>({type:'node',id:8000+i,lat:point.lat+.005,lon:point.lon+.001*i,tags:{name:`Local venue ${i}`, ...tags}}));
const restaurants=Array.from({length:2200},(_,i)=>({type:'node',id:10000+i,lat:point.lat,lon:point.lon,tags:{name:`Restaurant ${i}`,amenity:'restaurant'}}));
const museums=Array.from({length:800},(_,i)=>({pageid:20000+i,title:`Local Museum ${i}`,description:'Museum in Toronto',coordinates:[{lat:point.lat,lon:point.lon}]}));
const queryLog=[];
const request=async(url,options)=>{
 if(new URL(url).hostname==='overpass.private.coffee'){queryLog.push(new URLSearchParams(options.body).get('data'));return Response.json({elements:[...restaurants,...venues,venues[3],{...venues[3],id:9000,tags:{...venues[3].tags,access:'private'}},{...venues[5],id:9001,lat:0,lon:0}]});}
 return Response.json({query:{pages:museums}});
};
const catalog=await lookupCity(city.label,request,city);
assert.equal(catalog.discoveryVersion,DISCOVERY_VERSION);
assert.equal(catalog.entries.length,CITY_CATALOG_LIMIT,'A broad catalog can retain more than the former 500-place cap');
for(const c of discoveryCollections){
 assert.ok(catalog.entries.slice(0,48).some(p=>p.tags.includes(c.label)),`${c.label} remains visible on the first page`);
 assert.equal(discoveryCollection(c.label,city.name)?.id,c.id);
 const result=await lookupCity(city.label,request,city,c.label);
 assert.ok(result.entries.length>=1,`${c.label} returns its mapped venue even when its name says nothing about the activity`);
 assert.ok(result.entries.every(p=>p.tags.includes(c.label)), 'Focused collections exclude unrelated venue types');
 assert.ok(result.entries[0].tags.includes(c.label));
 assert.ok(queryLog.at(-1).includes('out center body 500;'),'One-tap collections run their own focused query');
}
assert.equal(catalog.entries.filter(p=>p.id==='osm-node-8003').length,1,'Repeated category outputs do not create duplicate pins');
assert.ok(!catalog.entries.some(p=>['osm-node-9000','osm-node-9001'].includes(p.id)));
assert.equal(discoveryCollection('Escape Room Cafe',city.name),undefined,'Named places are not mistaken for categories');
assert.equal(discoveryCollection('Bowling','Bowling Green').id,'bowling','A collection still works when its words are also in the city name');
assert.equal(discoveryCollection('bouldering in Toronto','Toronto').id,'climbing');
assert.ok(activitySearchTerms('escape rooms',city.name).includes('escape game'));
assert.ok(osmQuery(point).includes('out center body 90;'),'Niche types have dedicated browsing quotas');
assert.ok(osmQuery(point,'records').includes('["shop"~"^(music|musical_instrument)$"]'));
assert.ok(!osmQuery(point,'records').includes('["amenity"="cafe"]'));
assert.equal(matchesDiscoverySearch({name:'The Vault',description:'Escape room. Check the source.',tags:['Entertainment']},'Escape rooms',city.name),true,'Older real cached places remain identifiable during an outage');
assert.equal(matchesDiscoverySearch({name:'Cafe',description:'A local cafe',tags:['Food']},'Escape rooms',city.name),false);
let alternateUsed=false;
const alternate=await lookupCity(city.label,async url=>{const host=new URL(url).hostname;if(host==='overpass.private.coffee')return new Response('Temporarily down',{status:503});if(host==='maps.mail.ru'){alternateUsed=true;return Response.json({elements:venues});}return Response.json({query:{pages:[]}});},city,'escape rooms');
assert.ok(alternateUsed);assert.equal(alternate.entries.length,1);assert.equal(alternate.sourcesUnavailable,false);assert.equal(alternate.entries[0].latitude,venues[3].lat);
const craft=catalog.entries.find(p=>p.id==='osm-node-8013');assert.ok(craft.description.includes('supply shop'));assert.ok(!craft.description.includes('workshop'));
const escape=catalog.entries.find(p=>p.id==='osm-node-8003');
let state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Explore Toronto',destination:city.label,city,start:'2027-04-04',end:'2027-04-04',budget:30000}});state.recommendations=catalog;
state=applyAction(state,{type:'add_suggestion',actor:'sam',suggestionId:escape.id,participants:['sam'],start:'2027-04-04T10:00:00-04:00',duration:60});
assert.equal(state.items[0].latitude,escape.latitude);assert.equal(state.items[0].longitude,escape.longitude);assert.equal(state.events.length,0);assert.equal(state.items[0].status,'draft');
console.log('Niche discovery: 1,800-place coverage, all 30 collections in the first 48 places, focused type lookup without venue names, duplicate/bounds/access filtering, honest venue descriptions and preserved itinerary pins passed.');
