import { financialTrip, type State } from './model.ts';
import {commitFinancialEffect} from './financial-history.ts';
import {confirmCaptureRefund,reconcileRecoveryRefund} from './recovery-service.ts';
import { providerCents, verifiedOrderCapture, dataTripId, requirePayPalCurrency, requireCaptureLedgerMatch, type PaymentOperation, type ProviderOrder } from './payment-guards.ts';

export type PayPalWebhookEvent = { id: string; event_type: string; resource: Record<string, unknown>; [key: string]: unknown };
export class WebhookDeliveryError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type InboxRow = { id: string; body: string; status: string; attempts: number; processing_started: string | null };
export type WebhookInboxDependencies = {
  database: D1Database;
  verify: (headers: Headers, event: PayPalWebhookEvent, rawBody: string) => Promise<boolean>;
  process: (event: PayPalWebhookEvent) => Promise<void>;
  now?: () => Date;
  leaseMs?: number;
};

function eventFromJson(rawBody: string): PayPalWebhookEvent {
  let value: unknown;
  try { value = JSON.parse(rawBody); } catch { throw new WebhookDeliveryError(400, 'Enter a valid PayPal webhook event.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WebhookDeliveryError(400, 'Enter a valid PayPal webhook event.');
  const event = value as Record<string, unknown>;
  if (typeof event.id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(event.id) ||
      typeof event.event_type !== 'string' || !/^[A-Z0-9_.-]{1,128}$/.test(event.event_type) ||
      !event.resource || typeof event.resource !== 'object' || Array.isArray(event.resource))
    throw new WebhookDeliveryError(400, 'PayPal webhook event identifiers and resource are required.');
  return event as PayPalWebhookEvent;
}

/** Keep the signed event text intact inside an escaped verification envelope. */
export function webhookVerificationPayload(headers: Headers, webhookId: string, rawBody: string) {
  eventFromJson(rawBody);
  const fields = {
    auth_algo: headers.get('paypal-auth-algo'), cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'), transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'), webhook_id: webhookId,
  };
  if (Object.values(fields).some(value => !value || value.length > 4096))
    throw new WebhookDeliveryError(400, 'PayPal webhook verification headers are required.');
  let certificate: URL;
  try { certificate = new URL(fields.cert_url!); } catch { throw new WebhookDeliveryError(400, 'PayPal sandbox certificate URL is invalid.'); }
  if (certificate.protocol !== 'https:' || certificate.port || certificate.username || certificate.password ||
      !['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'].includes(certificate.hostname) ||
      !/^\/v1\/notifications\/certs\/[A-Za-z0-9-]+$/.test(certificate.pathname) || certificate.search || certificate.hash)
    throw new WebhookDeliveryError(400, 'PayPal sandbox certificate URL is invalid.');
  return JSON.stringify(fields).slice(0, -1) + ',"webhook_event":' + rawBody + '}';
}

/** Verification precedes durable receipt; acknowledgement follows processing.
 * A fenced lease prevents concurrent deliveries from silently dropping work. */
export async function receivePayPalWebhook(request: Request, dependencies: WebhookInboxDependencies) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1024 * 1024)
    throw new WebhookDeliveryError(413, 'PayPal webhook event is too large.');
  const event = eventFromJson(rawBody);
  if (!await dependencies.verify(request.headers, event, rawBody))
    throw new WebhookDeliveryError(400, 'Webhook signature verification failed.');
  const database = dependencies.database, now = dependencies.now ?? (() => new Date());
  const received = now().toISOString();
  await database.prepare('INSERT OR IGNORE INTO webhook_events (id,body,received,status,attempts) VALUES (?,?,?,?,0)')
    .bind(event.id, rawBody, received, 'received').run();
  const existing = await database.prepare('SELECT id,body,status,attempts,processing_started FROM webhook_events WHERE id = ?')
    .bind(event.id).first<InboxRow>();
  if (!existing) throw new WebhookDeliveryError(503, 'PayPal event could not be saved.');
  // Formatting may vary across deliveries; a signed ID may never change content.
  if (JSON.stringify(eventFromJson(existing.body)) !== JSON.stringify(event))
    throw new WebhookDeliveryError(409, 'A different PayPal event already uses this identifier.');
  return processStoredPayPalWebhook(event.id, dependencies);
}

