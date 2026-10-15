/** Only the fictional merchant catalog supports the beta checkout adapter. */
export function hasMerchantCheckout(item:{source:string}){
 return /^(Fictional demo merchant|Seeded demo catalog)\s*·/.test(item.source);
}
export function requireMerchantCheckout(item:{source:string}){
 if(!hasMerchantCheckout(item))throw Error('This place is booked and paid outside PlanRecover. Its planned cost is not a merchant invoice.');
}
