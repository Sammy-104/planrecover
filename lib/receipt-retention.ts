/** Removes only managed abandoned sources; approved and referenced evidence is retained. */
export async function cleanupReceiptObjects(database:D1Database,bucket:Pick<R2Bucket,'delete'>,owner:string,options:{now?:number;limit?:number}={}){
 const now=options.now??Date.now(),cutoff=new Date(now-30*86400000).toISOString(),limit=Math.max(1,Math.min(20,options.limit??5));
 const unused=`NOT EXISTS(SELECT 1 FROM receipt_drafts d WHERE d.file_key=receipt_objects.file_key AND d.status='reviewed') AND NOT EXISTS(SELECT 1 FROM plans p,json_each(p.body,'$.receipts') r WHERE p.owner=receipt_objects.owner AND json_extract(r.value,'$.fileKey')=receipt_objects.file_key)`;
 const rows=await database.prepare(`SELECT file_key FROM receipt_objects WHERE owner=? AND created<? AND (status IN ('staged','ready') OR status='deleting' AND lease_until<=?) AND ${unused} ORDER BY created,file_key LIMIT ?`).bind(owner,cutoff,now,limit).all<{file_key:string}>();
 let deleted=0,failed=0;
 for(const row of rows.results){const token=crypto.randomUUID(),claim=await database.prepare(`UPDATE receipt_objects SET status='deleting',lease_token=?,lease_until=? WHERE file_key=? AND owner=? AND created<? AND (status IN ('staged','ready') OR status='deleting' AND lease_until<=?) AND ${unused}`).bind(token,now+30000,row.file_key,owner,cutoff,now).run();if(!claim.meta.changes)continue;
  try{const current=await database.prepare(`SELECT file_key FROM receipt_objects WHERE file_key=? AND lease_token=? AND lease_until>? AND ${unused}`).bind(row.file_key,token,options.now??Date.now()).first();if(!current)continue;
   await bucket.delete(row.file_key);const result=await database.prepare("UPDATE receipt_objects SET status='deleted',lease_token=NULL,lease_until=0,deleted_at=? WHERE file_key=? AND lease_token=?").bind(new Date(options.now??Date.now()).toISOString(),row.file_key,token).run();if(result.meta.changes)deleted++;
  }catch{failed++;await database.prepare("UPDATE receipt_objects SET lease_token=NULL,lease_until=0 WHERE file_key=? AND lease_token=? AND status='deleting'").bind(row.file_key,token).run();}
 }
 return {examined:rows.results.length,deleted,failed,retentionDays:30};
}
