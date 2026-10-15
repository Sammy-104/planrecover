import {workspaceAccess,checkOrigin,loadAccess,saveAccess,collaboration,apiError,publicState} from '@/lib/store';
import {addPerson,makePerson,personName} from '@/lib/people';
import {BackendError} from '@/lib/backend-errors';
import {z} from 'zod';
const id=z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const name=z.string().trim().min(1).max(60);
const common={version:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),tripId:id};
const memberRequest=z.discriminatedUnion('operation',[
 z.object({...common,operation:z.literal('join'),name:name.optional()}).strict(),
 z.object({...common,operation:z.literal('profile'),name}).strict(),
 z.object({...common,operation:z.literal('role'),memberId:id,role:z.enum(['viewer','editor'])}).strict(),
]);
export async function POST(request:Request){try{
 checkOrigin(request);const access=await workspaceAccess(request),parsed=memberRequest.safeParse(await request.json());
 if(!parsed.success)throw new BackendError('INVALID_MEMBER_REQUEST','Enter a valid member action and current plan version.',400);
 const body=parsed.data,state=await loadAccess(access);
 if(!access.user)throw Error('Sign in to join this plan.');if(body.tripId!==state.plan.id||body.version!==state.version)throw Error('Another change was saved. Refresh the workspace and try again.');if(!state.people)throw Error('Member accounts are available on personal plans.');
 const current=state.people.find(p=>p.id===access.user!.id);
 if(body.operation==='join'){
  if(!access.share)throw Error('Open a plan invitation to join.');
  if(!current)addPerson(state,{...access.user,name:personName(body.name??access.user.name)},access.share.role);
 }else if(body.operation==='profile'){
  if(!current)throw new BackendError('FORBIDDEN','Join the plan before changing your profile.',403);Object.assign(current,makePerson(current.id,personName(body.name),current.role));
  state.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),text:`${current.name} updated their name.`,actorId:current.id,actorName:current.name});
 }else if(body.operation==='role'){
  if(access.share||current?.role!=='owner')throw new BackendError('FORBIDDEN','Only the plan owner can manage people.',403);
  const person=state.people.find(p=>p.id===body.memberId);if(!person||!['viewer','editor'].includes(String(body.role))||['owner','legacy'].includes(person.role))throw Error('Choose a friend and viewer or editor access.');
  person.role=body.role as 'viewer'|'editor';state.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),text:`${current.name} changed ${person.name} to ${person.role}.`,actorId:current.id,actorName:current.name});
 }
 const saved=await saveAccess(access,state,state.version,true);return Response.json({state:publicState(saved,access),collaboration:await collaboration(access,saved)},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}
