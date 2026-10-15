import {z} from 'zod';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {approvedCheckoutAmount,requirePayPalCurrency} from './payment-guards.ts';
import {requireMerchantCheckout} from './merchant-scope.ts';
import type {PlanRecord} from './plan-repository.ts';
import type {MoneyEvent} from './model.ts';
import {claimPaymentFunding,commitFinancialEffect} from './financial-history.ts';

const maxMoney=100_000_000;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(`${value}T12:00:00Z`);return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;});
export const invoiceCreateRequest=z.object({version:z.number().int().nonnegative(),requestId:z.string().uuid(),
 itemId:z.string().min(1).max(160),revision:z.number().int().positive(),memberId:z.string().min(1).max(160),
 email:z.string().trim().email().max(254),due:date,dueAt:z.string().datetime({offset:true}),allowPartial:z.boolean(),minimum:z.number().int().min(1).max(maxMoney),
}).strict();
export const invoiceActionRequest=z.object({version:z.number().int().nonnegative(),invoiceVersion:z.number().int().nonnegative(),
 action:z.enum(['approve','reconcile','send','cancel']),confirm:z.boolean().optional()}).strict();
export type InvoiceCreate=z.infer<typeof invoiceCreateRequest>;
export type InvoiceStatus='creating'|'draft'|'sending'|'sent'|'partially-paid'|'paid'|'cancelling'|'cancelled'|'needs-review';
type Terms={planId:string;itemId:string;itemName:string;memberId:string;revision:number;amount:number;currency:'CAD';
 email:string;due:string;dueAt:string;allowPartial:boolean;minimum:number;reference:string;invoiceNumber:string;approvedSnapshot:string};
type InvoiceRow={id:string;owner:string;plan_id:string;item_id:string;member_id:string;revision:number;request_id:string;
 terms:string;approved_members:string;amount:number;minimum:number;paid:number;provider_id:string|null;provider_url:string|null;status:InvoiceStatus;provider_status:string|null;
 version:number;lease_until:number;lease_token:string|null;last_error:string|null;created:string;updated:string};
export type PlanInvoice={id:string;planId:string;itemId:string;memberId:string;revision:number;amount:number;minimum:number;paid:number;
 outstanding:number;currency:'CAD';due:string;dueAt:string;allowPartial:boolean;approvedMembers:string[];recipientEmail:string;providerId:string|null;status:InvoiceStatus;
 providerStatus:string|null;version:number;created:string;updated:string;paymentUrl:string|null;requiresReview:boolean};
export type InvoiceProvider=(path:string,method?:string,body?:unknown,key?:string)=>Promise<any>;
export type InvoiceScope={record:PlanRecord;memberId:string};
export type InvoicePayment={id:string;amount:number;event:MoneyEvent;body:string};
export type InvoiceCommit={row:InvoiceRow;expectedVersion:number;payments:InvoicePayment[];paid:number;status:InvoiceStatus;providerStatus:string;providerUrl:string|null;
 leaseToken:string;at:string};
