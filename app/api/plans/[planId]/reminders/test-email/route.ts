import {env} from 'cloudflare:workers';
import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {ControlledReminderEmailService,controlledReminderEmailRequest} from '@/lib/controlled-reminder-email';
type Context={params:Promise<{planId:string}>};
async function context(request:Request,route:Context){
 const {identity}=await planApiContext(request,{readOnly:true}),{planId}=await route.params;
 return {service:new ControlledReminderEmailService(db(),env as unknown as Record<string,unknown>),scope:{planId,identity,authenticatedEmail:request.headers.get('oai-authenticated-user-email')}};
}
export async function GET(request:Request,route:Context){try{
 const {service,scope}=await context(request,route);return Response.json(await service.preview(scope),{headers:privateHeaders});
}catch(error){const response=apiError(error);response.headers.set('Cache-Control','private, no-store');return response;}}
export async function POST(request:Request,route:Context){try{
 checkOrigin(request);const {service,scope}=await context(request,route),input=controlledReminderEmailRequest.parse(await invoiceJson(request,4000));
 return Response.json(await service.send(scope,input),{headers:privateHeaders});
}catch(error){const response=apiError(error);response.headers.set('Cache-Control','private, no-store');return response;}}
