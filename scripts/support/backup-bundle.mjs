import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync,writeFileSync,mkdirSync,renameSync,unlinkSync,openSync,closeSync,realpathSync,copyFileSync,constants,rmSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep,dirname,basename,parse} from 'node:path';
import {verifyBackup} from './backup-verification.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const keyPattern=/^[a-f0-9]{64}\/(?:documents\/)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const maxObject=8*1024*1024,maxDatabase=256*1024*1024,maxBytes=512*1024*1024,maxObjects=10000;
const below=(root,path)=>{const rel=relative(root,path);return !!rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
function noLinks(path){const target=resolve(path);let cursor=parse(target).root;for(const part of target.slice(cursor.length).split(sep).filter(Boolean)){cursor=resolve(cursor,part);if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw Error('Linked paths are not accepted.');}return target;}
function regular(path,max){noLinks(path);const stat=lstatSync(path);if(!stat.isFile()||stat.size<1||stat.size>max)throw Error('A source is not a regular file within the backup byte limit.');return stat;}
function json(path){return JSON.parse(readFileSync(path,'utf8'));}
function atomicJson(path,value){const temporary=path+'.pending';writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temporary,path);}
function standalone(path){regular(path,maxDatabase);if(['-wal','-shm','-journal'].some(suffix=>existsSync(path+suffix)))throw Error('Use a standalone provider export; SQLite sidecars cannot be present.');if(readFileSync(path).subarray(0,16).toString()!=='SQLite format 3\u0000')throw Error('The database must be an exported SQLite file.');}
function mime(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return'image/webp';if(bytes.subarray(0,5).toString()==='%PDF-')return'application/pdf';throw Error('An object has an unsupported media signature.');}
function referencedObjects(database){
 const tables=new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name)),found=new Map(),retired=new Set();
 const add=(key,owner,size,contentType,digest)=>{if(!keyPattern.test(key)||!key.startsWith(sha(owner)+'/'))throw Error('An object reference has an invalid owner scope or path.');const prior=found.get(key);if(prior&&prior.owner!==owner)throw Error('An object is referenced across workspace scopes.');if(size!==undefined&&(!Number.isSafeInteger(size)||size<1||size>maxObject))throw Error('An object has an invalid saved byte size.');if(digest!==undefined&&digest!==null&&!/^[a-f0-9]{64}$/.test(digest))throw Error('An object has an invalid saved digest.');found.set(key,{...prior,key,owner,...(size?{size}:{}),...(contentType?{contentType}:{}),...(digest?{sourceSha256:digest}:{})});};
 for(const table of ['receipt_objects','document_objects'])if(tables.has(table))for(const row of database.prepare(`SELECT * FROM ${table}`).all()){if(row.status==='deleted')retired.add(row.file_key);else add(row.file_key,row.owner,row.size,row.mime,row.source_sha256);}
 if(tables.has('receipt_drafts'))for(const row of database.prepare('SELECT * FROM receipt_drafts').all())if(!retired.has(row.file_key)||row.status==='reviewed')add(row.file_key,row.owner,row.size,row.mime);
 if(tables.has('plans'))for(const row of database.prepare('SELECT owner,body FROM plans').all())for(const receipt of JSON.parse(row.body).receipts??[])if(receipt.fileKey)add(receipt.fileKey,row.owner);
 if(tables.has('trip_documents'))for(const row of database.prepare('SELECT * FROM trip_documents').all()){const body=JSON.parse(row.body);add(row.file_key,row.owner,row.size,body.mimeType??body.mime,row.source_sha256);}
 for(const key of retired)if(found.has(key))throw Error('A retained reference points to deliberately retired object bytes.');
 if(found.size>maxObjects)throw Error('This export exceeds the 10000 object limit.');return [...found.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
function sourceObject(root,entry){const path=resolve(root,...entry.key.split('/'));if(!below(root,path))throw Error('An object path escaped its source mirror.');const before=regular(path,maxObject),bytes=readFileSync(path),after=lstatSync(path);if(bytes.length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('An object changed during capture.');const digest=sha(bytes),contentType=mime(bytes);if(entry.size&&entry.size!==bytes.length||entry.contentType&&entry.contentType!==contentType||entry.sourceSha256&&entry.sourceSha256!==digest)throw Error('Source bytes differ from their database size, MIME or digest.');return {bytes,entry:{key:entry.key,size:bytes.length,sha256:digest,contentType}};}

/** Creates a new private offline bundle from explicit provider exports. It never
 * contacts providers, changes source bytes, or points a runtime at restored data. */
export async function exportBackupBundle({databasePath,objectsDirectory,outputDirectory,resume=false,batchSize=100,independentManifestPath}){
 const source=noLinks(databasePath),sourceObjects=noLinks(objectsDirectory),output=noLinks(outputDirectory);
 standalone(source);if(!lstatSync(sourceObjects).isDirectory())throw Error('An exported object mirror directory is required.');
 if(output===sourceObjects||below(sourceObjects,output)||source===output||below(output,source)||below(output,sourceObjects))throw Error('Source and output paths must be separate.');
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000)throw Error('Batch size must be between 1 and 1000 objects.');
 if(independentManifestPath){const path=noLinks(independentManifestPath);if(path===output||below(output,path)||existsSync(path))throw Error('The independent manifest must be a new file outside the bundle.');}
 const sourceHash=sha(readFileSync(source));if(existsSync(output)){if(!resume)throw Error('Output exists; explicit --resume is required.');if(!lstatSync(output).isDirectory()||!existsSync(resolve(output,'.capture.json')))throw Error('Only a marked incomplete backup can be resumed.');}else{if(resume)throw Error('There is no marked bundle to resume.');if(!existsSync(dirname(output)))throw Error('The output parent must already exist.');mkdirSync(output,{mode:0o700});}
 const lock=resolve(output,'.export.lock');let lockHandle;try{lockHandle=openSync(lock,'wx',0o600);}catch{throw Error('The bundle is locked; do not run simultaneous exporters. Preserve and review interrupted locks.');}
 let database;try{
  const checkpointPath=resolve(output,'.capture.json'),databaseTarget=resolve(output,'database.sqlite'),manifestPath=resolve(output,'manifest.json');
  if(existsSync(manifestPath))throw Error('A completed bundle is immutable; create a new output directory.');
  let checkpoint;if(existsSync(checkpointPath)){checkpoint=json(checkpointPath);if(checkpoint.format!=='planrecover-offline-capture'||checkpoint.version!==1||checkpoint.sourceDatabaseSha256!==sourceHash||!Array.isArray(checkpoint.objects))throw Error('Resume source does not match the original captured database.');for(const name of readdirSync(output).filter(name=>/^\.object-[a-f0-9]{64}\.json$/.test(name))){const entry=json(noLinks(resolve(output,name)));if(name!=='.object-'+sha(entry.key)+'.json')throw Error('An object checkpoint identity changed.');checkpoint.objects.push(entry);}standalone(databaseTarget);if(sha(readFileSync(databaseTarget))!==checkpoint.databaseSha256)throw Error('The captured database changed.');}
  database=new DatabaseSync(source,{readOnly:true,allowExtension:false});database.exec('PRAGMA query_only=ON');const references=referencedObjects(database);
  if(!checkpoint){await backup(database,databaseTarget);checkpoint={format:'planrecover-offline-capture',version:1,capturedAt:new Date().toISOString(),sourceDatabaseSha256:sourceHash,databaseSha256:sha(readFileSync(databaseTarget)),objects:[]};atomicJson(checkpointPath,checkpoint);mkdirSync(resolve(output,'objects'),{mode:0o700});}
  const captured=new Map(checkpoint.objects.map(entry=>[entry.key,entry]));let copied=0,total=0;
  for(const reference of references){const {bytes,entry}=sourceObject(sourceObjects,reference);total+=bytes.length;if(total>maxBytes)throw Error('Objects exceed the 512 MiB per-bundle safety limit.');const target=resolve(output,'objects',...entry.key.split('/')),prior=captured.get(entry.key);
   if(prior){if(JSON.stringify(prior)!==JSON.stringify(entry))throw Error('A source object changed between capture batches.');regular(target,maxObject);if(sha(readFileSync(target))!==prior.sha256)throw Error('A captured object changed.');continue;}
   if(copied>=batchSize)continue;
   noLinks(dirname(target));mkdirSync(dirname(target),{recursive:true,mode:0o700});if(existsSync(target))throw Error('An uncheckpointed target already exists; preserve and review this interrupted bundle.');writeFileSync(target,bytes,{flag:'wx',mode:0o600});atomicJson(resolve(output,'.object-'+sha(entry.key)+'.json'),entry);checkpoint.objects.push(entry);checkpoint.objects.sort((a,b)=>a.key.localeCompare(b.key));captured.set(entry.key,entry);copied++;
  }
  if(sha(readFileSync(source))!==sourceHash)throw Error('The source database changed during capture.');
  if(captured.size!==references.length)return {format:'planrecover-backup-export',version:1,status:'incomplete',copied,captured:captured.size,required:references.length,resumeRequired:true};
  const manifest={version:1,format:'planrecover-backup-manifest',capturedAt:checkpoint.capturedAt,databaseSha256:checkpoint.databaseSha256,sourceDatabaseSha256:sourceHash,objects:checkpoint.objects};
  const candidate=resolve(output,'manifest.candidate.json');atomicJson(candidate,manifest);const report=verifyBackup({databasePath:databaseTarget,objectsDirectory:resolve(output,'objects'),manifestPath:candidate,requireManifest:true});atomicJson(resolve(output,'verification.json'),report);if(!report.ok){unlinkSync(candidate);throw Error('Captured bundle failed offline verification. Preserve verification.json for private review.');}
  renameSync(candidate,manifestPath);atomicJson(resolve(output,'BACKUP_COMPLETE.json'),{format:'planrecover-offline-backup',version:1,capturedAt:checkpoint.capturedAt,manifestSha256:sha(readFileSync(manifestPath)),scope:'offline-provider-export-only',hostedRestoreVerified:false});
  if(independentManifestPath)copyFileSync(manifestPath,resolve(independentManifestPath),constants.COPYFILE_EXCL);
  return {format:'planrecover-backup-export',version:1,status:'complete',objects:captured.size,objectBytes:total,databaseSha256:checkpoint.databaseSha256,manifestSha256:sha(readFileSync(manifestPath)),independentManifestWritten:!!independentManifestPath,hostedRestoreVerified:false};
 }finally{database?.close();if(lockHandle!==undefined){closeSync(lockHandle);unlinkSync(lock);}}
}

export async function rehearseBackupRestore({bundleDirectory,outputDirectory}){
 const bundle=noLinks(bundleDirectory),output=noLinks(outputDirectory),marker=json(resolve(bundle,'BACKUP_COMPLETE.json'));if(marker.format!=='planrecover-offline-backup'||marker.manifestSha256!==sha(readFileSync(resolve(bundle,'manifest.json'))))throw Error('The completed bundle marker or manifest digest is invalid.');
 const before=verifyBackup({databasePath:resolve(bundle,'database.sqlite'),objectsDirectory:resolve(bundle,'objects'),manifestPath:resolve(bundle,'manifest.json'),requireManifest:true});if(!before.ok)throw Error('The source backup failed verification; preserve it for review.');
 const result=await exportBackupBundle({databasePath:resolve(bundle,'database.sqlite'),objectsDirectory:resolve(bundle,'objects'),outputDirectory:output,batchSize:1000});if(result.status!=='complete')throw Error('Rehearsal exceeds one bounded 1000-object batch; use explicit export/resume first.');
 atomicJson(resolve(output,'REHEARSAL_ONLY.json'),{format:'planrecover-isolated-restore-rehearsal',version:1,completedAt:new Date().toISOString(),sourceManifestSha256:marker.manifestSha256,networkUsed:false,runtimeActivated:false,hostedRestoreVerified:false});return {format:'planrecover-restore-rehearsal',version:1,ok:true,objects:result.objects,scope:'isolated-local-copy',networkUsed:false,runtimeActivated:false,hostedRestoreVerified:false};
}

/** Retention is a dry-run unless apply=true. Only marked, independently verified
 * complete bundles directly below the explicit root are candidates. */
export function retainBackupBundles({directory,keep=7,apply=false}){
 const root=noLinks(directory);if(!lstatSync(root).isDirectory()||!Number.isSafeInteger(keep)||keep<1||keep>1000)throw Error('Use an explicit directory and keep between 1 and 1000 complete backups.');
 const bundles=[];for(const name of readdirSync(root)){const path=resolve(root,name);if(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()||!existsSync(resolve(path,'BACKUP_COMPLETE.json')))continue;
  const marker=json(resolve(path,'BACKUP_COMPLETE.json'));if(marker.format!=='planrecover-offline-backup'||marker.version!==1||!Number.isFinite(Date.parse(marker.capturedAt))||marker.manifestSha256!==sha(readFileSync(resolve(path,'manifest.json'))))throw Error('A marked backup has an invalid marker or digest.');
  const report=verifyBackup({databasePath:resolve(path,'database.sqlite'),objectsDirectory:resolve(path,'objects'),manifestPath:resolve(path,'manifest.json'),requireManifest:true});if(!report.ok)throw Error('A retained candidate failed verification; pruning is refused.');bundles.push({path,capturedAt:marker.capturedAt});
 }
 bundles.sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)||a.path.localeCompare(b.path));const candidates=bundles.slice(keep);
 for(const item of candidates){noLinks(item.path);const checked=realpathSync(item.path);if(!below(realpathSync(root),checked)||dirname(checked).toLowerCase()!==realpathSync(root).toLowerCase()||basename(checked)!==basename(item.path))throw Error('A retention target escaped the explicit backup root.');if(apply)rmSync(checked,{recursive:true,force:false});}
 return {format:'planrecover-backup-retention',version:1,applied:apply,completeBundles:bundles.length,kept:Math.min(keep,bundles.length),candidates:candidates.length,removed:apply?candidates.length:0};
}
