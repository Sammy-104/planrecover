import {forbidden} from './backend-errors.ts';

export type ReviewInvitation={owner:string;tokenHash:string;tripId:string;role:'viewer'|'editor'};

/** Bind current plan membership and invitation authority to the actual INSERT.
 * A preflight read cannot authorize a preview after its invitation is revoked. */
export function reviewWriteGuard(input:{owner:string;planId:string;version:number;memberId:string;invitation?:ReviewInvitation}){
 const {owner,planId,version,memberId,invitation}=input;
 if(invitation&&(invitation.owner!==owner||invitation.tripId!==planId||invitation.role!=='editor'))throw forbidden();
 const sql=`EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
  WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))${invitation?
  " AND EXISTS(SELECT 1 FROM trip_links WHERE token_hash=? AND owner=? AND trip_id=? AND role='editor' AND (expires IS NULL OR julianday(expires)>julianday('now')))":''}`;
 return {sql,values:[owner,planId,version,memberId,...(invitation?[invitation.tokenHash,owner,planId]:[])]};
}
