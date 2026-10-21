type JsonRequest=(url:string,init?:RequestInit)=>Promise<any>;
type Pending={uploadId?:string;until:number;flight?:Promise<any>};
const pending=new Map<string,Pending>(),MAX_PENDING=8,RECOVERY_MS=24*60*60*1000;
let preparations=new WeakMap<File,Map<string,Promise<any>>>(),accountEpoch=0;
const digest=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
/** Page/auth redirects must not carry a previous account's unfinished uploads. */
export function clearPendingPrivateUploads(){pending.clear();preparations=new WeakMap();accountEpoch++;}
if(typeof window!=='undefined')window.addEventListener('pagehide',clearPendingPrivateUploads);
function definitiveFailure(error:unknown){
 const value=error as {status?:number;code?:string;message?:string};
 if([401,403,404,410,413,415,422].includes(value?.status??0))return true;
 return [400,409].includes(value?.status??0)&&(/^(?:INVALID_|UPLOAD_(?:INPUT|CONTENT|EXPIRED|UNAVAILABLE|OBJECT))/.test(value.code??'')||/\b(?:invalid|expired|revoked)\b|choose the file again/i.test(value.message??''));
}
/** Keep the existing multipart path on Cloudflare; Vercel sends bytes straight to private Blob. */
export async function submitFileForm(path:string,form:FormData,request:JsonRequest,signal?:AbortSignal){
 const file=form.get('file');if(process.env.NEXT_PUBLIC_HOSTING_PLATFORM!=='vercel'||!(file instanceof File))return request(path,{method:'POST',body:form,signal});
 if(file.size<=0||file.size>8*1024*1024)throw Error('Choose a PDF, PNG, JPEG or WebP file under 8 MB.');
 signal?.throwIfAborted();
 const metadata:Record<string,string>={};for(const [name,value] of form)if(name!=='file'&&name!=='uploadId'&&typeof value==='string')metadata[name]=value;
 const sortedMetadata=Object.entries(metadata).sort(([a],[b])=>a.localeCompare(b)),preparationKey=JSON.stringify([path,sortedMetadata]);
 let filePreparations=preparations.get(file);if(!filePreparations){filePreparations=new Map();preparations.set(file,filePreparations);}
 const existing=filePreparations.get(preparationKey);if(existing)return existing;
 // Share a double submit before either asynchronous checksum has finished. A File is immutable;
 // different file objects still use the content fingerprint below for uncertain-response retries.
 const epoch=accountEpoch,currentPreparations=filePreparations;
 const preparation=Promise.resolve().then(async()=>{
 const sha256=await digest(await file.arrayBuffer());
 const fingerprint=await digest(new TextEncoder().encode(JSON.stringify([path,file.name,file.type,file.size,sha256,sortedMetadata])));
 if(epoch!==accountEpoch)throw Error('This upload was interrupted. Choose the file again.');
 signal?.throwIfAborted();
 const now=Date.now();for(const [key,value] of pending)if(!value.flight&&value.until<=now)pending.delete(key);
 let entry=pending.get(fingerprint);if(entry?.flight)return entry.flight;
 if(!entry){if(pending.size>=MAX_PENDING)throw Error('Finish retrying your earlier uploads before adding more files.');entry={until:now+RECOVERY_MS};pending.set(fingerprint,entry);}
 const current=entry;
 const task=Promise.resolve().then(async()=>{
  try{
   if(!current.uploadId){
    const grant=await request('/api/private-uploads',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({tripId:metadata.tripId??'',purpose:path==='/api/documents'?'document':'receipt',filename:file.name,mime:file.type,size:file.size,sha256})});
    if(typeof grant.uploadId!=='string'||typeof grant.url!=='string')throw Error('The private upload could not be prepared.');
    const response=await fetch(grant.url,{method:'PUT',headers:{'Content-Type':file.type},body:file,signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw Error('The private upload did not finish. Choose the file again.');
    // Only the opaque server session survives an uncertain final POST. Never retain bytes or signed URLs.
    current.uploadId=grant.uploadId;current.until=Date.now()+RECOVERY_MS;
   }
   const result=await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...metadata,uploadId:current.uploadId}),signal});
   if(pending.get(fingerprint)===current)pending.delete(fingerprint);return result;
  }catch(error){
   if((error as {status?:number})?.status===401)clearPendingPrivateUploads();
   else if((!current.uploadId||definitiveFailure(error))&&pending.get(fingerprint)===current)pending.delete(fingerprint);
   throw error;
  }finally{current.flight=undefined;}
 });current.flight=task;return task;
 }).finally(()=>{
  if(currentPreparations.get(preparationKey)===preparation)currentPreparations.delete(preparationKey);
 });
 currentPreparations.set(preparationKey,preparation);return preparation;
}
