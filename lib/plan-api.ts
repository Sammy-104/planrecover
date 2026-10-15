import { z } from 'zod';
import { workspaceAccess, loadState, db } from './store';
import { PlanRepository } from './plan-repository';
import { BackendError } from './backend-errors';
import { parseWorkspaceMutation } from './action-contracts';
import type { State, Preferences, Action } from './model';

export const privateHeaders={'Cache-Control':'private, no-store'};
export async function planApiContext(request:Request,options:{readOnly?:boolean}={}) {
  let access;
  try {access=await workspaceAccess(request);}
  catch(error){if(error instanceof Error&&error.message.includes('Sign in'))throw new BackendError('AUTH_REQUIRED','Sign in to access your plans.',401);throw error;}
  if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to access your plans.',401);
  if(access.share)throw new BackendError('SHARED_ROUTE','Open the plan workspace to use this invitation.',403);
  if(!options.readOnly)await loadState(access.id,access.user);
  return {access,identity:access.user,repository:new PlanRepository(db())};
}
export function recordResponse(record:{state:State;version:number;role:string}) {
  return Response.json({state:record.state,version:record.version,role:record.role},{headers:privateHeaders});
}
export function parsePlanCreation(input:unknown) {
  const envelope=z.object({plan:z.unknown()}).strict().safeParse(input);
  if(!envelope.success)throw new BackendError('INVALID_REQUEST','Provide the new plan details.');
  const action=parseWorkspaceMutation({version:0,action:{type:'create_trip',plan:envelope.data.plan}}).action;
  if(action.type!=='create_trip')throw new BackendError('INVALID_REQUEST','Provide the new plan details.');
  return action.plan as Partial<State['plan']>;
}
export function parsePlanMutation(input:unknown) {
  const parsed=parseWorkspaceMutation(input);
  return {version:parsed.version,action:{...parsed.action,actor:''} as Action};
}
export function parsePreferences(input:unknown) {
  const envelope=z.object({version:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),preferences:z.unknown()}).strict().safeParse(input);
  if(!envelope.success)throw new BackendError('INVALID_REQUEST','Provide preferences and their current version.');
  const parsed=parseWorkspaceMutation({version:envelope.data.version,action:{type:'preferences',preferences:envelope.data.preferences}});
  if(parsed.action.type!=='preferences')throw new BackendError('INVALID_REQUEST','Provide your preferences.');
  return {version:envelope.data.version,preferences:parsed.action.preferences as Preferences};
}
