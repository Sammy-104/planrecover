import {checkOrigin,db,apiError,workspaceAccess,loadAccess} from '@/lib/store';
import {planApiContext,privateHeaders,parsePlanMutation} from '@/lib/plan-api';
import {invoiceJson} from '@/lib/plan-invoices';
import {reviewPlanAction} from '@/lib/planning-review';
import {BackendError,conflict,missingPlan} from '@/lib/backend-errors';
import {PlanRepository} from '@/lib/plan-repository';
import {loadPlanningPreferences} from '@/lib/planning-constraints';
import {z} from 'zod';
const workspaceReview=z.object({workspaceVersion:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),action:z.unknown()}).strict();
async function workspaceContext(request:Request,planId:string,version:number){
 let access;try{access=await workspaceAccess(request);}catch(error){if(error instanceof Error&&error.message.includes('Sign in'))throw new BackendError('AUTH_REQUIRED','Sign in to review your private fit.',401);throw error;}
 if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to review your private fit.',401);
 if(access.share&&access.share.tripId!==planId)throw missingPlan();
 const repository=new PlanRepository(db()),record=await repository.getPlan(planId,access.user);
 if(access.share&&record.owner!==access.id)throw missingPlan();
 const workspace=await loadAccess(access);
 if(workspace.plan.id!==planId||workspace.version!==version)throw conflict();
 return {access,identity:access.user,repository,record};
}
export async function POST(request:Request,context:{params:Promise<{planId:string}>}){try{
 checkOrigin(request);const initialAccess=await workspaceAccess(request);if(!initialAccess.user)throw new BackendError('AUTH_REQUIRED','Sign in to review your private fit.',401);
 const {planId}=await context.params,raw=await invoiceJson(request,30000);
 const usesWorkspaceVersion=!!raw&&typeof raw==='object'&&'workspaceVersion' in raw;
 const envelope=usesWorkspaceVersion?workspaceReview.safeParse(raw):null;
 if(envelope&&!envelope.success)throw new BackendError('INVALID_REQUEST','Provide the current workspace version and a supported action.');
 const input=parsePlanMutation(envelope?.success?{version:envelope.data.workspaceVersion,action:envelope.data.action}:raw);
 const workspaceCurrent=usesWorkspaceVersion?await workspaceContext(request,planId,input.version):null;
 const {identity,repository}=workspaceCurrent??await planApiContext(request,{readOnly:true});
 const record=workspaceCurrent?.record??await repository.getPlan(planId,identity);
 if(!usesWorkspaceVersion&&record.version!==input.version)throw conflict();
 const review=await reviewPlanAction(db(),record,identity.id,input.action);
 const fresh=usesWorkspaceVersion?await workspaceContext(request,planId,input.version):null;
 const latest=fresh?.record??await repository.getPlan(planId,identity);
 if(latest.version!==record.version||fresh&&workspaceCurrent&&(fresh.access.id!==workspaceCurrent.access.id||fresh.access.share?.tokenHash!==workspaceCurrent.access.share?.tokenHash||fresh.access.share?.role!==workspaceCurrent.access.share?.role))throw conflict();
 if(review&&(await loadPlanningPreferences(db(),record.owner,planId,identity.id,record.state.plan.timezone)).version!==review.planningVersion)throw conflict();
 return Response.json({review},{headers:privateHeaders});
}catch(error){return apiError(error);}}
