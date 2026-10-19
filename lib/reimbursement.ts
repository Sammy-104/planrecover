import {formatMoney,moneyInput,moneyScale,validCurrency} from './money.ts';

// PayPal's published currency table, checked 2026-10-17:
// https://developer.paypal.com/api/codes/currency/
const supported=new Set(['AUD','BRL','CAD','CNY','CZK','DKK','EUR','HKD','HUF','ILS','JPY','MYR','MXN','TWD','NZD','NOK','PHP','PLN','GBP','RUB','SGD','SEK','CHF','THB','USD']);
const wholeOnly=new Set(['HUF','JPY','TWD']);
/** The visible request and handoff always share the same integer amount and currency. */
export function reimbursementHandoff(profile:string,amount:number,currency:string):{href:string;label:string}|undefined{
 if(!/^https:\/\/(www\.)?paypal\.me\/[a-zA-Z0-9._-]+\/?$/.test(profile)||!Number.isSafeInteger(amount)||amount<=0||amount>1e12)return;
 try{validCurrency(currency);}catch{return;}
 if(!supported.has(currency)||wholeOnly.has(currency)&&amount%moneyScale(currency)!==0)return;
 const value=wholeOnly.has(currency)?String(amount/moneyScale(currency)):moneyInput(amount,currency);
 return {href:`${profile.replace(/\/$/,'')}/${value}${currency}`,label:formatMoney(amount,currency)};
}
