import {currencyDigits,formatMoney} from './money.ts';

type Impact={expectedRefund:number|null;newPaymentNow:number|null;finalChange:number|null};
type Figures={retained:number;expectedRefund:number|null;newPaymentNow:number|null;finalTotal:number|null;perMember:Record<string,number>;memberImpacts:Record<string,Impact>};
/** Keep authoritative minor-unit figures intact and supply presentation labels separately. */
export function recoveryMoney(currency:string,figures:Figures){
 const display=(amount:number|null)=>amount===null?'Unknown':formatMoney(amount,currency);
 return {currency,decimalPlaces:currencyDigits(currency),display:{
  retained:display(figures.retained),expectedRefund:display(figures.expectedRefund),newPaymentNow:display(figures.newPaymentNow),finalTotal:display(figures.finalTotal),
  perMember:Object.fromEntries(Object.entries(figures.perMember).map(([id,value])=>[id,display(value)])),
  memberImpacts:Object.fromEntries(Object.entries(figures.memberImpacts).map(([id,impact])=>[id,{expectedRefund:display(impact.expectedRefund),newPaymentNow:display(impact.newPaymentNow),finalChange:display(impact.finalChange)}])),
 }};
}
/** Recovery amounts and saved-review claims are rendered from successful service results, never model prose. */
export function recoveryToolAnswer(entries:unknown[],memberId:string):string|null{
 for(const entry of [...entries].reverse()){
  const tool=entry as {name?:string;result?:{kind?:string;changeId?:string;reviewUrl?:string;money?:ReturnType<typeof recoveryMoney>;warnings?:string[]}};
  if(!['compare_recovery_options','prepare_plan_change'].includes(tool.name??''))continue;
  const result=tool.result;if(!result?.money||!['recovery','departure'].includes(result.kind??''))continue;
  const saved=tool.name==='prepare_plan_change';
  if(saved&&(!result.changeId||!result.reviewUrl?.startsWith('/flows?')))continue;
  const display=result.money.display,impact=display.memberImpacts[memberId];
  const title=result.kind==='departure'?'Departure':'Recovery';
  return [saved?title+' proposal ready for review.':title+' comparison ready. No proposal was saved by this comparison.',
   'New cash estimate: '+display.newPaymentNow+'.',
   'Expected refund: '+display.expectedRefund+'.',
   'Expected final total: '+display.finalTotal+'.',
   ...(impact?['Your cost change: '+impact.finalChange+'.']:[]),
   ...(result.warnings??[]),
   'Unknown availability, travel times and supplier terms still need checking.',
   saved?'Review the exact saved terms: '+result.reviewUrl:'Ask to save a proposal when you are ready to review these terms.',
   'No plan changes were applied, no terms were approved and no payments were made. Pending refunds cannot fund a replacement.',
  ].join('\n');
 }
 return null;
}
