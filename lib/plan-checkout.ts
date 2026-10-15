import type {Identity} from './people.ts';
import type {PlanRecord} from './plan-repository.ts';
import {PlanRepository} from './plan-repository.ts';
import {BackendError,forbidden,conflict} from './backend-errors.ts';
import {approvedCheckoutAmount,requirePaymentActor,verifiedOrderCapture,verifyUncapturedOrder,type PaymentOperation,type ProviderOrder} from './payment-guards.ts';
import {requireMerchantCheckout} from './merchant-scope.ts';
import {claimPaymentFunding,saveProviderRequestIntent,sha256,approvedItemSnapshot} from './financial-history.ts';
type Provider=(path:string,method?:string,body?:unknown,key?:string)=>Promise<any>;
type Dependencies={database:D1Database;provider:Provider;reconcileCapture:(owner:string,operation:PaymentOperation,order:ProviderOrder)=>Promise<unknown>};

export async function createPlanCheckout(record:PlanRecord,identity:Identity,input:{itemId:string;revision:number;version:number},dependencies:Dependencies){
 if(!['owner','editor'].includes(record.role))throw forbidden();
 if(record.version!==input.version)throw conflict();
 const item=record.state.items.find(item=>item.id===input.itemId);
 if(!item)throw new BackendError('ITEM_NOT_FOUND','This payment item is unavailable.',404);
 requireMerchantCheckout(item);requirePaymentActor(record.state,identity.id,identity.id);
 const amount=approvedCheckoutAmount(record.state,item,identity.id,input.revision),planId=record.state.plan.id!;
 if(record.state.events.some(event=>event.itemId===item.id&&event.kind==='expense'&&event.status==='confirmed'&&(event.shares[identity.id]??0)>0))
  throw new BackendError('PAYMENT_ALREADY_RECORDED','Your payment is already recorded for this purchase.',409);
 const id=(await sha256(`${record.owner}-${planId}-${item.id}-${identity.id}-${item.revision}`)).slice(0,38);
 await claimPaymentFunding(dependencies.database,{owner:record.owner,planId,itemId:item.id,revision:item.revision,memberId:identity.id,channel:'order',referenceId:id});
 const prior=await dependencies.database.prepare('SELECT * FROM provider_operations WHERE id=? AND owner=? AND kind=?').bind(id,record.owner,'order').first<PaymentOperation>();
 if(prior?.provider_id)return {orderId:prior.provider_id,operationId:id};
 const key=(await sha256(record.owner+id)).slice(0,38),body={intent:'CAPTURE',purchase_units:[{
  reference_id:item.id,custom_id:id,description:`PlanRecover fictional sandbox merchant: ${item.name}`,
  amount:{currency_code:'CAD',value:(amount/100).toFixed(2)},
 }],payment_source:{paypal:{experience_context:{shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW'}}}};
 await dependencies.database.prepare('INSERT OR IGNORE INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,?,?,?,?, ?,?)')
  .bind(id,record.owner,item.id,identity.id,item.revision,'order',amount,'creating',JSON.stringify({planrecoverTripId:planId,planrecoverCurrency:'CAD',planrecoverApprovalSnapshot:approvedItemSnapshot(item)})).run();
 await saveProviderRequestIntent(dependencies.database,{operationId:id,owner:record.owner,planId,path:'/v2/checkout/orders',body,requestKey:key});
 const fresh=await new PlanRepository(dependencies.database).getPlan(planId,identity);
 if(fresh.version!==record.version||!['owner','editor'].includes(fresh.role)){
  await dependencies.database.prepare("UPDATE provider_operations SET status='unsubmitted' WHERE id=? AND owner=? AND provider_id IS NULL").bind(id,record.owner).run();throw conflict();
 }
 const order=await dependencies.provider('/v2/checkout/orders','POST',body,key);
 if(typeof order.id!=='string'||!/^[A-Z0-9]{1,36}$/.test(order.id))throw new BackendError('PROVIDER_ORDER_INVALID','PayPal returned no valid sandbox order.',502);
 await dependencies.database.prepare('UPDATE provider_operations SET provider_id=?,status=?,payload=? WHERE id=? AND owner=? AND provider_id IS NULL')
  .bind(order.id,'created',JSON.stringify({...order,planrecoverTripId:planId,planrecoverCurrency:'CAD',planrecoverApprovalSnapshot:approvedItemSnapshot(item)}),id,record.owner).run();
 const saved=await dependencies.database.prepare('SELECT provider_id FROM provider_operations WHERE id=? AND owner=?').bind(id,record.owner).first<{provider_id:string}>();
 if(saved?.provider_id!==order.id)throw new BackendError('PROVIDER_ORDER_CONFLICT','The saved order needs reconciliation.',409);
 return {orderId:order.id,operationId:id};
}
export async function capturePlanCheckout(record:PlanRecord,identity:Identity,orderId:string,dependencies:Dependencies){
 if(!['owner','editor'].includes(record.role))throw forbidden();
 if(!/^[A-Z0-9]{1,36}$/.test(orderId))throw new BackendError('INVALID_ORDER','Choose a saved sandbox checkout.');
 const op=await dependencies.database.prepare("SELECT * FROM provider_operations WHERE provider_id=? AND owner=? AND member=? AND kind='order'")
  .bind(orderId,record.owner,identity.id).first<PaymentOperation>();
 if(!op||JSON.parse(op.payload??'{}').planrecoverTripId!==record.state.plan.id)throw new BackendError('ORDER_NOT_FOUND','This checkout is unavailable for your share.',404);
 const item=record.state.items.find(item=>item.id===op.item_id);
 if(!item)throw new BackendError('ITEM_NOT_FOUND','This approved payment item is unavailable.',404);
 requireMerchantCheckout(item);requirePaymentActor(record.state,identity.id,identity.id);
 // Canonical GET first repairs a lost capture response without charging again.
 let order=await dependencies.provider(`/v2/checkout/orders/${encodeURIComponent(orderId)}`) as ProviderOrder;
 if(order.status!=='COMPLETED'){
  if(op.status==='manual-review')throw new BackendError('ORDER_REVIEW_REQUIRED','This recovered checkout needs merchant review before payment.',409);
  verifyUncapturedOrder(op,order);
  if(record.state.events.some(event=>event.itemId===item.id&&event.kind==='expense'&&event.status==='confirmed'&&(event.shares[identity.id]??0)>0))throw new BackendError('PAYMENT_ALREADY_RECORDED','Your payment is already recorded for this purchase.',409);
  if(approvedCheckoutAmount(record.state,item,identity.id,op.revision)!==op.amount)throw conflict();
  const snapshot=JSON.parse(op.payload??'{}').planrecoverApprovalSnapshot;
  if(snapshot&&snapshot!==approvedItemSnapshot(item))throw new BackendError('APPROVAL_CHANGED','Review the current payment terms.',409);
  const fresh=await new PlanRepository(dependencies.database).getPlan(record.state.plan.id!,identity);
  if(fresh.version!==record.version||!['owner','editor'].includes(fresh.role))throw conflict();
  const path=`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,key=(await sha256(`capture-${record.owner}-${op.id}`)).slice(0,38);
  await saveProviderRequestIntent(dependencies.database,{operationId:`capture-${op.id}`,owner:record.owner,planId:record.state.plan.id!,path,body:{},requestKey:key});
  order=await dependencies.provider(path,'POST',{},key);
 }
 const capture=verifiedOrderCapture(op,order);
 await dependencies.reconcileCapture(record.owner,op,order);
 return {captureId:capture.id};
}
