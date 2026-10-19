import {env} from 'cloudflare:workers';
import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {BackendError} from '@/lib/backend-errors';
import {invoiceJson} from '@/lib/plan-invoices';
import {ServiceReadinessService,readinessCheckRequest} from '@/lib/service-readiness';

type Context={params:Promise<{planId:string}>};
function failure(error:unknown){const response=apiError(error instanceof BackendError?error:new BackendError('READINESS_UNAVAILABLE','Service readiness could not be inspected. Try again later.',503));response.headers.set('Cache-Control','private, no-store');return response;}
export async function GET(request:Request,context:Context){try{
 const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params;
 return Response.json(await new ServiceReadinessService(db()).inspect(planId,identity,env as unknown as Record<string,unknown>),{headers:privateHeaders});
}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 try{checkOrigin(request);}catch{throw new BackendError('ORIGIN_DENIED','Readiness checks must come from this app.',403);}
 const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params;
 const parsed=readinessCheckRequest.safeParse(await invoiceJson(request,512));if(!parsed.success)throw new BackendError('READINESS_INPUT','Explicitly confirm one Bedrock check with a new request ID.');
 return Response.json(await new ServiceReadinessService(db()).checkBedrock(planId,identity,env as unknown as Record<string,unknown>,parsed.data),{headers:privateHeaders});
}catch(error){return failure(error);}}
