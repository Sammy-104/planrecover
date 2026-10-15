import type {ReceiptExtraction} from './receipt-drafts.ts';

/** Conservative OCR interpretation. Recognized text is evidence for a draft, never payment authority. */
export function parseReceiptText(text:string):ReceiptExtraction{
 const lines=text.normalize('NFKC').split(/\r?\n/).map(line=>line.trim().replace(/[\t ]+/g,' ')).filter(Boolean).slice(0,600);
 const flags=['Read on your device. Check the photo, currency and every amount before saving.'];
 const currency=/\bCHF\b|\bSFr\b/i.test(text)?'CHF':/\bCAD\b|CA\$|C\$|CANADIAN DOLLARS/i.test(text)?'CAD':/\bUSD\b|US\$/i.test(text)?'USD':/\bEUR\b|€/i.test(text)?'EUR':/\bGBP\b|£/i.test(text)?'GBP':null;
 const taxIncluded=/\b(?:incl?\.?|included|inkl\.?|inclus)\s*(?:[\d.,]+\s*%?\s*)?(?:tax|VAT|M[wuv]?s?t|TVA)|(?:tax|VAT|MwSt|TVA)\s*incl/i.test(text);
 const validDate=(date:string)=>{const d=new Date(date+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date;};
 let date:string|null=null,merchant:string|null=null,totalCents:number|null=null,taxCents:number|null=null,tipCents:number|null=null,discountCents:number|null=null;
 let aggregateTax:number|null=null;
 const items:ReceiptExtraction['items']=[];
 for(const [index,line] of lines.entries()){
  const iso=line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(iso){const candidate=`${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;if(validDate(candidate))date=candidate;}
  const numeric=line.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2}|\d{2})\b/);
  if(!date&&numeric){const a=Number(numeric[1]),b=Number(numeric[2]),year=numeric[3].length===2?'20'+numeric[3]:numeric[3];
   if(a>12||b>12||a===b){const candidate=`${year}-${String(a>12?b:a).padStart(2,'0')}-${String(a>12?a:b).padStart(2,'0')}`;if(validDate(candidate))date=candidate;}}
  const named=line.match(/\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if(named){const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(named[1].slice(0,3).toUpperCase())+1;
   const candidate=`${named[3]}-${String(month).padStart(2,'0')}-${named[2].padStart(2,'0')}`;if(validDate(candidate))date=candidate;}
  const match=line.match(/(-?\s*(?:\d{1,3}(?:[, ]\d{3})+|\d+)[.,]\d{2})\s*(?:[A-Z*|=]{1,3})?\s*$/i);
  if(!match){if(!merchant&&index<5&&/[A-Za-z]{3}/.test(line)&&!/^(?:\d|receipt\b|invoice\b|order\b|tel\b|date\b|www\.|https?:|thank|customer)/i.test(line))merchant=line.slice(0,200);continue;}
  const amountText=match[1].replace(/\s/g,'').replace(/,(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const amount=Math.round(Math.abs(Number(amountText))*100);if(!Number.isSafeInteger(amount)||amount>1_000_000_000_000)continue;
  const label=line.slice(0,match.index).trim();if(!label)continue;
  if(/\b(sub\s*total|sous.total|total\s+(?:items|taxable)|taxable\s+total)\b/i.test(label))continue;
  if(/\b(grand\s*total|total|amount\s*due|balance\s*due|montant\s*total)\b/i.test(label)&&!/tax/i.test(label)){totalCents=amount;continue;}
  if(/\b(?:total\s*tax|tax\s*total)\b/i.test(label)){aggregateTax=amount;continue;}
  if(/\b(?:HST|GST|PST|QST|TPS|TVQ|VAT|tax|taxes|MwSt|TVA)\b/i.test(label)||/\b(?:incl?|inkl)\b/i.test(label)&&/\bM[wuv]?s?t\b|%/i.test(label)){taxCents=(taxCents??0)+amount;continue;}
  if(/\b(?:tip|gratuity|pourboire)\b/i.test(label)){tipCents=amount;continue;}
  if(/\b(?:discount|coupon|savings|rabais)\b/i.test(label)){discountCents=(discountCents??0)+amount;continue;}
  if(/\b(?:visa|mastercard|amex|debit|credit|cash|paid|payment|tendered|change|balance|auth|card|rounding|suggested|entspricht|equivalent|exchange)\b|(?:\d{1,2}:\d{2})/i.test(label))continue;
  if(/^-/.test(amountText)){flags.push('A negative line needs manual review; it was not added as a purchase.');continue;}
  let name=label.replace(/\s+[àa@]\s*[\d.,]+\s*(?:[A-Z]{3})?.*$/i,'').replace(/\s+\d+[.,]\d{2}\s*$/,'').replace(/^[|"'‘’=\s]+/,'').trim();
  const quantity=name.search(/\b\d+\s*x\s*/i);if(quantity>0&&quantity<12)name=name.slice(quantity);
  if(/[A-Za-z]/.test(name)&&items.length<100)items.push({name:name.slice(0,200),amountCents:amount});
 }
 if(aggregateTax!==null)taxCents=aggregateTax;
 if(!currency)flags.push('The printed currency could not be established. Confirm it before using these amounts.');
 if(!date)flags.push('The date is missing or ambiguous. Enter it from the photo.');
 if(!items.length)flags.push('No readable item prices were found. Try a clearer, straight-on photo or paste the receipt text.');
 if([taxCents,tipCents,discountCents,totalCents].some(value=>value===null))flags.push('Unprinted or unreadable totals stay blank. Confirm any zero values explicitly.');
 if(taxIncluded)flags.push('Printed tax is included in the item prices; it must not be added a second time.');
 if(totalCents!==null&&items.reduce((sum,item)=>sum+item.amountCents!,0)+(taxIncluded?0:taxCents??0)+(tipCents??0)-(discountCents??0)!==totalCents)
  flags.push('The readable item amounts and scanned total do not match. Check missing lines, tax and the printed total against the photo.');
 return {merchant,date,currency,items,taxCents,tipCents,discountCents,totalCents,...(taxIncluded?{taxIncluded:true}:{}),flags:[...new Set(flags)].slice(0,30)};
}
