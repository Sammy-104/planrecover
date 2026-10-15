import assert from 'node:assert/strict';
import {searchCities,validCitySelection} from '../lib/city-search.ts';
import {lookupCity} from '../lib/city-lookup.ts';
import {osmQuery} from '../lib/osm-places.ts';
import {discoveryCollections,CITY_CATALOG_LIMIT} from '../lib/discovery.ts';

// A settlement outside the bundled index still gets a selectable, sourced location.
let geocoderCalls=0;
const feature=(id,name,key='place',value='village',coordinates=[11.1,43.9])=>({properties:{osm_type:'N',osm_id:id,osm_key:key,osm_value:value,name,country:'Italy',state:'Tuscany'},geometry:{type:'Point',coordinates}});
const [villages,shared]=await Promise.all([1,2].map(()=>searchCities('Unindexed Settlement Test',async url=>{
 geocoderCalls++;const u=new URL(url);assert.equal(u.hostname,'photon.komoot.io');assert.ok(u.searchParams.getAll('osm_tag').includes('place:village'));
 return Response.json({features:[feature(77,'Small village'),feature(77,'Small village'),feature(78,'A shop','shop','books'),feature(79,'Invalid location','place','town',[190,95]),feature(80,'Another village')]});
})));
assert.equal(geocoderCalls,1,'Concurrent rare-town searches share the provider request');
assert.deepEqual(villages.map(c=>c.id),['osm-node-77','osm-node-80']);assert.deepEqual(shared,villages);
assert.ok(validCitySelection(villages[0],villages[0].label));
assert.deepEqual(await searchCities('Unindexed Offline Town',async()=>{throw Error('offline');}),[],'An unavailable fallback does not break city suggestions');
assert.ok((await searchCities('Tokyo',async()=>{throw Error('Common cities stay offline-capable');})).length);

// The same coordinate-based catalog works across continents without English articles or hand-written city guides.
const destinations=['Nairobi','Bangkok','São Paulo','Sydney','Lisbon','Toronto'];
for(const name of destinations){
 const city=(await searchCities(name))[0];assert.ok(city,name);
 const result=await lookupCity(city.label,async(url,options)=>{
  const host=new URL(url).hostname;
  if(host==='overpass.private.coffee'){
   const q=new URLSearchParams(options.body).get('data');assert.ok(q.includes(`around:20000,${city.latitude},${city.longitude}`));
   return Response.json({elements:[
    {type:'way',id:8101,center:{lat:city.latitude+.003,lon:city.longitude},tags:{name:'地元の映画館',amenity:'cinema'}},
    {type:'node',id:8102,lat:city.latitude+.005,lon:city.longitude,tags:{name:'Local sauna',leisure:'sauna'}},
    {type:'relation',id:8103,center:{lat:city.latitude+.007,lon:city.longitude},tags:{name:'Local nature reserve',boundary:'national_park'}},
    {type:'node',id:8104,lat:city.latitude+.009,lon:city.longitude,tags:{name:'Local waterfall',natural:'waterfall'}},
    {type:'node',id:8105,lat:city.latitude+.009,lon:city.longitude,tags:{name:'Private bath',amenity:'public_bath',access:'private'}}
   ]});
  }
  throw Error('No English Wikipedia article');
 },city);
 assert.equal(result.entries.length,4,`${name} discovers mapped venues without an article`);
 for(const type of ['Cinemas','Spas & saunas','Nature reserves','Waterfalls'])assert.ok(result.entries.some(p=>p.tags.includes(type)),`${name}: ${type}`);
 assert.equal(result.entries.find(p=>p.id==='osm-way-8101').latitude,city.latitude+.003,'Building coordinates reach the catalog');
 assert.equal(result.entries.find(p=>p.id==='osm-relation-8103').longitude,city.longitude);
}
const query=osmQuery({lat:43.65,lon:-79.38},'Museums','Toronto');
assert.ok(query.includes('node.venues;out center body 500;way.venues;out center body 500;relation.venues;out center body 100;'),'Dense cities reserve space for points, buildings and larger mapped sites separately');
const native=await lookupCity(villages[0].label,async(url)=>{
 if(new URL(url).hostname==='overpass.private.coffee')return Response.json({elements:[{type:'node',id:901,lat:43.9,lon:11.1,tags:{name:'Native venue','name:ja':'小さな博物館',tourism:'museum'}}]});
 throw Error('Other sources offline');
},villages[0],'小さな博物館');
assert.equal(native.entries[0].id,'osm-node-901','Named discovery matches multilingual mapped names');
assert.equal(discoveryCollections.length,30);assert.equal(CITY_CATALOG_LIMIT,1800);
console.log('Worldwide discovery: six continents/regions, 30 venue types, smaller settlements, native names, mapped building/site coordinates, provider outages and separate geometry quotas passed.');
