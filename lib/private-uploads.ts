import {z} from 'zod';
import {BackendError,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import {verifyDocument} from './documents.ts';
import type {Identity} from './people.ts';
export const MAX_PRIVATE_UPLOAD=8*1024*1024;
export const privateUploadInput=z.object({tripId:z.string().min(1).max(180),purpose:z.enum(['document','receipt']),filename:z.string().min(1).max(240),mime:z.enum(['application/pdf','image/png','image/jpeg','image/webp']),size:z.number().int().min(1).max(MAX_PRIVATE_UPLOAD),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
type Upload=ReturnType<typeof privateUploadInput.parse>;
type Row={id:string;owner:string;plan_id:string;member_id:string;purpose:string;file_key:string;filename:string;mime:string;size:number;sha256:string;status:string;created:number;expires:number;lease_until:number;deleted_at:number|null;result:string|null};
export const PRIVATE_UPLOAD_LEASE_MS=180000,PRIVATE_UPLOAD_RECOVERY_MS=24*60*60000;
/** Complete must join the same transaction that publishes the durable record. */
export type PrivateUploadPublication={id:string;guard:()=>D1PreparedStatement[];complete:(result:unknown)=>D1PreparedStatement[]};
export type PrivateUploadFile={bytes:Uint8Array;mime:string;filename:string;publication:PrivateUploadPublication};
export const privateUploadRuntime=()=>typeof process!=='undefined'&&process.env.PLANRECOVER_HOSTING==='vercel';
export const privateUploadDigest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('');

/** A staging grant is write-only, expires quickly, and cannot authorize a publication. */
export async function preparePrivateUpload(database:D1Database,identity:Identity,input:Upload,options:{now?:number}={}){
 const value=privateUploadInput.parse(input),record=await new PlanRepository(database).getPlan(value.tripId,identity);if(!['owner','editor'].includes(record.role))throw forbidden();
 const now=options.now??Date.now(),id=crypto.randomUUID(),prefix=await privateUploadDigest(new TextEncoder().encode(record.owner)),fileKey=`${prefix}/uploads/${id}`,expires=now+10*60000;
 const result=await database.prepare(`INSERT INTO private_uploads(id,owner,plan_id,member_id,purpose,file_key,filename,mime,size,sha256,status,created,expires)
 SELECT ?,?,?,?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))
 AND (SELECT COUNT(*) FROM private_uploads WHERE owner=? AND plan_id=? AND member_id=? AND created>?)<10
 AND (SELECT COALESCE(SUM(size),0) FROM private_uploads WHERE owner=? AND plan_id=? AND deleted_at IS NULL)+?<=104857600`)
 .bind(id,record.owner,value.tripId,identity.id,value.purpose,fileKey,value.filename,value.mime,value.size,value.sha256,now,expires,record.owner,value.tripId,identity.id,record.owner,value.tripId,identity.id,now-10*60000,record.owner,value.tripId,value.size).run();
 if(!result.meta.changes)throw new BackendError('UPLOAD_LIMIT','Wait for earlier uploads to finish, then try again.',429);
 return {id,fileKey,mime:value.mime,size:value.size,expires};
}

/** Finalize only a server-owned session. Client URLs/keys are never accepted as file sources. */
export async function consumePrivateUpload<T>(database:D1Database,bucket:Pick<R2Bucket,'get'|'delete'>,identity:Identity,planId:string,purpose:'document'|'receipt',id:unknown,publish:(file:PrivateUploadFile)=>Promise<T>,options:{now?:number;resolve?:(result:T)=>Promise<T>}={}):Promise<T>{
 if(typeof id!=='string'||!z.string().uuid().safeParse(id).success)throw new BackendError('UPLOAD_INPUT','Choose a current saved upload.');
 const row=await database.prepare('SELECT * FROM private_uploads WHERE id=? AND plan_id=? AND member_id=? AND purpose=?').bind(id,planId,identity.id,purpose).first<Row>();
 if(!row)throw new BackendError('UPLOAD_UNAVAILABLE','This upload is unavailable.',404);
 const record=await new PlanRepository(database).getPlan(planId,identity);if(record.owner!==row.owner||!['owner','editor'].includes(record.role))throw forbidden();
 const recover=(result:string)=>{const parsed=JSON.parse(result) as T;return options.resolve?options.resolve(parsed):Promise.resolve(parsed);};
 if(row.status==='used'&&row.result)return recover(row.result);
 const clock=()=>options.now??Date.now(),now=clock(),recoverable=['processing','failed'].includes(row.status)&&row.created+PRIVATE_UPLOAD_RECOVERY_MS>now;
 if(row.deleted_at!==null||row.status==='pending'&&row.expires<=now||row.status!=='pending'&&!recoverable)throw new BackendError('UPLOAD_EXPIRED','This upload expired. Choose the file again.',409);
 if(row.status==='processing'&&row.lease_until>now)throw new BackendError('UPLOAD_BUSY','This upload is still being saved. Retry shortly.',409);
 const lease=JSON.stringify({leaseToken:crypto.randomUUID()}),claim=await database.prepare(`UPDATE private_uploads SET status='processing',lease_until=?,result=? WHERE id=? AND deleted_at IS NULL AND ((status='pending' AND expires>?) OR (status IN ('processing','failed') AND lease_until<=? AND created>?)) AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))`).bind(now+PRIVATE_UPLOAD_LEASE_MS,lease,id,now,now,now-PRIVATE_UPLOAD_RECOVERY_MS,row.owner,planId,identity.id).run();
 if(!claim.meta.changes)throw new BackendError('UPLOAD_BUSY','This upload is already being saved or access changed.',409);
 const checked=()=>{const token=crypto.randomUUID();return {start:database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM private_uploads u JOIN plans p ON p.owner=u.owner AND p.id=u.plan_id JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE u.id=? AND u.owner=? AND u.plan_id=? AND u.member_id=? AND u.purpose=? AND u.status='processing' AND u.result=? AND u.lease_until>? AND u.deleted_at IS NULL AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor')) THEN 1 ELSE 0 END)`).bind(token,id,row.owner,planId,identity.id,purpose,lease,clock(),identity.id),end:database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)};};
 const publication:PrivateUploadPublication={id,guard(){const guard=checked();return [guard.start,guard.end];},complete(result){const guard=checked(),encoded=JSON.stringify(result);if(encoded===undefined)throw new BackendError('UPLOAD_RESULT','The saved upload result is unavailable.',503);return [guard.start,database.prepare("UPDATE private_uploads SET status='used',result=?,lease_until=0 WHERE id=? AND status='processing' AND result=?").bind(encoded,id,lease),guard.end];}};
 const completed=()=>database.prepare("SELECT result FROM private_uploads WHERE id=? AND status='used'").bind(id).first<{result:string}>();
 try{
  const object=await bucket.get(row.file_key);if(!object)throw new BackendError('UPLOAD_MISSING','The private upload did not finish. Choose the file again.',409);
  if(object.size!==row.size||object.size>MAX_PRIVATE_UPLOAD||object.httpMetadata?.contentType!==row.mime){await object.body.cancel().catch(()=>undefined);throw new BackendError('UPLOAD_CONTENT','The private upload does not match the selected file.');}
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==row.size||await privateUploadDigest(bytes)!==row.sha256)throw new BackendError('UPLOAD_CONTENT','The uploaded file changed. Choose it again.');
  verifyDocument(bytes,row.mime);
  const result=await publish({bytes,mime:row.mime,filename:row.filename,publication});
  if(!await completed())throw new BackendError('UPLOAD_PUBLICATION','The source could not be linked to its saved upload. Retry this upload.',503);
  // Keep the original write grant occupied until it expires. Deleting earlier would allow a replay to recreate an orphan.
  return result;
 }catch(error){
  // A lost DB acknowledgement or a later AI/read error cannot turn a committed
  // source into a failed upload. Its original durable publication is recoverable.
  try{const saved=await completed();if(saved?.result)return recover(saved.result);}catch{/* Leave the lease/result intact while the database is unavailable. */}
  await database.prepare("UPDATE private_uploads SET status='failed',result=NULL,lease_until=0 WHERE id=? AND status='processing' AND result=?").bind(id,lease).run().catch(()=>undefined);throw error;
 }
}

/** Deterministic publication keys may already exist after an uncertain PUT. */
export async function putPrivatePublicationObject(bucket:Pick<R2Bucket,'get'|'put'>,key:string,bytes:Uint8Array,mime:string){
 const digest=await privateUploadDigest(bytes);
 const existing=async()=>{const object=await bucket.get(key);if(!object)return false;if(object.size!==bytes.length||object.httpMetadata?.contentType!==mime){await object.body.cancel().catch(()=>undefined);throw new BackendError('UPLOAD_OBJECT','The saved source does not match this upload.',409);}const prior=new Uint8Array(await object.arrayBuffer());if(await privateUploadDigest(prior)!==digest)throw new BackendError('UPLOAD_OBJECT','The saved source does not match this upload.',409);return true;};
 if(await existing())return;
 try{await bucket.put(key,bytes,{httpMetadata:{contentType:mime}});}catch(error){if(!await existing())throw error;}
}

/** Stage objects remain occupied until grant expiry, then delete with retryable leases. */
export async function cleanupPrivateUploads(database:D1Database,bucket:Pick<R2Bucket,'delete'>,owner:string,options:{now?:number}={}){
 const now=options.now??Date.now(),eligible="(status IN ('pending','used') OR created<=?)",rows=await database.prepare(`SELECT id,file_key FROM private_uploads WHERE owner=? AND deleted_at IS NULL AND expires<? AND lease_until<=? AND ${eligible} ORDER BY created LIMIT 5`).bind(owner,now,now,now-PRIVATE_UPLOAD_RECOVERY_MS).all<{id:string;file_key:string}>();let deleted=0,failed=0;
 for(const row of rows.results){const claim=await database.prepare(`UPDATE private_uploads SET lease_until=? WHERE id=? AND owner=? AND deleted_at IS NULL AND expires<? AND lease_until<=? AND ${eligible}`).bind(now+30000,row.id,owner,now,now,now-PRIVATE_UPLOAD_RECOVERY_MS).run();if(!claim.meta.changes)continue;
  try{await bucket.delete(row.file_key);await database.prepare('UPDATE private_uploads SET deleted_at=?,lease_until=0 WHERE id=? AND lease_until=?').bind(now,row.id,now+30000).run();deleted++;}catch{failed++;await database.prepare('UPDATE private_uploads SET lease_until=0 WHERE id=? AND lease_until=?').bind(row.id,now+30000).run();}}
 return {examined:rows.results.length,deleted,failed};
}
