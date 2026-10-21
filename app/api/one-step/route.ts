import {apiError,config} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';

export async function GET(request:Request){
 try{
  const {identity,repository}=await planApiContext(request),settings=config();
  return Response.json({plans:await repository.listPlans(identity.id),profile:identity,config:{paypal:settings.paypal,clientId:settings.clientId}},{headers:privateHeaders});
 }catch(error){return apiError(error);}
}
