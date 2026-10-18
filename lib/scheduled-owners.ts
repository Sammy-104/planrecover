type Options={maxOwners?:number;concurrency?:number;startBudgetMs?:number;now?:()=>number};
/** Fair bounded batches. Owner runners retain their durable leases/cooldowns.
 * A failed workspace does not prevent the rest of the batch from running. */
export async function runScheduledOwners(database:D1Database,runOwner:(owner:string)=>Promise<{status:string;[key:string]:unknown}>,options:Options={}){
 const now=options.now??Date.now,start=now(),maxOwners=Math.min(100,Math.max(1,Math.floor(options.maxOwners??25))),concurrency=Math.min(5,Math.max(1,Math.floor(options.concurrency??3)));
 const owners=await database.prepare(`SELECT w.owner FROM workspaces w LEFT JOIN background_job_runs j ON j.owner=w.owner
  WHERE COALESCE(j.lease_until,0)<=? AND COALESCE(j.next_at,0)<=? ORDER BY COALESCE(j.last_started,''),w.owner LIMIT ?`).bind(start,start,maxOwners).all<{owner:string}>();
 const count=await database.prepare(`SELECT COUNT(*) n FROM workspaces w LEFT JOIN background_job_runs j ON j.owner=w.owner WHERE COALESCE(j.lease_until,0)<=? AND COALESCE(j.next_at,0)<=?`).bind(start,start).first<{n:number}>();
 const results:{status:string;[key:string]:unknown}[]=[];let cursor=0;
 async function worker(){while(cursor<owners.results.length&&now()-start<(options.startBudgetMs??45000)){
  const account=owners.results[cursor++];
  try{results.push(await runOwner(account.owner));}catch{results.push({status:'retry-required'});}
 }}
 await Promise.all(Array.from({length:Math.min(concurrency,owners.results.length)},()=>worker()));
 return {processed:results.length,results,deferred:Math.max(0,(count?.n??owners.results.length)-results.length),selectedBatchDeferred:owners.results.length-results.length,eligibleAtStart:count?.n??owners.results.length,batchLimit:maxOwners};
}