export type InvoiceEffects={
 claim:(scope:InvoiceScope,invoiceId:string,itemId:string,revision:number,memberId:string)=>Promise<void>;
 commit:(scope:InvoiceScope,input:InvoiceCommit)=>Promise<void>;
};
export async function invoiceJson(request:Request,maxBytes:number):Promise<unknown>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new BackendError('INVALID_REQUEST','Send invoice requests as JSON.',415);
 const reader=request.body?.getReader();if(!reader)throw new BackendError('INVALID_REQUEST','Provide invoice JSON.');
 let text='',size=0;const decoder=new TextDecoder();
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
  if(size>maxBytes){await reader.cancel();throw new BackendError('REQUEST_TOO_LARGE',`Keep invoice requests under ${maxBytes} bytes.`,413);}
  text+=decoder.decode(next.value,{stream:true});}
  text+=decoder.decode();try{return JSON.parse(text);}catch{throw new BackendError('INVALID_REQUEST','Provide valid invoice JSON.');}
 }finally{reader.releaseLock();}
}
const unavailable=()=>new BackendError('INVOICE_UNAVAILABLE','This invoice is unavailable.',404);
const now=()=>new Date().toISOString();
function parseTerms(row:InvoiceRow):Terms{return JSON.parse(row.terms);}
function projection(row:InvoiceRow):PlanInvoice{
 const terms=parseTerms(row);
 return {id:row.id,planId:row.plan_id,itemId:row.item_id,memberId:row.member_id,revision:row.revision,amount:row.amount,
  minimum:row.minimum,paid:row.paid,outstanding:row.amount-row.paid,currency:'CAD',due:terms.due,dueAt:terms.dueAt,allowPartial:terms.allowPartial,approvedMembers:JSON.parse(row.approved_members),
  recipientEmail:terms.email,providerId:row.provider_id,status:row.status,providerStatus:row.provider_status,version:row.version,
  created:row.created,updated:row.updated,paymentUrl:['sent','partially-paid','paid'].includes(row.status)?row.provider_url:null,requiresReview:row.status==='needs-review'};
}
const access=`EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
 WHERE p.owner=plan_invoices.owner AND p.id=plan_invoices.plan_id AND p.status<>'deleted' AND m.member_id=?
 AND m.role IN ('owner','editor','viewer') AND (m.role='owner' OR m.member_id=plan_invoices.member_id))`;
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function money(amount:number){return {currency_code:'CAD',value:(amount/100).toFixed(2)};}
function invoiceUrl(data:any):string|null{
 const raw=data.detail?.metadata?.recipient_view_url;
 if(typeof raw!=='string'||raw.length>2048)return null;
 try{const url=new URL(raw);return url.protocol==='https:'&&url.hostname==='www.sandbox.paypal.com'&&url.pathname.startsWith('/invoice/')&&!url.username&&!url.password&&!url.port?url.href:null;}catch{return null;}
}
function cents(value:any,zero=false){
 if(!value||value.currency_code!=='CAD'||typeof value.value!=='string'||!/^\d+\.\d{2}$/.test(value.value))throw new BackendError('INVOICE_EVIDENCE','Invoice amount or currency needs merchant review.',409);
 const amount=Number(value.value.replace('.',''));
 if(!Number.isSafeInteger(amount)||amount<0||(!zero&&amount===0)||amount>maxMoney)throw new BackendError('INVOICE_EVIDENCE','Invoice amount needs merchant review.',409);
 return amount;
}
function sameApproved(scope:InvoiceScope,terms:Terms){
 const item=scope.record.state.items.find(value=>value.id===terms.itemId);
 if(!item||item.revision!==terms.revision||item.name!==terms.itemName||item.shares[terms.memberId]!==terms.amount||
  item.status==='cancelled'||!(item.required??item.participants).every(id=>item.approvals.includes(id))||
  JSON.stringify({name:item.name,price:item.price,participants:item.participants,shares:item.shares,required:item.required??item.participants,
   approvals:item.approvals,source:item.source})!==terms.approvedSnapshot)
  throw new BackendError('INVOICE_APPROVAL_CHANGED','Invoice terms no longer match the approved item. Cancel this invoice and approve a new revision.',409);
 requireMerchantCheckout(item);requirePayPalCurrency(scope.record.state.plan);
 if(item.expires&&(!Number.isFinite(Date.parse(item.expires))||Date.parse(item.expires)<=Date.now()))
  throw new BackendError('INVOICE_APPROVAL_CHANGED','This quote expired. Approve a new revision before sending an invoice.',409);
}

