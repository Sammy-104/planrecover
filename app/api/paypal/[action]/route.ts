import { requireMerchantCheckout } from '@/lib/merchant-scope';
import { financialTrip } from '@/lib/model';
import { workspaceAccess, publicState, checkOrigin, loadState, loadAccess, requireEdit, saveState, db, apiError } from '@/lib/store';
import { paypal, reconcileCapture, providerTripId } from '@/lib/paypal';
import { approvedCheckoutAmount, approvedFullRefund, requirePaymentActor, requirePayPalCurrency, requireCaptureEventMatch, providerCents,verifyUncapturedOrder, type PaymentOperation, type ProviderOrder } from '@/lib/payment-guards';
import { BackendError } from '@/lib/backend-errors';
import { parseReconciliationInput, reconcileOwnerPayments } from '@/lib/paypal-reconciliation';
import {PlanRepository} from '@/lib/plan-repository';
import {createPlanCheckout,capturePlanCheckout} from '@/lib/plan-checkout';
import {claimPaymentFunding,saveProviderRequestIntent,approvedItemSnapshot,commitFinancialEffect} from '@/lib/financial-history';
import {reserveCaptureRefund,confirmCaptureRefund} from '@/lib/recovery-service';
import {freezeMerchantFunding} from '@/lib/merchant-funding';

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    checkOrigin(request);
    const access = await workspaceAccess(request), id = access.id, { action } = await params;
    if (access.share&&!['create','capture'].includes(action)) throw new BackendError('FORBIDDEN', 'This PayPal action requires the owner workspace.', 403);
    if (!access.user) throw new BackendError('AUTHENTICATION_REQUIRED', 'Sign in to access your saved workspace.', 401);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new BackendError('REQUEST_TOO_LARGE', 'This payment request is too large.', 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new BackendError('INVALID_JSON', 'Enter a valid payment request.'); }
    if (action === 'reconcile') {
      const result = await reconcileOwnerPayments(id, parseReconciliationInput(input), {
        database: db(), fetchOrder: orderId => paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}`),
        fetchRefund: refundId => paypal(`/v2/payments/refunds/${encodeURIComponent(refundId)}`),
        reconcileCapture, loadState, saveState,
      });
      return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Enter a valid payment request.');
    const body = input as Record<string, unknown>;
    const state = await loadState(id), personId = access.user!.id;
    const active=access.share?await loadAccess(access):state;
    if((access.share||active.people)&&['create','capture'].includes(action)){
      requireEdit(access,active);
      if(body.actor!==undefined&&body.actor!==personId)throw new BackendError('PAYMENT_ACTOR','Only your own share can use this checkout.',403);
      if(body.tripId&&body.tripId!==active.plan.id)throw new BackendError('PLAN_CHANGED','Open the current shared plan before checkout.',409);
      const record=await new PlanRepository(db()).getPlan(active.plan.id!,access.user!);
      const dependencies={database:db(),provider:paypal,reconcileCapture};
      if(action==='create'){
        if(typeof body.itemId!=='string'||!Number.isSafeInteger(body.revision))throw new BackendError('INVALID_CHECKOUT','Choose the current approved share.');
        return Response.json(await createPlanCheckout(record,access.user!,{itemId:body.itemId,revision:body.revision as number,version:record.version},dependencies),{headers:{'Cache-Control':'private, no-store'}});
      }
      if(typeof body.orderId!=='string')throw new BackendError('INVALID_ORDER','Choose your saved checkout.');
      const captured=await capturePlanCheckout(record,access.user!,body.orderId,dependencies);
      return Response.json({...captured,state:publicState(await loadAccess(access),access)},{headers:{'Cache-Control':'private, no-store'}});
    }

    if (action === 'create') {
      const { actor, revision, itemId, tripId } = body;
      if (typeof actor !== 'string' || typeof itemId !== 'string' || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
        throw Error('Select the current item revision and payer.');
      if (tripId && tripId !== state.plan.id) throw Error('The active trip changed. Refresh before checkout.');
      const item = state.items.find(i => i.id === itemId);
      requirePaymentActor(state, actor, personId);
      if (item) requireMerchantCheckout(item);
      const amount = approvedCheckoutAmount(state, item, actor, revision);
      const groupFunding=freezeMerchantFunding(item!),fundingMetadata=groupFunding?{planrecoverFunding:groupFunding}:{};
      const stable = (await hash(`${id}-${state.plan.id}-${item!.id}-${actor}-${item!.revision}`)).slice(0, 38);
      await claimPaymentFunding(db(),{owner:id,planId:state.plan.id!,itemId:item!.id,revision:item!.revision,memberId:actor,channel:'order',referenceId:stable});
      const prior = await db().prepare('SELECT * FROM provider_operations WHERE id = ? AND owner = ? AND kind = ?')
        .bind(stable, id, 'order').first<PaymentOperation>();
      if (prior?.provider_id) return Response.json({ orderId: prior.provider_id });
      await db().prepare('INSERT OR IGNORE INTO provider_operations (id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(stable, id, item!.id, actor, item!.revision, 'order', amount, 'creating', JSON.stringify({ planrecoverTripId: state.plan.id, planrecoverCurrency: 'CAD',planrecoverApprovalSnapshot:approvedItemSnapshot(item!),...fundingMetadata })).run();
      const orderBody={
        intent: 'CAPTURE', purchase_units: [{ reference_id: item!.id, custom_id: stable, description: `PlanRecover demo merchant: ${item!.name} / ${actor}`, amount: { currency_code: 'CAD', value: (amount / 100).toFixed(2) } }],
        payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
      };
      const requestKey=(await hash(id+stable)).slice(0,38);
      await saveProviderRequestIntent(db(),{operationId:stable,owner:id,planId:state.plan.id!,path:'/v2/checkout/orders',body:orderBody,requestKey});
      const order = await paypal('/v2/checkout/orders','POST',orderBody,requestKey);
      if (typeof order.id !== 'string' || !order.id) throw Error('PayPal returned no order ID.');
      await db().prepare('UPDATE provider_operations SET provider_id = ?, status = ?, payload = ? WHERE id = ? AND owner = ?')
        .bind(order.id, 'created', JSON.stringify({ ...order, planrecoverTripId: state.plan.id, planrecoverCurrency: 'CAD',planrecoverApprovalSnapshot:approvedItemSnapshot(item!),...fundingMetadata }), stable, id).run();
      return Response.json({ orderId: order.id });
    }

    if (action === 'capture') {
      const orderId = body.orderId;
      if (typeof orderId !== 'string' || !/^[A-Z0-9]{1,36}$/.test(orderId)) throw Error('Select a valid PayPal order.');
      const op = await db().prepare('SELECT * FROM provider_operations WHERE provider_id = ? AND owner = ? AND kind = ?')
        .bind(orderId, id, 'order').first<PaymentOperation>();
      if (!op) throw Error('This checkout does not belong to your workspace.');
      const trip = financialTrip(state, op.item_id, providerTripId(op));
      if (!trip) throw Error('The approved item no longer exists. This order cannot be captured.');
      requirePayPalCurrency(trip.plan);
      requirePaymentActor(trip, op.member, personId);
      const item = trip.items.find(i => i.id === op.item_id);
      if (item) requireMerchantCheckout(item);
      if (op.status !== 'captured') {
        const amount = approvedCheckoutAmount(trip, item, op.member, op.revision);
        if (amount !== op.amount) throw Error('The approved share changed. This order cannot be captured.');
      }
      let data:ProviderOrder=await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      if(data.status!=='COMPLETED'){
        verifyUncapturedOrder(op,data);
        const latest=await loadState(id),latestTrip=financialTrip(latest,op.item_id,providerTripId(op)),latestItem=latestTrip?.items.find(value=>value.id===op.item_id);
        if(!latestTrip||!latestItem||!item||approvedItemSnapshot(latestItem)!==approvedItemSnapshot(item))throw new BackendError('APPROVAL_CHANGED','Review the current share before capture.',409);
        requirePaymentActor(latestTrip,op.member,personId);
        if(approvedCheckoutAmount(latestTrip,latestItem,op.member,op.revision)!==op.amount)throw new BackendError('APPROVAL_CHANGED','Review the current share before capture.',409);
        const path=`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,key=(await hash(`capture-${id}-${op.id}`)).slice(0,38);
        await saveProviderRequestIntent(db(),{operationId:`capture-${op.id}`,owner:id,planId:trip.plan.id!,path,body:{},requestKey:key});
        data=await paypal(path,'POST',{},key);
      }
      const capture = await reconcileCapture(id, op, data);
      return Response.json({ captureId: capture.id, state: publicState(await loadState(id), access) });
    }

    if (action === 'refund') {
      const trip = [state, ...(state.archives ?? []).map(a => a.workspace)].find(t => t.events.some(e => e.id === body.eventId));
      const event = trip?.events.find(e => e.id === body.eventId);
      if (!trip || !event) throw Error('Select a real sandbox capture. Fixture payments cannot be refunded through PayPal.');
      const approval = approvedFullRefund(trip, event);
      const operations = await db().prepare('SELECT * FROM provider_operations WHERE owner = ? AND kind = ? AND item_id = ? AND member = ?')
        .bind(id, 'order', event.itemId, approval.member).all<PaymentOperation>();
      const original = operations.results.find(op => {
        try {
          if (op.revision !== trip.items.find(item => item.id === event.itemId)?.revision) return false;
          requireCaptureEventMatch(op, event, JSON.parse(op.payload ?? '{}'), trip.plan.id); return true;
        }
        catch { return false; }
      });
      if (!original) throw Error('This refund must match the original server-verified checkout.');
      if (trip.events.some(e => e.kind === 'refund' && e.mode === 'sandbox' && e.evidence.includes(`for capture ${event.providerId}.`)))
        return Response.json({ state: publicState(state, access) });
      const key = (await hash(`refund-${id}-${event.providerId}`)).slice(0, 38);
      const metadata = { planrecoverTripId: trip.plan.id, planrecoverCaptureId: event.providerId, planrecoverProposalId: approval.proposalId, planrecoverRevision: approval.revision };
      const reservationInput={reservationId:key,owner:id,planId:trip.plan.id!,itemId:event.itemId,memberId:approval.member,captureId:event.providerId!,currency:'CAD',captured:event.amount,amount:approval.amount};
      const reservedMetadata={...metadata,planrecoverCapacityReserved:true};
      const before=await db().prepare('SELECT payload FROM provider_operations WHERE id=? AND owner=?').bind(key,id).first<{payload:string|null}>();
      if(!before||!JSON.parse(before.payload??'{}').planrecoverCapacityReserved){
        const guard=crypto.randomUUID();
        await db().batch([
          db().prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN NOT EXISTS(SELECT 1 FROM provider_operations WHERE id=? AND json_extract(payload,'$.planrecoverCapacityReserved')=1) THEN 1 ELSE 0 END)`).bind(guard,key),
          ...await reserveCaptureRefund(db(),reservationInput),
          db().prepare('INSERT OR IGNORE INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,?,?,?,?,?,?)').bind(key,id,event.itemId,approval.member,approval.revision,'refund',approval.amount,'refunding',JSON.stringify(reservedMetadata)),
          db().prepare("UPDATE provider_operations SET payload=json_set(payload,'$.planrecoverCapacityReserved',json('true')) WHERE id=? AND owner=?").bind(key,id),
          db().prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
        ]);
      }
      const refundOp = await db().prepare('SELECT * FROM provider_operations WHERE id = ? AND owner = ? AND kind = ?').bind(key, id, 'refund').first<PaymentOperation>();
      if (!refundOp || refundOp.amount !== approval.amount) throw Error('The saved refund amount needs merchant review.');
      const saved = JSON.parse(refundOp.payload ?? '{}');
      if (saved.planrecoverTripId !== trip.plan.id || saved.planrecoverCaptureId !== event.providerId ||
          saved.planrecoverProposalId !== approval.proposalId || saved.planrecoverRevision !== approval.revision)
        throw Error('The saved refund authorization changed. Merchant review required.');
      const refundPath=`/v2/payments/captures/${encodeURIComponent(event.providerId!)}/refund`;
      const refundBody={amount:{currency_code:'CAD',value:(approval.amount/100).toFixed(2)},note_to_payer:'Approved PlanRecover sandbox cancellation'};
      await saveProviderRequestIntent(db(),{operationId:key,owner:id,planId:trip.plan.id!,path:refundPath,body:refundBody,requestKey:key});
      const refund = saved.refund ?? await paypal(refundPath,'POST',refundBody,key);
      if (typeof refund.id !== 'string' || !['COMPLETED', 'PENDING'].includes(refund.status) || providerCents(refund.amount) !== approval.amount)
        throw Error('PayPal refund is not confirmed for the approved amount. Merchant review required.');
      // Save the provider response before the workspace revision check so a
      // retry after a conflicting edit can reconstruct the same ledger entry.
      await db().prepare("UPDATE provider_operations SET provider_id=?,status=CASE WHEN status='refunded' THEN status ELSE 'refund-pending' END,payload=CASE WHEN status='refunded' THEN payload ELSE ? END WHERE id=? AND owner=?")
        .bind(refund.id,JSON.stringify({...reservedMetadata,refund}),key,id).run();
      const effect={
        id: `paypal-refund-${refund.id}`, itemId: event.itemId, kind: 'refund', label: 'Sandbox capture refund',
        shares: Object.fromEntries(Object.entries(event.shares).map(([member, amount]) => [member, -amount])),
        contributions: Object.fromEntries(Object.entries(event.contributions).map(([member, amount]) => [member, -amount])),
        amount: -approval.amount, status: refund.status === 'COMPLETED' ? 'confirmed' : 'pending',
        evidence: `PayPal sandbox refund ${refund.id} for capture ${event.providerId}. Approved recovery ${approval.proposalId}. Bank availability unverified.`,
        mode: 'sandbox', providerId: refund.id, created: new Date().toISOString(),
      } as const;
      const committed=await commitFinancialEffect(db(),{owner:id,planId:trip.plan.id!,event:effect,
        statements:refund.status==='COMPLETED'?await confirmCaptureRefund(db(),{reservationId:key,captureId:event.providerId!,amount:approval.amount}):[],
        operation:{id:key,status:refund.status==='COMPLETED'?'refunded':'refund-pending',providerId:refund.id,payload:JSON.stringify({...reservedMetadata,refund})}});
      return Response.json({ state: publicState(committed.state, access) });
    }
    throw Error('Unsupported PayPal operation.');
  } catch (error) { return apiError(error); }
}

async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
