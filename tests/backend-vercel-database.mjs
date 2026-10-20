import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createClient} from '@libsql/client';
import {createTursoD1,tursoDatabaseFromEnv} from '../lib/vercel/database.ts';
import {PlanRepository} from '../lib/plan-repository.ts';

const client=createClient({url:'file::memory:',intMode:'number'}),database=createTursoD1(client);
try{
 const created=await database.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE ledger(id INTEGER PRIMARY KEY,provider_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL CHECK(amount>0),label TEXT);
  CREATE TABLE guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CONSTRAINT backend_write_guard_valid CHECK(valid=1));
  CREATE TABLE balance(id INTEGER PRIMARY KEY,total INTEGER NOT NULL);
  INSERT INTO balance VALUES(1,0);
  CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'Financial facts are append-only'); END;
  CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'Financial facts are retained'); END;
 `);
 assert.equal(created.count,7,'exec preserves trigger bodies and reports top-level statements.');
 assert.ok(Number.isFinite(created.duration)&&created.duration>=0);

 await assert.rejects(()=>database.batch([
  database.prepare('UPDATE balance SET total=99 WHERE id=1'),
  database.prepare('INSERT INTO ledger(provider_id,amount) VALUES (?,?)').bind('fixture-capture-rejected',99),
  database.prepare('INSERT INTO guards VALUES (?,?)').bind('guard-rejected',0),
  database.prepare('INSERT INTO ledger(provider_id,amount) VALUES (?,?)').bind('fixture-after-guard',1),
 ]),error=>/CHECK constraint|backend_write_guard_valid/i.test(error.message));
 assert.equal(await database.prepare('SELECT total FROM balance').first('total'),0,'A failed financial guard rolls back earlier writes.');
 assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM ledger').first('count'),0);
 assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM guards').first('count'),0);
 await database.exec('PRAGMA foreign_keys=OFF');
 await assert.rejects(()=>database.prepare('UPDATE balance SET total=999 WHERE id=1').run(),error=>error.code==='D1_FOREIGN_KEYS_REQUIRED'&&error.status===503);
 await assert.rejects(()=>database.batch([database.prepare('INSERT INTO ledger(provider_id,amount) VALUES (?,?)').bind('fixture-fk-disabled',999)]),error=>error.code==='D1_FOREIGN_KEYS_REQUIRED');
 await database.exec('PRAGMA foreign_keys=ON');
 assert.equal(await database.prepare('SELECT total FROM balance').first('total'),0,'A corrected connection recovers without a cached startup failure.');
 assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM ledger').first('count'),0,'Foreign-key configuration failure happens before any user write.');
 await database.exec('CREATE TABLE parent_rows(id INTEGER PRIMARY KEY); CREATE TABLE child_rows(parent_id INTEGER REFERENCES parent_rows(id));');
 await assert.rejects(()=>database.batch([
  database.prepare('INSERT INTO parent_rows VALUES(1)'),
  database.prepare('INSERT INTO child_rows VALUES(2)'),
 ]),/FOREIGN KEY constraint/i);
 assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM parent_rows').first('count'),0,'Actual referential constraints roll back the entire batch.');

 const saved=await database.batch([
  database.prepare('INSERT INTO guards VALUES (?,?)').bind('guard-accepted',1),
  database.prepare('INSERT INTO ledger(provider_id,amount,label) VALUES (?,?,?)').bind('fixture-capture-accepted',25,'semi;colon'),
  database.prepare('UPDATE balance SET total=25 WHERE id=1'),
  database.prepare('DELETE FROM guards WHERE id=?').bind('guard-accepted'),
  database.prepare('SELECT amount,label FROM ledger'),
 ]);
 assert.equal(saved.length,5);assert.ok(saved.every(result=>result.success));
 assert.equal(saved[1].meta.changes,1);assert.equal(saved[1].meta.last_row_id,1);assert.equal(saved[1].meta.changed_db,true);
 assert.deepEqual(saved[4].results,[{amount:25,label:'semi;colon'}]);
 assert.equal(saved[4].meta.rows_read,1);
 assert.equal((await database.prepare('UPDATE balance SET total=0 WHERE id=99').run()).meta.changes,0);
 assert.equal((await database.prepare('SELECT * FROM ledger').run()).results.length,0);
 assert.deepEqual(await database.prepare('SELECT id,label FROM ledger').raw({columnNames:true}),[['id','label'],[1,'semi;colon']]);
 assert.deepEqual(await database.prepare('SELECT 1 AS duplicate,2 AS duplicate').raw(),[[1,2]],'raw preserves positional values even with duplicate column labels.');
 assert.deepEqual(Object.keys((await database.prepare('SELECT amount,label FROM ledger').all()).results[0]),['amount','label'],'libSQL numeric indexes and length are not leaked.');
 assert.equal(await database.prepare('SELECT label FROM ledger WHERE id=99').first(),null);
 assert.equal(await database.prepare('SELECT NULL AS nullable').first('nullable'),null);
 await assert.rejects(()=>database.prepare('SELECT 1 AS value').first('missing'),/column not found/);

 await assert.rejects(()=>database.batch([
  database.prepare('UPDATE balance SET total=50 WHERE id=1'),
  database.prepare('INSERT INTO ledger(provider_id,amount) VALUES (?,?)').bind('fixture-capture-accepted',25),
 ]),/UNIQUE constraint/i);
 assert.equal(await database.prepare('SELECT total FROM balance').first('total'),25,'Duplicate provider effects cannot leave partial balance writes.');
 await assert.rejects(()=>database.batch([
  database.prepare('UPDATE balance SET total=75 WHERE id=1'),
  database.prepare('UPDATE ledger SET amount=75 WHERE id=1'),
 ]),/append-only/);
 assert.equal(await database.prepare('SELECT total FROM balance').first('total'),25);
 assert.equal(await database.prepare('SELECT amount FROM ledger').first('amount'),25);
 await assert.rejects(()=>database.prepare('DELETE FROM ledger').run(),/retained/);

 const reusable=database.prepare('SELECT ? AS value');
 assert.equal(await reusable.bind(1).first('value'),1);assert.equal(await reusable.bind(2).first('value'),2);
 for(const value of [undefined,true,{},[],BigInt(1),NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>reusable.bind(value),/Unsupported D1|safely/);
 assert.equal(await reusable.bind(Number.MAX_SAFE_INTEGER).first('value'),Number.MAX_SAFE_INTEGER);
 await assert.rejects(()=>database.prepare('SELECT 9007199254740992 AS value').first(),/safely|represented|range/i);
 const bytes=new Uint8Array([1,2,255]),binaryStatement=reusable.bind(bytes);bytes[0]=99;
 assert.deepEqual(await binaryStatement.first('value'),[1,2,255]);
 assert.deepEqual(await database.batch([]),[]);
 await assert.rejects(()=>database.batch([createTursoD1(client).prepare('SELECT 1')]),/belong to this database/);

 const script=await database.exec(`-- semicolons in comments ; are ignored
  /* and block comments ; */
  CREATE TABLE notes(value TEXT);
  INSERT INTO notes VALUES('value;with;semicolons');
  CREATE TRIGGER notes_check BEFORE UPDATE ON notes BEGIN
   SELECT CASE WHEN NEW.value='' THEN RAISE(ABORT,'empty;value') ELSE 1 END;
  END;
 `);
 assert.equal(script.count,3);
 await assert.rejects(()=>database.exec("INSERT INTO notes VALUES('retained-before-error'); INSERT INTO missing_table VALUES(1);"));
 assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM notes WHERE value='retained-before-error'").first('count'),1,'exec retains documented sequential executeMultiple semantics; financial writes use batch.');
}finally{client.close();}

// Exercise the real application schema and repository through the new adapter.
const repositoryClient=createClient({url:'file::memory:',intMode:'number'}),repositoryDb=createTursoD1(repositoryClient);
try{
 await repositoryDb.exec('PRAGMA foreign_keys=ON');
 const migrationDirectory=new URL('../drizzle/',import.meta.url);
 for(const file of readdirSync(migrationDirectory).filter(name=>name.endsWith('.sql')).sort())await repositoryDb.exec(readFileSync(new URL(file,migrationDirectory),'utf8'));
 const repository=new PlanRepository(repositoryDb),identity={id:'person-fixture-vercel-owner',name:'Fixture owner'};
 const plan=await repository.createPlan('fixture-vercel-account',identity,{kind:'trip',name:'Adapter fixture plan',destination:'Toronto, Ontario, Canada',start:'2027-04-04',end:'2027-04-06',timezone:'America/Toronto',currency:'CAD',budget:20000});
 assert.equal((await repository.getPlan(plan.state.plan.id,identity)).state.plan.name,'Adapter fixture plan');
 await assert.rejects(()=>repository.getPlan(plan.state.plan.id,{id:'person-unrelated-fixture',name:'Unrelated'}),error=>error.status===404);
 const changed=await repository.updatePlan(plan.state.plan.id,identity,plan.version,{type:'plan',actor:identity.id,plan:{...plan.state.plan,name:'Updated adapter fixture'}});
 assert.equal(changed.state.plan.name,'Updated adapter fixture');
 await assert.rejects(()=>repository.updatePlan(plan.state.plan.id,identity,plan.version,{type:'plan',actor:identity.id,plan:{...plan.state.plan,name:'Stale write'}}),error=>error.status===409);
 assert.equal((await repository.getPlan(plan.state.plan.id,identity)).state.plan.name,'Updated adapter fixture');
}finally{repositoryClient.close();}

const originalError=Object.assign(new Error('Synthetic constraint failure'),{code:'SQLITE_CONSTRAINT_CHECK'});let calls=0;
const failed=createTursoD1({execute:async()=>{calls++;throw originalError;},batch:async()=>{calls++;throw originalError;},executeMultiple:async()=>{calls++;throw originalError;}});
await assert.rejects(()=>failed.prepare('SELECT 1').all(),error=>error===originalError);
await assert.rejects(()=>failed.batch([failed.prepare('SELECT 1')]),error=>error===originalError);
await assert.rejects(()=>failed.exec('SELECT 1'),error=>error===originalError);
assert.equal(calls,3,'Failures preserve the client error and never retry an uncertain mutation.');
const bigintResult={columns:['value'],rows:[{0:BigInt(Number.MAX_SAFE_INTEGER)+BigInt(1)}],rowsAffected:0,lastInsertRowid:undefined};
const guardResult={columns:['enforced'],rows:[{0:1}],rowsAffected:0,lastInsertRowid:undefined};
const unsafe=createTursoD1({execute:async()=>bigintResult,batch:async()=>[guardResult,bigintResult],executeMultiple:async()=>{}});
await assert.rejects(()=>unsafe.prepare('SELECT value').first(),/safely/);
assert.equal(tursoDatabaseFromEnv({}),undefined);
for(const settings of [
 {TURSO_AUTH_TOKEN:'fixture-token'},
 {TURSO_DATABASE_URL:'libsql://fixture.turso.io'},
 {TURSO_DATABASE_URL:'file:private.db',TURSO_AUTH_TOKEN:'fixture-token'},
 {TURSO_DATABASE_URL:'http://fixture.invalid',TURSO_AUTH_TOKEN:'fixture-token'},
 {TURSO_DATABASE_URL:'libsql://fixture.turso.io?tls=0',TURSO_AUTH_TOKEN:'fixture-token'},
 {TURSO_DATABASE_URL:'libsql://fixture.turso.io',TURSO_AUTH_TOKEN:'fixture-token\n'},
])assert.throws(()=>tursoDatabaseFromEnv(settings));
console.log('Turso D1 adapter: atomic guard rollback, immutable/unique financial constraints, real migrations/repository isolation, safe integers, result shapes and configuration checks passed.');
