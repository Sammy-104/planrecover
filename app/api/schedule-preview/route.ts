import {frontendJson} from '@/lib/frontend-request';
import {workspaceAccess,loadAccess,requireEdit,checkOrigin,apiError} from '@/lib/store';
import {schedulePreview} from '@/lib/schedule-preview';
export async function POST(request:Request){try{
 checkOrigin(request);const access=await workspaceAccess(request),state=await loadAccess(access),body=await frontendJson(request) as Record<string,unknown>;requireEdit(access,state);if(body.tripId!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');
 const result=await schedulePreview(state,body,state.people?access.user!.id:'sam',new URL(request.url).origin),{matrix:_,...visible}=result;
 return Response.json(visible,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
