import {env} from 'cloudflare:workers';
import {workspaceAccess,checkOrigin,db,apiError} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
import {TripDocumentService} from '@/lib/trip-document-service';
const headers={'Cache-Control':'private, no-store'};
async function context(request:Request){const access=await workspaceAccess(request);if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to open the plan wallet.',401);if(!env.BUCKET)throw new BackendError('DOCUMENT_STORAGE','Private file storage is unavailable.',503);return {access,service:new TripDocumentService(db(),env.BUCKET)};}
export async function GET(request:Request){try{const {access,service}=await context(request),q=new URL(request.url).searchParams,planId=q.get('tripId')??'',id=q.get('id');if(access.share&&access.share.tripId!==planId)throw new BackendError('FORBIDDEN','This file belongs to a different plan.',403);
 if(!id)return Response.json({documents:(await service.list(planId,access.user!)).map(f=>f.document),currentUser:access.user!.id},{headers});
 const {object,document}=await service.file(planId,access.user!,id);return new Response(object.body,{headers:{...headers,'Content-Type':document.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(document.filename).replace(/'/g,'%27')}`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}catch(error){return apiError(error);}}
async function multipart(request:Request){
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw new BackendError('DOCUMENT_INPUT','Use the upload form.');
 const reader=request.body?.getReader();if(!reader)throw new BackendError('DOCUMENT_INPUT','Choose a file action.');let total=0;const chunks:Uint8Array[]=[];let timer:ReturnType<typeof setTimeout>|undefined;
 try{const read=async()=>{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>9*1024*1024)throw new BackendError('DOCUMENT_SIZE','Upload a file under 8 MB.');chunks.push(value);}};await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BackendError('DOCUMENT_TIMEOUT','The upload took too long. Try again.')),10000);})]);const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();}
 finally{if(timer)clearTimeout(timer);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function POST(request:Request){try{checkOrigin(request);const {access,service}=await context(request),form=await multipart(request),planId=String(form.get('tripId')??'');if(access.share&&access.share.tripId!==planId)throw new BackendError('FORBIDDEN','This file belongs to a different plan.',403);const operation=String(form.get('operation')??'upload');let members:unknown;try{members=JSON.parse(String(form.get('members')??'[]'));}catch{throw new BackendError('DOCUMENT_INPUT','Choose current file recipients.');}
 if(operation==='access'||operation==='delete')return Response.json(await service.change(planId,access.user!,{operation,id:String(form.get('id')??''),version:Number(form.get('version')),visibility:form.get('visibility'),members},access.share),{headers});
 if(operation!=='upload')throw new BackendError('DOCUMENT_INPUT','Choose a supported file action.');const file=form.get('file');if(!(file instanceof File)||file.size<=0||file.size>8*1024*1024)throw new BackendError('DOCUMENT_SIZE','Choose a file under 8 MB.');
 return Response.json({document:await service.upload(planId,access.user!,{title:String(form.get('title')??''),filename:file.name,mime:file.type,bytes:new Uint8Array(await file.arrayBuffer()),itemId:String(form.get('itemId')??'')||undefined,visibility:form.get('visibility')??'private',members},access.share)},{headers});
}catch(error){return apiError(error);}}