/** Verify fetched invoice evidence; browser-provided totals never enter the ledger. */
export function verifiedInvoicePayments(row:InvoiceRow,data:any):{payments:InvoicePayment[];paid:number;status:InvoiceStatus;providerStatus:string;providerUrl:string|null}{
 const terms=parseTerms(row),bad=()=>new BackendError('INVOICE_EVIDENCE','PayPal invoice evidence does not match its approved terms. Merchant review is required.',409);
 if(!row.provider_id||data.id!==row.provider_id||data.detail?.currency_code!=='CAD'||data.detail?.reference!==terms.reference||
  data.detail?.invoice_number!==terms.invoiceNumber||data.detail?.payment_term?.due_date!==terms.due||
  data.primary_recipients?.length!==1||data.primary_recipients[0]?.billing_info?.email_address!==terms.email||
  data.items?.length!==1||data.items[0]?.name!==terms.itemName||String(data.items[0]?.quantity)!=='1'||
  cents(data.items[0]?.unit_amount)!==terms.amount||cents(data.amount)!==terms.amount||
  data.configuration?.allow_tip!==false||data.configuration?.partial_payment?.allow_partial_payment!==terms.allowPartial||
  (terms.allowPartial&&cents(data.configuration?.partial_payment?.minimum_amount_due)!==terms.minimum)||
  (data.gratuity&&cents(data.gratuity,true)!==0)||(data.refunds?.refund_amount&&cents(data.refunds.refund_amount,true)!==0)||
  (data.refunds?.transactions?.length??0)>0)throw bad();
 const transactions=data.payments?.transactions??[],payments:InvoicePayment[]=[],seen=new Set<string>();
 if(!Array.isArray(transactions)||transactions.length>100)throw bad();
 for(const payment of transactions){
  if(payment.type!=='PAYPAL'||typeof payment.payment_id!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(payment.payment_id)||seen.has(payment.payment_id))throw bad();
  seen.add(payment.payment_id);const amount=cents(payment.amount);
  payments.push({id:payment.payment_id,amount,body:JSON.stringify({id:payment.payment_id,amount,currency:'CAD',invoiceId:row.provider_id}),event:{id:`invoice-payment-${payment.payment_id}`,
   itemId:row.item_id,kind:'expense',label:`${terms.itemName} · sandbox invoice payment`,shares:{[row.member_id]:amount},
   contributions:{[row.member_id]:amount},amount,status:'confirmed',mode:'sandbox',created:row.created,providerId:payment.payment_id,
   evidence:`Server-verified PayPal sandbox invoice ${row.provider_id}. Partial payments are buyer initiated; booking confirmation is separate.`}});
 }
 const paid=payments.reduce((sum,payment)=>sum+payment.amount,0);
 if(paid>row.amount||paid<row.paid||(data.payments?.paid_amount&&cents(data.payments.paid_amount,true)!==paid)||
  (data.due_amount&&cents(data.due_amount,true)!==row.amount-paid))throw bad();
 const status=String(data.status??'');
 if(!['DRAFT','SENT','SCHEDULED','UNPAID','PARTIALLY_PAID','PAID','CANCELLED','PAYMENT_PENDING'].includes(status)||
  ((status==='PAID')!==(paid===row.amount))||((status==='PARTIALLY_PAID')!==(paid>0&&paid<row.amount))||
  (status==='DRAFT'&&paid>0)||(status==='CANCELLED'&&paid>0))throw bad();
 return {payments,paid,providerStatus:status,providerUrl:invoiceUrl(data),status:paid===row.amount?'paid':paid>0?'partially-paid':status==='DRAFT'?'draft':status==='CANCELLED'?'cancelled':'sent'};
}

