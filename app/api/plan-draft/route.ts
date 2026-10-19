import {workspaceAccess,loadAccess,requireEdit,checkOrigin,apiError,publicState,saveAccess} from '@/lib/store';
import {frontendJson} from '@/lib/frontend-request';
import {draftCityState,dayCity,cityRecommendations,setCityRecommendations} from '@/lib/city-stays';
import {createPlanDraft,draftCandidatePool,draftGoal} from '@/lib/plan-draft';
import {cityProfile} from '@/lib/cities';
import {cityCatalog} from '@/lib/city-catalog-cache';
import {draftTravelMatrix} from '@/lib/schedule-preview';
import {tripDays} from '@/lib/trip-time';
import {validPoint} from '@/lib/itinerary-map';
export async function POST(request:Request){try{
 checkOrigin(request);const access=await workspaceAccess(request);let state=await loadAccess(access);requireEdit(access,state);
 const body=await frontendJson(request);if(Object.keys(body).some(k=>!['tripId','goal','ai','day'].includes(k))||body.tripId!==state.plan.id||typeof body.goal!=='string'||body.day!==undefined&&typeof body.day!=='string')throw Error('Choose the active plan and a planning goal.');
 if(body.ai===true)throw Error('Use the source-based draft while AI service verification is pending.');
 const actor=state.people?access.user!.id:'sam';draftGoal(body.goal,state,actor);const context=dayCity(state,body.day as string|undefined??state.plan.start);
 if(!cityProfile(context.destination,context.city)&&!cityRecommendations(state,context.destination)?.entries.length){try{const catalog=await cityCatalog(context.destination,context.city,'',false,new URL(request.url).origin);state=await saveAccess(access,setCityRecommendations(state,catalog),state.version);}catch{/* Existing source data remains usable. */}}
 const scoped=draftCityState(state,body.day as string|undefined??state.plan.start),visible=publicState(scoped,access),candidates=draftCandidatePool(visible,body.goal,actor).filter(validPoint).slice(0,24).map(c=>c.id);
 let matrix;try{matrix=(await draftTravelMatrix(scoped,candidates,tripDays(scoped.plan.start,scoped.plan.end).slice(0,7),state.plan.scheduleTravelMode==='drive'?'drive':'walk',new URL(request.url).origin)).matrix;}catch{}
 const draft=createPlanDraft(visible,body.goal,actor,candidates.map(suggestionId=>({suggestionId,reason:'Chosen from mapped source places for your planning goal.'})),matrix);draft.mode='source';draft.routeSourceIds=candidates;
 if(!matrix)draft.warnings.unshift('Mapped routes are not ready. These times are provisional; regenerate the preview before adding.');
 return Response.json({draft,state:publicState(state,access),note:'Source-based planning uses saved catalog places and your stated goal. No AI service was called.'},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return apiError(e);}}
