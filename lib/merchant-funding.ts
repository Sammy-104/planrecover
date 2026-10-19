import type {Item,Shares} from './model.ts';
import type {PaymentOperation} from './payment-guards.ts';

export type MerchantFunding={mode:'whole-group';payerId:string};
export type FrozenMerchantFunding={mode:'whole-group';payerId:string;revision:number;amount:number;participants:string[];shares:Shares};
const sorted=(values:Shares)=>Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
export function freezeMerchantFunding(item:Item):FrozenMerchantFunding|undefined{
 if(!item.merchantFunding)return undefined;
 const payerId=item.merchantFunding.payerId;
 if(item.merchantFunding.mode!=='whole-group'||!item.participants.includes(payerId)||item.collection||!Number.isSafeInteger(item.price)||!item.price||item.price<0||item.participants.length!==new Set(item.participants).size||Object.keys(item.shares).length!==item.participants.length||Object.entries(item.shares).some(([id,n])=>!item.participants.includes(id)||!Number.isSafeInteger(n)||n<0)||Object.values(item.shares).reduce((a,b)=>a+b,0)!==item.price)throw Error('Review the exact whole-group amount, participants and designated payer.');
 return {mode:'whole-group',payerId,revision:item.revision,amount:item.price,participants:[...item.participants].sort(),shares:sorted(item.shares)};
}
export function savedMerchantFunding(operation:PaymentOperation):FrozenMerchantFunding|undefined{
 let value:FrozenMerchantFunding|undefined;try{value=JSON.parse(operation.payload??'{}').planrecoverFunding;}catch{throw Error('The saved payment funding evidence needs review.');}
 if(!value)return undefined;
 if(value.mode!=='whole-group'||value.payerId!==operation.member||value.revision!==operation.revision||value.amount!==operation.amount||!Array.isArray(value.participants)||!value.participants.includes(operation.member)||value.participants.length!==new Set(value.participants).size||!value.shares||Object.keys(value.shares).length!==value.participants.length||Object.entries(value.shares).some(([id,n])=>!value!.participants.includes(id)||!Number.isSafeInteger(n)||n<0)||Object.values(value.shares).reduce((a,b)=>a+b,0)!==operation.amount)throw Error('The original whole-group funding evidence needs merchant review.');
 return value;
}
export function captureShares(operation:PaymentOperation):Shares{return savedMerchantFunding(operation)?.shares??{[operation.member]:operation.amount};}
/** Keep server-frozen allocation/approval facts when a provider response replaces
 * its mutable status payload. These values never come from request bodies. */
export function retainedPaymentMetadata(operation:PaymentOperation){const saved=JSON.parse(operation.payload??'{}');return {...(saved.planrecoverApprovalSnapshot?{planrecoverApprovalSnapshot:saved.planrecoverApprovalSnapshot}:{}),...(savedMerchantFunding(operation)?{planrecoverFunding:saved.planrecoverFunding}:{})};}
export function equalMoneyMaps(a:Shares,b:Shares){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
