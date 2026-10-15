import {z} from 'zod';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {apiError,db} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
type Context={params:Promise<{planId:string}>};
const eventCursor=z.object({at:z.string().datetime({offset:true}),id:z.string().min(1).max(180)}).strict();
const approvalCursor=z.object({at:z.string().datetime({offset:true}),itemId:z.string().min(1).max(180),revision:z.number().int().min(0).safe()}).strict();
function cursor<T>(raw:string|null,schema:z.ZodType<T>):T|undefined{
 if(!raw)return undefined;
 try{if(raw.length>1000)throw Error();return schema.parse(JSON.parse(decodeURIComponent(atob(raw))));}
 catch{throw new BackendError('INVALID_HISTORY_CURSOR','Use the history cursor returned by the server.');}
}
const encode=(value:unknown)=>btoa(encodeURIComponent(JSON.stringify(value)));
export async function GET(request:Request,context:Context){try{
 const {identity,repository}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,record=await repository.getPlan(planId,identity);
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>!['limit','eventsAfter','approvalsAfter'].includes(key)))throw new BackendError('INVALID_HISTORY_QUERY','Select only a history page size and returned cursors.');
 const rawLimit=query.get('limit')??'100',limit=Number(rawLimit);
 if(!/^\d{1,3}$/.test(rawLimit)||!Number.isInteger(limit)||limit<1||limit>100)throw new BackendError('INVALID_HISTORY_QUERY','Use a history page size from 1 to 100.');
 const afterEvent=cursor(query.get('eventsAfter'),eventCursor),afterApproval=cursor(query.get('approvalsAfter'),approvalCursor);
 const events=await db().prepare(`SELECT id,event_id,status,body,recorded FROM financial_event_history WHERE owner=? AND plan_id=?
  ${afterEvent?'AND (recorded>? OR (recorded=? AND id>?))':''} ORDER BY recorded,id LIMIT ?`)
  .bind(record.owner,planId,...(afterEvent?[afterEvent.at,afterEvent.at,afterEvent.id]:[]),limit+1)
  .all<{id:string;event_id:string;status:string;body:string;recorded:string}>();
 const approvals=await db().prepare(`SELECT item_id,revision,snapshot,created FROM approval_revisions WHERE owner=? AND plan_id=?
  ${afterApproval?'AND (created>? OR (created=? AND item_id>?) OR (created=? AND item_id=? AND revision>?))':''} ORDER BY created,item_id,revision LIMIT ?`)
  .bind(record.owner,planId,...(afterApproval?[afterApproval.at,afterApproval.at,afterApproval.itemId,afterApproval.at,afterApproval.itemId,afterApproval.revision]:[]),limit+1)
  .all<{item_id:string;revision:number;snapshot:string;created:string}>();
 const pageEvents=events.results.slice(0,limit),pageApprovals=approvals.results.slice(0,limit),lastEvent=pageEvents.at(-1),lastApproval=pageApprovals.at(-1);
 return Response.json({planId,events:pageEvents.map(row=>({eventId:row.event_id,status:row.status,event:JSON.parse(row.body),recorded:row.recorded})),
  approvals:pageApprovals.map(row=>({itemId:row.item_id,revision:row.revision,snapshot:JSON.parse(row.snapshot),created:row.created})),
  pagination:{eventsAfter:events.results.length>limit&&lastEvent?encode({at:lastEvent.recorded,id:lastEvent.id}):null,
   approvalsAfter:approvals.results.length>limit&&lastApproval?encode({at:lastApproval.created,itemId:lastApproval.item_id,revision:lastApproval.revision}):null}},
  {headers:privateHeaders});
}catch(error){return apiError(error);}}
