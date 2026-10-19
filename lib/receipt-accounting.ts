import {splitReceipt,type Receipt,type Shares,type State} from './model.ts';
import {planCurrency} from './money.ts';

const sum=(values:Shares)=>Object.values(values).reduce((total,value)=>total+value,0);
const sameIds=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const delta=(next:Shares,prior:Shares,ids:readonly string[])=>Object.fromEntries(ids.map(id=>[id,(next[id]??0)-(prior[id]??0)]));
const hasValues=(values:Shares)=>Object.values(values).some(value=>value!==0);
const committedPurchase=(receipt:Receipt)=>receipt.status==='approved'?receipt.linkedItemId:receipt.reconciledItemId??(!receipt.recording&&receipt.previousShares?receipt.linkedItemId:null);
/** Original reported tender facts are separate from who consumed each line. */
export function receiptContributions(receipt:Pick<Receipt,'contributions'|'payer'|'total'>,memberIds:readonly string[]):Shares{
 const values=receipt.contributions??{[receipt.payer]:receipt.total},positive=Object.fromEntries(Object.entries(values).filter(([,amount])=>amount>0));
 if(!values||Array.isArray(values)||typeof values!=='object'||Object.keys(values).length>100||Object.entries(values).some(([id,amount])=>!memberIds.includes(id)||!Number.isSafeInteger(amount)||amount<0)||!Number.isSafeInteger(sum(values))||sum(values)!==receipt.total||receipt.total>0&&!Object.hasOwn(positive,receipt.payer))throw Error('Original payer contributions must use current members and add up to the exact receipt total.');
 return positive;
}

export function hasFinalizedReceiptPurchase(state:Pick<State,'receipts'>,itemId:string){return state.receipts.some(receipt=>committedPurchase(receipt)===itemId);}

/** A receipt may reconcile an estimate after its original expense was approved.
 * Keep that immutable financial identity visible to every purchase consumer. */
export function accountingItemIds(state:Pick<State,'receipts'>,itemId:string){
 const ids=new Set([itemId]);
 for(const receipt of state.receipts){
  const reconciled=committedPurchase(receipt);
  if(reconciled===itemId)ids.add(receipt.accountingItemId??receipt.linkedItemId??receipt.id);
 }
 return [...ids];
}
export function purchaseEvents(state:Pick<State,'events'|'receipts'>,itemId:string){
 const ids=new Set(accountingItemIds(state,itemId));return state.events.filter(event=>ids.has(event.itemId));
}

export function receiptPurchaseLedger(state:Pick<State,'events'>,itemId:string){
 const events=('receipts'in state?purchaseEvents(state as Pick<State,'events'|'receipts'>,itemId):state.events.filter(event=>event.itemId===itemId)).filter(event=>event.status==='confirmed'&&['expense','adjustment'].includes(event.kind));
 const shares:Shares={},contributions:Shares={};
 for(const event of events){for(const [id,value]of Object.entries(event.shares))shares[id]=(shares[id]??0)+value;for(const [id,value]of Object.entries(event.contributions))contributions[id]=(contributions[id]??0)+value;}
 return {events,ids:events.map(event=>event.id).sort(),shares,contributions,total:events.reduce((total,event)=>total+event.amount,0)};
}

export function receiptDuplicateCandidates(state:Pick<State,'receipts'>,receipt:Receipt){
 const merchant=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
 return state.receipts.filter(saved=>saved.id!==receipt.id&&((!!receipt.linkedItemId&&saved.linkedItemId===receipt.linkedItemId)||
  saved.date===receipt.date&&saved.total===receipt.total&&merchant(saved.merchant)===merchant(receipt.merchant)));
}

