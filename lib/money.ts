import {countryCurrencies} from './data/country-currencies.ts';

export const currencyCodes=[...new Set(Object.values(countryCurrencies))].sort();
export const planCurrency=(plan:{currency?:string})=>plan.currency??'CAD';
export function validCurrency(value:unknown){if(typeof value!=='string'||!currencyCodes.includes(value))throw Error('Choose a supported currency.');return value;}
export function currencyDigits(currency='CAD'){return new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;}
export const moneyScale=(currency='CAD')=>10**currencyDigits(currency);
export const moneyStep=(currency='CAD')=>String(1/moneyScale(currency));
export const moneyInput=(amount:number,currency='CAD')=>(amount/moneyScale(currency)).toFixed(currencyDigits(currency));
export function parseMoney(value:string,currency='CAD'){
 const digits=currencyDigits(currency),match=/^(\d+)(?:\.(\d*))?$/.exec(value.trim());
 if(!match||(match[2]??'').slice(digits).replace(/0/g,'').length>0)return NaN;
 const amount=Number(match[1])*moneyScale(currency)+Number((match[2]??'').slice(0,digits).padEnd(digits,'0'));
 return Number.isSafeInteger(amount)?amount:NaN;
}
export const formatMoney=(amount:number,currency='CAD')=>new Intl.NumberFormat('en',{style:'currency',currency,currencyDisplay:'code'}).format(amount/moneyScale(currency));
export function currencyName(currency:string){return `${currency} · ${new Intl.DisplayNames('en',{type:'currency'}).of(currency)??currency}`;}
export function suggestedCurrency(country?:string){return country?countryCurrencies[country]:undefined;}
export function currencyLocked(state:{items:{price:number|null}[];events:unknown[];receipts:unknown[];proposals:unknown[]}){return state.items.some(item=>(item.price??0)>0)||!!(state.events.length||state.receipts.length||state.proposals.length);}
