import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,unlinkSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {applyVercelMigrations} from '../scripts/migrate-vercel.mjs';

const temporaryRoot=realpathSync(tmpdir()),temporaryDirectories=[];
const client=()=>createClient({url:'file::memory:',intMode:'number'});
const hash=sql=>createHash('sha256').update(sql).digest('hex');
function fixtures(files){
 const directory=mkdtempSync(join(temporaryRoot,'planrecover-vercel-migrations-'));temporaryDirectories.push(directory);
 for(const[name,sql]of Object.entries(files))writeFileSync(join(directory,name),sql);
 return {directory,migrations:pathToFileURL(directory+'/')};
}
const tableExists=async(db,name)=>(await db.execute({sql:"SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",args:[name]})).rows[0].count===1;
const markers=async db=>(await db.execute('SELECT name,sha256,applied_at FROM _planrecover_migrations ORDER BY name')).rows.map(row=>({name:row.name,sha256:row.sha256,applied_at:row.applied_at}));
let checks=0;
async function check(name,run){await run();checks++;console.log(`PASS ${name}`);}
try{
 await check('All real migrations apply atomically with checksum markers and remain idempotent',async()=>{
  const db=client();try{
   await db.execute('PRAGMA foreign_keys=ON');
   const directory=new URL('../drizzle/',import.meta.url),names=readdirSync(directory).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
   const review=await applyVercelMigrations(db);
   assert.deepEqual(review,{mode:'review',applied:0,pending:names});
   assert.equal(await tableExists(db,'_planrecover_migrations'),false,'Review performs no schema writes.');
   assert.deepEqual(await applyVercelMigrations(db,{apply:true}),{mode:'applied',applied:names.length,pending:[]});
   for(const name of ['workspaces','plans','financial_events','provider_request_intents','private_uploads'])assert.equal(await tableExists(db,name),true);
   assert.equal((await db.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name='financial_events_no_update'")).rows[0].count,1);
   const before=await markers(db);assert.equal(before.length,names.length);
   for(const row of before)assert.equal(row.sha256,hash(readFileSync(new URL(row.name,directory),'utf8')));
   assert.deepEqual(await applyVercelMigrations(db,{apply:true}),{mode:'applied',applied:names.length,pending:[]});
   assert.deepEqual(await markers(db),before,'Repeated application does not rewrite marker hashes/timestamps.');
   assert.deepEqual(await applyVercelMigrations(db),{mode:'review',applied:names.length,pending:[]});
  }finally{db.close();}
 });
 await check('Modified and missing applied migrations are rejected without database changes',async()=>{
  const original='CREATE TABLE fixture_checksum(id INTEGER PRIMARY KEY);',f=fixtures({'0000_fixture.sql':original}),db=client();
  try{
   await db.execute('PRAGMA foreign_keys=ON');await applyVercelMigrations(db,{apply:true,migrations:f.migrations});const before=await markers(db);
   writeFileSync(join(f.directory,'0000_fixture.sql'),original+'\n-- changed after application');
   await assert.rejects(()=>applyVercelMigrations(db,{apply:true,migrations:f.migrations}),/changed or is missing/);
   assert.deepEqual(await markers(db),before);
   unlinkSync(join(f.directory,'0000_fixture.sql'));
   await assert.rejects(()=>applyVercelMigrations(db,{migrations:f.migrations}),/changed or is missing/);
   assert.deepEqual(await markers(db),before);
  }finally{db.close();}
 });
 await check('Missing saved checksum values fail closed',async()=>{
  const f=fixtures({'0000_fixture.sql':'CREATE TABLE fixture_missing_checksum(id INTEGER);'}),db=client();
  try{
   await db.executeMultiple('CREATE TABLE _planrecover_migrations(name TEXT PRIMARY KEY,sha256 TEXT,applied_at TEXT); INSERT INTO _planrecover_migrations VALUES(\'0000_fixture.sql\',NULL,\'fixture-time\');');
   await assert.rejects(()=>applyVercelMigrations(db,{apply:true,migrations:f.migrations}),/changed or is missing/);
   assert.equal(await tableExists(db,'fixture_missing_checksum'),false);
  }finally{db.close();}
 });
 await check('Unmanaged databases are rejected in both review and apply modes',async()=>{
  const db=client();try{
   await db.execute('CREATE TABLE existing_private_fixture(id INTEGER)');
   for(const apply of [false,true])await assert.rejects(()=>applyVercelMigrations(db,{apply}),/unmanaged tables/);
   assert.equal(await tableExists(db,'_planrecover_migrations'),false);
   assert.equal(await tableExists(db,'workspaces'),false);
  }finally{db.close();}
 });
 await check('Failed DDL rolls back every statement in its script, while earlier scripts remain resumable',async()=>{
  const f=fixtures({'0000_first.sql':'CREATE TABLE fixture_first(id INTEGER);','0001_second.sql':'CREATE TABLE fixture_partial(id INTEGER); INSERT INTO fixture_partial VALUES(1); INSERT INTO missing_fixture_table VALUES(2);'}),db=client();
  try{
   await db.execute('PRAGMA foreign_keys=ON');
   await assert.rejects(()=>applyVercelMigrations(db,{apply:true,migrations:f.migrations}));
   assert.equal(await tableExists(db,'fixture_first'),true);assert.equal(await tableExists(db,'fixture_partial'),false);
   assert.deepEqual((await markers(db)).map(row=>row.name),['0000_first.sql']);
   const repaired='CREATE TABLE fixture_partial(id INTEGER); INSERT INTO fixture_partial VALUES(1);';writeFileSync(join(f.directory,'0001_second.sql'),repaired);
   assert.deepEqual(await applyVercelMigrations(db,{apply:true,migrations:f.migrations}),{mode:'applied',applied:2,pending:[]});
   assert.equal((await db.execute('SELECT COUNT(*) AS count FROM fixture_partial')).rows[0].count,1);
   assert.equal((await markers(db)).find(row=>row.name==='0001_second.sql').sha256,hash(repaired));
  }finally{db.close();}
 });
 await check('A failed checksum-marker insert also rolls back otherwise successful DDL',async()=>{
  const f=fixtures({'0000_marker.sql':'CREATE TABLE fixture_without_marker(id INTEGER);'}),db=client();
  try{
   await db.executeMultiple("PRAGMA foreign_keys=ON; CREATE TABLE _planrecover_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL); CREATE TRIGGER fixture_marker_abort BEFORE INSERT ON _planrecover_migrations BEGIN SELECT RAISE(ABORT,'Synthetic marker failure'); END;");
   await assert.rejects(()=>applyVercelMigrations(db,{apply:true,migrations:f.migrations}),/Synthetic marker failure/);
   assert.equal(await tableExists(db,'fixture_without_marker'),false);assert.deepEqual(await markers(db),[]);
  }finally{db.close();}
 });
 await check('Foreign keys are checked on each migration transaction, not only a separate preflight connection',async()=>{
  const f=fixtures({'0000_fk.sql':'CREATE TABLE fixture_unsafe_fk(id INTEGER);'}),db=client();
  try{
   await db.execute('PRAGMA foreign_keys=OFF');
   const differentConnection={execute:async(statement,...args)=>statement==='PRAGMA foreign_keys'?{rows:[{foreign_keys:1}]}:db.execute(statement,...args),transaction:(...args)=>db.transaction(...args)};
   await assert.rejects(()=>applyVercelMigrations(differentConnection,{apply:true,migrations:f.migrations}),/foreign keys/i);
   assert.equal(await tableExists(db,'fixture_unsafe_fk'),false);
   assert.deepEqual(await markers(db),[]);
   await db.execute('PRAGMA foreign_keys=ON');
   assert.deepEqual(await applyVercelMigrations(db,{apply:true,migrations:f.migrations}),{mode:'applied',applied:1,pending:[]});
  }finally{db.close();}
 });
}finally{
 for(const directory of temporaryDirectories){
  const resolved=realpathSync(directory);
  if(dirname(resolved)!==temporaryRoot||!basename(resolved).startsWith('planrecover-vercel-migrations-'))throw Error('Refusing to remove an unexpected fixture directory.');
  rmSync(resolved,{recursive:true,force:true});
 }
}
console.log(`${checks} Vercel migration checks passed using local in-memory libSQL only.`);
