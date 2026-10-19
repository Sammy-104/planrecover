import {env} from 'cloudflare:workers';
import {apiError,checkOrigin,db} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
import {sha256} from '@/lib/financial-history';
import {invoiceJson} from '@/lib/plan-invoices';
import {runSavedOwnerJobs} from '@/lib/owner-jobs';
import {runScheduledOwners} from '@/lib/scheduled-owners';
/** Separate service authorization; the Sites service gateway supplies no visitor identity. */
export async function POST(request:Request){try{
 checkOrigin(request);
 const expected=(env as unknown as Record<string,string>).JOB_RUNNER_KEY;
 if(!expected||expected.length<16)throw new BackendError('JOBS_NOT_CONFIGURED','The scheduled backend runner is not configured.',503);
 const provided=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
 if(provided.length>4096)throw new BackendError('SERVICE_AUTH','The scheduled runner needs its service credential.',401);
 const [left,right]=await Promise.all([sha256(expected),sha256(provided)]);let different=0;
 for(let i=0;i<left.length;i++)different|=left.charCodeAt(i)^right.charCodeAt(i);
 if(different)throw new BackendError('SERVICE_AUTH','The scheduled runner needs its service credential.',401);
 const body=await invoiceJson(request,64);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new BackendError('INVALID_JOB_REQUEST','The runner selects only saved workspace records.');
 const raw=Number((env as unknown as Record<string,string>).JOB_BATCH_SIZE??25);
 const maxOwners=Number.isInteger(raw)&&raw>=1&&raw<=100?raw:25;
 return Response.json(await runScheduledOwners(db(),owner=>runSavedOwnerJobs(owner,'scheduled'),{maxOwners}),{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}}
