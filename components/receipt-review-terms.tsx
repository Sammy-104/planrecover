'use client';
import type {Receipt,State} from '@/lib/model';
import {formatMoney} from '@/lib/money';
import {receiptRequiredMembers} from '@/lib/receipt-accounting';

export function ReceiptReviewTerms({receipt,state,members,currency}:{receipt:Receipt;state:State;members:readonly {id:string;name:string}[];currency:string}){
 const required=receiptRequiredMembers(receipt,members.map(member=>member.id)),name=(id:string)=>members.find(member=>member.id===id)?.name??id;
 const previous=receipt.previousShares,contributions=receipt.recording==='evidence'?receipt.previousContributions??{}:receipt.contributions??{[receipt.payer]:receipt.total};
 const purchase=state.items.find(item=>item.id===receipt.linkedItemId);
 return <div className="terms-box receipt-terms"><h3>Receipt terms · revision {receipt.revision}</h3><p>{formatMoney(receipt.total,currency)} {currency} · {purchase?`Reconciles ${purchase.name}`:'Separate purchase'}</p>
  <p>{receipt.recording==='evidence'?'Evidence for recorded payment. Original payers and payment amounts are retained.':'Manually reported purchase. Approval records the exact shares and payer contribution below.'}</p>
  {receipt.correctionReason&&<p>Correction evidence: {receipt.correctionReason}</p>}
  {receipt.previousTotal!==undefined&&<p>Previously recorded: {formatMoney(receipt.previousTotal,currency)} · Proposed: {formatMoney(receipt.total,currency)}. An approved difference is appended to history.</p>}
  <div className="money-table-scroll"><table className="money-terms-table"><thead><tr><th>Person</th>{previous&&<th>Previous cost share</th>}<th>Proposed cost share</th>{previous&&<th>Previous contribution</th>}<th>{receipt.recording==='evidence'?'Retained contribution':'Reported contribution'}</th></tr></thead><tbody>{members.filter(member=>required.includes(member.id)).map(member=><tr key={member.id}><td>{member.name}</td>{previous&&<td>{formatMoney(previous[member.id]??0,currency)}</td>}<td>{formatMoney(receipt.shares[member.id]??0,currency)}</td>{previous&&<td>{formatMoney(receipt.previousContributions?.[member.id]??0,currency)}</td>}<td>{formatMoney(contributions[member.id]??0,currency)}</td></tr>)}</tbody></table></div>
  <p>Required approval: {required.map(name).join(', ')}.</p>
 </div>;
}