/** Retry only an event already admitted by signature verification. Callers must
 * authorize its saved operation owner before invoking this internal worker. */
export async function processStoredPayPalWebhook(id: string, dependencies: Pick<WebhookInboxDependencies, 'database' | 'process' | 'now' | 'leaseMs'>) {
  const database = dependencies.database, now = dependencies.now ?? (() => new Date());
  const existing = await database.prepare('SELECT id,body,status,attempts,processing_started FROM webhook_events WHERE id = ?')
    .bind(id).first<InboxRow>();
  if (!existing) throw new WebhookDeliveryError(404, 'The saved PayPal event is unavailable.');
  const event = eventFromJson(existing.body);
  if (existing.status === 'processed') return { received: true, duplicate: true, status: 'processed' };
  const started = now(), staleBefore = new Date(started.getTime() - (dependencies.leaseMs ?? 5 * 60 * 1000)).toISOString();
  const claimed = await database.prepare(`UPDATE webhook_events SET status = 'processing', attempts = attempts + 1,
    processing_started = ?, last_error = NULL WHERE id = ? AND (status IN ('received','failed') OR
    (status = 'processing' AND (processing_started IS NULL OR processing_started <= ?))) RETURNING attempts`)
    .bind(started.toISOString(), event.id, staleBefore).first<{ attempts: number }>();
  if (!claimed) {
    const latest = await database.prepare('SELECT status FROM webhook_events WHERE id = ?').bind(event.id).first<{ status: string }>();
    if (latest?.status === 'processed') return { received: true, duplicate: true, status: 'processed' };
    throw new WebhookDeliveryError(503, 'PayPal event is saved and already processing. Retry this delivery.');
  }
  try {
    await dependencies.process(event);
    const result = await database.prepare(`UPDATE webhook_events SET status = 'processed', processed = ?,
      processing_started = NULL, last_error = NULL WHERE id = ? AND status = 'processing' AND attempts = ?`)
      .bind(now().toISOString(), event.id, claimed.attempts).run();
    if (!result.meta.changes) throw Error('The PayPal event processing lease changed.');
    return { received: true, duplicate: existing.attempts > 0, status: 'processed' };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'PayPal event reconciliation failed.';
    await database.prepare(`UPDATE webhook_events SET status = 'failed', last_error = ?, processing_started = NULL,
      processed = NULL WHERE id = ? AND status = 'processing' AND attempts = ?`)
      .bind(message, event.id, claimed.attempts).run();
    throw new WebhookDeliveryError(503, 'PayPal event was saved; reconciliation will retry.');
  }
}

export type ProviderRefund = {
  id?: string; status?: string; amount?: { currency_code?: string; value?: string };
  supplementary_data?: { related_ids?: { capture_id?: string } };
  links?: { rel?: string; href?: string }[];
};
export type PayPalReconciliationDependencies = {
  fetchInvoice?:(id:string)=>Promise<unknown>;
  database: D1Database;
  fetchOrder: (id: string) => Promise<ProviderOrder>;
  fetchRefund: (id: string) => Promise<ProviderRefund>;
  reconcileCapture: (owner: string, operation: PaymentOperation, order: ProviderOrder) => Promise<unknown>;
  loadState: (owner: string) => Promise<State>;
  saveState: (owner: string, state: State, expected: number) => Promise<State>;
};

function resourceString(resource: Record<string, unknown>, key: string) {
  const value = resource[key];
  if (typeof value !== 'string' || !value) throw Error(`PayPal event ${key} is missing.`);
  return value;
}

export function relatedCaptureId(refund: ProviderRefund) {
  const id = refund.supplementary_data?.related_ids?.capture_id;
  if (id) return id;
  const up = refund.links?.find(link => link.rel === 'up')?.href;
  if (!up) return undefined;
  try { return /^\/v2\/payments\/captures\/([A-Z0-9]+)$/.exec(new URL(up).pathname)?.[1]; }
  catch { return undefined; }
}

