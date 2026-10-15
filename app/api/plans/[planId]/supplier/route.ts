import {env} from 'cloudflare:workers';
import {apiError,checkOrigin,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {runSupplierOperation,supplierRequest} from '@/lib/supplier-adapter';
import {forbidden} from '@/lib/backend-errors';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {identity,repository}=await planApiContext(request),{planId}=await context.params,record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();const rows=await db().prepare("SELECT id,kind,request,response,status,updated FROM adapter_operations WHERE owner=? AND plan_id=? AND provider='supplier' ORDER BY created DESC LIMIT 50").bind(record.owner,planId).all<{id:string;kind:string;request:string;response:string|null;status:string;updated:string}>();return Response.json({operations:rows.results.map(row=>({...row,request:JSON.parse(row.request),response:row.response?JSON.parse(row.response):null}))},{headers:privateHeaders});}catch(e){return apiError(e);}}
export async function POST(request:Request,context:Context){try{checkOrigin(request);const {identity}=await planApiContext(request),{planId}=await context.params,input=supplierRequest.parse(await invoiceJson(request,4000));return Response.json(await runSupplierOperation(db(),env as unknown as Record<string,unknown>,planId,identity,input),{headers:privateHeaders});}catch(e){return apiError(e);}}
