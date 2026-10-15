import {env} from 'cloudflare:workers';
import {checkOrigin,apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {queryAmazonLocation,locationRequest} from '@/lib/amazon-location';
import {acquireAiLease} from '@/lib/ai-usage';
import {BackendError} from '@/lib/backend-errors';
type Context={params:Promise<{planId:string}>};
export async function POST(request:Request,context:Context){let release;try{checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params,record=await repository.getPlan(planId,identity);if(!['owner','editor'].includes(record.role))throw new BackendError('FORBIDDEN','Editing membership is required.',403);
 const input=locationRequest.parse(await invoiceJson(request,3000));release=await acquireAiLease(db(),identity.id,'plan-draft');const result=await queryAmazonLocation(env as unknown as Record<string,unknown>,input);if((await repository.getPlan(planId,identity)).version!==record.version)throw new BackendError('PLAN_CHANGED','The plan changed. Review this location query again.',409);return Response.json(result,{headers:privateHeaders});}catch(e){return apiError(e);}finally{if(release)await release();}}
