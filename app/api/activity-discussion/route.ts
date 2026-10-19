import {workspaceAccess,loadAccess,apiError} from '@/lib/store';
import {activityDecision} from '@/lib/activity-decisions';
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams,access=await workspaceAccess(request),state=await loadAccess(access);
 if(query.get('tripId')!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');
 return Response.json({decision:activityDecision(state,query.get('targetId')??''),version:state.version},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
