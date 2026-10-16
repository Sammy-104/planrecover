import {z} from 'zod';
import {PlanRepository} from './plan-repository.ts';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import type {Identity} from './people.ts';
export const invoiceRefundRequest=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),invoiceId:z.string().min(1).max(180),requestId:z.string().uuid(),amount:z.number().int().positive().max(1e8),reason:z.string().trim().min(1).max(2000),version:z.number().int().nonnegative()}).strict(),
 z.object({action:z.enum(['approve','handoff','cancel']),id:z.string().uuid(),confirm:z.literal(true)}).strict(),
 z.object({action:z.literal('close-collection'),invoiceId:z.string().min(1).max(180),changeId:z.string().uuid(),confirm:z.literal(true)}).strict(),
]);
export class InvoiceRefundService{
 constructor(private database:D1Database){}
 async list(planId:string,identity:Identity){const record=await new PlanRepository(this.database).getPlan(planId,identity);const rows=await this.database.prepare("SELECT * FROM invoice_refund_requests WHERE owner=? AND plan_id=? AND (member_id=? OR ?='owner') ORDER BY created DESC LIMIT 100").bind(record.owner,planId,identity.id,record.role).all();return rows.results;}
 async act(planId:string,identity:Identity,input:z.infer<typeof invoiceRefundRequest>){
  const record=await new PlanRepository(this.database).getPlan(planId,identity);
  if(input.action==='close-collection'){
   if(record.role!=='owner')throw forbidden();
   const change=await this.database.prepare("SELECT body FROM plan_changes WHERE id=? AND owner=? AND plan_id=? AND status='review' AND NOT EXISTS(SELECT 1 FROM json_each(body,'$.required') m WHERE NOT EXISTS(SELECT 1 FROM plan_change_approvals a WHERE a.change_id=plan_changes.id AND a.member_id=m.value))").bind(input.changeId,record.owner,planId).first<{body:string}>();
   const invoice=await this.database.prepare('SELECT * FROM plan_invoices WHERE id=? AND owner=? AND plan_id=?').bind(input.invoiceId,record.owner,planId).first<any>();
   if(!change||!invoice||invoice.paid<=0||invoice.paid>=invoice.amount||!JSON.parse(change.body).originals.some((i:any)=>i.id===invoice.item_id&&i.revision===invoice.revision))throw conflict();
   const guard=crypto.randomUUID();await this.database.batch([
    this.database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plan_changes c JOIN plans p ON p.id=c.plan_id AND p.owner=c.owner JOIN plan_members m ON m.plan_id=p.id AND m.owner=p.owner WHERE c.id=? AND c.owner=? AND c.plan_id=? AND c.status='review' AND p.version=? AND m.member_id=? AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM json_each(c.body,'$.required') member WHERE NOT EXISTS(SELECT 1 FROM plan_change_approvals a WHERE a.change_id=c.id AND a.member_id=member.value))) AND EXISTS(SELECT 1 FROM plan_invoices WHERE id=? AND paid=? AND paid>0 AND paid<amount) THEN 1 ELSE 0 END)").bind(guard,input.changeId,record.owner,planId,record.version,identity.id,invoice.id,invoice.paid),
    this.database.prepare('INSERT OR IGNORE INTO invoice_collection_closures(invoice_id,change_id,amount,body,created) VALUES (?,?,?,?,?)').bind(invoice.id,input.changeId,invoice.paid,JSON.stringify({invoiceId:invoice.provider_id,originalTerms:invoice.terms,paid:invoice.paid,expectedTotal:invoice.paid,expectedDue:0,allowPartial:false}),new Date().toISOString()),this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)]);
   return {status:'awaiting-merchant',instruction:'In the sandbox merchant account, revise this invoice total to the collected amount and disable partial payments. Keep the recipient, description and reference. Then check its saved status. No money is refunded by this step.',expectedTotal:invoice.paid,merchantUrl:'https://www.sandbox.paypal.com/invoice/manage'};
  }
  if(input.action==='prepare'){
   if(record.role!=='owner'||record.version!==input.version)throw forbidden();
   const invoice=await this.database.prepare('SELECT * FROM plan_invoices WHERE id=? AND owner=? AND plan_id=?').bind(input.invoiceId,record.owner,planId).first<any>();
   if(!invoice||!invoice.provider_id)throw conflict();
   const id=input.requestId,body=JSON.stringify({reason:input.reason,invoiceProviderId:invoice.provider_id,paymentIds:(await this.database.prepare('SELECT id FROM plan_invoice_payments WHERE invoice_id=? ORDER BY id').bind(invoice.id).all<{id:string}>()).results.map(r=>r.id),previousRefunds:(await this.database.prepare('SELECT refund_id FROM invoice_refunds WHERE invoice_id=? ORDER BY refund_id').bind(invoice.id).all<{refund_id:string}>()).results.map(r=>r.refund_id)});
   const prior=await this.database.prepare('SELECT owner,invoice_id,amount,terms,status FROM invoice_refund_requests WHERE id=?').bind(id).first<any>();if(prior){if(prior.owner!==record.owner||prior.invoice_id!==invoice.id||prior.amount!==input.amount||prior.terms!==body)throw conflict();return {id,status:prior.status,amount:prior.amount,financialEffects:false};}
   const guard=crypto.randomUUID();await this.database.batch([
    this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.plan_id=p.id AND m.owner=p.owner WHERE p.owner=? AND p.id=? AND p.version=? AND m.member_id=? AND m.role='owner') AND (EXISTS(SELECT 1 FROM invoice_refund_requests WHERE id=? AND owner=? AND invoice_id=? AND amount=? AND terms=?) OR (NOT EXISTS(SELECT 1 FROM invoice_refund_requests WHERE id=?) AND ?<=(SELECT paid FROM plan_invoices WHERE id=?)-(SELECT COALESCE(SUM(amount),0) FROM invoice_refunds WHERE invoice_id=?)-(SELECT COALESCE(SUM(amount),0) FROM invoice_refund_requests WHERE invoice_id=? AND status IN ('review','awaiting-merchant')))) THEN 1 ELSE 0 END)`).bind(guard,record.owner,planId,record.version,identity.id,id,record.owner,invoice.id,input.amount,body,id,input.amount,invoice.id,invoice.id,invoice.id),
    this.database.prepare("INSERT OR IGNORE INTO invoice_refund_requests(id,owner,plan_id,invoice_id,member_id,amount,currency,terms,created) VALUES (?,?,?,?,?,?,'CAD',?,?)").bind(id,record.owner,planId,invoice.id,invoice.member_id,input.amount,body,new Date().toISOString()),this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)]);
   return {id,status:'review',amount:input.amount,financialEffects:false};
  }
  const row=await this.database.prepare('SELECT * FROM invoice_refund_requests WHERE id=? AND owner=? AND plan_id=?').bind(input.id,record.owner,planId).first<any>();if(!row)throw conflict();
  if(input.action==='cancel'){if(record.role!=='owner'||row.status!=='review')throw forbidden();await this.database.prepare("UPDATE invoice_refund_requests SET status='cancelled' WHERE id=? AND status='review'").bind(row.id).run();return {id:row.id,status:'cancelled',financialEffects:false};}
  if(input.action==='approve'){
   if(!['review','awaiting-merchant','completed'].includes(row.status))throw conflict();
   if(record.role!=='owner'&&row.member_id!==identity.id)throw forbidden();
   await this.database.prepare('UPDATE invoice_refund_requests SET approved_owner=MAX(approved_owner,?),approved_member=MAX(approved_member,?) WHERE id=?').bind(record.role==='owner'?1:0,row.member_id===identity.id?1:0,row.id).run();return {id:row.id,status:row.status};
  }
  if(!['review','awaiting-merchant','completed'].includes(row.status))throw conflict();
  if(record.role!=='owner'||!row.approved_owner||!row.approved_member)throw new BackendError('REFUND_APPROVALS','The owner and billed member must approve this exact refund first.',409);
  await this.database.prepare("UPDATE invoice_refund_requests SET status='awaiting-merchant' WHERE id=? AND status='review'").bind(row.id).run();
  return {id:row.id,status:row.status==='completed'?'completed':'awaiting-merchant',amount:row.amount,merchantUrl:'https://www.sandbox.paypal.com/invoice/manage',instruction:'Issue the approved refund against the original invoice payment in the sandbox merchant account, then check invoice status here. Only verified PayPal refund evidence updates balances.',financialEffects:false};
 }
}
