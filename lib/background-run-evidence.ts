export type BackgroundRunSource='manual'|'scheduled';

/** A successful service call is not an unattended run. Persist its actual
 * entry point and terminal outcome without storing private job payloads. */
export async function observeOwnerRun<T extends {status:string}>(database:D1Database,owner:string,source:BackgroundRunSource,run:()=>Promise<T>,clock=()=>Date.now()):Promise<T>{
 const started=new Date(clock()).toISOString(),id=crypto.randomUUID();
 try{
  const result=await run();
  if(result.status==='completed')await database.prepare("INSERT INTO background_run_evidence(id,owner,source,status,started_at,completed_at) VALUES (?,?,?,'completed',?,?)").bind(id,owner,source,started,new Date(clock()).toISOString()).run();
  await database.prepare('DELETE FROM background_run_evidence WHERE id IN (SELECT id FROM background_run_evidence WHERE owner=? AND started_at<? ORDER BY started_at LIMIT 100)').bind(owner,new Date(clock()-90*86400000).toISOString()).run();
  return result;
 }catch(error){
  await database.prepare("INSERT OR IGNORE INTO background_run_evidence(id,owner,source,status,started_at,completed_at) VALUES (?,?,?,'failed',?,?)").bind(id,owner,source,started,new Date(clock()).toISOString()).run();
  throw error;
 }
}
