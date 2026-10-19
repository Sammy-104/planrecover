'use client';
import {allocate,type ReceiptRow,type Allocation} from '@/lib/model';
import {moneyInput,moneyStep,parseMoney} from '@/lib/money';

export function ReceiptLineAllocation({row,index,currency,members,onChange}:{row:ReceiptRow;index:number;currency:string;members:readonly {id:string;name:string}[];onChange:(row:ReceiptRow)=>void}){
 const mode=row.allocation??'equal';
 function choose(allocation:Allocation){
  let values:Record<string,number>={};
  if(row.claims.length){const equal=allocate(row.amount,row.claims,'equal',{},members.map(member=>member.id));values=Object.fromEntries(row.claims.map(id=>[id,allocation==='fixed'?equal[id]:allocation==='percent'?100/row.claims.length:1]));}
  onChange({...row,allocation,values});
 }
 return <div className="receipt-line-details"><label className="field"><span>Line {index+1} allocation</span><select aria-label={`Item ${index+1} allocation`} value={mode} onChange={event=>choose(event.target.value as Allocation)}>
  <option value="equal">Equal among selected people</option><option value="fixed">Exact amounts</option><option value="percent">Percentages</option><option value="weight">Relative weights</option>
 </select></label>{mode!=='equal'&&<div className="form-grid">{row.claims.map(id=><label className="field" key={id}><span>{members.find(member=>member.id===id)?.name??id} · {mode==='fixed'?currency:mode==='percent'?'%':'weight'}</span>
  <input aria-label={`Item ${index+1} ${id} ${mode}`} type="number" min="0" step={mode==='fixed'?moneyStep(currency):'0.01'} value={mode==='fixed'?moneyInput(row.values?.[id]??0,currency):row.values?.[id]??0} onChange={event=>onChange({...row,values:{...row.values,[id]:mode==='fixed'?parseMoney(event.target.value,currency):Number(event.target.value)}})}/>
 </label>)}</div>}{mode==='fixed'&&<small>Exact line shares must add to the line amount. Tax, tip and group discounts are allocated afterward.</small>}{mode==='percent'&&<small>Selected percentages must add to 100.</small>}</div>;
}