export class PlanInvoiceRepository {
 constructor(private database:D1Database,private provider:InvoiceProvider,private effects:InvoiceEffects){}
 private async row(scope:InvoiceScope,id:string){
  const row=await this.database.prepare(`SELECT * FROM plan_invoices WHERE id=? AND owner=? AND plan_id=? AND ${access}`)
   .bind(id,scope.record.owner,scope.record.state.plan.id!,scope.memberId).first<InvoiceRow>();
  if(!row)throw unavailable();return row;
 }
 async get(scope:InvoiceScope,id:string){return projection(await this.row(scope,id));}
 async list(scope:InvoiceScope){
  const rows=await this.database.prepare(`SELECT * FROM plan_invoices WHERE owner=? AND plan_id=? AND ${access} ORDER BY created DESC,id DESC LIMIT 100`)
   .bind(scope.record.owner,scope.record.state.plan.id!,scope.memberId).all<InvoiceRow>();
  return rows.results.map(projection);
 }
 async create(scope:InvoiceScope,input:InvoiceCreate){
  if(scope.record.role!=='owner')throw forbidden();
  if(scope.record.version!==input.version)throw conflict();
  const state=scope.record.state,id=(await hash(`plan-invoice:${scope.record.owner}:${state.plan.id}:${input.requestId}`)).slice(0,38);
  const prior=await this.database.prepare(`SELECT * FROM plan_invoices WHERE id=? AND owner=? AND plan_id=? AND ${access}`)
   .bind(id,scope.record.owner,state.plan.id!,scope.memberId).first<InvoiceRow>();
  if(prior){
   const terms=parseTerms(prior);
   if(terms.itemId!==input.itemId||terms.revision!==input.revision||terms.memberId!==input.memberId||terms.email!==input.email||
    terms.due!==input.due||terms.dueAt!==input.dueAt||terms.minimum!==input.minimum||terms.allowPartial!==input.allowPartial)
    throw new BackendError('INVOICE_IDEMPOTENCY','This request already belongs to different invoice terms. Use a new request ID.',409);
   if(prior.status!=='creating')return projection(prior);
   // Recover a saved provider ID even if the quote or plan subsequently changed.
   if(prior.provider_id)return this.completeCreate(scope,prior);
  }
  const item=state.items.find(value=>value.id===input.itemId);
  const amount=approvedCheckoutAmount(state,item,input.memberId,input.revision);
  if(!item)throw unavailable();requireMerchantCheckout(item);
  if(!state.people?.some(person=>person.id===input.memberId&&['owner','editor'].includes(person.role)))
   throw new BackendError('INVOICE_MEMBER','Choose a current paying member of the plan.');
  if(input.minimum>amount||(!input.allowPartial&&input.minimum!==amount))
   throw new BackendError('INVOICE_MINIMUM','The minimum must fit the approved share; a full-payment invoice requires the full amount.');
  const terms:Terms={planId:state.plan.id!,itemId:item.id,itemName:item.name,memberId:input.memberId,revision:item.revision,
   amount,currency:'CAD',email:input.email,due:input.due,dueAt:input.dueAt,allowPartial:input.allowPartial,minimum:input.minimum,
   reference:`pr:${id}`,invoiceNumber:`PR${id.slice(0,20)}`,approvedSnapshot:JSON.stringify({name:item.name,price:item.price,
    participants:item.participants,shares:item.shares,required:item.required??item.participants,approvals:item.approvals,source:item.source})};
  const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:state.plan.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.dueAt));
  if(localDay!==input.due)throw new BackendError('INVOICE_DEADLINE','The reminder deadline must fall on the invoice due date in the plan time zone.');
  await this.effects.claim(scope,id,item.id,item.revision,input.memberId);
  const at=now();
  await this.database.prepare(`INSERT OR IGNORE INTO plan_invoices (id,owner,plan_id,item_id,member_id,revision,request_id,terms,
   amount,minimum,status,created,updated) SELECT ?,?,?,?,?,?,?,?,?,?,'creating',?,? WHERE EXISTS
   (SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=?
    AND p.status='active' AND m.member_id=? AND m.role='owner')`)
   .bind(id,scope.record.owner,state.plan.id!,item.id,input.memberId,item.revision,input.requestId,JSON.stringify(terms),amount,input.minimum,
    at,at,scope.record.owner,state.plan.id!,scope.record.version,scope.memberId).run();
  let row=await this.row(scope,id);
  if(row.terms!==JSON.stringify(terms))throw new BackendError('INVOICE_IDEMPOTENCY','This request already belongs to different invoice terms. Use a new request ID.',409);
  if(row.status!=='creating')return projection(row);
  return this.completeCreate(scope,row);
 }
 private async completeCreate(scope:InvoiceScope,row:InvoiceRow){
  const terms=parseTerms(row);
  const lease=await this.lease(scope,row);
  try{
   if(!row.provider_id){
    const created=await this.provider('/v2/invoicing/invoices','POST',{
     detail:{invoice_number:terms.invoiceNumber,reference:terms.reference,currency_code:'CAD',
      payment_term:{term_type:'DUE_ON_DATE_SPECIFIED',due_date:terms.due},note:'Fictional PlanRecover sandbox merchant. No automatic installment collection.'},
     primary_recipients:[{billing_info:{email_address:terms.email}}],
     items:[{name:terms.itemName,quantity:'1',unit_amount:money(terms.amount)}],
     configuration:{allow_tip:false,partial_payment:{allow_partial_payment:terms.allowPartial,
      ...(terms.allowPartial?{minimum_amount_due:money(terms.minimum)}:{})}},
    },row.id);
    const providerId=created.id??created.href?.split('/').pop()??created.links?.find((link:any)=>link.rel==='self')?.href?.split('/').pop();
    if(typeof providerId!=='string'||!/^INV2-[A-Z0-9-]{4,80}$/.test(providerId))throw new BackendError('INVOICE_PROVIDER','PayPal returned no usable invoice ID.',502);
    const saved=await this.database.prepare('UPDATE plan_invoices SET provider_id=?,updated=? WHERE id=? AND owner=? AND lease_token=? AND provider_id IS NULL')
     .bind(providerId,now(),row.id,row.owner,lease).run();
    if(!saved.meta.changes)throw conflict();row={...row,provider_id:providerId};
   }
   const data=await this.provider(`/v2/invoicing/invoices/${encodeURIComponent(row.provider_id!)}`);
   const verified=verifiedInvoicePayments(row,data);
   if(verified.status!=='draft'||verified.paid!==0)throw new BackendError('INVOICE_EVIDENCE','A newly created invoice must remain an unpaid draft.',409);
   await this.finish(row,lease,verified.status,verified.providerStatus,0,verified.providerUrl);
   return this.get(scope,row.id);
  }catch(error){await this.fail(row,lease,error,false);throw error;}
 }
 private async lease(scope:InvoiceScope,row:InvoiceRow,active=true){
  const token=crypto.randomUUID();
  const result=await this.database.prepare(`UPDATE plan_invoices SET lease_token=?,lease_until=? WHERE id=? AND owner=? AND version=?
   AND lease_until<=? AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
    WHERE p.owner=plan_invoices.owner AND p.id=plan_invoices.plan_id AND ${active?"p.status='active'":"p.status<>'deleted'"} AND p.version=? AND m.member_id=?
    AND m.role IN ('owner','editor') AND (m.role='owner' OR m.member_id=plan_invoices.member_id))`)
   .bind(token,Date.now()+60000,row.id,row.owner,row.version,Date.now(),scope.record.version,scope.memberId).run();
  if(!result.meta.changes)throw new BackendError('INVOICE_BUSY','This invoice is changing. Refresh and try again shortly.',409);
  return token;
 }
 private async finish(row:InvoiceRow,lease:string,status:InvoiceStatus,providerStatus:string,paid:number,providerUrl:string|null=null){
  const result=await this.database.prepare(`UPDATE plan_invoices SET status=?,provider_status=?,paid=?,provider_url=COALESCE(?,provider_url),version=version+1,
   lease_token=NULL,lease_until=0,last_error=NULL,updated=? WHERE id=? AND owner=? AND version=? AND lease_token=?`)
   .bind(status,providerStatus,paid,providerUrl,now(),row.id,row.owner,row.version,lease).run();
  if(!result.meta.changes)throw conflict();
 }
 private async fail(row:InvoiceRow,lease:string,error:unknown,review:boolean){
  await this.database.prepare(`UPDATE plan_invoices SET lease_token=NULL,lease_until=0,last_error=?,status=CASE WHEN ?=1 THEN 'needs-review' ELSE status END,
   updated=? WHERE id=? AND owner=? AND lease_token=?`).bind(error instanceof BackendError?error.code:'PROVIDER_RETRY_REQUIRED',review?1:0,now(),row.id,row.owner,lease).run();
 }
 async act(scope:InvoiceScope,id:string,input:z.infer<typeof invoiceActionRequest>){
  if(!['owner','editor'].includes(scope.record.role))throw forbidden();
  if(scope.record.version!==input.version)throw conflict();
  const row=await this.row(scope,id);
  if(row.version!==input.invoiceVersion)throw conflict();
  if(input.action==='approve'){
   if(row.status!=='draft')throw new BackendError('INVOICE_STATE','Review and approve the draft invoice before it is sent.',409);
   if(input.confirm!==true)throw new BackendError('INVOICE_CONFIRM','Explicitly confirm these invoice terms.');
   sameApproved(scope,parseTerms(row));
   const approvals=[...new Set([...JSON.parse(row.approved_members) as string[],scope.memberId])];
   const result=await this.database.prepare(`UPDATE plan_invoices SET approved_members=?,version=version+1,updated=? WHERE id=? AND owner=? AND version=?
    AND lease_until<=? AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
     WHERE p.owner=plan_invoices.owner AND p.id=plan_invoices.plan_id AND p.status='active' AND p.version=? AND m.member_id=? AND m.role IN ('owner','editor'))`)
    .bind(JSON.stringify(approvals),now(),id,row.owner,row.version,Date.now(),scope.record.version,scope.memberId).run();
   if(!result.meta.changes)throw conflict();return this.get(scope,id);
  }
  if(!row.provider_id)throw new BackendError('INVOICE_RETRY_CREATE','Retry the original create request to recover this invoice.',409);
  if(input.action!=='reconcile'&&scope.record.role!=='owner')throw forbidden();
  if(input.action!=='reconcile'&&input.confirm!==true)throw new BackendError('INVOICE_CONFIRM','Explicitly confirm this invoice action.');
  if(input.action==='send'){
   if(!['draft','sending'].includes(row.status))throw new BackendError('INVOICE_STATE','Only an unpaid draft invoice can be sent.',409);
   sameApproved(scope,parseTerms(row));
   const approvals=JSON.parse(row.approved_members) as string[];
   if(!approvals.includes(row.member_id))throw new BackendError('INVOICE_APPROVAL_REQUIRED','The billed member must approve the invoice due date and partial-payment terms before it is sent.',409);
  }
  if(input.action==='cancel'&&(!['draft','sent','sending','cancelling','needs-review'].includes(row.status)||row.paid!==0))
   throw new BackendError('INVOICE_STATE','Paid invoices need a reviewed refund before cancellation.',409);
  const lease=await this.lease(scope,row,input.action!=='reconcile');
  try{
   const path=`/v2/invoicing/invoices/${encodeURIComponent(row.provider_id)}`;
   if(input.action==='send'){
    const current=verifiedInvoicePayments(row,await this.provider(path));
    if(current.status==='draft'){
     const started=await this.database.prepare(`UPDATE plan_invoices SET status='sending',updated=? WHERE id=? AND lease_token=?
      AND EXISTS(SELECT 1 FROM plans WHERE owner=? AND id=? AND version=? AND status='active')`)
      .bind(now(),row.id,lease,row.owner,row.plan_id,scope.record.version).run();
     if(!started.meta.changes)throw conflict();
     await this.provider(`${path}/send`,'POST',{send_to_recipient:true,send_to_invoicer:false},(await hash(`${row.id}:send`)).slice(0,38));
    }else if(current.status!=='sent')throw new BackendError('INVOICE_STATE','This invoice has changed and needs review.',409);
   }else if(input.action==='cancel'){
    const current=verifiedInvoicePayments(row,await this.provider(path));
    if(current.paid>0)throw new BackendError('INVOICE_STATE','A payment arrived. Review its refund before cancellation.',409);
    if(current.status!=='cancelled'){
     await this.database.prepare("UPDATE plan_invoices SET status='cancelling',updated=? WHERE id=? AND lease_token=?").bind(now(),row.id,lease).run();
     if(current.status==='draft')await this.provider(path,'DELETE',undefined,(await hash(`${row.id}:cancel`)).slice(0,38));
     else await this.provider(`${path}/cancel`,'POST',{subject:'PlanRecover sandbox invoice cancelled',note:'Approved item requires a new invoice.',send_to_recipient:false,send_to_invoicer:false},(await hash(`${row.id}:cancel`)).slice(0,38));
     await this.finish(row,lease,'cancelled',current.status==='draft'?'DELETED':'CANCELLED',0);
     return this.get(scope,id);
    }
   }
   const data=await this.provider(path),verified=verifiedInvoicePayments(row,data);
   await this.effects.commit(scope,{row,expectedVersion:row.version,payments:verified.payments,paid:verified.paid,status:verified.status,
    providerStatus:verified.providerStatus,providerUrl:verified.providerUrl,leaseToken:lease,at:now()});
   return this.get(scope,id);
  }catch(error){await this.fail(row,lease,error,error instanceof BackendError&&error.code==='INVOICE_EVIDENCE');throw error;}
 }
}

