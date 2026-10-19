import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
import {commitFinancialEffect} from '../lib/financial-history.ts';
import {ReceiptDraftRepository} from '../lib/receipt-drafts.ts';
import {verifyBackup} from '../scripts/support/backup-verification.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
let checks=0;
async function check(name,run,{migrations=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'planrecover-offline-backup-')),database=createTestD1({migrations});
 try{
  const owner='offline-backup-owner',identity={id:await accountPersonId(owner),name:'Fixture owner'},repository=new PlanRepository(database),record=await repository.createPlan(owner,identity,{name:'Offline restore verification fixture',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
  const updated=await repository.updatePlan(record.state.plan.id,identity,record.version,{type:'add_item',actor:identity.id,name:'Fictional booking',category:'Activity',start:'2027-04-04T10:00:00-04:00',duration:60,price:1600,participants:[identity.id]}),itemId=updated.state.items[0].id;
  const event={id:'capture-fixture',itemId,kind:'expense',amount:1600,shares:{[identity.id]:1600},contributions:{[identity.id]:1600},status:'confirmed',mode:'sandbox',providerId:'OFFLINE-CAPTURE',label:'Offline canonical fixture',evidence:'Injected provider fixture; no network',created:'2026-10-17T12:00:00Z'};
  const payload={id:'OFFLINE-ORDER',status:'COMPLETED',planrecoverTripId:record.state.plan.id,purchase_units:[{reference_id:itemId,custom_id:'OFFLINE-OP',payments:{captures:[{id:'OFFLINE-CAPTURE',status:'COMPLETED',amount:{currency_code:'CAD',value:'16.00'}}]}}]};
  await database.prepare("INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES ('OFFLINE-OP',?,?,?,1,'order',1600,'OFFLINE-ORDER','captured',?)").bind(owner,itemId,identity.id,JSON.stringify(payload)).run();
  await commitFinancialEffect(database,{owner,planId:record.state.plan.id,event});
  const key=sha(owner)+'/12345678-1234-4234-8234-123456789abc',objectsDirectory=join(directory,'objects'),filename=join(objectsDirectory,...key.split('/'));mkdirSync(resolve(filename,'..'),{recursive:true});writeFileSync(filename,png);
  await database.prepare("INSERT INTO receipt_objects(file_key,owner,plan_id,status,created) VALUES (?,?,?,'ready','2026-10-17T12:00:00Z')").bind(key,owner,record.state.plan.id).run();
  await new ReceiptDraftRepository(database).create({owner,planId:record.state.plan.id,memberId:identity.id},{fileKey:key,mime:'image/png',size:png.length});
  const databasePath=join(directory,'export.sqlite'),manifestPath=join(directory,'inventory.json');
  const exportFixture=async()=>{await backup(database.sqlite,databasePath);writeFileSync(manifestPath,JSON.stringify({version:1,databaseSha256:sha(readFileSync(databasePath)),objects:[{key,size:png.length,sha256:sha(png),contentType:'image/png'}]}));};
  await exportFixture();const options={databasePath,objectsDirectory,manifestPath};
  await run({directory,database,owner,planId:record.state.plan.id,identity,itemId,event,key,filename,options,exportFixture});checks++;console.log('PASS '+name);
 }finally{database.close();rmSync(directory,{recursive:true,force:true});}
}
const has=(report,code)=>report.findings.some(row=>row.code===code);
await check('A migrated export and exact receipt bytes verify without changing database bytes, timestamps or objects',async t=>{
 const before=readFileSync(t.options.databasePath),beforeMtime=statSync(t.options.databasePath).mtimeMs,report=verifyBackup(t.options);assert.equal(report.ok,true,JSON.stringify(report.findings));assert.equal(report.schema.latestMigration,t.database.appliedMigrations.at(-1));assert.equal(report.schema.actualTables,report.schema.expectedTables);assert.equal(report.financial.providerEffects,1);assert.equal(report.objects.checked,1);assert.equal(report.objects.inventory[0].sha256,sha(png));assert.deepEqual(readFileSync(t.options.databasePath),before);assert.equal(statSync(t.options.databasePath).mtimeMs,beforeMtime);assert.deepEqual(readFileSync(t.filename),png);
 const withoutManifest=verifyBackup({...t.options,manifestPath:undefined});assert.equal(withoutManifest.ok,true);assert.ok(has(withoutManifest,'NO_INDEPENDENT_OBJECT_HASHES'));assert.equal(verifyBackup({...t.options,manifestPath:undefined,requireManifest:true}).ok,false);
});
await check('CLI emits one machine-readable report and reliable success, failure and usage exit codes',async t=>{
 const cli=resolve('scripts/verify-backup.mjs'),run=args=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',cli,...args],{encoding:'utf8'}),args=['--database',t.options.databasePath,'--objects',t.options.objectsDirectory,'--manifest',t.options.manifestPath];
 let result=run(args);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
 rmSync(t.filename);result=run(args);assert.equal(result.status,1,result.stderr);assert.ok(has(JSON.parse(result.stdout),'MISSING_RECEIPT_OBJECT'));result=run(['--database',t.options.databasePath]);assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).ok,false);
});
await check('An independently hashed same-size substitution is detected even when image signature and draft size match',async t=>{
 const changed=Buffer.from(png);changed[changed.length-1]^=1;writeFileSync(t.filename,changed);const before=sha(readFileSync(t.options.databasePath)),report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'RECEIPT_HASH_MISMATCH'));assert.ok(!has(report,'RECEIPT_SIZE_MISMATCH'));assert.equal(sha(readFileSync(t.options.databasePath)),before);
});
await check('Original receipt digests are immutable, legacy NULLs remain honest and same-size substitution fails without a manifest',async t=>{
 const key=sha(t.owner)+'/12345678-1234-4234-8234-123456789abd',file=join(t.options.objectsDirectory,...key.split('/'));writeFileSync(file,png);
 await t.database.prepare("INSERT INTO receipt_objects(file_key,owner,plan_id,status,created,source_sha256) VALUES (?,?,?,'ready','2026-10-17T12:00:00Z',?)").bind(key,t.owner,t.planId,sha(png)).run();
 assert.equal((await t.database.prepare('SELECT source_sha256 FROM receipt_objects WHERE file_key=?').bind(t.key).first()).source_sha256,null);await assert.rejects(()=>t.database.prepare('UPDATE receipt_objects SET source_sha256=? WHERE file_key=?').bind(sha(png),t.key).run(),/immutable/i);await assert.rejects(()=>t.database.prepare('UPDATE receipt_objects SET source_sha256=? WHERE file_key=?').bind('0'.repeat(64),key).run(),/immutable/i);await assert.rejects(()=>t.database.prepare("INSERT INTO receipt_objects(file_key,owner,plan_id,status,created,source_sha256) VALUES (?,?,?,'ready','now','BAD')").bind(sha(t.owner)+'/12345678-1234-4234-8234-123456789abe',t.owner,t.planId).run(),/digest/i);
 await t.exportFixture();const changed=Buffer.from(png);changed[changed.length-1]^=1;writeFileSync(file,changed);const report=verifyBackup({...t.options,manifestPath:undefined});assert.equal(report.ok,false);assert.ok(has(report,'SOURCE_HASH_MISMATCH'));assert.ok(!has(report,'RECEIPT_SIZE_MISMATCH'));
});
await check('Missing, wrong-size and wrong-format receipt source bytes fail independently of a manifest',async t=>{
 writeFileSync(t.filename,Buffer.from('%PDF-1.7\nwrong bytes'));let report=verifyBackup({...t.options,manifestPath:undefined});assert.equal(report.ok,false);assert.ok(has(report,'RECEIPT_SIZE_MISMATCH'));assert.ok(has(report,'RECEIPT_MIME_MISMATCH'));
 rmSync(t.filename);report=verifyBackup({...t.options,manifestPath:undefined});assert.equal(report.ok,false);assert.ok(has(report,'MISSING_RECEIPT_OBJECT'));
});
await check('Missing protective triggers and inconsistent immutable financial facts are detected without repair',async t=>{
 t.database.sqlite.exec('DROP TRIGGER financial_events_no_update');t.database.sqlite.prepare("UPDATE financial_events SET facts=json_set(facts,'$.amount',1700) WHERE event_id='capture-fixture'").run();await t.exportFixture();const before=sha(readFileSync(t.options.databasePath)),report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'MISSING_SCHEMA_OBJECT'));assert.ok(has(report,'FINANCIAL_FACT_MISMATCH'));assert.ok(has(report,'FINANCIAL_ALLOCATION_MISMATCH'));assert.equal(sha(readFileSync(t.options.databasePath)),before);
});
await check('A duplicated canonical provider effect is reported even if its unique index was removed',async t=>{
 t.database.sqlite.exec('DROP INDEX financial_provider_effect_unique');const row=t.database.sqlite.prepare("SELECT * FROM financial_events WHERE event_id='capture-fixture'").get(),body={...JSON.parse(row.body),id:'second-capture'},facts={...JSON.parse(row.facts),id:'second-capture'};
 t.database.sqlite.prepare('INSERT INTO financial_events(owner,plan_id,event_id,facts,body,currency,provider,provider_id,kind,created) VALUES (?,?,?,?,?,?,?,?,?,?)').run(row.owner,row.plan_id,body.id,JSON.stringify(facts),JSON.stringify(body),row.currency,row.provider,row.provider_id,row.kind,row.created);
 t.database.sqlite.prepare('INSERT INTO financial_event_history(id,owner,plan_id,event_id,fingerprint,status,body,recorded) VALUES (?,?,?,?,?,?,?,?)').run('duplicate-history',row.owner,row.plan_id,body.id,sha(JSON.stringify(body)),body.status,JSON.stringify(body),row.created);await t.exportFixture();const report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'DUPLICATE_PROVIDER_EFFECT'));
});
await check('A physically valid export with broken foreign-key references fails verification',async t=>{
 t.database.sqlite.exec('PRAGMA foreign_keys=OFF');t.database.sqlite.prepare("INSERT INTO plan_members(owner,plan_id,member_id,role,body) VALUES ('missing-owner','missing-plan','missing-person','viewer','{}')").run();await t.exportFixture();const report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'FOREIGN_KEY_VIOLATIONS'));assert.equal(report.schema.integrity[0],'ok');
});
await check('Changed status-history fingerprints and canonical provider amounts fail independent financial checks',async t=>{
 t.database.sqlite.exec('DROP TRIGGER financial_event_history_no_update');t.database.sqlite.prepare("UPDATE financial_event_history SET fingerprint=? WHERE event_id='capture-fixture'").run('0'.repeat(64));
 t.database.sqlite.prepare("UPDATE provider_operations SET payload=json_set(payload,'$.purchase_units[0].payments.captures[0].amount.value','17.00') WHERE id='OFFLINE-OP'").run();await t.exportFixture();const report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'FINANCIAL_HISTORY_MISMATCH'));assert.ok(has(report,'PROVIDER_CANONICAL_SCOPE_MISMATCH'));
});
await check('An invoice collection total unsupported by canonical payment rows is rejected',async t=>{
 await t.database.prepare("INSERT INTO plan_invoices(id,owner,plan_id,item_id,member_id,revision,request_id,terms,amount,minimum,paid,status,created,updated) VALUES ('backup-invoice',?,?,?,?,1,'fixture-request','{}',1600,1600,500,'partially-paid','now','now')").bind(t.owner,t.planId,t.itemId,t.identity.id).run();await t.exportFixture();const report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'INVOICE_BALANCE_MISMATCH'));
});
await check('Projected approval consent requires its immutable exact member approval history',async t=>{
 const repository=new PlanRepository(t.database),root=await repository.loadWorkspace(t.owner);root.items[0].approvals=[t.identity.id];await repository.saveWorkspace(t.owner,root,root.version);
 t.database.sqlite.exec('DROP TRIGGER approval_members_no_delete');t.database.sqlite.prepare('DELETE FROM approval_members WHERE owner=? AND plan_id=?').run(t.owner,t.planId);await t.exportFixture();const report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'PLAN_APPROVAL_HISTORY_MISSING'));
});
await check('An older populated schema fails migration completeness without applying migrations to the supplied export',async t=>{
 const before=sha(readFileSync(t.options.databasePath)),report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'MISSING_SCHEMA_OBJECT'));assert.equal(sha(readFileSync(t.options.databasePath)),before);
},{migrations:{through:'0017_connected_workflows.sql'}});
await check('Corrupt SQLite input and possible live sidecars fail safely before any migration or repair',async t=>{
 writeFileSync(t.options.databasePath+'-wal',Buffer.from('do not open this live database'));let report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'SQLITE_SIDECARS'));rmSync(t.options.databasePath+'-wal');
 writeFileSync(t.options.databasePath,Buffer.from('not SQLite'));report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'VERIFICATION_ERROR'));assert.equal(readFileSync(t.options.databasePath,'utf8'),'not SQLite');
});
await check('A retired object cannot silently be revived and malformed manifest keys cannot escape the mirror',async t=>{
 t.database.sqlite.prepare("UPDATE receipt_objects SET status='deleted',deleted_at='now' WHERE file_key=?").run(t.key);await t.exportFixture();let report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'RETIRED_RECEIPT_OBJECT_PRESENT'));
 writeFileSync(t.options.manifestPath,JSON.stringify({version:1,objects:[{key:'../escape',size:png.length,sha256:sha(png)}]}));report=verifyBackup(t.options);assert.equal(report.ok,false);assert.ok(has(report,'INVALID_MANIFEST_ENTRY'));
});
console.log(`${checks} offline backup verification checks passed. Inputs were fixture exports; no live backup or restore was attempted.`);
