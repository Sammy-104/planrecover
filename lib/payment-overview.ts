import {hasMerchantCheckout} from './merchant-scope.ts';
import type {State} from './model.ts';
import type {PlanInvoice} from './plan-invoices.ts';
/** Display only. Checkout and invoice services remain the authority for collection. */
export function paymentOverview(state:State,actor:string,invoices:PlanInvoice[]){
 const mine=invoices.filter(invoice=>invoice.memberId===actor&&invoice.planId===state.plan.id&&invoice.status!=='cancelled');
 const due=state.items.filter(item=>hasMerchantCheckout(item)&&item.status==='awaiting-payment'&&item.participants.includes(actor)&&!item.paid.includes(actor)&&(item.collection?.due[actor]??item.shares[actor]??0)>0);
 const directDue=due.filter(item=>!mine.some(invoice=>invoice.itemId===item.id&&invoice.revision===item.revision));
 const waiting=state.items.filter(item=>hasMerchantCheckout(item)&&item.status==='draft'&&(item.required??item.participants).includes(actor));
 const openInvoices=mine.filter(invoice=>invoice.outstanding>0);
 const total=directDue.reduce((sum,item)=>sum+(item.collection?.due[actor]??item.shares[actor]??0),0)+openInvoices.reduce((sum,invoice)=>sum+invoice.outstanding,0);
 return {directDue,waiting,openInvoices,total};
}
