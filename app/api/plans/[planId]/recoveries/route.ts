import { checkOrigin, apiError, db } from '@/lib/store';
import { planApiContext, privateHeaders } from '@/lib/plan-api';
import { BackendError } from '@/lib/backend-errors';
import { paypal } from '@/lib/paypal';
import { commitFinancialEffect } from '@/lib/financial-history';
import { cancelRecoveredBooking, RecoveryService, recoveryRequest, recoveryRefundBody, type RecoveryScope } from '@/lib/recovery-service';

type Context={params:Promise<{planId:string}>};
function service(){const database=db();return new RecoveryService({database,
  fetchOrder:id=>paypal(`/v2/checkout/orders/${encodeURIComponent(id)}`),
  fetchCapture:id=>paypal(`/v2/payments/captures/${encodeURIComponent(id)}`),
  fetchRefund:id=>paypal(`/v2/payments/refunds/${encodeURIComponent(id)}`),
  createRefund:(id,amount,currency,key)=>paypal(`/v2/payments/captures/${encodeURIComponent(id)}/refund`,'POST',
    recoveryRefundBody(amount,currency),key),
  commitRefund:input=>commitFinancialEffect(database,{owner:input.owner,planId:input.planId,event:input.event,statements:input.statements}),
  cancelBooking:input=>cancelRecoveredBooking(database,input),
});}
async function scopeFor(request:Request,context:Context):Promise<RecoveryScope> {
  const {identity,repository}=await planApiContext(request),{planId}=await context.params;
  const record=await repository.getPlan(planId,identity);
  return {owner:record.owner,planId,memberId:identity.id};
}
async function boundedJson(request:Request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new BackendError('INVALID_REQUEST','Send a JSON recovery request.',415);
  const reader=request.body?.getReader();if(!reader)throw new BackendError('INVALID_REQUEST','Provide the recovery details.');
  let length=0,text='';const decoder=new TextDecoder();
  try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;
    if(length>20_000){await reader.cancel();throw new BackendError('REQUEST_TOO_LARGE','Keep recovery details under 20 KB.',413);}
    text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
  finally{reader.releaseLock();}
  let value:unknown;try{value=JSON.parse(text);}catch{throw new BackendError('INVALID_REQUEST','Provide valid JSON recovery details.');}
  const parsed=recoveryRequest.safeParse(value);
  if(!parsed.success)throw new BackendError('INVALID_REQUEST','Provide saved source terms, current versions and explicit sandbox confirmation.');
  return parsed.data;
}
export async function GET(request:Request,context:Context) {
  try{const scope=await scopeFor(request,context),id=new URL(request.url).searchParams.get('proposalId');
    const result=id?{proposal:await service().get(scope,id)}:await service().list(scope);
    return Response.json(result,{headers:privateHeaders});
  }catch(error){return apiError(error);}
}
export async function POST(request:Request,context:Context) {
  try{checkOrigin(request);const scope=await scopeFor(request,context),input=await boundedJson(request),backend=service();
    const result=input.type==='register-policy'?{policy:await backend.registerPolicy(scope,input)}:
      {proposal:input.type==='propose'?await backend.propose(scope,input):input.type==='approve'?await backend.approve(scope,input):
        input.type==='cancel-proposal'?await backend.cancelProposal(scope,input):await backend.execute(scope,input)};
    return Response.json(result,{headers:privateHeaders});
  }catch(error){return apiError(error);}
}
