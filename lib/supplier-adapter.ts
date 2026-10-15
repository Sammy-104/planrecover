import {z} from 'zod';
import {providerConfig,providerPost,type Env} from './http-adapters.ts';
import {PlanRepository} from './plan-repository.ts';
import {PlanChangeService} from './plan-changes.ts';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {planCurrency} from './money.ts';
import type {Identity} from './people.ts';
const identifier=z.string().regex(/^[A-Za-z0-9._:-]{1,180}$/);
const quote=z.object({sandbox:z.literal(true),quoteId:identifier,itemId:identifier,revision:z.number().int().positive(),amount:z.number().int().nonnegative().max(1e12),currency:z.string().regex(/^[A-Z]{3}$/),expiresAt:z.string().datetime({offset:true}),available:z.boolean(),terms:z.string().min(1).max(5000),sourceUrl:z.string().url().refine(u=>u.startsWith('https://'))}).strict();
const booking=z.object({sandbox:z.literal(true),requestId:identifier,bookingId:identifier,quoteId:identifier,status:z.enum(['confirmed','pending','cancelled','failed']),amount:z.number().int().nonnegative().max(1e12),currency:z.string().regex(/^[A-Z]{3}$/)}).strict();
export const supplierRequest=z.object({operation:z.enum(['quote','book','cancel','status']),requestId:z.string().uuid(),version:z.number().int().nonnegative(),itemId:identifier,revision:z.number().int().positive(),quoteOperationId:z.string().uuid().optional(),bookingOperationId:z.string().uuid().optional(),changeId:z.string().uuid().optional(),confirm:z.boolean().optional()}).strict();
export async function runSupplierOperation(database:D1Database,env:Env,planId:string,identity:Identity,input:z.infer<typeof supplierRequest>,fetcher:typeof fetch=fetch){
 const repository=new PlanRepository(database),record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();if(record.version!==input.version)throw conflict();
 const item=record.state.items.find(i=>i.id===input.itemId);if(!item||item.revision!==input.revision)throw conflict();
 const config=providerConfig(env,'SUPPLIER');if(!config)throw new BackendError('SUPPLIER_UNCONFIGURED','The owner must configure a sandbox supplier adapter.',503);
 if(env.SUPPLIER_MODE!=='sandbox')throw new BackendError('SUPPLIER_MODE','Only explicitly configured sandbox suppliers are enabled.',503);
 const existing=await database.prepare('SELECT * FROM adapter_operations WHERE id=? AND owner=? AND plan_id=? AND provider=?').bind(input.requestId,record.owner,planId,'supplier').first<{request:string;response:string|null;status:string;lease_until:number}>();
 const request={...input};if(existing&&existing.request!==JSON.stringify(request))throw conflict();if(existing?.status==='completed')return JSON.parse(existing.response!);
 const body:Record<string,unknown>={sandbox:true,requestId:input.requestId,item:{id:item.id,revision:item.revision,name:item.name,start:item.start,duration:item.duration,participants:item.participants.length,currency:planCurrency(record.state.plan)}};
 async function prior(id:string|undefined,kind:string){if(!id)throw new BackendError('SUPPLIER_REFERENCE','Select a saved provider quote or booking.');const row=await database.prepare("SELECT response,request FROM adapter_operations WHERE id=? AND owner=? AND plan_id=? AND provider='supplier' AND kind=? AND status='completed'").bind(id,record.owner,planId,kind).first<{response:string;request:string}>();if(!row)throw forbidden();const original=JSON.parse(row.request);if(original.itemId!==item!.id||original.revision!==item!.revision)throw conflict();return JSON.parse(row.response);}
 if(input.operation==='book'){
  if(input.confirm!==true||env.SUPPLIER_BOOKING_ENABLED!=='true')throw forbidden();if(item.status==='cancelled'||item.booking==='failed')throw conflict();const saved=quote.parse(await prior(input.quoteOperationId,'quote'));
  if(!saved.available||saved.itemId!==item.id||saved.revision!==item.revision||saved.currency!==planCurrency(record.state.plan)||saved.amount!==item.price||Date.parse(saved.expiresAt)<=Date.now())throw conflict();
  if(!(item.required??item.participants).every(id=>item.approvals.includes(id))||!item.participants.every(id=>item.paid.includes(id)))throw new BackendError('SUPPLIER_FUNDING','Confirm current participant approvals and verified payment before booking.',409);
  const paid=record.state.events.filter(e=>e.itemId===item.id&&e.status==='confirmed'&&['expense','refund'].includes(e.kind)&&e.mode==='sandbox'&&e.providerId).reduce((n,e)=>n+e.amount,0);if(paid!==saved.amount)throw new BackendError('SUPPLIER_FUNDING','Verified sandbox payments must match this quote exactly.',409);body.quoteId=saved.quoteId;body.amount=saved.amount;
 }
 if(input.operation==='cancel'||input.operation==='status'){
  const saved=booking.parse(await prior(input.bookingOperationId,'book'));body.bookingId=saved.bookingId;
  if(input.operation==='cancel'){
   if(input.confirm!==true||!input.changeId||env.SUPPLIER_BOOKING_ENABLED!=='true')throw forbidden();const change=await new PlanChangeService(database).get(planId,identity,input.changeId);
   if(!change.fullyApproved||change.status!=='review'||change.terms.kind!=='recovery'||change.terms.option==='keep'||!change.terms.originals.some(i=>i.id===item.id&&i.revision===item.revision))throw forbidden();body.changeId=change.id;
  }
 }
 const now=new Date().toISOString();await database.prepare(`INSERT OR IGNORE INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,created,updated)
 SELECT ?,?,?,?,?,?,?,?,? WHERE ?<>'book' OR NOT EXISTS(SELECT 1 FROM adapter_operations WHERE owner=? AND plan_id=? AND provider='supplier' AND kind='book' AND json_extract(request,'$.itemId')=? AND json_extract(request,'$.revision')=? AND id<>?)`).bind(input.requestId,record.owner,planId,identity.id,'supplier',input.operation,JSON.stringify(request),now,now,input.operation,record.owner,planId,item.id,item.revision,input.requestId).run();
 const token=crypto.randomUUID(),claim=await database.prepare("UPDATE adapter_operations SET status='processing',lease_token=?,lease_until=? WHERE id=? AND owner=? AND request=? AND status IN ('prepared','uncertain','processing') AND lease_until<=?").bind(token,Date.now()+30000,input.requestId,record.owner,JSON.stringify(request),Date.now()).run();if(!claim.meta.changes)throw new BackendError('SUPPLIER_BUSY','Review the saved booking request or wait for its current attempt to finish.',409);
 try{const fresh=await repository.getPlan(planId,identity);if(fresh.version!==record.version)throw conflict();
  const result=await providerPost(config,'/'+input.operation,body,input.requestId,fetcher),checked=input.operation==='quote'?quote.parse(result):booking.parse(result);
  if('itemId' in checked&&(checked.itemId!==item.id||checked.revision!==item.revision)||checked.currency!==planCurrency(record.state.plan)||'requestId' in checked&&checked.requestId!==input.requestId||input.operation==='book'&&('quoteId' in checked&&checked.quoteId!==body.quoteId||checked.amount!==body.amount))throw new BackendError('SUPPLIER_EVIDENCE','Provider evidence does not match the saved request.',502);
  const saved=await database.prepare("UPDATE adapter_operations SET status='completed',response=?,lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=?").bind(JSON.stringify(checked),new Date().toISOString(),input.requestId,token).run();if(!saved.meta.changes)throw conflict();
  const current=await repository.getPlan(planId,identity);if(current.role!=='owner'||current.version!==record.version)throw conflict();return checked;
 }catch(error){await database.prepare("UPDATE adapter_operations SET status='uncertain',lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=?").bind(new Date().toISOString(),input.requestId,token).run();throw error;}
}