/** Shared root ledger commits provider evidence and the invoice paid amount together. */
export function invoiceFinancialEffects(database:D1Database):InvoiceEffects {
 return {
  claim:async(scope,invoiceId,itemId,revision,memberId)=>{
   await claimPaymentFunding(database,{owner:scope.record.owner,planId:scope.record.state.plan.id!,itemId,revision,memberId,channel:'invoice',referenceId:invoiceId});
  },
  commit:async(scope,input)=>{
   const {row,leaseToken,expectedVersion}=input;
   for(const payment of input.payments){
    const guard=crypto.randomUUID();
    const statements=[
     database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN
      EXISTS(SELECT 1 FROM plan_invoice_payments WHERE id=? AND invoice_id=? AND owner=? AND amount=? AND body=?)
      OR EXISTS(SELECT 1 FROM plan_invoices WHERE id=? AND owner=? AND version=? AND lease_token=? AND paid+?<=amount)
      THEN 1 ELSE 0 END)`).bind(guard,payment.id,row.id,row.owner,payment.amount,payment.body,row.id,row.owner,expectedVersion,leaseToken,payment.amount),
     database.prepare(`UPDATE plan_invoices SET paid=paid+?,status=CASE WHEN paid+?=amount THEN 'paid' ELSE 'partially-paid' END,updated=?
      WHERE id=? AND owner=? AND version=? AND lease_token=? AND NOT EXISTS(SELECT 1 FROM plan_invoice_payments WHERE id=?)`)
      .bind(payment.amount,payment.amount,input.at,row.id,row.owner,expectedVersion,leaseToken,payment.id),
     database.prepare(`INSERT OR IGNORE INTO plan_invoice_payments(id,invoice_id,owner,plan_id,amount,body,created)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM plan_invoices WHERE id=? AND owner=? AND version=? AND lease_token=?)`)
      .bind(payment.id,row.id,row.owner,row.plan_id,payment.amount,payment.body,input.at,row.id,row.owner,expectedVersion,leaseToken),
     database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
    ];
    await commitFinancialEffect(database,{owner:row.owner,planId:row.plan_id,event:payment.event,statements,
     markPaid:{memberId:row.member_id,revision:row.revision,amount:row.amount}});
   }
   const guard=crypto.randomUUID();
   await database.batch([
    database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plan_invoices
     WHERE id=? AND owner=? AND version=? AND lease_token=? AND paid=? AND paid=(SELECT COALESCE(SUM(amount),0)
      FROM plan_invoice_payments WHERE invoice_id=?)) THEN 1 ELSE 0 END)`)
     .bind(guard,row.id,row.owner,expectedVersion,leaseToken,input.paid,row.id),
    database.prepare(`UPDATE plan_invoices SET status=?,provider_status=?,provider_url=COALESCE(?,provider_url),version=version+1,lease_token=NULL,lease_until=0,
     last_error=NULL,updated=? WHERE id=? AND owner=? AND version=? AND lease_token=?`)
     .bind(input.status,input.providerStatus,input.providerUrl,input.at,row.id,row.owner,expectedVersion,leaseToken),
    database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
   ]);
  },
 };
}

