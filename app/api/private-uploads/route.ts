import {env} from 'cloudflare:workers';
import {workspaceAccess,checkOrigin,db,apiError} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
import {invoiceJson} from '@/lib/plan-invoices';
import {privateUploadInput,privateUploadRuntime,preparePrivateUpload,cleanupPrivateUploads} from '@/lib/private-uploads';
import {signPrivateUpload} from '@/lib/vercel/blob-upload';
export async function POST(request:Request){try{
 checkOrigin(request);if(request.headers.get('origin')!==new URL(request.url).origin)throw new BackendError('UPLOAD_ORIGIN','Open the upload form in this app.',403);
 if(!privateUploadRuntime())throw new BackendError('UPLOAD_UNAVAILABLE','Direct uploads are unavailable on this host.',404);
 const access=await workspaceAccess(request);if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to upload a private file.',401);
 const input=privateUploadInput.parse(await invoiceJson(request,2000));if(access.share&&(access.share.tripId!==input.tripId||access.share.role!=='editor'))throw new BackendError('FORBIDDEN','Editing access to this plan is required.',403);
 const token=(env as unknown as Record<string,string>).BLOB_READ_WRITE_TOKEN;if(!token||!env.BUCKET)throw new BackendError('UPLOAD_STORAGE','Private file storage is unavailable.',503);
 // Cleanup is bounded and only touches expired, tracked staging objects for this owner.
 await cleanupPrivateUploads(db(),env.BUCKET,access.id).catch(()=>undefined);
 const grant=await preparePrivateUpload(db(),access.user,input);
 try{return Response.json({uploadId:grant.id,url:await signPrivateUpload(grant,token),expires:grant.expires},{headers:{'Cache-Control':'private, no-store'}});}
 catch{await db().prepare("UPDATE private_uploads SET status='failed' WHERE id=? AND status='pending'").bind(grant.id).run();throw new BackendError('UPLOAD_STORAGE','Private storage could not prepare your upload. Try again.',503);}
}catch(error){return apiError(error);}}
