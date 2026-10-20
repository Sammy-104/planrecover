import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {accountPersonId} from '../lib/people.ts';
import {applyAction,initialState} from '../lib/model.ts';
import {localDateTime} from '../lib/trip-time.ts';
import {parseWorkspaceMutation} from '../lib/action-contracts.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const viteRequire=createRequire(require.resolve('vite')),{build}=require(viteRequire.resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});
const temporary=mkdtempSync(join(root,'build','backend-idea-itinerary-'));
const origin='https://planrecover.test',account='idea-plan-owner',person=await accountPersonId(account);
globalThis.ideaItineraryEnv={DB:undefined};
globalThis.fetch=async()=>{throw Error('Live providers are disabled for idea import tests.');};
const ideas=[{id:'idea-one',name:'Visit the gallery',note:'Saved notes '.padEnd(1000,'x'),url:'https://example.test/gallery',done:false},{id:'idea-two',name:'A quiet lunch',note:'Keep this for another plan',done:false},{id:'idea-three',name:'Walk by the lake',note:'Go at our own pace',done:false}];
const plan={kind:'trip',name:'Ideas become activities',destination:'Toronto, Ontario, Canada',start:'2027-03-13',end:'2027-03-14',timezone:'America/Toronto',currency:'CAD',budget:30000};
let checks=0;
const routes={};
function request(path,method='GET',body){return new Request(origin+path,{method,headers:{'oai-authenticated-user-id':account,'oai-authenticated-user-email':'owner@example.test',...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function decoded(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;}
async function check(name,run){const database=createTestD1();globalThis.ideaItineraryEnv.DB=database;try{await run(database);checks++;console.log('PASS '+name);}finally{database.close();}}

try{
 for(const [name,path]of Object.entries({workspace:'app/api/workspace/route.ts',plans:'app/api/plans/route.ts',ideas:'app/api/ideas/route.ts'})){
  const outfile=join(temporary,name+'.mjs');
  await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'idea-test-binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'binding',namespace:'idea-test'}));builder.onLoad({filter:/.*/,namespace:'idea-test'},()=>({contents:'export const env=globalThis.ideaItineraryEnv;',loader:'js'}));}}]});
  routes[name]=await import(pathToFileURL(outfile).href);
 }
 await check('selected saved ideas persist as real draft itinerary activities after creation and reload',async database=>{
  const before=await decoded(await routes.workspace.GET(request('/api/workspace')));
  const library=await decoded(await routes.ideas.POST(request('/api/ideas','POST',{version:0,operation:'save',collection:{id:'collection-one',name:'Weekend ideas',destination:plan.destination,timeframe:'Spring',notes:'Private collection',ideas,updatedAt:''}})));
  const selected=[library.collections[0].ideas[0],library.collections[0].ideas[2]];
  const created=await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:before.state.version,action:{type:'create_trip',actor:'sam',plan:{...plan,planningIdeas:selected}}})));
  const reopened=await decoded(await routes.workspace.GET(request('/api/workspace')));
  assert.deepEqual(reopened.state.items,created.state.items);
  assert.deepEqual(reopened.state.items.map(item=>item.ideaId),['idea-one','idea-three']);
  assert.deepEqual(reopened.state.items.map(item=>item.name),['Visit the gallery','Walk by the lake']);
  assert.equal(reopened.state.items[0].sourceUrl,ideas[0].url);
  assert.equal(reopened.state.items[0].source,'Saved idea: '+ideas[0].note);
  assert.equal(reopened.state.plan.planningIdeas[0].note.length,1000);
  const stored=JSON.parse(database.sqlite.prepare('SELECT body FROM plans WHERE owner=? AND id=?').get(account,created.state.plan.id).body);
  assert.deepEqual(stored.items,created.state.items);
  assert.deepEqual(await decoded(await routes.ideas.GET(request('/api/ideas'))),library,'Import must not delete or complete the private source collection.');
  assert.deepEqual(created.state.archives.find(archive=>archive.workspace.plan.id===before.state.plan.id).workspace.events,before.state.events);
  assert.deepEqual(created.state.events,[]);assert.deepEqual(created.state.receipts,[]);
  assert.deepEqual(created.state.people.map(member=>member.id),[person]);
  for(const item of created.state.items){assert.deepEqual(item.participants,[person]);assert.equal(item.price,null);assert.equal(item.status,'draft');assert.equal(item.booking,'unconfirmed');assert.deepEqual(item.paid,[]);assert.deepEqual(item.approvals,[]);assert.deepEqual(item.shares,{});assert.equal(item.duration,30);}
 });
 await check('provisional local slots preserve each date and the daylight-saving offset',async()=>{
  const created=await decoded(await routes.plans.POST(request('/api/plans','POST',{plan:{...plan,planningIdeas:[ideas[0],ideas[2]]}})),201);
  assert.equal(created.state.items[0].start,'2027-03-13T09:00:00-05:00');
  assert.equal(created.state.items[1].start,'2027-03-14T09:00:00-04:00');
  assert.deepEqual(created.state.items.map(item=>item.participants),[[person],[person]]);
 });
 await check('city stays give copied activities the day’s correct location and zone',async()=>{
  const city=(id,name,latitude,longitude)=>({id,name,region:name==='Toronto'?'Ontario':'British Columbia',country:'Canada',label:name+', Canada',latitude,longitude});
  const created=await decoded(await routes.plans.POST(request('/api/plans','POST',{plan:{...plan,start:'2027-05-01',end:'2027-05-02',planningIdeas:[ideas[0],ideas[2]],stays:[{id:'toronto-stay',city:city('toronto','Toronto',43.65,-79.38),start:'2027-05-01',end:'2027-05-01',timezone:'America/Toronto',kind:'stay',note:''},{id:'vancouver-stay',city:city('vancouver','Vancouver',49.28,-123.12),start:'2027-05-02',end:'2027-05-02',timezone:'America/Vancouver',kind:'stay',note:''}]}})),201);
  const [first,second]=created.state.items;
  assert.equal(first.stayId,'toronto-stay');assert.equal(second.stayId,'vancouver-stay');
  assert.equal(second.location,'Vancouver, Canada');assert.equal(second.timezone,'America/Vancouver');
  assert.equal(localDateTime(second.start,second.timezone),'2027-05-02T09:00');
 });
 await check('oversized selections fail explicitly and atomically without losing selected ideas',async()=>{
  const before=await decoded(await routes.workspace.GET(request('/api/workspace')));
  const tooMany=Array.from({length:25},(_,index)=>({id:'idea-'+index,name:'Saved idea '+index,note:''}));
  const failed=await decoded(await routes.workspace.POST(request('/api/workspace','POST',{version:before.state.version,action:{type:'create_trip',actor:'sam',plan:{...plan,kind:'day-out',end:plan.start,planningIdeas:tooMany}}})),400);
  assert.match(failed.error,/24 ideas per plan day/);
  assert.deepEqual((await decoded(await routes.workspace.GET(request('/api/workspace')))).state,before.state);
 });
 await check('empty selection creates no activities and invalid idea links cannot enter a plan',async()=>{
  const empty=await decoded(await routes.plans.POST(request('/api/plans','POST',{plan:{...plan,planningIdeas:[]}})),201);
  assert.deepEqual(empty.state.items,[]);
  assert.throws(()=>applyAction(initialState(),{type:'create_trip',actor:'sam',plan:{...plan,planningIdeas:[{...ideas[0],url:'javascript:alert(1)'}]}}),/https/);
 });
 await check('clients cannot override the server-selected founder or smuggle extra idea data',async()=>{
  assert.throws(()=>parseWorkspaceMutation({version:0,action:{type:'create_trip',actor:'sam',_creatorId:'someone-else',plan}}));
  assert.throws(()=>parseWorkspaceMutation({version:0,action:{type:'create_trip',actor:'sam',plan:{...plan,planningIdeas:[{...ideas[0],price:1}]}}}));
 });
 console.log(`${checks} idea-to-itinerary persistence checks passed.`);
}finally{delete globalThis.ideaItineraryEnv;rmSync(temporary,{recursive:true,force:true});}
