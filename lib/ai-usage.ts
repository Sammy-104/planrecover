import { BackendError } from './backend-errors.ts';
type AiDatabase={prepare:(sql:string)=>{bind:(...values:(string|number|null)[])=>{
  first:<T>()=>Promise<T|null>;run:()=>Promise<unknown>;
}}};
type AiFeature='plan-draft'|'receipt-extraction';

/** Per-member inference budget and expiring lease, shared by server instances. */
export async function acquireAiLease(database:AiDatabase,memberId:string,feature:AiFeature,now=Date.now()) {
  const window=Math.floor(now/3_600_000)*3_600_000,token=crypto.randomUUID();
  const row=await database.prepare(`INSERT INTO ai_usage_limits (member_id,feature,window_start,request_count,lease_until,lease_token)
    VALUES (?,?,?,1,?,?) ON CONFLICT(member_id,feature) DO UPDATE SET
    window_start=excluded.window_start,
    request_count=CASE WHEN ai_usage_limits.window_start<>excluded.window_start THEN 1 ELSE ai_usage_limits.request_count+1 END,
    lease_until=excluded.lease_until,lease_token=excluded.lease_token
    WHERE ai_usage_limits.lease_until<=? AND (ai_usage_limits.window_start<>excluded.window_start OR ai_usage_limits.request_count<20)
    RETURNING lease_token`).bind(memberId,feature,window,now+65_000,token,now).first<{lease_token:string}>();
  if(row?.lease_token!==token)throw new BackendError('AI_RATE_LIMIT','An AI request is already running or your hourly AI limit was reached. Try again later.',429);
  return async()=>{await database.prepare('UPDATE ai_usage_limits SET lease_until=0,lease_token=NULL WHERE member_id=? AND feature=? AND lease_token=?')
    .bind(memberId,feature,token).run();};
}
