import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
import {commitFinancialEffect} from '../lib/financial-history.ts';
const directory=mkdtempSync(join(tmpdir(),'planrecover-backup-rehearsal-')),database=createTestD1();let restored;
try{
 const owner='backup-fixture',identity={id:await accountPersonId(owner),name:'Backup fixture'},repository=new PlanRepository(database),record=await repository.createPlan(owner,identity,{name:'Isolated backup rehearsal',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:2000});
 const updated=await repository.updatePlan(record.state.plan.id,identity,record.version,{type:'add_item',actor:identity.id,name:'Fixture booking',category:'Activity',start:'2027-04-04T10:00:00-04:00',duration:60,price:1600,participants:[identity.id]});
 const event={id:'backup-payment',itemId:updated.state.items[0].id,kind:'expense',amount:1600,shares:{[identity.id]:1600},contributions:{[identity.id]:1600},status:'confirmed',mode:'sandbox',providerId:'FIXTURE-CAPTURE',label:'Offline fixture',evidence:'Injected evidence only',created:new Date().toISOString()};await commitFinancialEffect(database,{owner,planId:record.state.plan.id,event});
 await database.prepare("INSERT INTO receipt_objects(file_key,owner,plan_id,status,created) VALUES ('fixture-receipt-object',?,?,'ready',?)").bind(owner,record.state.plan.id,new Date().toISOString()).run();
 const saved=await repository.loadWorkspace(owner),file=join(directory,'restored.sqlite');await backup(database.sqlite,file);restored=new DatabaseSync(file);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM workspaces WHERE owner=?').get(owner).body),JSON.parse(database.sqlite.prepare('SELECT body FROM workspaces WHERE owner=?').get(owner).body));
 assert.equal(restored.prepare('SELECT COUNT(*) n FROM financial_events WHERE owner=? AND plan_id=?').get(owner,record.state.plan.id).n,1);assert.equal(restored.prepare('SELECT COUNT(*) n FROM financial_event_history WHERE owner=? AND plan_id=?').get(owner,record.state.plan.id).n,1);assert.equal(restored.prepare('SELECT file_key FROM receipt_objects').get().file_key,'fixture-receipt-object');
 assert.throws(()=>restored.prepare("UPDATE financial_events SET facts='{}'").run(),/immutable|append.only/i);
 console.log('PASS SQLite backup restores plan records, immutable financial facts, status history and receipt-object references with valid integrity/foreign keys.');
 console.log('PASS Restored triggers still reject financial-history mutation. This is an isolated rehearsal; hosted database and R2 restoration remain provider-dependent.');
}finally{restored?.close();database.close();rmSync(directory,{recursive:true,force:true});}
