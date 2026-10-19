import {cents} from './model.ts';
import {websiteUrl} from './place-info.ts';
export type CancellationTerms={refund:'unknown'|'full'|'none'|'fee'|'percent';fee:number;percent:number;cutoff:string|null;source:string;sourceUrl?:string;checkedAt:string};
/** Reviewed supplier text only. No refund eligibility or money is inferred. */
export function normalizedTerms(value:unknown):CancellationTerms{
 const terms=value as CancellationTerms;if(!terms||!['unknown','full','none','fee','percent'].includes(terms.refund))throw Error('Choose valid refund terms.');
 const fee=cents(terms.fee??0),percent=Number(terms.percent??0);if(!Number.isFinite(percent)||percent<0||percent>100)throw Error('Use a refund percentage from 0 to 100.');
 if(terms.refund!=='unknown'&&(typeof terms.source!=='string'||terms.source.trim().length<3))throw Error('Add the supplier confirmation supporting these terms.');
 const cutoff=terms.cutoff?String(terms.cutoff):null;if(cutoff&&!Number.isFinite(Date.parse(cutoff)))throw Error('Choose a valid cancellation cutoff.');
 return {refund:terms.refund,fee,percent,cutoff,source:String(terms.source??'').trim().slice(0,500),sourceUrl:websiteUrl(terms.sourceUrl),checkedAt:new Date().toISOString()};
}
