import {PlanRepository} from './plan-repository.ts';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
import {providerCents,type PaymentOperation,type ProviderOrder} from './payment-guards.ts';
import type {Identity} from './people.ts';
export async function closeUnpaidCheckout(database:D1Database,planId:string,identity:Identity,input:{changeId:string;operationId:string},fetchOrder:(id:string)=>Promise<ProviderOrder>){
 const repository=new PlanRepository(database),record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();
 const change=await database.prepare("SELECT body FROM plan_changes c WHERE id=? AND owner=? AND plan_id=? AND status='review' AND NOT EXISTS(SELECT 1 FROM json_each(c.body,'$.required') m WHERE NOT EXISTS(SELECT 1 FROM plan_change_approvals a WHERE a.change_id=c.id AND a.member_id=m.value))").bind(input.changeId,record.owner,planId).first<{body:string}>();
 const operation=await database.prepare("SELECT * FROM provider_operations WHERE id=? AND owner=? AND kind='order'").bind(input.operationId,record.owner).first<PaymentOperation>();
 if(!change||!operation||JSON.parse(operation.payload??'{}').planrecoverTripId!==planId||!JSON.parse(change.body).originals.some((item:any)=>item.id===operation.item_id&&item.revision===operation.revision))throw conflict();
 if(operation.status==='cancelled')return {status:'cancelled',providerMutations:false};
 if(!operation.provider_id)throw new BackendError('CHECKOUT_REVIEW','Recover the saved order identity before closing this checkout.',409);
 const order=await fetchOrder(operation.provider_id),unit=order.purchase_units?.[0];
 if(order.id!==operation.provider_id||!['CREATED','SAVED','APPROVED','PAYER_ACTION_REQUIRED','VOIDED'].includes(order.status??'')||order.purchase_units?.length!==1||unit?.custom_id!==operation.id||unit.reference_id!==operation.item_id||providerCents(unit.amount)!==operation.amount||unit.payments?.captures?.length)throw new BackendError('CHECKOUT_REVIEW','A possible payment needs canonical reconciliation before this checkout can close.',409);
 const token=crypto.randomUUID();try{await database.batch([
  database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND m.member_id=? AND m.role='owner') AND EXISTS(SELECT 1 FROM plan_changes c WHERE c.id=? AND c.owner=? AND c.plan_id=? AND c.status='review' AND NOT EXISTS(SELECT 1 FROM json_each(c.body,'$.required') member WHERE NOT EXISTS(SELECT 1 FROM plan_change_approvals a WHERE a.change_id=c.id AND a.member_id=member.value))) AND NOT EXISTS(SELECT 1 FROM provider_request_intents WHERE operation_id=?) THEN 1 ELSE 0 END)").bind(token,record.owner,planId,record.version,identity.id,input.changeId,record.owner,planId,`capture-${operation.id}`),
  database.prepare("UPDATE provider_operations SET status='cancelled' WHERE id=? AND owner=? AND status<>'captured'").bind(operation.id,record.owner),database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)
 ]);}catch{throw new BackendError('CHECKOUT_REVIEW','A capture may already have started. Reconcile it before continuing this change.',409);}
 return {status:'cancelled',message:'This unpaid checkout is closed in PlanRecover. Its old approval cannot submit a capture.',providerMutations:false};
}
