import {awsJson} from './aws-adapters.ts';
import {receiptExtractionSchema,type ReceiptExtraction} from './receipt-drafts.ts';
import {parseMoney} from './money.ts';
import {BackendError} from './backend-errors.ts';
type Field={Type?:{Text?:string;Confidence?:number};ValueDetection?:{Text?:string;Confidence?:number};Currency?:{Code?:string}};
/** Inline images only. PDFs keep the document-capable Bedrock/manual path. */
export async function extractExpense(env:Record<string,unknown>,file:{mime:string;bytes:Uint8Array},fetcher:typeof fetch=fetch):Promise<ReceiptExtraction>{
 if(!['image/png','image/jpeg'].includes(file.mime)||file.bytes.byteLength>5_000_000)throw new BackendError('TEXTRACT_DOCUMENT','Textract accepts PNG or JPEG images up to 5 MB here. Review PDFs manually or select Bedrock.');
 let binary='';for(let i=0;i<file.bytes.length;i+=8192)binary+=String.fromCharCode(...file.bytes.slice(i,i+8192));
 const response=await awsJson(env,'textract','AnalyzeExpense',{Document:{Bytes:btoa(binary)}},{fetch:fetcher,timeoutMs:20000});
 if(!Array.isArray(response.ExpenseDocuments)||response.ExpenseDocuments.length!==1||response.DocumentMetadata?.Pages>1)throw new BackendError('TEXTRACT_DOCUMENT','Use one receipt image at a time.');
 const doc=response.ExpenseDocuments[0],summary=Array.isArray(doc.SummaryFields)?doc.SummaryFields as Field[]:[],rows:Field[][]=(Array.isArray(doc.LineItemGroups)?doc.LineItemGroups:[]).flatMap((group:{LineItems?:{LineItemExpenseFields?:Field[]}[]})=>Array.isArray(group.LineItems)?group.LineItems.map(row=>Array.isArray(row.LineItemExpenseFields)?row.LineItemExpenseFields:[]):[]);
 const all=[...summary,...rows.flat()],codes=[...new Set(all.map(field=>field.Currency?.Code).filter((value):value is string=>typeof value==='string'&&/^[A-Z]{3}$/.test(value)))];
 const currency=codes.length===1?codes[0]:null,flags:string[]=[];
 if(!currency)flags.push(codes.length?'Conflicting printed currencies; verify every amount.':'No explicit currency detected; verify the source currency.');
 const values=(fields:Field[],type:string)=>fields.filter(field=>field.Type?.Text===type),text=(fields:Field[],type:string)=>{const found=values(fields,type);return found.length===1&&typeof found[0].ValueDetection?.Text==='string'?found[0].ValueDetection.Text.trim():null;};
 const amount=(fields:Field[],type:string)=>{const raw=text(fields,type);if(!raw||!currency)return null;
  // Ambiguous grouping/decimal conventions remain blank rather than guessing locale.
  const cleaned=raw.replace(/(?:CAD|USD|AUD|NZD|SGD|HKD|EUR|GBP|JPY|[$€£¥])/g,'').trim();if(!/^\d+(?:\.\d+)?$/.test(cleaned))return null;
  try{const value=parseMoney(cleaned,currency);return Number.isSafeInteger(value)&&value>=0&&value<=1e12?value:null;}catch{return null;}};
 const detections=all.slice(0,200).map(field=>{const confidence=field.ValueDetection?.Confidence;return {field:String(field.Type?.Text??'UNKNOWN').slice(0,120),text:String(field.ValueDetection?.Text??'').slice(0,500),confidence:typeof confidence==='number'&&Number.isFinite(confidence)&&confidence>=0&&confidence<=100?confidence:null};});
 if(all.length>200)flags.push('Some detections exceed the review limit; inspect the original image.');
 if(detections.some(field=>field.confidence===null||field.confidence<90))flags.push('Some detections have low or unknown confidence; compare them with the original image.');
 for(const type of ['TOTAL','SUBTOTAL','TAX','GRATUITY','DISCOUNT'])if(values(summary,type).length>1)flags.push(`Multiple ${type.toLowerCase()} detections remain blank for review.`);
 const dateText=text(summary,'INVOICE_RECEIPT_DATE'),date=dateText&&/^\d{4}-\d{2}-\d{2}$/.test(dateText)&&!isNaN(Date.parse(dateText+'T12:00:00Z'))&&new Date(dateText+'T12:00:00Z').toISOString().slice(0,10)===dateText?dateText:null;
 if(rows.length>100)flags.push('More than 100 receipt rows were detected; review the source manually.');
 const items=rows.slice(0,100).map((fields,index)=>{const raw=text(fields,'QUANTITY'),quantity=raw&&/^\d+(?:\.\d{1,3})?$/.test(raw)?Number(raw)*1000:null;
  return {name:(text(fields,'ITEM')??text(fields,'EXPENSE_ROW')??`Unclear item ${index+1}`).slice(0,200),amountCents:amount(fields,'PRICE'),quantityMilli:quantity!==null&&Number.isSafeInteger(quantity)&&quantity>0&&quantity<=1e9?quantity:null,unitPriceCents:amount(fields,'UNIT_PRICE'),lineDiscountCents:amount(fields,'DISCOUNT')};});
 return receiptExtractionSchema.parse({merchant:text(summary,'VENDOR_NAME')?.slice(0,200)??null,date,currency,items,taxCents:amount(summary,'TAX'),tipCents:amount(summary,'GRATUITY'),discountCents:amount(summary,'DISCOUNT'),totalCents:amount(summary,'TOTAL'),flags:flags.slice(0,30),detections});
}