/** Derive accounting baselines from saved state, never client-supplied metadata. */
export function prepareReceiptReview(state:State,input:Receipt,memberIds:readonly string[]):Receipt{
 if(!input||typeof input.merchant!=='string'||!input.merchant.trim()||!Array.isArray(input.rows)||input.rows.length>100)throw Error('Enter a valid receipt with up to 100 lines.');
 if(!memberIds.includes(input.payer))throw Error('Choose the person who paid.');
 const old=state.receipts.find(receipt=>receipt.id===input.id);
 if(old&&input.revision!==old.revision)throw Error('This receipt revision changed. Reopen its current review before editing.');
 if(receiptDuplicateCandidates(state,input).some(saved=>!!input.linkedItemId&&saved.linkedItemId===input.linkedItemId||
  JSON.stringify(saved.rows.map(row=>[row.name,row.amount]))===JSON.stringify(input.rows.map(row=>[row.name,row.amount]))))throw Error('A matching receipt is already saved. Review or correct that receipt before adding this purchase again.');
 const linked=input.linkedItemId?state.items.find(item=>item.id===input.linkedItemId):null;
 if(input.linkedItemId&&!linked)throw Error('Choose an existing purchase in this plan.');
 const shares=splitReceipt(input,memberIds,planCurrency(state.plan));
 let contributions:Shares={};
 const recorded=old?.status==='approved'||old?.previousShares!==undefined;
 if(recorded&&old.linkedItemId&&old.linkedItemId!==input.linkedItemId)throw Error('A recorded receipt must keep its original purchase link.');
 if(recorded&&!old.linkedItemId&&input.linkedItemId&&receiptPurchaseLedger(state,input.linkedItemId).events.length)throw Error('That purchase already has a payment. Keep both financial records for review instead of merging them.');
 const itemId=recorded?old.accountingItemId??old.linkedItemId??old.id:input.linkedItemId??old?.id??'',ledger=receiptPurchaseLedger(state,recorded?old.linkedItemId??itemId:itemId);
 const recording=old?.recording??(recorded?'expense':input.recording??(linked&&ledger.events.length?'evidence':'expense'));
 if(recorded&&input.recording&&input.recording!==recording)throw Error('A recorded receipt must keep its original accounting mode.');
 if(!recorded&&recording==='expense'&&ledger.events.length)throw Error('This purchase is already recorded. Attach the receipt as payment evidence to avoid another expense.');
 if(recording==='evidence'&&(!linked||!ledger.events.length))throw Error('Choose a purchase with a recorded payment before attaching evidence.');
 if(recording==='evidence'&&input.total!==ledger.total)throw Error('Payment evidence must match the recorded purchase total. Resolve a payment or refund separately before changing that total.');
 contributions=recording==='evidence'?structuredClone(ledger.contributions):receiptContributions(input,memberIds);
 const next:Receipt={...input,id:old?.id??crypto.randomUUID(),recording,shares,revision:(old?.revision??0)+1,approvals:[],status:'review',
  reconciledItemId:old?.status==='approved'?old.linkedItemId:old?.reconciledItemId??(old?.previousShares&&!old.recording?old.linkedItemId:null)};
 next.accountingItemId=recorded?itemId:input.linkedItemId??next.id;
 delete next.previousShares;delete next.previousTotal;delete next.previousContributions;delete next.recordedEventIds;
 delete next.originalContributions;
 if(input.contributions!==undefined)next.contributions=contributions;else delete next.contributions;
 if(recorded||recording==='evidence'){
  next.previousShares=structuredClone(ledger.shares);next.previousTotal=ledger.total;next.previousContributions=structuredClone(ledger.contributions);next.recordedEventIds=ledger.ids;
  // Legacy receipts without linked item IDs still reconcile through their receipt ID.
  if(!ledger.events.length)throw Error('The recorded purchase evidence is unavailable. Refresh before proposing a correction.');
 }
 if(recording==='evidence'){next.paymentConfirmed=true;next.payer=Object.entries(ledger.contributions).find(([,amount])=>amount>0)?.[0]??input.payer;contributions=structuredClone(ledger.contributions);next.contributions=contributions;}
 const original=recorded?(old?.originalContributions??(Object.keys(old.contributions??{}).length>1?ledger.events.find(event=>event.kind==='expense')?.contributions:undefined)):undefined;
 if(original){if(Object.keys(contributions).some(id=>!Object.hasOwn(original,id)))throw Error('A recorded split-tender receipt must keep its original payer identities. Record a repayment separately.');next.originalContributions=structuredClone(original);}
 else if(Object.keys(contributions).length>1)next.originalContributions=structuredClone(contributions);
 if(recorded&&next.total!==(next.previousTotal??old?.total)&&!next.correctionReason?.trim())throw Error('Explain the documented total correction before requesting approval.');
 return next;
}

