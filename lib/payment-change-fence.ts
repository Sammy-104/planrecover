import {BackendError} from './backend-errors.ts';

type Scope={owner:string;planId:string;itemIds:string[]};
/** These predicates run again inside the same transaction that changes items.
 * Funding claims fence the gap before a checkout/invoice row has been written. */
function blockers(input:Scope){
 const ids=JSON.stringify(input.itemIds);
 return {sql:`EXISTS(SELECT 1 FROM provider_operations o WHERE o.owner=? AND o.item_id IN (SELECT value FROM json_each(?))
   AND (CASE WHEN json_valid(o.payload) THEN json_extract(o.payload,'$.planrecoverTripId') ELSE NULL END IS NULL
    OR CASE WHEN json_valid(o.payload) THEN json_extract(o.payload,'$.planrecoverTripId') ELSE NULL END=?)
   AND o.status NOT IN ('captured','refunded','cancelled','failed','completed'))
  OR EXISTS(SELECT 1 FROM plan_invoices i WHERE i.owner=? AND i.plan_id=? AND i.item_id IN (SELECT value FROM json_each(?))
   AND NOT (COALESCE(i.lifecycle_status,i.status) IN ('paid','cancelled','closed') OR COALESCE(i.lifecycle_status,i.status) IN ('partially-refunded','refunded')
    AND (i.paid=i.amount OR EXISTS(SELECT 1 FROM invoice_collection_closures c WHERE c.invoice_id=i.id AND c.status='verified'))))
  OR EXISTS(SELECT 1 FROM invoice_refund_requests r JOIN plan_invoices i ON i.id=r.invoice_id
   WHERE r.owner=? AND r.plan_id=? AND i.item_id IN (SELECT value FROM json_each(?)) AND (r.status IN ('review','awaiting-merchant')
    OR r.status='completed' AND r.amount>(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=r.id)))
  OR EXISTS(SELECT 1 FROM payment_funding_claims f WHERE f.owner=? AND f.plan_id=? AND f.item_id IN (SELECT value FROM json_each(?))
   AND ((f.channel='order' AND NOT EXISTS(SELECT 1 FROM provider_operations o WHERE o.id=f.reference_id AND o.owner=f.owner))
    OR (f.channel='invoice' AND NOT EXISTS(SELECT 1 FROM plan_invoices i WHERE i.id=f.reference_id AND i.owner=f.owner AND i.plan_id=f.plan_id))))`,
  values:[input.owner,ids,input.planId,input.owner,input.planId,ids,input.owner,input.planId,ids,input.owner,input.planId,ids]};
}
export async function assertPaymentChangeReady(database:D1Database,input:Scope){
 const condition=blockers(input),row=await database.prepare(`SELECT CASE WHEN ${condition.sql} THEN 1 ELSE 0 END AS blocked`).bind(...condition.values).first<{blocked:number}>();
 if(row?.blocked)throw new BackendError('CHANGE_PAYMENTS','Resolve pending payment and invoice operations before changing these bookings.',409);
}
export function paymentChangeGuard(database:D1Database,input:Scope,token:string){
 const condition=blockers(input);
 return database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN NOT (${condition.sql}) THEN 1 ELSE 0 END)`).bind(token,...condition.values);
}
