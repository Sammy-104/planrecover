import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {BackendError} from '@/lib/backend-errors';
import {paypal} from '@/lib/paypal';
import {PlanInvoiceRepository,invoiceCreateRequest,invoiceFinancialEffects,invoiceJson} from '@/lib/plan-invoices';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){
 try{
  const {repository,identity}=await planApiContext(request),{planId}=await context.params;
  const record=await repository.getPlan(planId,identity);
  return Response.json({invoices:await new PlanInvoiceRepository(db(),paypal,invoiceFinancialEffects(db())).list({record,memberId:identity.id})},{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
export async function POST(request:Request,context:Context){
 try{
  checkOrigin(request);
  const {repository,identity}=await planApiContext(request),{planId}=await context.params;
  const record=await repository.getPlan(planId,identity);
  const input=await invoiceJson(request,10000);
  const parsed=invoiceCreateRequest.safeParse(input);
  if(!parsed.success)throw new BackendError('INVALID_REQUEST','Provide the approved item revision, member, invoice deadline and payment terms.');
  return Response.json({invoice:await new PlanInvoiceRepository(db(),paypal,invoiceFinancialEffects(db())).create({record,memberId:identity.id},parsed.data)},{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
