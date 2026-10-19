/** Allocate finite canonical refund evidence in stable request order. All returned
 * statements must share the invoice lease/version transaction with completion. */
export async function invoiceRefundEvidenceWrites(database:D1Database,invoiceId:string,at:string){
 const requests=await database.prepare(`SELECT q.id,q.terms,q.amount-(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=q.id) AS remaining
  FROM invoice_refund_requests q WHERE q.invoice_id=? AND q.status IN ('awaiting-merchant','completed') AND q.approved_owner=1 AND q.approved_member=1
   AND q.amount>(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=q.id) ORDER BY q.created,q.id LIMIT 100`).bind(invoiceId).all<{id:string;terms:string;remaining:number}>();
 const refunds=await database.prepare(`SELECT r.refund_id,r.amount-(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.refund_id=r.refund_id) AS remaining
  FROM invoice_refunds r WHERE r.invoice_id=? AND r.amount>(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.refund_id=r.refund_id) ORDER BY r.created,r.refund_id`).bind(invoiceId).all<{refund_id:string;remaining:number}>();
 const statements:D1PreparedStatement[]=[];
 // The invoice lease serializes allocators. The database trigger independently
 // enforces each request/refund capacity if any caller violates that contract.
 // Each segment fills a request or refund, keeping the batch bounded by their
 // count rather than a request-by-refund cross product.
 for(const request of requests.results){const previous=new Set<string>(JSON.parse(request.terms).previousRefunds??[]);
  for(const refund of refunds.results){if(!request.remaining)break;if(!refund.remaining||previous.has(refund.refund_id))continue;
   const amount=Math.min(request.remaining,refund.remaining);request.remaining-=amount;refund.remaining-=amount;
   statements.push(database.prepare('INSERT INTO invoice_refund_allocations(request_id,refund_id,amount,created) VALUES (?,?,?,?)').bind(request.id,refund.refund_id,amount,at));
  }
 }
 if(requests.results.length)statements.push(database.prepare(`UPDATE invoice_refund_requests SET status=CASE
  WHEN amount=(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=invoice_refund_requests.id) THEN 'completed' ELSE 'awaiting-merchant' END
  WHERE invoice_id=? AND id IN (SELECT value FROM json_each(?)) AND status IN ('awaiting-merchant','completed') AND approved_owner=1 AND approved_member=1`).bind(invoiceId,JSON.stringify(requests.results.map(r=>r.id))));
 return statements;
}

/** Legacy completed rows are progress claims, not proof, until allocations exist. */
export function invoiceRefundRequestView<T extends {status:string;amount:number;allocated_amount?:number}>(row:T){
 return {...row,status:row.status==='completed'&&(row.allocated_amount??0)<row.amount?'awaiting-merchant':row.status};
}
