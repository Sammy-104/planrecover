import assert from 'node:assert/strict';
import {placeDetails} from '../lib/place-details.ts';
const claim=(value,rank='normal')=>({rank,mainsnak:{snaktype:'value',datavalue:{value}}});
const page={pageid:10,title:'Royal Ontario Museum',coordinates:[{lat:43.66,lon:-79.39}],pageprops:{wikibase_item:'Q10'},pageimage:'Old_ROM.jpg',thumbnail:{source:'https://upload.wikimedia.org/wikipedia/commons/old.jpg'}};
const calls=[];
const result=await placeDetails([page,{...page,title:'Museum entrance'}],async url=>{
 const u=new URL(url);calls.push(u);
 if(u.hostname==='www.wikidata.org')return Response.json({entities:{Q10:{claims:{P625:[claim({latitude:1,longitude:1,globe:'http://www.wikidata.org/entity/Q2'},'deprecated'),claim({latitude:43.6677123,longitude:-79.3948123,precision:.000001,globe:'http://www.wikidata.org/entity/Q2'},'preferred')]}}}});
 assert.equal(u.searchParams.get('redirects'),'1');assert.equal(u.searchParams.get('iiurlwidth'),'640');
 return Response.json({query:{normalized:[{from:'File:Old_ROM.jpg',to:'File:Old ROM.jpg'}],redirects:[{from:'File:Old ROM.jpg',to:'File:New ROM.jpg'}],pages:[{title:'File:New ROM.jpg',imageinfo:[{thumburl:'https://upload.wikimedia.org/wikipedia/commons/new.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:New_ROM.jpg',extmetadata:{Artist:{value:'<a>Photographer</a>'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]}]}});
});
assert.equal(result.details.get(page.title).latitude,43.6677123,'Use the exact entity’s precise current coordinate');
assert.equal(result.details.get(page.title).longitude,-79.3948123);
assert.equal(result.details.get(page.title).locationPrecision,.000001);
assert.equal(result.details.get(page.title).imageUrl,'https://upload.wikimedia.org/wikipedia/commons/new.jpg','Renamed image files keep their photos');
assert.equal(result.details.get('Museum entrance').imageUrl,result.details.get(page.title).imageUrl,'Shared files supply every matching place');
assert.equal(result.details.get(page.title).imageCredit,'Photographer');assert.equal(calls.length,2);
const alternate=await placeDetails([{title:'CN Tower',pageprops:{wikibase_item:'Q11'}}],async url=>{
 const u=new URL(url);
 if(u.hostname==='www.wikidata.org')return Response.json({entities:{Q11:{claims:{P18:[claim('CN Tower photo.jpg')]}}}});
 assert.equal(u.searchParams.get('titles'),'File:CN Tower photo.jpg');
 return Response.json({query:{pages:[{title:'File:CN Tower photo.jpg',imageinfo:[{thumburl:'https://upload.wikimedia.org/wikipedia/commons/tower.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:CN_Tower_photo.jpg',extmetadata:{LicenseShortName:{value:'Public domain'}}}]}]}});
});
assert.ok(alternate.details.get('CN Tower').imageUrl,'A place without a page thumbnail uses its own alternate source image');
assert.equal(alternate.details.get('CN Tower').imageCredit,'Wikimedia Commons');
const ambiguous=await placeDetails([page],async url=>new URL(url).hostname==='www.wikidata.org'?Response.json({entities:{Q10:{claims:{P625:[claim({latitude:43.6,longitude:-79.3,globe:'http://www.wikidata.org/entity/Q2'}),claim({latitude:43.9,longitude:-79.8,globe:'http://www.wikidata.org/entity/Q2'})]}}}}):Response.json({query:{pages:[]}}));
assert.equal(ambiguous.details.get(page.title).latitude,43.66,'A multi-site entity must not select an arbitrary branch');
const missing=await placeDetails([{title:'No photo'}],async()=>{throw Error('No unrelated image searches');});assert.equal(missing.details.get('No photo').photoStatus,'unavailable');
const offline=await placeDetails([page],async()=>{throw Error('offline');});assert.equal(offline.details.get(page.title).photoStatus,'retry');assert.equal(offline.details.get(page.title).latitude,43.66);
console.log('Precise current place coordinates, image redirects, shared-file matching, alternate place photos, attribution and outage handling passed.');

const coarse=await placeDetails([page],async url=>new URL(url).hostname==='www.wikidata.org'?Response.json({entities:{Q10:{claims:{P625:[claim({latitude:43.7,longitude:-79.4,precision:.1,globe:'http://www.wikidata.org/entity/Q2'})]}}}}):Response.json({query:{pages:[]}}));
assert.equal(coarse.details.get(page.title).latitude,43.66,'A coarse entity centre must not replace a venue coordinate');
