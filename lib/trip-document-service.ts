import {PlanRepository} from './plan-repository.ts';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {canReadDocument,documentAudience,documentFilename,verifyDocument,type TripDocument} from './documents.ts';
import type {Identity} from './people.ts';
type Bucket=Pick<R2Bucket,'put'|'get'|'delete'>;
type Row={id:string;owner:string;trip_id:string;uploader:string;body:string;file_key:string;version:number;size:number;source_sha256:string};
export type DocumentLink={tokenHash:string;tripId:string;role:'viewer'|'editor'};
const hex=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(v=>v.toString(16).padStart(2,'0')).join('');
export class TripDocumentService{
 constructor(private database:D1Database,private bucket:Bucket,private repository=new PlanRepository(database)){}
 private async scope(planId:string,identity:Identity,writing=false){const record=await this.repository.getPlan(planId,identity);if(writing&&!['owner','editor'].includes(record.role))throw forbidden();return record;}
 private guards(record:{owner:string;version:number},planId:string,identity:Identity,link?:DocumentLink){
  const token=crypto.randomUUID(),linkSql=link?" AND EXISTS(SELECT 1 FROM trip_links WHERE token_hash=? AND owner=? AND trip_id=? AND role='editor' AND (expires IS NULL OR julianday(expires)>julianday('now')))":'';
  if(link&&(link.tripId!==planId||link.role!=='editor'))throw forbidden();
  return {token,start:this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))${linkSql} THEN 1 ELSE 0 END)`).bind(token,record.owner,planId,record.version,identity.id,...(link?[link.tokenHash,record.owner,planId]:[])),end:this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)};
 }
 private async batch(commands:D1PreparedStatement[]){try{return await this.database.batch(commands);}catch(error){if(String(error).includes('CHECK constraint'))throw conflict();throw error;}}
 private value(row:Row):TripDocument{return {...JSON.parse(row.body),id:row.id,tripId:row.trip_id,uploader:row.uploader,version:row.version};}
 async list(planId:string,identity:Identity){const record=await this.scope(planId,identity),rows=await this.database.prepare("SELECT d.* FROM trip_documents d JOIN document_objects o ON o.file_key=d.file_key WHERE d.owner=? AND d.trip_id=? AND o.status='ready' ORDER BY d.id LIMIT 50").bind(record.owner,planId).all<Row>();return rows.results.filter(r=>canReadDocument(this.value(r),identity.id)).map(r=>({row:r,document:this.value(r)}));}
 async file(planId:string,identity:Identity,id:string){const saved=(await this.list(planId,identity)).find(v=>v.document.id===id);if(!saved)throw new BackendError('DOCUMENT_UNAVAILABLE','This file is unavailable or access changed.',404);const object=await this.bucket.get(saved.row.file_key);if(!object)throw new BackendError('DOCUMENT_MISSING','The saved file is unavailable.',404);
  const fresh=(await this.list(planId,identity)).find(v=>v.document.id===id);if(!fresh||fresh.document.version!==saved.document.version||fresh.row.file_key!==saved.row.file_key){await object.body.cancel().catch(()=>undefined);throw conflict();}return {object,document:fresh.document};}
 async upload(planId:string,identity:Identity,input:{title:string;filename:string;mime:string;bytes:Uint8Array;itemId?:string;visibility:unknown;members:unknown},link?:DocumentLink){
  const record=await this.scope(planId,identity,true);verifyDocument(input.bytes,input.mime);const title=input.title.trim();if(!title||title.length>150||input.itemId&&!record.state.items.some(i=>i.id===input.itemId&&i.status!=='cancelled'))throw new BackendError('DOCUMENT_INPUT','Name the file and choose a current activity.');
  const audience=documentAudience(input.visibility,input.members,record.state),ownerHash=await hex(new TextEncoder().encode(record.owner)),key=`${ownerHash}/documents/${crypto.randomUUID()}`,id=crypto.randomUUID(),digest=await hex(input.bytes),now=new Date().toISOString();
  const doc:TripDocument={id,tripId:planId,uploader:identity.id,itemId:input.itemId,title,filename:documentFilename(input.filename,input.mime),mime:input.mime,size:input.bytes.byteLength,...audience,version:1,created:now};
  const reserve=this.guards(record,planId,identity,link);
  await this.batch([reserve.start,this.database.prepare("INSERT INTO document_objects(file_key,owner,plan_id,status,created,source_sha256,size,mime) VALUES (?,?,?,'staged',?,?,?,?)").bind(key,record.owner,planId,now,digest,doc.size,doc.mime),reserve.end]);
  try{
   await this.bucket.put(key,input.bytes,{httpMetadata:{contentType:doc.mime}});
   const guard=this.guards(record,planId,identity,link),capacity=this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN (SELECT COUNT(*) FROM trip_documents WHERE owner=? AND trip_id=?)<50 AND (SELECT COALESCE(SUM(size),0) FROM trip_documents WHERE owner=? AND trip_id=?)+?<=104857600 THEN 1 ELSE 0 END)`).bind(guard.token+'-capacity',record.owner,planId,record.owner,planId,doc.size);
   await this.batch([guard.start,capacity,this.database.prepare('INSERT INTO trip_documents(id,owner,trip_id,uploader,body,file_key,version,size,source_sha256) VALUES (?,?,?,?,?,?,1,?,?)').bind(id,record.owner,planId,identity.id,JSON.stringify(doc),key,doc.size,digest),this.database.prepare("UPDATE document_objects SET status='ready' WHERE file_key=? AND status='staged'").bind(key),this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard.token+'-capacity'),guard.end]);
   return doc;
  }catch(error){await this.database.prepare("UPDATE document_objects SET status='deleting' WHERE file_key=? AND status='staged' AND NOT EXISTS(SELECT 1 FROM trip_documents WHERE file_key=?)").bind(key,key).run();await cleanupDocumentObjects(this.database,this.bucket,record.owner,{immediate:true}).catch(()=>undefined);throw error;}
 }
 async change(planId:string,identity:Identity,input:{id:string;version:number;operation:'delete'|'access';visibility?:unknown;members?:unknown},link?:DocumentLink){
  const record=await this.scope(planId,identity,true),saved=(await this.list(planId,identity)).find(v=>v.document.id===input.id);if(!saved||saved.row.uploader!==identity.id)throw forbidden();if(!Number.isInteger(input.version)||saved.document.version!==input.version)throw conflict();
  const guard=this.guards(record,planId,identity,link),rowGuard=this.database.prepare('INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM trip_documents WHERE id=? AND owner=? AND trip_id=? AND uploader=? AND version=?) THEN 1 ELSE 0 END)').bind(guard.token+'-row',input.id,record.owner,planId,identity.id,input.version),commands=[guard.start,rowGuard];
  if(input.operation==='access'){const audience=documentAudience(input.visibility,input.members,record.state),doc={...saved.document,...audience,version:input.version+1};commands.push(this.database.prepare('UPDATE trip_documents SET body=?,version=version+1 WHERE id=?').bind(JSON.stringify(doc),input.id));}
  else commands.push(this.database.prepare('DELETE FROM trip_documents WHERE id=?').bind(input.id),this.database.prepare("UPDATE document_objects SET status='deleting' WHERE file_key=? AND owner=? AND NOT EXISTS(SELECT 1 FROM trip_documents WHERE file_key=?)").bind(saved.row.file_key,record.owner,saved.row.file_key));
  commands.push(this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard.token+'-row'),guard.end);await this.batch(commands);
  if(input.operation==='delete')await cleanupDocumentObjects(this.database,this.bucket,record.owner,{immediate:true});return {ok:true};
 }
}
/** Deletes only tracked unreferenced objects. Failed deletes remain retryable. */
export async function cleanupDocumentObjects(database:D1Database,bucket:Pick<R2Bucket,'delete'>,owner:string,options:{immediate?:boolean;now?:number}={}){
 const now=options.now??Date.now(),cutoff=new Date(now-30*86400000).toISOString(),rows=await database.prepare("SELECT file_key FROM document_objects WHERE owner=? AND (status='deleting' OR status='staged' AND created<?) AND lease_until<=? AND NOT EXISTS(SELECT 1 FROM trip_documents d WHERE d.file_key=document_objects.file_key) ORDER BY created LIMIT 5").bind(owner,cutoff,now).all<{file_key:string}>();let deleted=0,failed=0;
 for(const row of rows.results){const token=crypto.randomUUID(),claim=await database.prepare("UPDATE document_objects SET status='deleting',lease_token=?,lease_until=? WHERE file_key=? AND owner=? AND status IN ('staged','deleting') AND lease_until<=? AND NOT EXISTS(SELECT 1 FROM trip_documents WHERE file_key=?)").bind(token,now+30000,row.file_key,owner,now,row.file_key).run();if(!claim.meta.changes)continue;
  try{await bucket.delete(row.file_key);await database.prepare("UPDATE document_objects SET status='deleted',lease_token=NULL,lease_until=0,deleted_at=? WHERE file_key=? AND lease_token=?").bind(new Date(now).toISOString(),row.file_key,token).run();deleted++;}catch{failed++;await database.prepare("UPDATE document_objects SET lease_token=NULL,lease_until=0 WHERE file_key=? AND lease_token=?").bind(row.file_key,token).run();}}
 return {examined:rows.results.length,deleted,failed};
}
