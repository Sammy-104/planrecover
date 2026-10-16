import {z} from 'zod';
import {checkOrigin,db,apiError} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {closeUnpaidCheckout} from '@/lib/collection-resolution';
import {paypal} from '@/lib/paypal';
import {forbidden} from '@/lib/backend-errors';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity,repository}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();const rows=await db().prepare("SELECT id,item_id,revision,amount,status FROM provider_operations WHERE owner=? AND kind='order' AND json_extract(payload,'$.planrecoverTripId')=? AND status NOT IN ('captured','cancelled','failed') ORDER BY id LIMIT 100").bind(record.owner,planId).all();return Response.json({checkouts:rows.results},{headers:privateHeaders});}catch(error){return apiError(error);}}
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params,input=z.object({changeId:z.string().uuid(),operationId:z.string().min(1).max(180),confirm:z.literal(true)}).strict().parse(await invoiceJson(request,2000));return Response.json(await closeUnpaidCheckout(db(),planId,identity,input,id=>paypal(`/v2/checkout/orders/${encodeURIComponent(id)}`)),{headers:privateHeaders});}catch(error){return apiError(error);}}
