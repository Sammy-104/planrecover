import {formatMoney} from '@/lib/money';

type People={id:string;name:string}[];
const memberName=(people:People,id:string)=>people.find(person=>person.id===id)?.name??id;
function instant(value:string|null|undefined,timezone:string){
 if(!value)return 'Not supplied';
 try{return new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value))+` (${timezone})`;}catch{return 'Invalid saved deadline — refresh before approving';}
}
function Source({value}:{value?:string}){
 try{const url=new URL(value??'');if(url.protocol==='https:'&&!url.username&&!url.password)return <a href={url.href} target="_blank" rel="noreferrer">Open reviewed supplier source</a>;}catch{}
 return <span>No public source link supplied</span>;
}
export function InvoiceReviewTerms({invoice,people,timezone}:{invoice:any;people:People;timezone:string}){
 const money=(amount:number)=>formatMoney(amount,invoice.currency);
 return <section className="financial-review" aria-label="Invoice terms for approval">
  <dl><dt>Invoice total</dt><dd>{money(invoice.amount)} · {invoice.currency}</dd>
   <dt>Billed person</dt><dd>{memberName(people,invoice.memberId)} · {invoice.recipientEmail}</dd>
   <dt>Payment due</dt><dd>{instant(invoice.dueAt,timezone)}</dd>
   <dt>Partial payments</dt><dd>{invoice.allowPartial?`Allowed · minimum ${money(invoice.minimum)}`:'Not allowed — the full outstanding amount is due'}</dd>
   <dt>Approved item revision</dt><dd>{invoice.revision} · invoice revision {invoice.version}</dd>
   <dt>Recipient approval</dt><dd>{invoice.approvedMembers?.includes(invoice.memberId)?'Approved for these saved terms':'Awaiting recipient review'}</dd>
  </dl>
  <p className="source-footnote">Sending is a separate merchant action. Buyers initiate their own payments; the invoice does not authorize automatic installments.</p>
 </section>;
}
export function RecoveryReviewTerms({recovery,people,timezone}:{recovery:any;people:People;timezone:string}){
 const snapshot=recovery.snapshot,policy=snapshot.policy,money=(amount:number)=>formatMoney(amount,policy.currency);
 const allocations=snapshot.allocations??[],invoices=snapshot.invoiceRefunds??[];
 return <section className="financial-review" aria-label="Cancellation and refund terms for approval">
  <dl><dt>Supplier and booking revision</dt><dd>{policy.merchantName} · revision {policy.itemRevision}</dd>
   <dt>Reviewed cancellation policy</dt><dd>{policy.terms}</dd><dt>Evidence reviewed</dt><dd>{policy.evidence}</dd>
   <dt>Policy source</dt><dd><Source value={policy.sourceUrl}/></dd>
   <dt>Policy cutoff</dt><dd>{instant(policy.cutoff,timezone)}</dd>
   <dt>Refund rule</dt><dd>{policy.refundableBps/100}% refundable, less {money(policy.cancellationFeeUnits)} group fee</dd>
   <dt>Total proposed refund</dt><dd>{money(allocations.reduce((sum:number,row:any)=>sum+row.amount,0)+invoices.reduce((sum:number,row:any)=>sum+row.amount,0))}</dd>
  </dl>
  {allocations.length>0&&<><h4>Refunds to original payment contributors</h4><ul>{allocations.map((row:any)=><li key={row.operationId??row.captureId}>{memberName(people,row.memberId)}: {money(row.amount)} from {money(row.captured)} captured · capture {row.captureId}{row.costShares&&<ul>{Object.entries(row.costShares).map(([id,amount])=><li key={id}>{memberName(people,id)} cost adjustment: {money(Number(amount))}</li>)}</ul>}</li>)}</ul></>}
  {invoices.length>0&&<><h4>Invoice refunds requiring merchant confirmation</h4><ul>{invoices.map((row:any)=><li key={row.id}>{memberName(people,row.memberId)}: {money(row.amount)} · invoice {row.invoiceId}</li>)}</ul></>}
  {snapshot.dependentItems?.length>0&&<p>Resolve dependent bookings first: {snapshot.dependentItems.map((item:any)=>item.name).join(', ')}.</p>}
  <p>Required approvals: {snapshot.required.map((id:string)=>`${memberName(people,id)} (${recovery.approved.includes(id)?'approved':'pending'})`).join('; ')}.</p>
  {recovery.reservations?.length>0&&<ul>{recovery.reservations.map((row:any)=><li key={row.id}>{memberName(people,row.member_id)}: {money(row.amount)} · {row.status.replaceAll('-',' ')}</li>)}</ul>}
  <p className="source-footnote">Proposal revision {recovery.version}. Expected refunds remain unavailable for replacement payments until canonical refund evidence is confirmed.</p>
 </section>;
}
