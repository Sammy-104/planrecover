import {checkOrigin,db,apiError} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {InvoiceRefundService,invoiceRefundRequest} from '@/lib/invoice-refund-service';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params;return Response.json({requests:await new InvoiceRefundService(db()).list(planId,identity)},{headers:privateHeaders});}catch(error){return apiError(error);}}
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params;return Response.json(await new InvoiceRefundService(db()).act(planId,identity,invoiceRefundRequest.parse(await invoiceJson(request,8000))),{headers:privateHeaders});}catch(error){return apiError(error);}}
