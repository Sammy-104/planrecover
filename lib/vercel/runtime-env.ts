import {tursoDatabaseFromEnv} from './database';
import {createBlobBucket} from './blob-bucket';

let database:D1Database|undefined,bucket:R2Bucket|undefined,settingsKey='';
function bindings(){
 const key=JSON.stringify([process.env.TURSO_DATABASE_URL,process.env.TURSO_AUTH_TOKEN,process.env.BLOB_READ_WRITE_TOKEN]);
 if(key!==settingsKey){
  database=tursoDatabaseFromEnv(process.env);
  bucket=database&&process.env.BLOB_READ_WRITE_TOKEN?createBlobBucket(database,{token:process.env.BLOB_READ_WRITE_TOKEN}):undefined;
  settingsKey=key;
 }
 return {DB:database,BUCKET:bucket};
}

/** Server-only compatibility bindings; no secret values enter client properties. */
export const env=new Proxy({} as Cloudflare.Env&Record<string,unknown>,{
 get(_target,key){
  if(key==='DB'||key==='BUCKET')return bindings()[key];
  if(typeof key==='string')return process.env[key];
  return undefined;
 },
 has(_target,key){return key==='DB'||key==='BUCKET'?Boolean(bindings()[key]):typeof key==='string'&&Object.hasOwn(process.env,key);},
});
