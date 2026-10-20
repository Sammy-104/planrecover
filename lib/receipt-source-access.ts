import {BackendError} from './backend-errors.ts';

type Access={id:string;user?:{id:string};share?:{tokenHash:string;tripId:string;role:'viewer'|'editor'}};
const receiptKey=/^[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** A storage prefix is not permission: require a retained receipt and current membership. */
export async function authorizeReceiptSource(database:D1Database,access:Access,key:string){
 if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to open a receipt source.',401);
 const prefix=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access.id)))].map(value=>value.toString(16).padStart(2,'0')).join('');
 if(!receiptKey.test(key)||!key.startsWith(prefix+'/'))throw new BackendError('RECEIPT_ACCESS','Receipt unavailable.',403);
 const link=access.share;
 const row=await database.prepare(`SELECT p.owner,p.id AS planId FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
  WHERE p.owner=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor','viewer')
  AND (EXISTS(SELECT 1 FROM receipt_drafts d WHERE d.owner=p.owner AND d.plan_id=p.id AND d.file_key=?)
   OR EXISTS(SELECT 1 FROM json_each(p.body,'$.receipts') r WHERE json_extract(r.value,'$.fileKey')=?))
  AND NOT EXISTS(SELECT 1 FROM receipt_objects o WHERE o.file_key=? AND (o.owner<>p.owner OR o.plan_id<>p.id OR o.status<>'ready'))
  ${link?"AND p.id=? AND EXISTS(SELECT 1 FROM trip_links l WHERE l.token_hash=? AND l.owner=p.owner AND l.trip_id=p.id AND l.role IN ('viewer','editor') AND (l.expires IS NULL OR julianday(l.expires)>julianday('now')))":''}
  LIMIT 1`).bind(access.id,access.user.id,key,key,key,...(link?[link.tripId,link.tokenHash]:[])).first<{owner:string;planId:string}>();
 if(!row)throw new BackendError('RECEIPT_UNAVAILABLE','This receipt source is unavailable or access changed.',404);
 return row;
}
