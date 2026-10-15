import assert from 'node:assert/strict';
import {entityPopularity,mappedPopularity,popularityScore,sortDiscovery} from '../lib/place-popularity.ts';
import {placeDetails} from '../lib/place-details.ts';
import {mergePlaces} from '../lib/osm-places.ts';
import {initialState,applyAction,tripCatalog} from '../lib/model.ts';
import {cityKey} from '../lib/cities.ts';

const sitelinks={enwiki:{url:'https://en.wikipedia.org/wiki/Museum'},frwiki:{url:'https://fr.wikipedia.org/wiki/Mus%C3%A9e'},commonswiki:{url:'https://commons.wikimedia.org/wiki/Museum'},enwikivoyage:{url:'https://en.wikivoyage.org/wiki/Museum'}};
const details=await placeDetails([{title:'City Museum',pageprops:{wikibase_item:'Q123'}}],async url=>{
 const u=new URL(url);assert.equal(u.searchParams.get('props'),'claims|sitelinks/urls');
 return Response.json({entities:{Q123:{sitelinks}}});
});
assert.equal(details.details.get('City Museum').popularityCoverage,2,'Recognition counts Wikipedia editions, excluding Commons and travel guides');
assert.equal(entityPopularity({id:'wrong',sitelinks}).popularityCoverage,undefined);
assert.equal(popularityScore({popularityCoverage:-1}),undefined);
assert.equal(popularityScore({popularityCoverage:'99'}),undefined);

const place=(id,name,extra={})=>({id,name,category:'Activity',area:'Toronto',description:'Museum',sourceUrl:'https://www.openstreetmap.org/node/123',sourceLabel:'OpenStreetMap',tags:['Museums'],latitude:43.65,longitude:-79.38,...extra});
const unknown=place('small','Small local museum'),near=place('near','Nearby museum',{popularityCoverage:2}),famous=place('famous','Well known museum',{popularityCoverage:50,latitude:43.69});
const places=[unknown,near,famous];
assert.deepEqual(sortDiscovery(places,'popular').map(p=>p.id),['famous','near','small'],'Popularity changes the first result instead of only changing the label');
assert.deepEqual(places.map(p=>p.id),['small','near','famous'],'Sorting never mutates the saved catalog');
assert.deepEqual(sortDiscovery(places,'nearest',{latitude:43.65,longitude:-79.38}).map(p=>p.id),['small','near','famous']);
assert.equal(sortDiscovery(places,'relevance',undefined,'Small local museum')[0].id,'small','An exact niche query outranks a more famous unrelated place');
assert.deepEqual(sortDiscovery([unknown,{...near,popularityCoverage:undefined}], 'popular').map(p=>p.id),['small','near'],'Unavailable popularity preserves usable browse order');

const merged=mergePlaces([[{...near,wikidataId:'Q123'}],[{...near,id:'wiki-123',wikidataId:'Q123',...details.details.get('City Museum')}]]);
assert.equal(merged.length,1);assert.equal(merged[0].popularityCoverage,2);assert.equal(merged[0].latitude,near.latitude,'Ranking enrichment keeps mapped coordinates');
const mapped=await mappedPopularity([{...unknown,wikidataId:'Q456'}],async url=>{assert.equal(new URL(url).searchParams.get('ids'),'Q456');return Response.json({entities:{Q456:{sitelinks}}});});
assert.equal(mapped[0].popularityCoverage,2,'Mapped places without an English article also get recognition data');
assert.equal((await mappedPopularity([{...unknown,wikidataId:'Q456'}],async()=>{throw Error('offline');}))[0].id,unknown.id,'A ranking outage cannot remove a place');

const state=applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{name:'Toronto',destination:'Toronto, Canada',start:'2027-04-04',end:'2027-04-06',budget:30000}});
state.recommendations={destinationKey:cityKey(state.plan.destination),resolvedCity:'Toronto',source:'open-places',fetchedAt:new Date().toISOString(),entries:[...places,...merged]};
assert.equal(tripCatalog(state).find(c=>c.id==='famous').popularityCoverage,50,'Saved recommendation metadata reaches the displayed cards');
assert.equal(sortDiscovery(tripCatalog(state),'popular')[0].id,'famous');
console.log('Popularity ordering, recognition provenance, niche query relevance, catalog persistence, mapped coordinates and outage fallback passed.');
