import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {initialState,applyAction,tripCatalog} from '../lib/model.ts';
import {evaluateInsertion,bestSuggestionSlot} from '../lib/suggestion-planning.ts';
import {mappedPlaceInfo,placeDetailsSourceLabel,PLACE_INFO_FRESHNESS_MS} from '../lib/place-info.ts';
import {cityKey} from '../lib/cities.ts';

const now=Date.now(),day='2027-04-04',actor='sam';
const state=applyAction(initialState(),{type:'create_trip',actor,plan:{name:'Suggestion public source checks',destination:'Toronto, Canada',start:day,end:day,timezone:'America/Toronto',budget:30000}});
const venue={id:'osm-node-883001',name:'Public source fixture',category:'Activity',area:'Toronto',description:'Synthetic venue source',sourceUrl:'https://www.openstreetmap.org/node/883001',sourceLabel:'OpenStreetMap',tags:[],latitude:43.66771,longitude:-79.39491,wikidataId:'Q649250',...mappedPlaceInfo({opening_hours:'24/7'},'https://www.openstreetmap.org/node/883001',now)};
state.recommendations={destinationKey:cityKey(state.plan.destination),resolvedCity:'Toronto',fetchedAt:new Date(now).toISOString(),source:'open-places',entries:[venue]};
const suggestion=tripCatalog(state).find(place=>place.id===venue.id),options={actor,participants:[actor],day,start:day+'T12:00:00-04:00',duration:60,buffer:0};
assert.equal(evaluateInsertion(state,suggestion,options).hours,'fits');
for(const changed of [
 {detailsCheckedAt:new Date(now-25*3600000).toISOString(),detailsExpiresAt:new Date(now+3600000).toISOString()},
 {detailsExpiresAt:new Date(now-1).toISOString()},
 {detailsCheckedAt:new Date(now+600000).toISOString()},
 {detailsProvenance:undefined,detailsSnapshotComplete:undefined},
 {detailsProvenance:'community-knowledge',detailsSnapshotComplete:undefined},
 {detailsDataAsOf:new Date(now-25*3600000).toISOString()},
])assert.equal(evaluateInsertion(state,{...suggestion,...changed},options).hours,'unknown','Expired, future, partial or lagging sources cannot prove insertion hours.');
const closed={...suggestion,openingHours:'Su 08:00-10:00'};
assert.equal(evaluateInsertion(state,closed,options).hours,'closed');
assert.equal(evaluateInsertion(state,{...closed,detailsExpiresAt:new Date(now-1).toISOString()},options).hours,'unknown','Stale closures must not block a new insertion.');
const noonOnly={...suggestion,openingHours:'Su 12:00-13:00'};
assert.match(bestSuggestionSlot(state,noonOnly,actor,day).start,/T12:00/);
assert.match(bestSuggestionSlot(state,{...noonOnly,detailsExpiresAt:new Date(now-1).toISOString()},actor,day).start,/T09:00/,'Stale hours must not seed preferred visit times.');
assert.equal(placeDetailsSourceLabel({detailsSourceUrl:'https://www.wikidata.org/wiki/Q649250'}),'Wikidata community source');
assert.equal(placeDetailsSourceLabel({detailsSourceUrl:'https://www.openstreetmap.org/node/883001'}),'OpenStreetMap community source');
assert.equal(placeDetailsSourceLabel({detailsSourceUrl:'https://example.org/?wikidata.org'}),'Public venue source');

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
const outfile=resolve(root,'build','suggestion-source-freshness-'+crypto.randomUUID()+'.mjs');mkdirSync(resolve(root,'build'),{recursive:true});
try{
 await build({stdin:{contents:"export {suggestionPreview} from './lib/suggestion-preview';",resolveDir:root,loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'offline-routing',setup(build){build.onResolve({filter:/^\.\/routed-travel$/},()=>({path:'offline-routing',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function cachedTravelRoute(){throw Error("This fixture must not invoke an external routing service.");}',loader:'js'}));}}]});
 const {suggestionPreview}=await import(pathToFileURL(outfile).href);
 const body={suggestionId:venue.id,participants:[actor],start:options.start,duration:60,buffer:0};
 const existing=JSON.stringify(state),cached=await suggestionPreview(state,body,actor,'https://private.example',undefined,{request:()=>{throw Error('A fresh complete catalog snapshot must not refresh.');}});
 assert.equal(cached.evaluation.hours,'fits');assert.equal(cached.details.detailsSnapshotComplete,true);assert.equal(JSON.stringify(state),existing);
 const legacy=structuredClone(state);Object.assign(legacy.recommendations.entries[0],{openingHours:'Su 08:00-10:00',detailsCheckedAt:new Date(now).toISOString(),detailsProvenance:undefined,detailsSnapshotComplete:undefined,detailsExpiresAt:undefined,detailsSourceUrl:'https://www.wikidata.org/wiki/Q649250'});
 let calls=0;
 const refreshed=await suggestionPreview(legacy,body,actor,'https://private.example',undefined,{request:async(url)=>{
  calls++;if(new URL(url).hostname==='www.wikidata.org')return Response.json({entities:{Q649250:{id:'Q649250',modified:new Date(now).toISOString(),claims:{}}}});
  return Response.json({osm3s:{timestamp_osm_base:new Date(now).toISOString()},elements:[{type:'node',id:883001,timestamp:'2026-01-01T00:00:00Z',tags:{opening_hours:'24/7',wikidata:'Q649250'}}]});
 }});
 assert.ok(calls>0,'A recent website-only timestamp must not suppress current venue lookup.');assert.equal(refreshed.evaluation.hours,'fits');assert.equal(refreshed.details.detailsProvenance,'community-map');assert.equal(refreshed.details.detailsLiveInventoryVerified,false);assert.ok(Date.parse(refreshed.details.detailsExpiresAt)>now);assert.ok(Date.parse(refreshed.details.detailsExpiresAt)<=Date.now()+PLACE_INFO_FRESHNESS_MS);
 const failed=structuredClone(legacy);Object.assign(failed.recommendations.entries[0],{id:'osm-node-883002',sourceUrl:'https://www.openstreetmap.org/node/883002',wikidataId:undefined});
 const unknown=await suggestionPreview(failed,{...body,suggestionId:'osm-node-883002'},actor,'https://private.example',undefined,{request:async()=>{throw Error('offline');}});
 assert.equal(unknown.evaluation.hours,'unknown');assert.equal(unknown.details.openingHours,undefined);assert.equal(unknown.evaluation.total,null);assert.equal(failed.events.length,0);assert.deepEqual(failed.items,[]);
}finally{try{unlinkSync(outfile);}catch{}}
console.log('Suggestion source freshness: fresh-only insertion hours and slot seeds, bounded current public snapshots, legacy timestamp refresh, source labels, failed refresh clearing, and unchanged financial state passed.');
