import {BackendError,forbidden} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
const pattern=/^[a-f0-9]{64}\/(?:documents\/)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
type Entry={key:string;kind:string;size:number|null;mime:string|null;sha256:string|null};
/** Per-plan read-only byte export for an owner. This is not a database snapshot:
 * pagination can observe concurrent changes. A full consistent provider export
 * and independent manifest remain required for a complete restore bundle. */
export class BackupObjectExportService{
 constructor(private database:D1Database,private repository=new PlanRepository(database)){}
 private async owner(planId:string,identity:Identity){const record=await this.repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();return record;}
 private async entries(owner:string,planId:string,memberId:string,after:string,limit:number,exact:string|null=null){return this.database.prepare(`SELECT key,MIN(kind) kind,MAX(size) size,MAX(mime) mime,MAX(sha256) sha256 FROM (
  SELECT file_key key,'receipt' kind,NULL size,NULL mime,NULL sha256 FROM receipt_objects WHERE owner=? AND plan_id=? AND status='ready'
  UNION ALL SELECT d.file_key,'receipt',d.size,d.mime,NULL FROM receipt_drafts d LEFT JOIN receipt_objects r ON r.file_key=d.file_key WHERE d.owner=? AND d.plan_id=? AND COALESCE(r.status,'ready')='ready'
  UNION ALL SELECT json_extract(r.value,'$.fileKey'),'receipt',NULL,NULL,NULL FROM plans p,json_each(p.body,'$.receipts') r WHERE p.owner=? AND p.id=? AND json_extract(r.value,'$.fileKey') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM receipt_objects o WHERE o.file_key=json_extract(r.value,'$.fileKey') AND o.status<>'ready')
  UNION ALL SELECT d.file_key,'document',d.size,COALESCE(json_extract(d.body,'$.mimeType'),json_extract(d.body,'$.mime')),d.source_sha256 FROM trip_documents d JOIN document_objects o ON o.file_key=d.file_key AND o.owner=d.owner AND o.plan_id=d.trip_id AND o.status='ready' WHERE d.owner=? AND d.trip_id=? AND (d.uploader=? OR json_extract(d.body,'$.visibility')='plan' OR json_extract(d.body,'$.visibility')='selected' AND EXISTS(SELECT 1 FROM json_each(d.body,'$.members') WHERE value=?))
 ) WHERE key>? AND (? IS NULL OR key=?) GROUP BY key ORDER BY key LIMIT ?`).bind(owner,planId,owner,planId,owner,planId,owner,planId,memberId,memberId,after,exact,exact,limit).all<Entry>();}
 async inventory(planId:string,identity:Identity,options:{after?:string;limit?:number}={}){
  const record=await this.owner(planId,identity),after=options.after??'',limit=options.limit??20;if(after&&!pattern.test(after)||!Number.isInteger(limit)||limit<1||limit>50)throw new BackendError('BACKUP_EXPORT_INPUT','Use a valid object cursor and a page size between 1 and 50.');
  const rows=await this.entries(record.owner,planId,identity.id,after,limit+1),prefix=await digest(new TextEncoder().encode(record.owner));if(rows.results.some(row=>!pattern.test(row.key)||!row.key.startsWith(prefix+'/')))throw new BackendError('BACKUP_EXPORT_SCOPE','Stored object scope needs review before export.',409);
  const entries=rows.results.slice(0,limit);return {scope:'owner-plan-accessible-object-inventory',databaseSnapshot:false,includesOtherMembersPrivateDocuments:false,planVersion:record.version,entries,nextCursor:rows.results.length>limit?entries.at(-1)!.key:null,independentHashes:entries.every(row=>row.sha256!==null),note:'Pair exported bytes with a consistent provider database export. Inventory pages respect document visibility and do not provide a complete point-in-time backup.'};
 }
 async bytes(planId:string,identity:Identity,key:string,bucket:Pick<R2Bucket,'get'>){
  if(!pattern.test(key))throw new BackendError('BACKUP_EXPORT_INPUT','Select a valid referenced object key.');const record=await this.owner(planId,identity),prefix=await digest(new TextEncoder().encode(record.owner));if(!key.startsWith(prefix+'/'))throw forbidden();
  const authorized=async()=>{const rows=await this.entries(record.owner,planId,identity.id,'',1,key);return rows.results[0];};let entry=await authorized();if(!entry)throw new BackendError('BACKUP_OBJECT_MISSING','The object is not retained by this plan or its visibility changed.',404);
  const object=await bucket.get(key);if(!object)throw new BackendError('BACKUP_OBJECT_MISSING','The referenced object bytes are unavailable.',404);if(object.size<1||object.size>8*1024*1024){await object.body.cancel();throw new BackendError('BACKUP_OBJECT_SIZE','Stored object size exceeds the allowed export limit.',409);}
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.byteLength!==object.size)throw new BackendError('BACKUP_OBJECT_SIZE','Stored object size changed during export.',409);const sha256=await digest(bytes);
  await this.owner(planId,identity);entry=await authorized();if(!entry)throw new BackendError('BACKUP_OBJECT_MISSING','The object reference changed during export.',409);if(entry.size!==null&&entry.size!==bytes.byteLength||entry.sha256&&entry.sha256!==sha256)throw new BackendError('BACKUP_OBJECT_EVIDENCE','Stored bytes differ from their retained size or digest.',409);
  return {bytes,sha256,key,mime:entry.mime??object.httpMetadata?.contentType??'application/octet-stream'};
 }
}
