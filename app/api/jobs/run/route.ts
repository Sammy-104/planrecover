import {workspaceAccess,checkOrigin,apiError,db} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
import {runSavedOwnerJobs} from '@/lib/owner-jobs';
import {invoiceJson} from '@/lib/plan-invoices';
export async function GET(request:Request){try{
 const access=await workspaceAccess(request);if(!access.user||access.share)throw new BackendError('FORBIDDEN','Sign in to your owner workspace.',403);
 const status=await db().prepare('SELECT status,last_started,last_completed,next_at,last_result FROM background_job_runs WHERE owner=?').bind(access.id).first();
 return Response.json({status:status??{status:'not-run'}},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}}
export async function POST(request:Request){try{
 checkOrigin(request);const access=await workspaceAccess(request);
 if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to run your background work.',401);
 if(access.share)throw new BackendError('FORBIDDEN','Background work requires your owner workspace.',403);
 const body=await invoiceJson(request,64);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new BackendError('INVALID_JOB_REQUEST','Background work uses only your saved owner records.');
 return Response.json(await runSavedOwnerJobs(access.id),{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}}
