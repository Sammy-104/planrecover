import {frontendJson} from '@/lib/frontend-request';
import {workspaceAccess,loadAccess,apiError,checkOrigin} from '@/lib/store';
import {suggestionPreview} from '@/lib/suggestion-preview';
export async function POST(request:Request){try{checkOrigin(request);const access=await workspaceAccess(request),state=await loadAccess(access),body=await frontendJson(request) as Record<string,unknown>;if(body.tripId!==state.plan.id)throw Error('The active plan changed. Refresh and try again.');const actor=state.people?access.user?.id??'guest':String(body.actor??'sam'),result=await suggestionPreview(state,body,actor,new URL(request.url).origin);const {options:_,...visible}=result;return Response.json(visible,{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}}
