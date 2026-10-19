import {env} from 'cloudflare:workers';
import {apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {BackendError} from '@/lib/backend-errors';
import {BackupObjectExportService} from '@/lib/backup-object-export';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{
 const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,url=new URL(request.url),service=new BackupObjectExportService(db()),key=url.searchParams.get('key');
 if([...url.searchParams.keys()].some(name=>!['key','after','limit'].includes(name))||[...new Set(url.searchParams.keys())].some(name=>url.searchParams.getAll(name).length!==1)||key&&(url.searchParams.has('after')||url.searchParams.has('limit')))throw new BackendError('BACKUP_EXPORT_INPUT','Use an object key or inventory cursor without duplicate options.');
 if(key){if(!env.BUCKET)throw new BackendError('BACKUP_STORAGE','Object storage is unavailable.',503);const result=await service.bytes(planId,identity,key,env.BUCKET);return new Response(result.bytes,{headers:{...privateHeaders,'Content-Type':result.mime,'Content-Disposition':`attachment; filename="${key.split('/').at(-1)}"`,'Content-Length':String(result.bytes.length),'X-Content-SHA256':result.sha256,'X-Content-Type-Options':'nosniff'}});}
 return Response.json(await service.inventory(planId,identity,{after:url.searchParams.get('after')??undefined,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined}),{headers:privateHeaders});
 }catch(error){const response=apiError(error instanceof BackendError?error:new BackendError('BACKUP_EXPORT_UNAVAILABLE','Object export could not complete. Try again later.',503));response.headers.set('Cache-Control','private, no-store');return response;}}