/** Server recovery jobs only: read existing canonical invoices, never create or send. */
export async function reconcilePendingPlanInvoices(database:D1Database,provider:InvoiceProvider,options:{owner:string;limit?:number}){
 const limit=Math.min(10,Math.max(1,Math.floor(options.limit??10))),results:{id:string;status:string}[]=[];
 const rows=await database.prepare(`SELECT * FROM plan_invoices WHERE owner=? AND provider_id IS NOT NULL
  AND status IN ('creating','sending','sent','partially-paid','needs-review') AND lease_until<=? ORDER BY updated,id LIMIT ?`)
  .bind(options.owner,Date.now(),limit).all<InvoiceRow>();
 const effects=invoiceFinancialEffects(database);
 for(const row of rows.results){
  const token=crypto.randomUUID();
  const leased=await database.prepare('UPDATE plan_invoices SET lease_token=?,lease_until=? WHERE id=? AND owner=? AND version=? AND lease_until<=?')
   .bind(token,Date.now()+60000,row.id,options.owner,row.version,Date.now()).run();
  if(!leased.meta.changes){results.push({id:row.id,status:'busy'});continue;}
  try{
   const plan=await database.prepare('SELECT body,version FROM plans WHERE owner=? AND id=?').bind(row.owner,row.plan_id).first<{body:string;version:number}>();
   if(!plan)throw new BackendError('INVOICE_PLAN_MISSING','This invoice needs merchant review.',409);
   const record:PlanRecord={owner:row.owner,state:JSON.parse(plan.body),version:plan.version,role:'owner'};
   const evidence=verifiedInvoicePayments(row,await provider(`/v2/invoicing/invoices/${encodeURIComponent(row.provider_id!)}`));
   await effects.commit({record,memberId:row.member_id},{row,expectedVersion:row.version,payments:evidence.payments,paid:evidence.paid,
    status:evidence.status,providerStatus:evidence.providerStatus,providerUrl:evidence.providerUrl,leaseToken:token,at:now()});
   results.push({id:row.id,status:evidence.status});
  }catch(error){
   const review=error instanceof BackendError&&['INVOICE_EVIDENCE','INVOICE_PLAN_MISSING','FINANCIAL_EFFECT_CONFLICT'].includes(error.code);
   await database.prepare(`UPDATE plan_invoices SET lease_token=NULL,lease_until=0,status=CASE WHEN ?=1 THEN 'needs-review' ELSE status END,
    last_error=?,updated=? WHERE id=? AND owner=? AND lease_token=?`).bind(review?1:0,error instanceof BackendError?error.code:'PROVIDER_RETRY_REQUIRED',now(),row.id,row.owner,token).run();
   results.push({id:row.id,status:review?'needs-review':'retry'});
  }
 }
 return {scanned:rows.results.length,results};
}
