import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
const origin='https://planrecover.test',owner='history-owner',identity={id:await accountPersonId(owner),name:'History owner'};
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-history-'));
const database=createTestD1();globalThis.historyTestEnv={DB:database};let calls=0,checks=0;
globalThis.fetch=async()=>{calls++;throw Error('History cannot contact a provider.');};
try{
 const outfile=join(directory,'route.mjs');await build({entryPoints:[resolve(root,'app/api/plans/[planId]/financial-history/route.ts')],outfile,bundle:true,
  platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'workers',setup(b){
   b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.historyTestEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(outfile).href),repository=new PlanRepository(database),record=await repository.createPlan(owner,identity,
  {name:'History pagination',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
 const planId=record.state.plan.id,context={params:Promise.resolve({planId})},at='2026-10-14T12:00:00Z';
 for(let index=0;index<6;index++){
  await database.prepare('INSERT INTO financial_event_history(id,owner,plan_id,event_id,fingerprint,status,body,recorded) VALUES (?,?,?,?,?,?,?,?)')
   .bind(`history-${index}`,owner,planId,`event-${index}`,`fingerprint-${index}`,'confirmed',JSON.stringify({id:`event-${index}`,amount:index}),at).run();
  await database.prepare('INSERT INTO approval_revisions(owner,plan_id,item_id,revision,snapshot,created) VALUES (?,?,?,?,?,?)')
   .bind(owner,planId,'same-item',index,JSON.stringify({id:'same-item',revision:index}),at).run();
 }
 const snapshot=()=>Object.fromEntries(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,database.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row=>({...row}))]));
 const before=snapshot();
 const get=async(query='',account=owner,status=200)=>{
  const response=await route.GET(new Request(`${origin}/api/plans/${planId}/financial-history${query}`,{headers:account?{'oai-authenticated-user-id':account}:{}}),context),data=await response.json();
  assert.equal(response.status,status,JSON.stringify(data));if(status===200)assert.match(response.headers.get('cache-control'),/private, no-store/);return data;};
 const ids=[],revisions=[];let query='?limit=2';
 for(let page=0;page<3;page++){
  const data=await get(query);assert.equal(data.events.length,2);assert.equal(data.approvals.length,2);
  ids.push(...data.events.map(event=>event.eventId));revisions.push(...data.approvals.map(approval=>approval.revision));
  if(page<2){assert.ok(data.pagination.eventsAfter&&data.pagination.approvalsAfter);query='?'+new URLSearchParams({limit:'2',eventsAfter:data.pagination.eventsAfter,approvalsAfter:data.pagination.approvalsAfter});}
  else assert.deepEqual(data.pagination,{eventsAfter:null,approvalsAfter:null});
 }
 assert.deepEqual(ids,Array.from({length:6},(_,i)=>`event-${i}`));assert.deepEqual(revisions,[0,1,2,3,4,5]);checks++;console.log('PASS Keyset history pages retain every same-time event and approval revision without duplicates');
 for(const query of ['?limit=0','?limit=101','?limit=2.5','?eventsAfter=bad','?approvalsAfter=bad','?owner=other'])await get(query,owner,400);
 checks++;console.log('PASS Malformed page limits, cursors and identity overrides are rejected');
 await get('',null,401);await get('','outsider',404);assert.deepEqual(snapshot(),before);assert.equal(calls,0);
 checks++;console.log('PASS History reads and rejected outsider requests leave every database table unchanged');
 console.log(`${checks} financial history route checks passed.`);
}finally{database.close();rmSync(directory,{recursive:true,force:true});delete globalThis.historyTestEnv;}
