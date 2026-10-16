import {z} from 'zod';
import {planApiContext,recordResponse} from '@/lib/plan-api';
import {checkOrigin,apiError} from '@/lib/store';
import {forbidden,conflict,BackendError} from '@/lib/backend-errors';
import {applyAction} from '@/lib/model';
import {parseWorkspaceMutation} from '@/lib/action-contracts';
import {sharedTripView,mergeSharedTrip} from '@/lib/trip-sharing';
import {invoiceJson} from '@/lib/plan-invoices';
import {requirePayPalCurrency} from '@/lib/payment-guards';
type Context={params:Promise<{planId:string}>};
const catalog={museum:{name:'Fictional museum visit',category:'Activity',each:1600,duration:60},
 'equipment-rental':{name:'Fictional equipment rental',category:'Activity',each:6000,duration:90},
 'guided-activity':{name:'Fictional guided activity',category:'Activity',each:9000,duration:120}} as const;
const schema=z.object({version:z.number().int().min(0),catalogId:z.enum(['museum','equipment-rental','guided-activity']),
 start:z.string().max(40),participants:z.array(z.string().min(1).max(180)).min(1).max(100),replacementItemId:z.string().min(1).max(180).optional(),confirm:z.literal(true).optional()}).strict();
/** Explicitly fictional sandbox quotes, never live supplier inventory. */
export async function POST(request:Request,context:Context){try{
 checkOrigin(request);const {identity,repository}=await planApiContext(request),{planId}=await context.params;
 const record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();
 requirePayPalCurrency(record.state.plan);
 const parsed=schema.safeParse(await invoiceJson(request,8192));if(!parsed.success)throw new BackendError('INVALID_QUOTE','Choose a fictional sandbox catalog item and its participants.');
 if(record.version!==parsed.data.version)throw conflict();
 const quote=catalog[parsed.data.catalogId],price=quote.each*parsed.data.participants.length;
 const replacement=parsed.data.replacementItemId?record.state.items.find(i=>i.id===parsed.data.replacementItemId):undefined;
 if(parsed.data.replacementItemId&&(!replacement||parsed.data.confirm!==true||replacement.status!=='draft'||replacement.source!=='Recovery proposal draft'||record.state.events.some(e=>e.itemId===replacement.id)||JSON.stringify(parsed.data.participants)!==JSON.stringify(replacement.participants)))throw new BackendError('INVALID_QUOTE','Select an unpaid recovery draft and explicitly confirm the fictional quote.');
 const action=parseWorkspaceMutation({version:record.version,action:{type:'add_item',name:quote.name,category:quote.category,
  start:parsed.data.start,duration:quote.duration,price,participants:parsed.data.participants,
  location:record.state.plan.destination,policy:'Fictional sandbox merchant quote. No real booking. Cancellation policy requires a separate recorded policy and approval.'}}).action;
 const root=(await repository.loadWorkspace(record.owner))!,target=sharedTripView(root,planId),next=applyAction(target,{...action,actor:identity.id,tripId:planId});
 const item=next.items[next.items.length-1];item.source='Seeded demo catalog · Explicit fictional sandbox quote';
 if(replacement){next.items=next.items.filter(i=>i.id!==replacement.id);item.id=replacement.id;item.revision=replacement.revision+1;}
 item.expires=new Date(Date.now()+24*60*60_000).toISOString();item.approvals=[];item.required=[...item.participants];
 const merged=mergeSharedTrip(root,next,planId);
 await repository.saveWorkspace(record.owner,merged,root.version,{planId,version:record.version,memberId:identity.id});
 return recordResponse(await repository.getPlan(planId,identity));
}catch(error){return apiError(error);}}
