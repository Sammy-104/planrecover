import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const directory=new URL('../drizzle/',import.meta.url);
export async function applyVercelMigrations(client,{apply=false,migrations=directory}={}){
 const files=readdirSync(migrations).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
 const entries=files.map(name=>{const sql=readFileSync(new URL(name,migrations),'utf8');return {name,sql,sha256:createHash('sha256').update(sql).digest('hex')};});
 const tables=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(row=>row.name);
 const managed=tables.includes('_planrecover_migrations');
 if(!managed&&tables.length)throw Error('This database already contains unmanaged tables. Use a reviewed import process instead of initializing it.');
 const saved=managed?(await client.execute('SELECT name,sha256 FROM _planrecover_migrations ORDER BY name')).rows:[];
 for(const row of saved){const entry=entries.find(item=>item.name===row.name);if(!entry||entry.sha256!==row.sha256)throw Error(`Previously applied migration changed or is missing: ${row.name}.`);}
 const pending=entries.filter(entry=>!saved.some(row=>row.name===entry.name));
 if(!apply)return {mode:'review',applied:saved.length,pending:pending.map(entry=>entry.name)};
 const foreignKeys=(await client.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys;
 if(Number(foreignKeys)!==1)throw Error('The selected database must enforce foreign keys before applying migrations.');
 await client.execute('CREATE TABLE IF NOT EXISTS _planrecover_migrations (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
 for(const entry of pending){
  const transaction=await client.transaction('write');
  try{
   // Remote SDK operations may use different logical connections. Verify the
   // connection that will execute this script before changing its schema.
   const transactionForeignKeys=(await transaction.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys;
   if(Number(transactionForeignKeys)!==1)throw Error('The migration connection must enforce foreign keys before applying migrations.');
   const current=await transaction.execute({sql:'SELECT sha256 FROM _planrecover_migrations WHERE name=?',args:[entry.name]});
   if(current.rows.length){if(current.rows[0].sha256!==entry.sha256)throw Error(`Migration checksum mismatch: ${entry.name}.`);}
   else{
    // Send the original script intact: triggers contain internal semicolons.
    await transaction.executeMultiple(entry.sql);
    await transaction.execute({sql:'INSERT INTO _planrecover_migrations (name,sha256,applied_at) VALUES (?,?,?)',args:[entry.name,entry.sha256,new Date().toISOString()]});
   }
   await transaction.commit();
  }catch(error){if(!transaction.closed)await transaction.rollback();throw error;}
  finally{transaction.close();}
 }
 return {mode:'applied',applied:entries.length,pending:[]};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 for(const name of ['.env','.env.local']){const path=new URL(`../${name}`,import.meta.url);if(existsSync(path))process.loadEnvFile(path);}
 const link=new URL('../.vercel/project.json',import.meta.url);
 if(!existsSync(link))throw Error('Link and inspect the intended Vercel project before migrating.');
 const project=JSON.parse(readFileSync(link,'utf8'));
 const args=process.argv.slice(2),apply=args.includes('--apply');
 const expected=args.find(arg=>arg.startsWith('--project='))?.slice('--project='.length);
 if(apply&&(!expected||expected!==project.projectId))throw Error('Pass --apply --project=<verified-project-id> after reviewing the migration plan.');
 const url=process.env.TURSO_DATABASE_URL,authToken=process.env.TURSO_AUTH_TOKEN;
 if(!url||!authToken||!['libsql:','https:'].includes(new URL(url).protocol))throw Error('Pull the linked project’s private Turso settings before migrating.');
 const client=createClient({url,authToken,intMode:'number'});
 try{console.log(JSON.stringify(await applyVercelMigrations(client,{apply}),null,2));}finally{client.close();}
}
