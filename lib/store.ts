import { env } from 'cloudflare:workers';
import { initialState, normalizeWorkspace, isDemoTrip, type State } from './model';
import {sharedTripView,mergeSharedTrip} from './trip-sharing';
import {accountPersonId,initializePeople,canEditPerson,type Identity} from './people';
import {PlanRepository,visibleWorkspace} from './plan-repository';
import {BackendError} from './backend-errors';
import {bedrockConfig} from './bedrock';
export function db(){if(!env.DB)throw Error('Saved workspace unavailable. Please try again.');return env.DB;}
function loopbackPreview(request:Request){const deployed=typeof process!=='undefined'&&(process.env.PLANRECOVER_HOSTING==='vercel'||!!process.env.VERCEL);return !deployed&&['terminal.local','localhost','127.0.0.1'].includes(new URL(request.url).hostname);}
export function owner(request:Request){const id=request.headers.get('oai-authenticated-user-id');if(id)return id;if(loopbackPreview(request))return 'local-beta-testing';throw Error('Sign in to access your saved workspace.');}
export function checkOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw Error('This request must come from the app.');}
export async function loadState(id:string,identity?:Identity):Promise<State>{
 const repository=new PlanRepository(db());
 for(let attempt=0;attempt<3;attempt++){
  const original=await repository.loadWorkspace(id);
  if(original){
   const normalized=normalizeWorkspace(original);
   const ownerIdentity=identity??{id:await accountPersonId(id),name:'Plan owner'};
   for(const plan of [normalized,...(normalized.archives??[]).map(a=>a.workspace)])if(!isDemoTrip(plan)&&!plan.empty)initializePeople(plan,ownerIdentity);
   if(JSON.stringify(original)===JSON.stringify(normalized)){await repository.importWorkspace(id,normalized,ownerIdentity);return normalized;}
   try{return await saveState(id,normalized,original.version);}catch(e){if(!(e instanceof Error)||!e.message.includes('Refresh'))throw e;continue;}
  }
  const state=initialState();
  await db().prepare('INSERT OR IGNORE INTO workspaces (owner,body,version,updated) VALUES (?,?,?,?)').bind(id,JSON.stringify(state),0,new Date().toISOString()).run();
 }
 throw Error('Another change was saved. Refresh the workspace and try again.');
}
export async function saveState(id:string,state:State,expected:number){return new PlanRepository(db()).saveWorkspace(id,state,expected);}
export type WorkspaceAccess={id:string;user?:Identity;share?:{tokenHash:string;tripId:string;role:'viewer'|'editor'}};
export async function tokenHash(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function workspaceAccess(request:Request):Promise<WorkspaceAccess>{
 const account=request.headers.get('oai-authenticated-user-id')??(loopbackPreview(request)?'local-beta-testing':null);
 let displayName=request.headers.get('oai-authenticated-user-email')??'Plan owner';const full=request.headers.get('oai-authenticated-user-full-name');if(full&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{displayName=decodeURIComponent(full);}catch{}}
 const user=account?{id:await accountPersonId(account),name:displayName.slice(0,60)}:undefined;
 const token=request.headers.get('x-trip-share');
 if(!token)return {id:owner(request),user};
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('This plan link is invalid or was turned off.');
 const hash=await tokenHash(token),link=await db().prepare('SELECT owner, trip_id, role, expires FROM trip_links WHERE token_hash = ?').bind(hash).first<{owner:string;trip_id:string;role:string;expires:string|null}>();
 if(!link)throw Error('This plan link is invalid or was turned off.');
 if(link.expires!==null&&(!Number.isFinite(Date.parse(link.expires))||Date.parse(link.expires)<=Date.now()))throw new BackendError('INVITATION_EXPIRED','This plan invitation expired. Ask the owner for a new link.',410);
 return {id:link.owner,user,share:{tokenHash:hash,tripId:link.trip_id,role:link.role==='viewer'?'viewer':'editor'}};
}
export async function loadAccess(access:WorkspaceAccess){const root=await loadState(access.id,access.share?undefined:access.user);return access.share?sharedTripView(root,access.share.tripId):root;}
export function requireEdit(access:WorkspaceAccess,state:State){
 if(access.share?.role==='viewer')throw Error('This link has viewing access only.');
 if(isDemoTrip(state)&&!state.people)return;
 if(!access.user)throw Error('Sign in to edit this plan.');
 if(!canEditPerson(state,access.user.id))throw Error('Join this plan or ask its owner for editing access.');
}
export async function saveAccess(access:WorkspaceAccess,state:State,expected:number,joining=false):Promise<State>{
 if(!joining)requireEdit(access,state);
 if(!access.share)return saveState(access.id,state,expected);
 const root=await loadState(access.id);if(root.version!==expected)throw Error('Another change was saved. Refresh the workspace and try again.');
 const merged=mergeSharedTrip(root,state,access.share.tripId);
 const saved=await new PlanRepository(db()).saveWorkspace(access.id,merged,expected,undefined,access.share);
 return sharedTripView(saved,access.share.tripId);
}
export function publicState(state:State,access:WorkspaceAccess){return visibleWorkspace(state,access.user?.id);}
export async function collaboration(access:WorkspaceAccess,state:State){const person=state.people?.find(p=>p.id===access.user?.id);let canEdit=true;try{requireEdit(access,state);}catch{canEdit=false;}return {shared:!!access.share,canManage:!access.share,canEdit,signedIn:!!access.user,memberId:person?.id,displayName:person?.name??access.user?.name??'Guest',role:person?.role??(access.share?'guest':'owner'),canJoin:!!access.share&&!!state.people&&!!access.user&&!person,linkRole:access.share?.role,sharingEnabled:!!access.share||!!await db().prepare("SELECT token_hash FROM trip_links WHERE owner = ? AND trip_id = ? AND (expires IS NULL OR julianday(expires)>julianday('now')) LIMIT 1").bind(access.id,state.plan.id).first()};}
export function apiError(e:unknown,status=400){const message=e instanceof Error?e.message:'Request could not be completed.';console.error('PlanRecover request failed:',message);return Response.json({error:message,code:e instanceof BackendError?e.code:'REQUEST_FAILED'},{status:e instanceof BackendError?e.status:typeof (e as {status?:number})?.status==='number'?(e as {status:number}).status:message.includes('Sign in')?401:message.includes('viewing access')||message.includes('editing access')?403:message.includes('Refresh')?409:status});}
export function config(){
 const e=env as unknown as Record<string,string>;
 let bedrock=false;try{bedrock=!!bedrockConfig(e);}catch{/* Configuration failures expose no credentials to the browser. */}
 return {paypal:!!(e.PAYPAL_CLIENT_ID&&e.PAYPAL_CLIENT_SECRET),clientId:e.PAYPAL_CLIENT_ID??'',
  ai:bedrock||!!e.OPENAI_API_KEY,bedrock,aiProvider:bedrock?'bedrock':e.OPENAI_API_KEY?'openai':null,
  webhook:!!e.PAYPAL_WEBHOOK_ID};
}
