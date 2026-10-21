import {receiptDeepLink} from './receipt-deep-link.ts';

/** Share fragments remain browser-only; existing receipt review keeps its original permission checks. */
export function rootWorkspaceDestination(search:string,hash:string):string|null{
 const query=search.startsWith('?')?search:'',fragment=hash.startsWith('#')?hash:'';
 if(new URLSearchParams(fragment.slice(1)).has('trip')||receiptDeepLink(query))return '/workspace'+query+fragment;
 return null;
}
