import {z} from 'zod';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {checkOrigin,apiError,db} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
import {paypal,reconcileCapture} from '@/lib/paypal';
import {createPlanCheckout,capturePlanCheckout} from '@/lib/plan-checkout';
import {invoiceJson} from '@/lib/plan-invoices';
type Context={params:Promise<{planId:string}>};
const input=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('create'),itemId:z.string().min(1).max(180),revision:z.number().int().min(1),version:z.number().int().min(0)}).strict(),
 z.object({operation:z.literal('capture'),orderId:z.string().regex(/^[A-Z0-9]{1,36}$/)}).strict(),
]);
export async function POST(request:Request,context:Context){try{
 checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params;
 const record=await repository.getPlan(planId,identity),parsed=input.safeParse(await invoiceJson(request,8192));
 if(!parsed.success)throw new BackendError('INVALID_CHECKOUT','Provide your current item or saved order.');
 const dependencies={database:db(),provider:paypal,reconcileCapture};
 const result=parsed.data.operation==='create'?await createPlanCheckout(record,identity,parsed.data,dependencies)
  :await capturePlanCheckout(record,identity,parsed.data.orderId,dependencies);
 return Response.json(result,{headers:privateHeaders});
}catch(error){return apiError(error);}}