async function operationFor(database: D1Database, providerId: string, kind: 'order' | 'refund') {
  const rows = await database.prepare('SELECT * FROM provider_operations WHERE provider_id = ? AND kind = ? LIMIT 2')
    .bind(providerId, kind).all<PaymentOperation>();
  if (rows.results.length !== 1) throw Error('PayPal event has no unique matching saved operation yet.');
  return rows.results[0];
}

/** Financial history outlives the Recently deleted restoration window. The
 * normalized deleted plan remains a private accounting tombstone, never a
 * restored workspace or a new member-accessible plan. */
async function retainedFinancialPlan(database: D1Database, operation: PaymentOperation) {
  const tripId = dataTripId(operation);
  if (!tripId) throw Error('The payment operation is missing its plan metadata.');
  const row = await database.prepare("SELECT body,version FROM plans WHERE owner = ? AND id = ? AND status = 'deleted'")
    .bind(operation.owner, tripId).first<{ body: string; version: number }>();
  if (!row) throw Error('The retained financial plan needs merchant review.');
  const state = JSON.parse(row.body) as State;
  if (state.plan.id !== tripId || !state.items.some(item => item.id === operation.item_id))
    throw Error('The retained payment item does not match this operation.');
  requirePayPalCurrency(state.plan);
  return {
    state,
    save: async () => {
      const result = await database.prepare("UPDATE plans SET body = ?, version = version + 1, updated = ? WHERE owner = ? AND id = ? AND status = 'deleted' AND version = ?")
        .bind(JSON.stringify(state), new Date().toISOString(), operation.owner, tripId, row.version).run();
      if (!result.meta.changes) throw Error('The retained financial plan changed. Retry reconciliation.');
    },
  };
}

async function reconcileRetainedCapture(database: D1Database, operation: PaymentOperation, order: ProviderOrder) {
  const capture = verifiedOrderCapture(operation, order), retained = await retainedFinancialPlan(database, operation);
  const existing = retained.state.events.filter(entry => entry.providerId === capture.id);
  if (existing.length > 1) throw Error('The existing capture ledger needs merchant review.');
  if (existing[0]) requireCaptureLedgerMatch(operation, existing[0]);
  if (!existing.length) {
    const item = retained.state.items.find(item => item.id === operation.item_id)!;
    const event={
      id: `paypal-${capture.id}`, itemId: item.id, kind: 'expense', label: `${item.name} · sandbox payment`,
      shares: { [operation.member]: operation.amount }, contributions: { [operation.member]: operation.amount }, amount: operation.amount,
      status: 'confirmed', evidence: `Server-verified sandbox capture ${capture.id}. Retained deleted plan; booking confirmation is separate.`,
      mode: 'sandbox', created: new Date().toISOString(), providerId: capture.id,
    } as const;
    await commitFinancialEffect(database,{owner:operation.owner,planId:dataTripId(operation)!,event,
      operation:{id:operation.id,status:'captured',payload:JSON.stringify({...order,planrecoverTripId:dataTripId(operation),planrecoverCurrency:'CAD'})}});
  }else{
    await commitFinancialEffect(database,{owner:operation.owner,planId:dataTripId(operation)!,event:existing[0],
      operation:{id:operation.id,status:'captured',payload:JSON.stringify({...order,planrecoverTripId:dataTripId(operation),planrecoverCurrency:'CAD'})}});
  }
}

/** Canonical provider reads can repair the interval between the provider
 * operation save and the workspace save, without issuing another refund. */
