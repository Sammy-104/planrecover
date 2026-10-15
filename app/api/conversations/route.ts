import {workspaceAccess,checkOrigin,apiError,db} from '@/lib/store';
import {privateHeaders} from '@/lib/plan-api';
import {ConversationRepository} from '@/lib/conversations';
import {PlanRepository} from '@/lib/plan-repository';
import {BackendError,missingPlan} from '@/lib/backend-errors';
import {invoiceJson} from '@/lib/plan-invoices';
import {isDemoTrip} from '@/lib/model';
import {z} from 'zod';
const actor=z.enum(['sam','alex','maya','chris']).optional();
const bodySchema=z.object({planId:z.string().min(1).max(180).nullable(),title:z.string().trim().min(1).max(100).optional(),demoMember:actor}).strict();
async function context(request:Request){
 const access=await workspaceAccess(request);if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to access saved conversations.',401);
 const repository=new ConversationRepository(db());return {access,identity:access.user,repository};
}
async function checkPlan(access:Awaited<ReturnType<typeof workspaceAccess>>,planId:string|null,demoMember?:string){
 if(access.share&&planId!==access.share.tripId)throw missingPlan();
 const record=planId?await new PlanRepository(db()).getPlan(planId,access.user!):undefined;
 if(access.share&&record?.owner!==access.id)throw missingPlan();
 if(demoMember&&(!record||!isDemoTrip(record.state)||record.state.people))throw new BackendError('INVALID_DEMO_CONTEXT','Demo member views are available only in the fictional demo.');
 return record;
}
export async function GET(request:Request){try{
 const {access,identity,repository}=await context(request),url=new URL(request.url),demoMember=actor.parse(url.searchParams.get('demoMember')??undefined),id=url.searchParams.get('id');
 if(id){if(!z.string().uuid().safeParse(id).success)throw new BackendError('CONVERSATION_INPUT','Choose a saved conversation.');
  const value=await repository.read(await repository.ownerFor(identity,id),identity,id,url.searchParams.get('before')??undefined,demoMember??'');
  await checkPlan(access,value.planId,demoMember);if(url.searchParams.has('planId')&&url.searchParams.get('planId')!==value.planId)throw missingPlan();return Response.json(value,{headers:privateHeaders});}
 const planId=z.string().min(1).max(180).optional().parse(url.searchParams.get('planId')??undefined),record=await checkPlan(access,planId??null,demoMember);
 return Response.json({conversations:await repository.list(record?.owner??access.id,identity,planId,demoMember??'')},{headers:privateHeaders});
}catch(e){return apiError(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const {access,identity,repository}=await context(request),body=bodySchema.parse(await invoiceJson(request,1000));
 const record=await checkPlan(access,body.planId,body.demoMember);
 return Response.json(await repository.create(record?.owner??access.id,identity,body.planId,body.title,body.demoMember??''),{headers:privateHeaders});
}catch(e){return apiError(e);}}
