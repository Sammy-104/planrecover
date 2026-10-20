'use client';
import {useEffect,useState} from 'react';
import {Wallet,ArrowRight,ReceiptText,RefreshCw} from 'lucide-react';
import {formatMoney,planCurrency} from '@/lib/money';
import {paymentOverview,checkoutDisplayAmount} from '@/lib/payment-overview';
import {isDemoTrip,type State,type Item} from '@/lib/model';
import type {PlanInvoice} from '@/lib/plan-invoices';

type InvoiceRead={scope:string;invoices:PlanInvoice[];loading:boolean;refreshing:boolean;error:string};
export function PaymentCenter({state,actor,busy,configured,onPay,onReview,onRefresh}:{state:State;actor:string;busy:boolean;configured:boolean;onPay:(item:Item)=>void;onReview:(item:Item)=>void;onRefresh:()=>Promise<void>;jsonFetch:(url:string,init?:RequestInit)=>Promise<any>}){
 const scope=state.plan.id+'|'+actor;
 const [read,setRead]=useState<InvoiceRead>({scope:'',invoices:[],loading:!!state.people,refreshing:false,error:''}),[checking,setChecking]=useState(false),[pass,setPass]=useState(0);
 const current:InvoiceRead=read.scope===scope?read:{scope,invoices:[],loading:!!state.people,refreshing:false,error:''};
 const {invoices,loading,refreshing,error}=current;
 const currency=planCurrency(state.plan),money=(value:number)=>formatMoney(value,currency),flow=`/flows?plan=${encodeURIComponent(state.plan.id!)}#invoices`;
 useEffect(()=>{
  if(!state.people){setRead({scope,invoices:[],loading:false,refreshing:false,error:''});return;}
  const life=new AbortController();
  // An unrelated plan edit can revalidate invoices without blanking the last result.
  setRead(previous=>previous.scope===scope?{...previous,error:'',loading:previous.loading||!!previous.error,refreshing:true}:{scope,invoices:[],loading:true,refreshing:true,error:''});
  void fetch(`/api/plans/${encodeURIComponent(state.plan.id!)}/invoices`,{credentials:'same-origin',cache:'no-store',signal:life.signal})
   .then(async response=>{const result=await response.json() as any;if(!response.ok)throw Error(result.error??'Saved invoices could not load.');return result;})
   .then(result=>{if(!life.signal.aborted)setRead({scope,invoices:result.invoices.filter((invoice:PlanInvoice)=>invoice.memberId===actor&&invoice.status!=='cancelled'),loading:false,refreshing:false,error:''});})
   .catch(reason=>{if(!life.signal.aborted)setRead(previous=>({...previous,scope,loading:false,refreshing:false,error:reason instanceof Error?reason.message:'Saved invoices could not load.'}));});
  return()=>life.abort();
 },[state.plan.id,state.version,actor,!!state.people,pass]);
 const {directDue,waiting,openInvoices,total}=paymentOverview(state,actor,invoices);
 const clear=!loading&&!error&&!directDue.length&&!openInvoices.length&&!waiting.length;
 async function refresh(){if(checking)return;setChecking(true);try{await onRefresh();setPass(value=>value+1);}catch(reason){setRead(previous=>previous.scope===scope?{...previous,error:(reason as Error).message}:previous);}finally{setChecking(false);}}
 return <section className={`payment-center panel${clear?' payment-center-clear':''}`} aria-label="Your payments">
  <div className="section-top"><div><span className="payment-eyebrow"><Wallet size={17}/>Payments</span>
   <h2>{loading?'Checking payments…':error?'Payment details need checking':total>0?`${money(total)} to review`:openInvoices.length?'You have an invoice to review':'No checkout payment due'}</h2>
   <p>{isDemoTrip(state)?'Fictional demo amounts.':clear?'Outside bookings and friend repayments are separate.':'Your share only. Outside bookings and friend repayments are separate.'}</p>
  </div><button className="btn small-btn payment-refresh" aria-label="Refresh payment status" disabled={busy||checking||loading||refreshing} onClick={()=>void refresh()}><RefreshCw size={15} className={checking||refreshing?'spin':undefined}/>{checking||refreshing?'Updating…':'Refresh'}</button></div>
  {error&&<p className="notice warning" role="alert">Invoice balances could not load. Refresh before paying. <button className="text-button" onClick={()=>setPass(value=>value+1)}>Try again</button></p>}
  {directDue.map(item=><article className="payment-choice" key={item.id}><span className="payment-choice-icon" aria-hidden><Wallet size={18}/></span><div className="payment-choice-text"><strong>{item.name}</strong><small>{`${item.approvals.length} of ${(item.required??item.participants).length} approvals · ${item.merchantFunding?.mode==='whole-group'?'you pay for the whole group':'your share'}`}</small><button className="text-button" onClick={()=>onReview(item)}>View agreed details</button></div><strong className="payment-amount">{money(checkoutDisplayAmount(item,actor))}</strong><button className="btn primary" disabled={busy||loading||refreshing||!!error||!configured||currency!=='CAD'} onClick={()=>onPay(item)}>Review & pay<ArrowRight size={16}/></button></article>)}
  {directDue.length>0&&(!configured||currency!=='CAD')&&<p className="source-footnote">{currency!=='CAD'?'PayPal test checkout currently supports CAD. Other bookings are paid directly with the supplier.':'PayPal checkout is not connected yet. Your approved share stays saved; no payment is started.'}</p>}
  {openInvoices.map(invoice=><article className="payment-choice" key={invoice.id}><span className="payment-choice-icon invoice" aria-hidden><ReceiptText size={18}/></span><div className="payment-choice-text"><strong>{state.items.find(item=>item.id===invoice.itemId)?.name??'Saved invoice'}</strong><small>{money(invoice.paid)} paid · {money(invoice.outstanding)} remaining</small></div><a className="btn" href={flow}>{invoice.paymentUrl?'View payment options':'Review invoice terms'}<ArrowRight size={16}/></a></article>)}
  {waiting.length>0&&<details className="payment-waiting"><summary>{waiting.length} item{waiting.length===1?' needs':'s need'} agreement</summary><div>{waiting.slice(0,3).map(item=><button key={item.id} className="text-button" onClick={()=>onReview(item)}>Review {item.name}<ArrowRight size={15}/></button>)}</div></details>}
  {state.people&&<a className="text-button payment-invoices-link" href={flow}>Invoices & deposits<ArrowRight size={16}/></a>}
 </section>;
}
