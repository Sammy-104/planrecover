import { applyAction, type Action, type Receipt, type Preferences } from '@/lib/model';
import { checkOrigin, workspaceAccess, loadAccess, saveAccess, collaboration, apiError, config, requireEdit, publicState, db } from '@/lib/store';
import { initializePeople } from '@/lib/people';
import { checkSharedAction } from '@/lib/trip-sharing';
import { parseWorkspaceMutation } from '@/lib/action-contracts';
import { PlanRepository } from '@/lib/plan-repository';
import { BackendError, conflict } from '@/lib/backend-errors';
import { requireReviewedReceiptDraft } from '@/lib/receipt-drafts';
import {reviewPlanAction} from '@/lib/planning-review';
import {prepareFrontendAction} from '@/lib/frontend-server';
import {invoiceJson} from '@/lib/plan-invoices';

export async function GET(request:Request) {
  try {
    const access=await workspaceAccess(request), state=await loadAccess(access);
    return Response.json({state:publicState(state,access),collaboration:await collaboration(access,state),
      config:access.share?{...config(),paypal:config().paypal&&(await collaboration(access,state)).canEdit,webhook:false}:config()},
      {headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error,503);}
}

export async function POST(request:Request) {
  try {
    checkOrigin(request);
    const access=await workspaceAccess(request), current=await loadAccess(access);
    requireEdit(access,current);
    const parsed=parseWorkspaceMutation(await invoiceJson(request,1000000),{requireActor:!current.people});
    let action:Action={...parsed.action,actor:current.people?access.user!.id:parsed.action.actor!};
    if(parsed.version!==current.version)throw conflict();
    if(access.share)checkSharedAction(current,action);
    action=await prepareFrontendAction(current,action.actor,action,new URL(request.url).origin);
    if(action.type==='receipt'&&(action.receipt as Receipt).fileKey) {
      const fileKey=(action.receipt as Receipt).fileKey!;
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access.id));
      const prefix=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(!fileKey.startsWith(`${prefix}/`))throw new BackendError('RECEIPT_ACCESS','This receipt attachment is unavailable.',403);
      await requireReviewedReceiptDraft(db(),access.id,current.plan.id!,action.receipt as Receipt);
    }
    const review=current.people?await reviewPlanAction(db(),await new PlanRepository(db()).getPlan(current.plan.id!,access.user!),access.user!.id,action):null;
    let state;
    if(['preferences','planning_style','reminder_settings','reminder_personal'].includes(action.type)&&current.people) {
      const repository=new PlanRepository(db());
      const previous=await repository.getPreferences(current.plan.id!,access.user!);
      const preferences=action.type==='preferences'?action.preferences as Preferences:applyAction(current,action).preferences[access.user!.id];
      await repository.updatePreferences(current.plan.id!,access.user!,preferences,previous.version,{workspaceVersion:parsed.version,link:access.share});
      state=await loadAccess(access);
    } else {
      const next=applyAction(current,action);
      if(action.type==='create_trip'&&access.user) {
        delete next.people; next.preferences={}; initializePeople(next,access.user);
        next.audit.forEach(entry=>{entry.actorId=access.user!.id;entry.actorName=access.user!.name;});
      }
      state=await saveAccess(access,next,parsed.version);
    }
    return Response.json({state:publicState(state,access),collaboration:await collaboration(access,state),review},
      {headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
