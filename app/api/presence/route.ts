import {frontendJson} from '@/lib/frontend-request';
import {workspaceAccess,loadAccess,requireEdit,checkOrigin,db,apiError} from '@/lib/store';
import {tripCatalog} from '@/lib/model';
import {PRESENCE_WINDOW,validPresence,type PresenceEntry} from '@/lib/presence';
import {savePlanPresence} from '@/lib/presence-store';

async function handle(request:Request){
 try{
  const writing=request.method==='POST';if(writing)checkOrigin(request);
  const access=await workspaceAccess(request),state=await loadAccess(access),body=writing?await frontendJson(request) as Record<string,unknown>:Object.fromEntries(new URL(request.url).searchParams);
  if(body.tripId!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');
  const people=state.people??[],now=Date.now();
  if(writing){
   requireEdit(access,state);const person=people.find(p=>p.id===access.user?.id&&['owner','editor'].includes(p.role));if(!person)throw Error('Join this plan with editing access to show presence.');
   const input=validPresence(body);
   if(input.itemId&&!state.items.some(i=>i.id===input.itemId)&&!tripCatalog(state).some(i=>i.id===input.itemId))throw Error('Choose an activity in this plan.');
   await savePlanPresence(db(),{owner:access.id,planId:state.plan.id!,memberId:person.id,workspaceVersion:state.version,link:access.share},input,{now,leave:body.leave===true});
  }
  const rows=await db().prepare("SELECT v.member_id,v.view,v.status,v.item_id,v.seen_at FROM plan_presence v JOIN plan_members m ON m.owner=v.owner AND m.plan_id=v.trip_id AND m.member_id=v.member_id WHERE v.owner=? AND v.trip_id=? AND v.seen_at>=? AND m.role IN ('owner','editor') ORDER BY v.seen_at DESC LIMIT 40").bind(access.id,state.plan.id!,now-PRESENCE_WINDOW).all<{member_id:string;view:string;status:string;item_id:string|null;seen_at:number}>();
  const entries:PresenceEntry[]=rows.results.flatMap(row=>{const p=people.find(p=>p.id===row.member_id&&['owner','editor'].includes(p.role));if(!p)return [];const item=state.items.find(i=>i.id===row.item_id)??tripCatalog(state).find(i=>i.id===row.item_id);return [{memberId:p.id,name:p.name,initials:p.initials,color:p.color,status:row.status==='editing'?'editing':'viewing',view:row.view,itemId:item?.id,itemName:item?.name,seenAt:new Date(row.seen_at).toISOString()}];});
  return Response.json({entries,checkedAt:new Date(now).toISOString()},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return apiError(e);}
}
export const GET=handle;
export const POST=handle;
