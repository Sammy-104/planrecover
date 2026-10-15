import {z} from 'zod';
import {workspaceAccess,checkOrigin,loadState,db,tokenHash,apiError} from '@/lib/store';
import {hasSharedTrip} from '@/lib/trip-sharing';
import {BackendError} from '@/lib/backend-errors';

const sharingRequest=z.object({
 tripId:z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
 operation:z.enum(['create','revoke']).default('create'),role:z.enum(['editor','viewer']).optional(),
}).strict().refine(value=>value.operation!=='revoke'||value.role===undefined,'Revocation turns off all invitation links.');
const privateHeaders={'Cache-Control':'private, no-store'};
const validInvitation="(expires IS NULL OR julianday(expires)>julianday('now'))";

export async function POST(request:Request){
 try{
  checkOrigin(request);
  const access=await workspaceAccess(request);
  if(access.share)throw new BackendError('FORBIDDEN','Only the plan owner can manage sharing.',403);
  if(!access.user)throw new BackendError('AUTHENTICATION_REQUIRED','Sign in to manage plan invitations.',401);
  const parsed=sharingRequest.safeParse(await request.json());
  if(!parsed.success)throw new BackendError('INVALID_SHARING_REQUEST','Choose a valid plan sharing action.',400);
  const body=parsed.data,id=access.id,state=await loadState(id,access.user);
  if(!hasSharedTrip(state,body.tripId))throw new BackendError('PLAN_NOT_FOUND','This plan is no longer available.',404);
  const member=await db().prepare('SELECT role FROM plan_members WHERE owner=? AND plan_id=? AND member_id=?')
   .bind(id,body.tripId,access.user.id).first<{role:string}>();
  if(member?.role!=='owner')throw new BackendError('FORBIDDEN','Only the plan owner can manage sharing.',403);

  // Recheck authorization in the transaction: deleting a plan cannot race with
  // creating an invitation to it. Historical membership stays intact.
  const guardId=crypto.randomUUID();
  const commands=[db().prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
    SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
    WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role='owner') THEN 1 ELSE 0 END)`)
   .bind(guardId,id,body.tripId,access.user.id)];
  if(body.operation==='revoke'){
   commands.push(db().prepare('DELETE FROM trip_links WHERE owner=? AND trip_id=?').bind(id,body.tripId));
  }else{
   const role=body.role??'editor',created=new Date().toISOString(),expires=new Date(Date.now()+7*86_400_000).toISOString();
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
   // Preserve valid links. Concurrent creators return the same persisted winner.
   commands.push(db().prepare("DELETE FROM trip_links WHERE owner=? AND trip_id=? AND role=? AND expires IS NOT NULL AND (julianday(expires) IS NULL OR julianday(expires)<=julianday('now'))")
    .bind(id,body.tripId,role));
   commands.push(db().prepare(`INSERT INTO trip_links(token_hash,token,owner,trip_id,created,role,expires)
    SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM trip_links WHERE owner=? AND trip_id=? AND role=? AND ${validInvitation})`)
    .bind(await tokenHash(token),token,id,body.tripId,created,role,expires,id,body.tripId,role));
  }
  commands.push(db().prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guardId));
  try{await db().batch(commands);}catch(error){
   if(String(error).includes('CHECK constraint failed'))throw new BackendError('SHARING_UNAVAILABLE','Only the plan owner can manage sharing for an available plan.',403);
   throw error;
  }
  if(body.operation==='revoke')return Response.json({sharingEnabled:false},{headers:privateHeaders});
  const existing=await db().prepare(`SELECT token,expires FROM trip_links WHERE owner=? AND trip_id=? AND role=? AND ${validInvitation} ORDER BY created ASC,token_hash ASC LIMIT 1`)
   .bind(id,body.tripId,body.role??'editor').first<{token:string;expires:string|null}>();
  if(!existing)throw new BackendError('INVITATION_UNAVAILABLE','The invitation was turned off. Create a new link.',409);
  return Response.json({token:existing.token,expires:existing.expires,sharingEnabled:true},{headers:privateHeaders});
 }catch(e){return apiError(e);}
}
