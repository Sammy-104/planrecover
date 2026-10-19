import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {PushSubscriptionRepository,pushSubscriptionRequest} from '@/lib/web-push';
type Context={params:Promise<{planId:string}>};
const subscriptions=()=>new PushSubscriptionRepository(db(),env as unknown as Record<string,unknown>);
export async function GET(request:Request,context:Context){try{const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params;return Response.json(await subscriptions().list(planId,identity),{headers:privateHeaders});}catch(error){return apiError(error);}}
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params,input=pushSubscriptionRequest.parse(await invoiceJson(request,5000));return Response.json(await subscriptions().save(planId,identity,input.subscription),{headers:privateHeaders});}catch(error){return apiError(error);}}
export async function DELETE(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params,input=z.object({id:z.string().uuid(),confirm:z.literal(true)}).strict().parse(await invoiceJson(request,512));return Response.json(await subscriptions().revoke(planId,identity,input.id),{headers:privateHeaders});}catch(error){return apiError(error);}}
