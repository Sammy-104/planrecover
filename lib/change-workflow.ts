import type {State} from './model.ts';
type ChangeTerms={kind:string;option?:string;originals:{id:string;name:string}[];additions:{name:string;price:number|null}[]};
export const replacementId=(changeId:string,index:number)=>`${changeId}-replacement-${index}`;

/** Progress is derived only from saved canonical evidence. It never executes a financial action. */
export async function syncChangeWorkflow(database:D1Database,changeId:string){
 const change=await database.prepare('SELECT owner,plan_id,body,status,created_by FROM plan_changes WHERE id=?').bind(changeId).first<{owner:string;plan_id:string;body:string;status:string;created_by:string}>();
 if(!change)return {status:'unavailable',steps:[]};
 const plan=await database.prepare('SELECT body,version FROM plans WHERE owner=? AND id=?').bind(change.owner,change.plan_id).first<{body:string;version:number}>();
 if(!plan)return {status:'review-required',steps:[]};
 const state=JSON.parse(plan.body) as State,terms=JSON.parse(change.body) as ChangeTerms,steps:{id:string;kind:string;itemId:string;status:string;detail:Record<string,unknown>}[]=[];
 if(terms.kind==='recovery'&&terms.option!=='keep')for(const original of terms.originals){
  const item=state.items.find(i=>i.id===original.id),children=await database.prepare("SELECT id,status FROM recovery_proposals WHERE owner=? AND plan_id=? AND json_extract(body,'$.policy.itemId')=? ORDER BY created").bind(change.owner,change.plan_id,original.id).all<{id:string;status:string}>();
  const refunds=state.events.filter(e=>e.itemId===original.id&&e.kind==='refund');
  steps.push({id:`cancel-${original.id}`,kind:'cancellation',itemId:original.id,status:item?.status==='cancelled'?'completed':children.results.some(c=>c.status==='manual-review')?'review-required':'awaiting-cancellation',detail:{name:original.name,children:children.results,dependsOn:state.items.filter(i=>i.status!=='cancelled'&&i.depends.includes(original.id)).map(i=>i.id),reviewUrl:`/flows?plan=${encodeURIComponent(change.plan_id)}`}});
  steps.push({id:`refund-${original.id}`,kind:'refund',itemId:original.id,status:refunds.some(e=>e.status!=='confirmed')?'awaiting-refund':item?.status==='cancelled'?'completed':'awaiting-cancellation',detail:{refunds:refunds.map(e=>({id:e.id,providerId:e.providerId??null,status:e.status}))}});
 }
 for(const [index,addition]of terms.additions.entries()){
  const id=replacementId(changeId,index),item=state.items.find(i=>i.id===id),bookings=await database.prepare('SELECT booking_id,status,operation_id FROM supplier_bookings WHERE owner=? AND plan_id=? AND item_id=? ORDER BY revision DESC LIMIT 1').bind(change.owner,change.plan_id,id).first<{booking_id:string;status:string;operation_id:string}>();
  const funded=state.events.filter(e=>e.itemId===id&&e.status==='confirmed'&&e.kind!=='settlement').reduce((n,e)=>n+e.amount,0),approved=!!item&&(item.required??item.participants).every(m=>item.approvals.includes(m)),hadPayment=state.events.some(e=>e.itemId===id&&e.kind==='expense'&&e.status==='confirmed'),failed=bookings?.status==='failed'||item?.booking==='failed',compensated=hadPayment&&funded<=0&&(failed||item?.status==='cancelled');
  steps.push({id:`prepare-${index}`,kind:'replacement',itemId:id,status:item?'completed':'awaiting-cancellations',detail:{name:item?.name??addition.name,replaces:terms.originals.map(i=>i.id)}});
  const paymentOperations=await database.prepare("SELECT id,provider_id,status FROM provider_operations WHERE owner=? AND item_id=? AND kind='order' AND json_extract(payload,'$.planrecoverTripId')=? ORDER BY id").bind(change.owner,id,change.plan_id).all();
  steps.push({id:`pay-${index}`,kind:'payment',itemId:id,status:compensated?'completed':!item?'blocked':!approved?'awaiting-approval':item.price===null?'review-required':funded>=item.price?'completed':'awaiting-buyer-payment',detail:{required:item?.price??null,confirmed:funded,requiredApprovers:item?.required??item?.participants??[],approved:item?.approvals??[],paymentOperations:paymentOperations.results,expenseIds:state.events.filter(e=>e.itemId===id&&e.kind==='expense').map(e=>({id:e.id,providerId:e.providerId??null})),pendingRefundsAvailable:false,compensated,reviewUrl:`/?plan=${encodeURIComponent(change.plan_id)}&view=money`}});
  const free=item?.price===0;
  steps.push({id:`book-${index}`,kind:'booking',itemId:id,status:compensated?'completed':failed?'review-required':free||bookings?.status==='confirmed'?'completed':item&&funded>=(item.price??Infinity)?'awaiting-booking':'blocked',detail:{bookingId:bookings?.booking_id??null,operationId:bookings?.operation_id??null,compensated}});
  if(failed&&hadPayment)steps.push({id:`compensate-${index}`,kind:'compensation-review',itemId:id,status:compensated?'completed':'review-required',detail:{reason:compensated?'The failed replacement payment has been refunded. No booking was confirmed.':'Payment confirmed but replacement booking failed. Review refund terms and explicitly approve any refund.',reviewUrl:`/flows?plan=${encodeURIComponent(change.plan_id)}`,automaticRefund:false}});
 }
 const stamp=new Date().toISOString();
 for(const step of steps)await database.prepare(`INSERT INTO plan_change_steps(change_id,step_id,kind,item_id,status,detail,updated)
 SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM plans WHERE owner=? AND id=? AND version=?) ON CONFLICT(change_id,step_id) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated=excluded.updated`).bind(changeId,step.id,step.kind,step.itemId,step.status,JSON.stringify(step.detail),stamp,change.owner,change.plan_id,plan.version).run();
 const status=change.status==='cancelled'?'cancelled':steps.some(s=>s.status==='review-required')?'review-required':change.status==='review'?steps.some(s=>s.status==='awaiting-cancellation')?'awaiting-cancellations':'awaiting-application':steps.every(s=>s.status==='completed')?steps.some(s=>s.detail.compensated)?'completed-with-refund':'completed':steps.some(s=>s.status==='awaiting-buyer-payment'||s.status==='awaiting-approval')?'awaiting-payments':'awaiting-bookings';
 const workflow={status,steps,financialActionsRequireConfirmation:true};
 await database.prepare(`INSERT INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,response,status,created,updated)
 SELECT ?,?,?,?,'plan-workflow','progress',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM plans WHERE owner=? AND id=? AND version=?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,response=excluded.response,updated=excluded.updated`).bind(`workflow-${changeId}`,change.owner,change.plan_id,change.created_by,JSON.stringify({changeId}),JSON.stringify(workflow),status,stamp,stamp,change.owner,change.plan_id,plan.version).run();
 return workflow;
}
export async function refreshOwnerWorkflows(database:D1Database,owner:string){const rows=await database.prepare("SELECT c.id FROM plan_changes c LEFT JOIN adapter_operations a ON a.id='workflow-'||c.id WHERE c.owner=? AND c.status<>'cancelled' AND COALESCE(a.status,'') NOT IN ('completed','completed-with-refund','cancelled') ORDER BY COALESCE(a.updated,''),c.created,c.id LIMIT 20").bind(owner).all<{id:string}>();for(const row of rows.results)await syncChangeWorkflow(database,row.id);return {checked:rows.results.length};}
