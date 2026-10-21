import {BackendError} from './backend-errors.ts';
import {privateUploadDigest,putPrivatePublicationObject,type PrivateUploadPublication} from './private-uploads.ts';
import {type ReceiptDraft,type ReceiptScope,ReceiptDraftRepository} from './receipt-drafts.ts';

/** Source/draft creation is separate from optional extraction and financial review. */
export async function publishReceiptSource(database:D1Database,bucket:Pick<R2Bucket,'get'|'put'|'delete'>,repository:ReceiptDraftRepository,scope:ReceiptScope,file:{bytes:Uint8Array;mime:string;publication?:PrivateUploadPublication},response?:(draft:ReceiptDraft)=>unknown){
 const prefix=await privateUploadDigest(new TextEncoder().encode(scope.owner)),key=`${prefix}/${file.publication?.id??crypto.randomUUID()}`,sourceHash=await privateUploadDigest(file.bytes),[start,end]=file.publication?.guard()??[];
 await database.batch([...(start?[start]:[]),database.prepare(`INSERT ${file.publication?'OR IGNORE ':''}INTO receipt_objects(file_key,owner,plan_id,status,created,source_sha256) VALUES (?,?,?,'staged',?,?)`).bind(key,scope.owner,scope.planId,new Date().toISOString(),sourceHash),...(end?[end]:[])]);
 if(file.publication){
  const object=await database.prepare('SELECT owner,plan_id,status,source_sha256 FROM receipt_objects WHERE file_key=?').bind(key).first<{owner:string;plan_id:string;status:string;source_sha256:string}>();
  if(!object||object.owner!==scope.owner||object.plan_id!==scope.planId||object.status!=='staged'||object.source_sha256!==sourceHash)throw new BackendError('UPLOAD_OBJECT','This saved source changed. Retry the current upload.',409);
  await putPrivatePublicationObject(bucket,key,file.bytes,file.mime);
 }else await bucket.put(key,file.bytes,{httpMetadata:{contentType:file.mime}});
 try{
  const draft=await repository.create(scope,{fileKey:key,mime:file.mime,size:file.bytes.length,publication:file.publication,publicationResult:response});
  if(!file.publication)await database.prepare("UPDATE receipt_objects SET status='ready' WHERE file_key=? AND owner=? AND plan_id=? AND status='staged'").bind(key,scope.owner,scope.planId).run();
  return draft;
 }catch(error){
  // A Vercel publication may have committed despite a lost acknowledgement.
  // Keep its immutable object for lease recovery; retirement handles abandons.
  if(!file.publication){let exists=false;try{await repository.byFile(scope,key);exists=true;}catch{}if(!exists)await bucket.delete(key).catch(()=>undefined);}
  throw error;
 }
}
