import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {BackendError} from '@/lib/backend-errors';
import {paypal} from '@/lib/paypal';
import {PlanInvoiceRepository,invoiceActionRequest,invoiceFinancialEffects,invoiceJson} from '@/lib/plan-invoices';
type Context={params:Promise<{planId:string;invoiceId:string}>};
export async function GET(request:Request,context:Context){
 try{
  const {repository,identity}=await planApiContext(request),{planId,invoiceId}=await context.params;
  const record=await repository.getPlan(planId,identity);
  return Response.json({invoice:await new PlanInvoiceRepository(db(),paypal,invoiceFinancialEffects(db())).get({record,memberId:identity.id},invoiceId)},{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
export async function POST(request:Request,context:Context){
 try{
  checkOrigin(request);
  const {repository,identity}=await planApiContext(request),{planId,invoiceId}=await context.params;
  const record=await repository.getPlan(planId,identity);
  const raw=await invoiceJson(request,1000);
  const parsed=invoiceActionRequest.safeParse(raw);
  if(!parsed.success)throw new BackendError('INVALID_REQUEST','Provide the current invoice and plan versions, and an explicit invoice action.');
  return Response.json({invoice:await new PlanInvoiceRepository(db(),paypal,invoiceFinancialEffects(db())).act({record,memberId:identity.id},invoiceId,parsed.data)},{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