export async function reconcileRefund(operation: PaymentOperation, refund: ProviderRefund, dependencies: PayPalReconciliationDependencies) {
  const saved = JSON.parse(operation.payload ?? '{}') as Record<string, unknown>;
  if(saved.planrecoverRecoveryReservationId)return reconcileRecoveryRefund(dependencies.database,operation,refund);
  const tripId = dataTripId(operation), captureId = saved.planrecoverCaptureId;
  if (operation.kind !== 'refund' || !tripId || typeof captureId !== 'string' || !/^[A-Z0-9]{1,36}$/.test(captureId) ||
      typeof saved.planrecoverProposalId !== 'string' || !saved.planrecoverProposalId ||
      !Number.isSafeInteger(saved.planrecoverRevision) || saved.planrecoverRevision !== operation.revision ||
      !operation.provider_id || refund.id !== operation.provider_id || !['COMPLETED', 'PENDING'].includes(refund.status ?? '') ||
      relatedCaptureId(refund) !== captureId || providerCents(refund.amount) !== operation.amount)
    throw Error('PayPal refund does not match the saved approved capture and amount.');
  if (operation.status === 'refunded' && refund.status !== 'COMPLETED')
    throw Error('PayPal refund status changed unexpectedly. Merchant review required.');
  const state = await dependencies.loadState(operation.owner);
  let trip = financialTrip(state, operation.item_id, tripId);
  const retained = trip ? undefined : await retainedFinancialPlan(dependencies.database, operation);
  trip ??= retained!.state;
  requirePayPalCurrency(trip.plan);
  const expense = trip.events.find(entry => entry.providerId === captureId && entry.itemId === operation.item_id && entry.kind === 'expense' && entry.mode === 'sandbox' && entry.status === 'confirmed');
  if (!expense || expense.amount !== operation.amount || Object.keys(expense.shares).length !== 1 ||
      Object.keys(expense.contributions).length !== 1 || expense.shares[operation.member] !== operation.amount ||
      expense.contributions[operation.member] !== operation.amount)
    throw Error('The refund ledger does not match the saved capture yet.');
  const recordedRefunds = trip.events.filter(entry => entry.providerId === refund.id);
  if (recordedRefunds.length > 1) throw Error('The refund ledger does not match the saved capture yet.');
  let ledgerRefund = recordedRefunds[0];
  if (ledgerRefund && (ledgerRefund.itemId !== operation.item_id || ledgerRefund.kind !== 'refund' || ledgerRefund.mode !== 'sandbox' ||
      ledgerRefund.amount !== -operation.amount || Object.keys(ledgerRefund.shares).length !== 1 ||
      Object.keys(ledgerRefund.contributions).length !== 1 || ledgerRefund.shares[operation.member] !== -operation.amount ||
      ledgerRefund.contributions[operation.member] !== -operation.amount || !ledgerRefund.evidence.includes(`for capture ${captureId}.`)))
    throw Error('The refund ledger does not match the saved capture yet.');
  if (ledgerRefund?.status === 'confirmed' && refund.status !== 'COMPLETED')
    throw Error('PayPal refund status changed unexpectedly. Merchant review required.');
  const status = refund.status === 'COMPLETED' ? 'confirmed' : 'pending';
  let changed = false;
  if (!ledgerRefund) {
    // A persisted approved operation is the authority here. Current itinerary
    // edits cannot erase money already refunded by the provider.
    ledgerRefund = {
      id: `paypal-refund-${refund.id}`, itemId: operation.item_id, kind: 'refund', label: 'Sandbox capture refund',
      shares: { [operation.member]: -operation.amount }, contributions: { [operation.member]: -operation.amount },
      amount: -operation.amount, status,
      evidence: `PayPal sandbox refund ${refund.id} for capture ${captureId}. Approved recovery ${saved.planrecoverProposalId}. Bank availability unverified.`,
      mode: 'sandbox', providerId: refund.id, created: new Date().toISOString(),
    };
    trip.events.push(ledgerRefund); changed = true;
  } else if (ledgerRefund.status !== status) { ledgerRefund.status = status; changed = true; }
  const operationStatus=refund.status === 'COMPLETED' ? 'refunded' : 'refund-pending';
  // A webhook can confirm the refund after this worker reads a pending ledger.
  // Never let an older PENDING response replace terminal provider evidence.
  const statements:D1PreparedStatement[]=[dependencies.database.prepare(`UPDATE provider_operations SET status=?,payload=?
    WHERE id=? AND owner=? AND kind='refund' AND (status<>'refunded' OR ?='refunded')`)
    .bind(operationStatus,JSON.stringify({...saved,refund}),operation.id,operation.owner,operationStatus)];
  if(saved.planrecoverCapacityReserved&&refund.status==='COMPLETED')statements.push(...await confirmCaptureRefund(dependencies.database,{reservationId:operation.id,captureId,amount:operation.amount}));
  await commitFinancialEffect(dependencies.database,{owner:operation.owner,planId:tripId,event:ledgerRefund,statements});
  return { status: operationStatus };
}

