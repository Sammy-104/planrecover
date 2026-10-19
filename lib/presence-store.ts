import {BackendError} from './backend-errors.ts';
type Input={sessionId:string;view:string;status:'viewing'|'editing';itemId:string|null};
type Link={tokenHash:string;tripId:string;role:'viewer'|'editor'};
/** Ephemeral presence still uses the same current workspace, membership and
 * invitation fences as plan writes. A stale request cannot publish presence
 * after revocation or overwrite a newer plan/session view. */
export async function savePlanPresence(database:D1Database,scope:{owner:string;planId:string;memberId:string;workspaceVersion:number;link?:Link},input:Input,{now=Date.now(),leave=false}:{now?:number;leave?:boolean}={}){
 if(scope.link&&(scope.link.tripId!==scope.planId||scope.link.role!=='editor'))throw new BackendError('PRESENCE_ACCESS','Open this plan with current editing access.',403);
 const token=crypto.randomUUID(),link=scope.link,linkGuard=link?" AND EXISTS(SELECT 1 FROM trip_links WHERE token_hash=? AND owner=? AND trip_id=? AND role='editor' AND (expires IS NULL OR julianday(expires)>julianday('now')))":'';
 const guard=database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
  SELECT 1 FROM workspaces w JOIN plans p ON p.owner=w.owner JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
  WHERE w.owner=? AND w.version=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))${linkGuard} THEN 1 ELSE 0 END)`)
  .bind(token,scope.owner,scope.workspaceVersion,scope.planId,scope.memberId,...(link?[link.tokenHash,scope.owner,scope.planId]:[]));
 const write=leave?database.prepare('DELETE FROM plan_presence WHERE owner=? AND trip_id=? AND member_id=? AND session_id=?').bind(scope.owner,scope.planId,scope.memberId,input.sessionId):database.prepare(`INSERT INTO plan_presence(owner,trip_id,member_id,session_id,view,status,item_id,seen_at) VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(owner,trip_id,member_id) DO UPDATE SET session_id=excluded.session_id,view=excluded.view,status=excluded.status,item_id=excluded.item_id,seen_at=excluded.seen_at WHERE plan_presence.seen_at<=excluded.seen_at`)
  .bind(scope.owner,scope.planId,scope.memberId,input.sessionId,input.view,input.status,input.itemId,now);
 try{await database.batch([guard,database.prepare('DELETE FROM plan_presence WHERE owner=? AND trip_id=? AND seen_at<?').bind(scope.owner,scope.planId,now-300000),write,database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)]);}
 catch(error){if(String(error).includes('CHECK constraint'))throw new BackendError('PRESENCE_CHANGED','Plan access changed. Refresh before updating presence.',409);throw error;}
}
