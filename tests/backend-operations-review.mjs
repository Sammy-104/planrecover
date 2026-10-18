import assert from 'node:assert/strict';
import {createTestD1} from './helpers/d1.mjs';
import {runScheduledOwners} from '../lib/scheduled-owners.ts';
import {backgroundHealth,planOperationsQueue} from '../lib/operations-health.ts';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';

const database=createTestD1();let checks=0;
async function check(name,run){await run();checks++;console.log('PASS '+name);}
try{
 await check('Scheduled batches process multiple owners with leases, cooldowns and bounded concurrency',async()=>{
  const now=Date.parse('2027-04-04T12:00:00Z');
  for(let i=1;i<=8;i++)await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,0,?)').bind(`owner-${i}`,'{}',new Date(now).toISOString()).run();
  await database.prepare("INSERT INTO background_job_runs(owner,next_at) VALUES ('owner-7',?)").bind(now+60000).run();
  await database.prepare("INSERT INTO background_job_runs(owner,lease_until) VALUES ('owner-8',?)").bind(now+60000).run();
  let active=0,peak=0;const called=[];
  const run=async owner=>{active++;peak=Math.max(peak,active);called.push(owner);await Promise.resolve();await database.prepare("INSERT INTO background_job_runs(owner,last_started,last_completed,next_at,status) VALUES (?,?,?,?,'completed') ON CONFLICT(owner) DO UPDATE SET last_started=excluded.last_started,last_completed=excluded.last_completed,next_at=excluded.next_at,status='completed'").bind(owner,new Date(now).toISOString(),new Date(now).toISOString(),now+60000).run();active--;if(owner==='owner-2')throw Error('Private fixture details');return {status:'completed'};};
  const first=await runScheduledOwners(database,run,{now:()=>now,maxOwners:3,concurrency:2});assert.equal(first.processed,3);assert.equal(first.eligibleAtStart,6);assert.equal(first.deferred,3);assert.equal(first.results.filter(r=>r.status==='retry-required').length,1);assert.ok(peak<=2);assert.ok(!JSON.stringify(first).includes('Private fixture'));
  const second=await runScheduledOwners(database,run,{now:()=>now,maxOwners:25,concurrency:2});assert.equal(second.processed,3);assert.equal(new Set(called).size,6);assert.ok(!called.includes('owner-7')&&!called.includes('owner-8'));
 });
 await check('A bounded start budget leaves unstarted owners for a later run',async()=>{
  let now=Date.parse('2027-04-04T14:00:00Z');const start=now;
  const result=await runScheduledOwners(database,async()=>{now+=45000;return {status:'completed'};},{now:()=>now,maxOwners:5,concurrency:1,startBudgetMs:45000});
  assert.equal(result.processed,1);assert.equal(result.deferred,7);assert.equal(result.selectedBatchDeferred,4);assert.equal(now,start+45000);
 });
 await check('Operational health distinguishes fresh, never-run, overdue, failed and stale-lease evidence',()=>{
  const now=Date.parse('2027-04-04T14:00:00Z'),row={status:'completed',last_started:new Date(now-60000).toISOString(),last_completed:new Date(now-30000).toISOString(),next_at:now+30000};
  assert.equal(backgroundHealth(row,now).status,'healthy');assert.equal(backgroundHealth(null,now).alerts[0].code,'NO_COMPLETED_RUN');
  assert.ok(backgroundHealth({...row,last_completed:new Date(now-91*60000).toISOString()},now).alerts.some(a=>a.code==='BACKGROUND_OVERDUE'));
  assert.ok(backgroundHealth({...row,status:'retry'},now).alerts.some(a=>a.code==='BACKGROUND_RETRY'));
  assert.ok(backgroundHealth({...row,status:'running',lease_until:now-1},now).alerts.some(a=>a.code==='BACKGROUND_STALLED'));
  assert.equal(backgroundHealth({...row,last_completed:'invalid'},now).status,'attention-required');
 });
 await check('Operational payment review queue is restricted to exact owner and plan',async()=>{
  for(const [id,owner,plan]of [['own','owner-1','plan-a'],['other-plan','owner-1','plan-b'],['other-owner','owner-2','plan-a']])await database.prepare("INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,'member',1,'order',100,'manual-review',?)").bind(id,owner,'item',JSON.stringify({planrecoverTripId:plan})).run();
  const queue=await planOperationsQueue(database,'owner-1','plan-a');assert.deepEqual(queue.payments.map(r=>r.id),['own']);
 });
 const require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
 // Keep output below this project so package resolution uses its pinned React.
 const directory=mkdtempSync(resolve('build','review-terms-'));
 try{
  const output=join(directory,'terms.mjs');await build({entryPoints:[resolve('components/financial-review-terms.tsx')],outfile:output,bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',tsconfig:resolve('tsconfig.json'),logLevel:'silent'});
  const {InvoiceReviewTerms,RecoveryReviewTerms}=await import(pathToFileURL(output).href),people=[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}];
  await check('Invoice approval exposes recipient, due time, partial minimum and exact revision',()=>{
   const html=renderToStaticMarkup(createElement(InvoiceReviewTerms,{people,timezone:'America/Toronto',invoice:{amount:2400,currency:'CAD',memberId:'bob',recipientEmail:'buyer@example.test',dueAt:'2027-04-04T18:00:00Z',allowPartial:true,minimum:600,revision:3,version:2,approvedMembers:[]}}));
   for(const term of ['buyer@example.test','America/Toronto','minimum','6.00','invoice revision 2','Awaiting recipient review'])assert.ok(html.includes(term),term);
  });
  await check('Refund approval exposes frozen policy, source, cutoff, allocations and dependencies',()=>{
   const html=renderToStaticMarkup(createElement(RecoveryReviewTerms,{people,timezone:'America/Toronto',recovery:{version:2,approved:['alice'],reservations:[],snapshot:{policy:{currency:'CAD',merchantName:'Fixture merchant',itemRevision:1,terms:'Refund less the agreed fee',evidence:'Documented cancellation evidence',sourceUrl:'https://supplier.example/terms',cutoff:'2027-04-04T12:00:00Z',refundableBps:8000,cancellationFeeUnits:100},allocations:[{memberId:'alice',amount:800,captured:1000,captureId:'CAPTURE1',operationId:'OP1'}],invoiceRefunds:[],dependentItems:[{name:'Shuttle'}],required:['alice','bob']}}}));
   for(const term of ['Refund less the agreed fee','Documented cancellation evidence','https://supplier.example/terms','America/Toronto','CAPTURE1','Shuttle','Bob (pending)'])assert.ok(html.includes(term),term);
  });
 }finally{rmSync(directory,{recursive:true,force:true});}
 console.log(`${checks} operations and financial-review checks passed.`);
}finally{database.close();}
