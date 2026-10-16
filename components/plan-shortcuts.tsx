'use client';
import {CalendarDays,ReceiptText,Wallet,Users,ArrowRight} from 'lucide-react';
export function PlanShortcuts({planId,onMoney,onReceipt,onPlan}:{planId:string;onMoney:()=>void;onReceipt:()=>void;onPlan:()=>void}){
 return <nav className="plan-shortcuts" aria-label="Quick actions"><button onClick={onPlan}><CalendarDays size={18}/><span>Open schedule</span><ArrowRight size={16}/></button><button onClick={onMoney}><Wallet size={18}/><span>Payments & balances</span><ArrowRight size={16}/></button><button onClick={onReceipt}><ReceiptText size={18}/><span>Scan a receipt</span><ArrowRight size={16}/></button><a href={`/flows?plan=${encodeURIComponent(planId)}`}><Users size={18}/><span>Review plan changes</span><ArrowRight size={16}/></a></nav>;
}
