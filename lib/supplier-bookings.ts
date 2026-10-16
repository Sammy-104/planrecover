import {PlanRepository} from './plan-repository.ts';
import {sharedTripView,mergeSharedTrip} from './trip-sharing.ts';
import {BackendError,conflict} from './backend-errors.ts';
import {planCurrency} from './money.ts';
import type {Identity} from './people.ts';
import {syncChangeWorkflow} from './change-workflow.ts';
export type SupplierBooking={sandbox:true;requestId:string;bookingId:string;quoteId:string;status:'confirmed'|'pending'|'cancelled'|'failed';amount:number;currency:string};
export async function projectSupplierBooking(database:D1Database,planId:string,identity:Identity,itemId:string,revision:number,operationId:string,response:SupplierBooking){
 const repository=new PlanRepository(database),record=await repository.getPlan(planId,identity),item=record.state.items.find(i=>i.id===itemId);
 if(record.role!=='owner'||!item||item.revision!==revision||response.amount!==item.price||response.currency!==planCurrency(record.state.plan))throw conflict();
 const prior=await database.prepare('SELECT booking_id,status FROM supplier_bookings WHERE owner=? AND plan_id=? AND item_id=? AND revision=?').bind(record.owner,planId,itemId,revision).first<{booking_id:string;status:string}>();
 if(prior&&(prior.booking_id!==response.bookingId||prior.status==='cancelled'&&response.status!=='cancelled'||prior.status==='confirmed'&&response.status==='pending'))throw new BackendError('SUPPLIER_STATE','The supplier status needs review.',409);
 if(prior?.status===response.status&&item.booking===response.status&&item.bookingReference===response.bookingId)return response;
 const root=await repository.loadWorkspace(record.owner);if(!root)throw conflict();const state=sharedTripView(root,planId),target=state.items.find(i=>i.id===itemId)!;
 target.booking=response.status;target.bookingReference=response.bookingId;
 // Supplier cancellation is independent of approved financial cancellation and refund completion.
 if(response.status==='cancelled'||response.status==='failed')state.disruption=true;
 const now=new Date().toISOString(),effects=[database.prepare(`INSERT INTO supplier_bookings(owner,plan_id,item_id,revision,operation_id,booking_id,quote_id,status,amount,currency,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(owner,plan_id,item_id,revision) DO UPDATE SET status=excluded.status,updated=excluded.updated`).bind(record.owner,planId,itemId,revision,operationId,response.bookingId,response.quoteId,response.status,response.amount,response.currency,now)];
 if(response.status==='cancelled'||response.status==='failed')effects.push(database.prepare('INSERT OR IGNORE INTO supplier_disruptions(id,owner,plan_id,item_id,booking_id,status,created) VALUES (?,?,?,?,?,?,?)').bind(`${operationId}-${response.status}`,record.owner,planId,itemId,response.bookingId,response.status,now));
 await repository.saveWorkspace(record.owner,mergeSharedTrip(root,state,planId),root.version,{planId,version:record.version,memberId:identity.id},undefined,effects);
 const parents=await database.prepare('SELECT DISTINCT change_id FROM plan_change_steps WHERE item_id=?').bind(itemId).all<{change_id:string}>();for(const parent of parents.results)await syncChangeWorkflow(database,parent.change_id);
 return response;
}
