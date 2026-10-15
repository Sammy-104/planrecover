import { BackendError } from './backend-errors.ts';
import type { PaymentOperation } from './payment-guards.ts';
import { processPayPalWebhook, processStoredPayPalWebhook, reconcilePayPalOperation, type PayPalReconciliationDependencies } from './paypal-webhooks.ts';

type RecoveryDependencies = PayPalReconciliationDependencies & {
  now?: () => Date; leaseMs?: number; cooldownMs?: number; budgetMs?: number;
  unfinishedOnly?:boolean;
};
type RecoveryInput = { operationId?: string; retryWebhooks?: boolean };
type RecoveryResult = { operationId: string; status: string };

export function parseReconciliationInput(input: unknown): RecoveryInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BackendError('INVALID_REQUEST', 'Enter a valid reconciliation request.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['operationId', 'retryWebhooks'].includes(key)) ||
      (body.operationId !== undefined && (typeof body.operationId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(body.operationId))) ||
      (body.retryWebhooks !== undefined && typeof body.retryWebhooks !== 'boolean'))
    throw new BackendError('INVALID_REQUEST', 'Select a saved operation and whether to retry its verified events.');
  return { operationId: body.operationId as string | undefined, retryWebhooks: body.retryWebhooks as boolean | undefined };
}

/** Owner authorization is enforced at the route. This bounded worker uses only
 * operations saved under that owner and never invokes a provider money mutation. */
export async function reconcileOwnerPayments(owner: string, input: RecoveryInput, dependencies: RecoveryDependencies) {
  const { database } = dependencies, now = dependencies.now ?? (() => new Date()), started = now().getTime();
  const staleBefore = new Date(started - (dependencies.leaseMs ?? 5 * 60 * 1000)).toISOString();
  const cooldownBefore = new Date(started - (dependencies.cooldownMs ?? 15_000)).toISOString();
  const rows = await database.prepare(`SELECT p.* FROM provider_operations p
    LEFT JOIN provider_reconciliation_attempts r ON r.operation_id = p.id
    WHERE p.owner = ? AND p.kind IN ('order','refund') ${input.operationId ? 'AND p.id = ?' : ''} ${dependencies.unfinishedOnly?"AND p.status NOT IN ('captured','refunded','confirmed','manual-review')":''}
    ORDER BY COALESCE(r.last_attempt,'') ASC, p.id ASC LIMIT 5`)
    .bind(owner, ...(input.operationId ? [input.operationId] : [])).all<PaymentOperation>();
  if (input.operationId && !rows.results.length)
    throw new BackendError('OPERATION_NOT_FOUND', 'This saved payment operation is unavailable.', 404);
  const operations: RecoveryResult[] = [], webhooks: { eventId: string; status: string }[] = [];
  let inboxLimitReached = false;
  const inBudget = () => now().getTime() - started < (dependencies.budgetMs ?? 25_000);
  for (const operation of rows.results) {
    if (!inBudget()) break;
    await database.prepare(`INSERT OR IGNORE INTO provider_reconciliation_attempts
      (operation_id,owner,status,attempts) VALUES (?,?,'ready',0)`)
      .bind(operation.id, owner).run();
    const attemptedAt = now().toISOString();
    const claim = await database.prepare(`UPDATE provider_reconciliation_attempts SET status = 'processing',
      attempts = attempts + 1, processing_started = ?, last_attempt = ?, last_error = NULL
      WHERE operation_id = ? AND owner = ? AND
      ((status != 'processing' AND (last_attempt IS NULL OR last_attempt <= ?)) OR
      (status = 'processing' AND (processing_started IS NULL OR processing_started <= ?))) RETURNING attempts`)
      .bind(attemptedAt, attemptedAt, operation.id, owner, cooldownBefore, staleBefore).first<{ attempts: number }>();
    if (!claim) { operations.push({ operationId: operation.id, status: 'already-processing-or-recent' }); continue; }
    try {
      const result = await reconcilePayPalOperation(operation, dependencies);
      const updated = await database.prepare(`UPDATE provider_reconciliation_attempts SET status = ?,
        processing_started = NULL, completed = ?, last_error = NULL
        WHERE operation_id = ? AND owner = ? AND status = 'processing' AND attempts = ?`)
        .bind(result.status, now().toISOString(), operation.id, owner, claim.attempts).run();
      operations.push({ operationId: operation.id, status: updated.meta.changes ? result.status : 'lease-changed' });
    } catch {
      // Provider responses and workspace contents are never exposed in recovery
      // errors. The saved operation remains retryable and retains its evidence.
      await database.prepare(`UPDATE provider_reconciliation_attempts SET status = 'failed',
        processing_started = NULL, completed = NULL, last_error = ?
        WHERE operation_id = ? AND owner = ? AND status = 'processing' AND attempts = ?`)
        .bind('Canonical reconciliation could not be completed. Retry or request merchant review.', operation.id, owner, claim.attempts).run();
      operations.push({ operationId: operation.id, status: 'failed' });
    }
  }
  if (input.retryWebhooks !== false && inBudget()) {
    // Each event must resolve to an operation owned by this account. Verification
    // already happened before durable insertion; raw caller events are rejected.
    const inbox = await database.prepare(`SELECT DISTINCT w.id FROM webhook_events w
      JOIN provider_operations p ON
        (json_extract(w.body,'$.event_type') = 'PAYMENT.CAPTURE.COMPLETED' AND p.kind = 'order' AND
         p.provider_id = json_extract(w.body,'$.resource.supplementary_data.related_ids.order_id')) OR
        (json_extract(w.body,'$.event_type') = 'PAYMENT.CAPTURE.REFUNDED' AND p.kind = 'refund' AND
         p.provider_id = json_extract(w.body,'$.resource.id'))
      WHERE p.owner = ? ${input.operationId ? 'AND p.id = ?' : ''} AND
        (w.status IN ('received','failed') OR (w.status = 'processing' AND
        (w.processing_started IS NULL OR w.processing_started <= ?)))
      ORDER BY w.attempts ASC, w.received ASC LIMIT 5`)
      .bind(owner, ...(input.operationId ? [input.operationId] : []), staleBefore).all<{ id: string }>();
    inboxLimitReached = inbox.results.length === 5;
    for (const event of inbox.results) {
      if (!inBudget()) break;
      try {
        await processStoredPayPalWebhook(event.id, { database, now, leaseMs: dependencies.leaseMs,
          process: payload => processPayPalWebhook(payload, dependencies) });
        webhooks.push({ eventId: event.id, status: 'processed' });
      } catch { webhooks.push({ eventId: event.id, status: 'failed' }); }
    }
  }
  return { operations, webhooks, readOnlyProvider: true, moreMayRemain: rows.results.length === 5 || inboxLimitReached || !inBudget() };
}