export function receiptRequiredMembers(receipt:Receipt,memberIds:readonly string[]){
 return memberIds.filter(id=>(receipt.shares[id]??0)>0||(receipt.previousShares?.[id]??0)>0||id===receipt.payer||(receipt.contributions?.[id]??0)>0||(receipt.originalContributions?.[id]??0)>0||(receipt.previousContributions?.[id]??0)>0);
}

/** Append approved differences; original captures and receipt facts stay immutable. */
export function approveReceiptReview(state:State,receiptId:string,revision:number,actor:string,memberIds:readonly string[],now:string){
 const receipt=state.receipts.find(value=>value.id===receiptId);
 if(!receipt||receipt.revision!==revision)throw Error('Review the latest receipt revision.');
 const required=receiptRequiredMembers(receipt,memberIds);
 if(!required.includes(actor))throw Error('You are not affected by this receipt.');
 if(receipt.status==='approved')return receipt;
 const itemId=receipt.accountingItemId??receipt.linkedItemId??receipt.id,ledger=receiptPurchaseLedger(state,receipt.reconciledItemId??itemId);
 if(!receipt.reconciledItemId&&receipt.linkedItemId&&receipt.linkedItemId!==itemId&&receiptPurchaseLedger(state,receipt.linkedItemId).events.length)throw Error('This planned purchase now has another recorded payment. Review both financial records before reconciling.');
 if(receipt.recordedEventIds&&!sameIds(ledger.ids,receipt.recordedEventIds))throw Error('The purchase payments or allocation changed. Save a fresh receipt review before approving.');
 if(!receipt.previousShares&&ledger.events.length)throw Error('This purchase now has a recorded payment. Save it as payment evidence before approving.');
 receipt.approvals=[...new Set([...receipt.approvals,actor])];
 if(!required.every(id=>receipt.approvals.includes(id)))return receipt;
 if(!receipt.paymentConfirmed)throw Error('Confirm the payer’s reported payment before recording an expense.');
 const tender=receiptContributions(receipt,memberIds);
 if(receipt.previousShares){
  const amount=receipt.total-(receipt.previousTotal??receipt.total),shares=delta(receipt.shares,receipt.previousShares,memberIds);
  const contributions=receipt.recording==='evidence'?{}:delta(tender,receipt.previousContributions??{},memberIds);
  if(receipt.recording==='evidence'&&amount!==0)throw Error('Captured payment evidence cannot change the recorded total.');
  if(sum(shares)!==amount||sum(contributions)!==amount)throw Error('The receipt adjustment must reconcile with the original recorded payment.');
  if(amount||hasValues(shares)||hasValues(contributions))state.events.push({id:`receipt-adjust-${receipt.id}-${receipt.revision}`,itemId,kind:'adjustment',
   label:`Receipt correction · ${receipt.merchant}`,shares,contributions,amount,status:'confirmed',mode:'manual',created:now,
   evidence:`All affected members approved receipt revision ${receipt.revision}. Original payment facts retained.${receipt.correctionReason?.trim()?` Reason: ${receipt.correctionReason.trim()}`:''}`});
 }else state.events.push({id:`receipt-${receipt.id}`,itemId,kind:'expense',label:receipt.merchant,shares:receipt.shares,
  contributions:tender,amount:receipt.total,status:'confirmed',mode:'manual',created:now,
  evidence:`Receipt ${receipt.id} · payer reported payment; all affected members reviewed the exact shares.`});
 receipt.status='approved';receipt.reconciledItemId=receipt.linkedItemId;
 const item=state.items.find(value=>value.id===receipt.linkedItemId);if(item?.status==='awaiting-payment')item.status='scheduled';
 return receipt;
}