/** Recovery uses only saved IDs and canonical GET results. The caller cannot
 * supply an arbitrary order, refund, amount, or financial event. */
export async function reconcilePayPalOperation(operation: PaymentOperation, dependencies: PayPalReconciliationDependencies) {
  if (!operation.provider_id || !/^[A-Z0-9]{1,36}$/.test(operation.provider_id))
    throw Error('This operation has no saved provider reference. Merchant review required.');
  if (operation.kind === 'order') {
    const order = await dependencies.fetchOrder(operation.provider_id);
    if (order.id !== operation.provider_id) throw Error('PayPal order does not match this checkout.');
    if (order.status !== 'COMPLETED') {
      if (!['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED', 'VOIDED'].includes(order.status ?? '') || operation.status === 'captured')
        throw Error('PayPal order status needs merchant review.');
      return { status: 'waiting' };
    }
    verifiedOrderCapture(operation, order);
    const workspace = await dependencies.loadState(operation.owner);
    if (financialTrip(workspace, operation.item_id, dataTripId(operation)))
      await dependencies.reconcileCapture(operation.owner, operation, order);
    else await reconcileRetainedCapture(dependencies.database, operation, order);
    return { status: 'captured' };
  }
  if (operation.kind === 'refund') return reconcileRefund(operation, await dependencies.fetchRefund(operation.provider_id), dependencies);
  throw Error('Only saved checkout and refund operations can be reconciled.');
}

export async function processPayPalWebhook(event: PayPalWebhookEvent, dependencies: PayPalReconciliationDependencies) {
  if(event.event_type.startsWith('INVOICING.INVOICE.')){
    const id=typeof event.resource.id==='string'?event.resource.id:(event.resource.invoice as {id?:string}|undefined)?.id;
    if(!id||!/^INV2-[A-Z0-9-]{1,40}$/.test(id)||!dependencies.fetchInvoice)throw Error('The saved invoice notification needs canonical reconciliation.');
    const {reconcileInvoiceNotification}=await import('./plan-invoices.ts');await reconcileInvoiceNotification(dependencies.database,id,dependencies.fetchInvoice);return;
  }
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const related = event.resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
    const orderId = related?.related_ids?.order_id;
    if (typeof orderId !== 'string' || !/^[A-Z0-9]{1,36}$/.test(orderId)) throw Error('PayPal capture event is missing its order.');
    const operation = await operationFor(dependencies.database, orderId, 'order');
    const order = await dependencies.fetchOrder(orderId);
    const capture = verifiedOrderCapture(operation, order);
    if (capture.id !== resourceString(event.resource, 'id') || event.resource.status !== 'COMPLETED' ||
        providerCents(event.resource.amount as ProviderRefund['amount']) !== operation.amount)
      throw Error('PayPal capture event does not match the canonical order capture.');
    const workspace = await dependencies.loadState(operation.owner);
    if (financialTrip(workspace, operation.item_id, dataTripId(operation)))
      await dependencies.reconcileCapture(operation.owner, operation, order);
    else await reconcileRetainedCapture(dependencies.database, operation, order);
    return;
  }
  if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    const refundId = resourceString(event.resource, 'id');
    const operation = await operationFor(dependencies.database, refundId, 'refund');
    const saved = JSON.parse(operation.payload ?? '{}') as Record<string, unknown>;
    const tripId = dataTripId(operation), captureId = saved.planrecoverCaptureId;
    if (!tripId || typeof captureId !== 'string' || !captureId || typeof saved.planrecoverProposalId !== 'string')
      throw Error('The saved refund is missing its capture and approval metadata.');
    const refund = await dependencies.fetchRefund(refundId);
    const eventCaptureId = relatedCaptureId(event.resource as ProviderRefund);
    if (refund.id !== refundId || refund.status !== 'COMPLETED' || relatedCaptureId(refund) !== captureId ||
        (eventCaptureId && eventCaptureId !== captureId) || providerCents(refund.amount) !== operation.amount ||
        providerCents(event.resource.amount as ProviderRefund['amount']) !== operation.amount)
      throw Error('PayPal refund does not match the saved approved capture and amount.');
    await reconcileRefund(operation, refund, dependencies);
  }
  // Other verified event types are durably recorded and intentionally ignored.
}
