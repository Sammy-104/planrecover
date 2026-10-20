import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {visiblePlanDays,activityTimeZone,addedDraftDay,conciseActivityLocation} from '../lib/planner-interface.ts';
import {tripDays,localDateTime,zonedStart} from '../lib/trip-time.ts';
import {initialState} from '../lib/model.ts';

const days=tripDays('2027-01-01','2027-12-31');
for(const selected of [days[0],days[180],days.at(-1)]){
 const window=visiblePlanDays(days,selected);assert.equal(window.length,7);assert.ok(window.includes(selected));
 assert.equal(new Set(window).size,7);assert.ok(window.every(day=>days.includes(day)));
}
assert.deepEqual(visiblePlanDays(days.slice(0,4),days[0]),days.slice(0,4));
assert.deepEqual(visiblePlanDays([],''),[]);
const plan={timezone:'America/Toronto'},activity={timezone:'Asia/Tokyo'};
const start='2027-01-04T10:30:00+09:00',zone=activityTimeZone(activity,plan);
assert.equal(localDateTime(start,zone),'2027-01-04T10:30');
assert.equal(Date.parse(zonedStart(localDateTime(start,zone),zone)),Date.parse(start));
assert.equal(activityTimeZone({},plan),'America/Toronto');
const beforeBatch=initialState();beforeBatch.plan={...beforeBatch.plan,start:'2027-01-01',end:'2027-01-05',timezone:'America/Toronto'};
const draft=(id,start,timezone)=>({...beforeBatch.items[0],id,start,timezone,status:'draft'});
const tokyoDraft=draft('new-tokyo-stop','2027-01-04T00:30:00+09:00','Asia/Tokyo'),laterDraft=draft('new-later-stop','2027-01-05T12:00:00-05:00');
assert.equal(addedDraftDay(beforeBatch,{...beforeBatch,items:[...beforeBatch.items,tokyoDraft,laterDraft]}),'2027-01-04','A cross-city batch must reveal the first added stop on its own local date, not Toronto’s previous date.');
assert.equal(addedDraftDay(beforeBatch,{...beforeBatch,items:[...beforeBatch.items,draft('fallback-zone','2027-01-04T02:00:00Z')]}),'2027-01-03','An activity without a zone uses the plan timezone.');
assert.equal(addedDraftDay(beforeBatch,{...beforeBatch,items:beforeBatch.items.map(item=>({...item,name:'Updated existing stop'}))}),undefined,'Editing existing stops must not change the selected day.');
assert.equal(addedDraftDay(beforeBatch,{...beforeBatch,items:[...beforeBatch.items,draft('outside-plan','2027-02-01T12:00:00Z')]}),undefined);
assert.equal(addedDraftDay(beforeBatch,{...beforeBatch,plan:{...beforeBatch.plan,id:'another-plan'},items:[tokyoDraft]}),undefined,'A plan switch must not be mistaken for a newly saved batch.');
assert.equal(conciseActivityLocation({location:'In and around Toronto · 4.3 km from centre'}),'In and around Toronto');
assert.equal(conciseActivityLocation({address:'12 Museum Road',location:'Toronto'}),'12 Museum Road');

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),viteRequire=createRequire(require.resolve('vite')),{build}=viteRequire(viteRequire.resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','planner-interface-'));
try{
 const outfile=join(directory,'components.mjs');
 await build({stdin:{contents:"export {PlanSchedule} from './components/plan-schedule';export {ItemDialog} from './app/workbench/plan';export {DateTimeField} from './components/time-field';export {PresenceBar} from './components/presence-bar';",resolveDir:root,loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',jsx:'automatic',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{
  name:'server-render-dialog-shell',setup(builder){builder.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'render-css'}));builder.onLoad({filter:/.*/,namespace:'render-css'},()=>({contents:'',loader:'js'}));builder.onResolve({filter:/^@\/components\/ui\/dialog$/},()=>({path:'dialog-shell',namespace:'render-shell'}));builder.onLoad({filter:/.*/,namespace:'render-shell'},()=>({contents:"import React from 'react';const Shell=({children})=>React.createElement('div',null,children);export const Dialog=Shell,DialogContent=Shell,DialogHeader=Shell,DialogTitle=Shell,DialogDescription=Shell,DialogFooter=Shell;",loader:'js',resolveDir:root}));}
 }]});
 const {PlanSchedule,ItemDialog,DateTimeField,PresenceBar}=await import(pathToFileURL(outfile).href);
 const state=initialState();state.plan.start=days[0];state.plan.end=days.at(-1);state.items=[];state.events=[];state.reminders=[];
 const noop=()=>{},html=renderToStaticMarkup(React.createElement(PlanSchedule,{state,actor:'sam',day:days[180],onDay:noop,busy:false,onMove:async()=>{},onOpen:noop,onAdd:noop,visitorDemo:true}));
 assert.equal((html.match(/<button[^>]+data-drop-day=/g)??[]).length,7);
 assert.match(html,/Jump to plan date/);assert.match(html,/2027-07-0/);
 const original=initialState(),item={...original.items[0],id:'city-zone-activity',name:'Tokyo morning',category:'Activity',timezone:'Asia/Tokyo',start:'2026-10-17T10:30:00+09:00',price:null,paid:[],approvals:[],status:'draft',booking:'unconfirmed',depends:[]};
 const detail=renderToStaticMarkup(React.createElement(ItemDialog,{item,state:{...original,items:[item]},actor:'sam',act:async()=>{},busy:false,onClose:noop,onPay:noop,configured:false})).replaceAll('\u00a0',' ');
 assert.match(detail,/Asia\/Tokyo/);assert.match(detail,/10:30/);assert.match(detail,/Cost, booking &amp; group review/);
 const fields=renderToStaticMarkup(React.createElement(DateTimeField,{value:'2026-10-20T14:30',onChange:noop,'aria-label':'Activity start time'}));
 assert.match(fields,/aria-label="Activity start date"/);assert.match(fields,/aria-label="Activity start time"/);assert.doesNotMatch(fields,/time time/);assert.match(fields,/type="time"[^>]*aria-hidden="true"/);
 const personal={...original,people:[{id:'owner',name:'Owner',role:'owner',color:'#123456',initials:'O'}]};
 assert.equal(renderToStaticMarkup(React.createElement(PresenceBar,{state:personal,actor:'owner',enabled:true,canEdit:true,view:'planner'})),'');
 console.log('Planner interface: bounded long-trip dates, city-zone edit round-trip, concise source location, accessible typed-time fields and quiet solo presence passed.');
}finally{
 if(dirname(directory)!==resolve(root,'build')||!basename(directory).startsWith('planner-interface-'))throw Error('Unexpected test cleanup path.');
 rmSync(directory,{recursive:true,force:true});
}
