import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestD1, applyMigrations } from './helpers/d1.mjs';
import { initialState } from '../lib/model.ts';
import { PlanRepository } from '../lib/plan-repository.ts';
import { receivePayPalWebhook, processPayPalWebhook, webhookVerificationPayload } from '../lib/paypal-webhooks.ts';

let checks = 0;
async function test(name, callback) { await callback(); checks++; console.log(`PASS ${name}`); }
const event = (id = 'EVENTA', type = 'OTHER.EVENT') => ({ id, event_type: type, resource: { id: 'RESOURCEA' } });
const captureEvent = (id = 'CAPTUREEVENTA') => ({ id, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTUREA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' }, supplementary_data: { related_ids: { order_id: 'ORDERA' } } } });
const refundEvent = (id = 'REFUNDEVENTA') => ({ id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REFUNDA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' }, supplementary_data: { related_ids: { capture_id: 'CAPTUREA' } } } });
const canonicalOrder = () => ({ id: 'ORDERA', status: 'COMPLETED', purchase_units: [{ reference_id: 'hike', custom_id: 'operation-order', payments: { captures: [{ id: 'CAPTUREA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' } }] } }] });
const canonicalRefund = () => ({ id: 'REFUNDA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTUREA' }] });
const headers = () => new Headers({ 'Content-Type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-FIXTURE', 'paypal-transmission-id': 'TRANSMISSION-FIXTURE', 'paypal-transmission-sig': 'SIGNATURE-FIXTURE', 'paypal-transmission-time': '2026-10-12T19:00:00Z' });
const request = (value, raw = JSON.stringify(value)) => new Request('https://planrecover.test/api/webhooks/paypal', { method: 'POST', headers: headers(), body: raw });
const inbox = (database, process = async () => {}) => ({ database, verify: async () => true, process });
const row = (database, id) => database.prepare('SELECT * FROM webhook_events WHERE id=?').bind(id).first();
const retryable = error => error?.status === 503;

await test('Inbox migration preserves existing event body and adds safe lifecycle defaults', async () => {
  const database = createTestD1({ migrations: { through: '0005_dusty_thor.sql' } });
  try {
    const raw = JSON.stringify(event('LEGACYEVENT'), null, 2);
    await database.prepare('INSERT INTO webhook_events(id,body,received) VALUES (?,?,?)').bind('LEGACYEVENT', raw, '2026-10-11T19:00:00Z').run();
    applyMigrations(database);
    const saved = await row(database, 'LEGACYEVENT');
    assert.equal(saved.body, raw); assert.equal(saved.status, 'received'); assert.equal(saved.attempts, 0);
    assert.equal(saved.processing_started, null); assert.equal(saved.last_error, null); assert.equal(saved.processed, null);
    assert.ok(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_provider_operations_provider_kind'").get());
  } finally { database.close(); }
});

await test('Only verified events enter the durable inbox', async () => {
  const database = createTestD1();
  try {
    await assert.rejects(receivePayPalWebhook(request(event('UNVERIFIED')), { ...inbox(database), verify: async () => false }), error => error.status === 400);
    assert.equal(await row(database, 'UNVERIFIED'), null);
    await assert.rejects(receivePayPalWebhook(request({}, '{broken'), inbox(database)), error => error.status === 400);
  } finally { database.close(); }
});

await test('Durable failures are retried; processed duplicates do not rerun the handler', async () => {
  const database = createTestD1(); let attempts = 0;
  const deps = inbox(database, async payload => {
    assert.equal((await row(database, payload.id)).status, 'processing');
    attempts++;
    if (attempts === 1) throw Error('A conflicting workspace save needs a retry.');
  });
  try {
    const payload = event('RETRY');
    await assert.rejects(receivePayPalWebhook(request(payload), deps), retryable);
    let saved = await row(database, payload.id);
    assert.equal(saved.status, 'failed'); assert.equal(saved.attempts, 1); assert.match(saved.last_error, /conflicting workspace/);
    assert.equal((await receivePayPalWebhook(request(payload), deps)).status, 'processed');
    const duplicate = await receivePayPalWebhook(request(payload), deps);
    saved = await row(database, payload.id);
    assert.equal(duplicate.duplicate, true); assert.equal(attempts, 2); assert.equal(saved.attempts, 2);
    assert.equal(saved.status, 'processed'); assert.equal(saved.last_error, null); assert.ok(saved.processed);
  } finally { database.close(); }
});

await test('Concurrent delivery keeps the current lease retryable until its owner completes', async () => {
  const database = createTestD1(); let release, entered;
  const waiting = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  const deps = inbox(database, async () => { entered(); await waiting; });
  try {
    const first = receivePayPalWebhook(request(event('CONCURRENT')), deps);
    await started;
    await assert.rejects(receivePayPalWebhook(request(event('CONCURRENT')), deps), retryable);
    assert.equal((await row(database, 'CONCURRENT')).attempts, 1);
    release(); await first;
    assert.equal((await receivePayPalWebhook(request(event('CONCURRENT')), deps)).duplicate, true);
  } finally { database.close(); }
});

await test('Expired claims can recover and old workers cannot overwrite the newer result', async () => {
  const database = createTestD1(); let release, entered;
  const waiting = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  try {
    const first = receivePayPalWebhook(request(event('CRASHED')), { ...inbox(database, async () => { entered(); await waiting; }), now: () => new Date('2026-10-12T19:00:00Z') });
    // Attach a rejection observer before deliberately taking the lease away.
    const fenced = assert.rejects(first, retryable);
    await started;
    await receivePayPalWebhook(request(event('CRASHED')), { ...inbox(database), now: () => new Date('2026-10-12T19:06:00Z') });
    release(); await fenced;
    const saved = await row(database, 'CRASHED');
    assert.equal(saved.attempts, 2); assert.equal(saved.status, 'processed'); assert.equal(saved.last_error, null);
  } finally { database.close(); }
});

await test('A reused signed event ID cannot replace an existing event payload', async () => {
  const database = createTestD1();
  try {
    const payload = event('CONFLICT'); await receivePayPalWebhook(request(payload), inbox(database));
    await assert.rejects(receivePayPalWebhook(request({ ...payload, resource: { id: 'ANOTHER' } }), inbox(database)), error => error.status === 409);
    assert.equal(JSON.parse((await row(database, payload.id)).body).resource.id, 'RESOURCEA');
  } finally { database.close(); }
});

await test('Verification envelopes preserve signed whitespace and reject non-sandbox certificates', async () => {
  const raw = JSON.stringify(event('RAW'), null, 4) + '\n';
  const envelope = webhookVerificationPayload(headers(), 'WEBHOOK-FIXTURE', raw);
  assert.ok(envelope.endsWith(',"webhook_event":' + raw + '}'));
  assert.deepEqual(JSON.parse(envelope).webhook_event, event('RAW'));
  for (const certificate of ['https://attacker.test/cert', 'http://api-m.sandbox.paypal.com/v1/notifications/certs/CERT', 'https://api-m.sandbox.paypal.com@attacker.test/v1/notifications/certs/CERT']) {
    const changed = headers(); changed.set('paypal-cert-url', certificate);
    assert.throws(() => webhookVerificationPayload(changed, 'WEBHOOK-FIXTURE', raw), /certificate URL/);
  }
  const documented = headers(); documented.set('paypal-cert-url', 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d');
  assert.ok(webhookVerificationPayload(documented, 'WEBHOOK-FIXTURE', raw).includes(raw));
});

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite')), { build } = require(viteRequire.resolve('esbuild'));
const buildRoot = resolve(root, 'build'); mkdirSync(buildRoot, { recursive: true });
const bundleDirectory = mkdtempSync(join(buildRoot, 'backend-webhooks-'));
const originalFetch = globalThis.fetch;
globalThis.paypalWebhookTestEnv = { DB: undefined, PAYPAL_CLIENT_ID: 'fixture-client-id', PAYPAL_CLIENT_SECRET: 'fixture-secret', PAYPAL_WEBHOOK_ID: 'fixture-webhook' };
try {
  for (const [name, entry] of [['paypal', 'lib/paypal.ts'], ['route', 'app/api/webhooks/paypal/route.ts']]) {
    await build({ entryPoints: [resolve(root, entry)], outfile: join(bundleDirectory, `${name}.mjs`), bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', tsconfig: resolve(root, 'tsconfig.json'), logLevel: 'silent', plugins: [{ name: 'fixture-cloudflare-binding', setup(builder) {
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'test-workers' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-workers' }, () => ({ contents: 'export const env = globalThis.paypalWebhookTestEnv;', loader: 'js' }));
    } }] });
  }
  const adapter = await import(pathToFileURL(join(bundleDirectory, 'paypal.mjs')).href);
  const route = await import(pathToFileURL(join(bundleDirectory, 'route.mjs')).href);
  let expectedRaw;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://api-m.sandbox.paypal.com/'), 'A fixture must never call an external host.');
    const path = new URL(url).pathname;
    if (path === '/v1/oauth2/token') return Response.json({ access_token: 'fixture-access-token' });
    if (path === '/v1/notifications/verify-webhook-signature') {
      assert.ok(options.body.endsWith(',"webhook_event":' + expectedRaw + '}'), 'Actual transport preserves the signed event formatting.');
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (path === '/v2/checkout/orders/ORDERA') return Response.json(canonicalOrder());
    if (path === '/v2/payments/refunds/REFUNDA') return Response.json(canonicalRefund());
    throw Error(`Unexpected fixture provider request: ${path}`);
  };
  async function seedWorkspace(database, state = initialState()) {
    state.plan.id = 'trip-a'; state.events = [];
    const hike = state.items.find(item => item.id === 'hike'); hike.paid = []; hike.status = 'awaiting-payment';
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)').bind('owner-a', JSON.stringify(state), state.version, '2026-10-12T19:00:00Z').run();
    const repository = new PlanRepository(database); await repository.importWorkspace('owner-a', state); return repository;
  }
  async function seedOrder(database, owner = 'owner-a', kind = 'order') {
    await database.prepare('INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(`operation-${kind}`, owner, 'hike', 'sam', 1, kind, 9000, 'ORDERA', 'created', JSON.stringify({ planrecoverTripId: 'trip-a' })).run();
  }
  function reconcileDependencies(database, repository, overrides = {}) {
    return { database, fetchOrder: async () => canonicalOrder(), fetchRefund: async () => canonicalRefund(), reconcileCapture: adapter.reconcileCapture,
      loadState: owner => repository.loadWorkspace(owner), saveState: (owner, state, expected) => repository.saveWorkspace(owner, state, expected), ...overrides };
  }

  await test('Actual webhook route preserves raw postback and records captured cash exactly once', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedOrder(database);
      expectedRaw = JSON.stringify(captureEvent(), null, 2) + '\n';
      assert.equal((await route.POST(request(captureEvent(), expectedRaw))).status, 200);
      assert.equal((await route.POST(request(captureEvent(), expectedRaw))).status, 200);
      expectedRaw = JSON.stringify(captureEvent('CAPTUREEVENTB'));
      assert.equal((await route.POST(request(captureEvent('CAPTUREEVENTB'), expectedRaw))).status, 200);
      const saved = await repository.loadWorkspace('owner-a');
      assert.equal(saved.events.filter(entry => entry.providerId === 'CAPTUREA').length, 1);
      assert.deepEqual(saved.items.find(item => item.id === 'hike').paid, ['sam']);
      assert.equal((await row(database, 'CAPTUREEVENTA')).attempts, 1);
    } finally { database.close(); }
  });

  await test('Canonical capture reconciliation preserves money after an item revision changes', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const state = initialState(); state.items.find(item => item.id === 'hike').revision = 2;
      const repository = await seedWorkspace(database, state); await seedOrder(database);
      await processPayPalWebhook(captureEvent(), reconcileDependencies(database, repository));
      const saved = await repository.loadWorkspace('owner-a');
      assert.equal(saved.events.find(entry => entry.providerId === 'CAPTUREA').amount, 9000);
      assert.deepEqual(saved.items.find(item => item.id === 'hike').paid, []);
    } finally { database.close(); }
  });

  await test('Out-of-order capture remains failed until its matching order becomes available', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database);
      const deps = inbox(database, payload => processPayPalWebhook(payload, reconcileDependencies(database, repository)));
      await seedOrder(database, 'unrelated-owner', 'invoice');
      await assert.rejects(receivePayPalWebhook(request(captureEvent()), deps), retryable);
      assert.equal((await row(database, 'CAPTUREEVENTA')).status, 'failed');
      await seedOrder(database);
      await receivePayPalWebhook(request(captureEvent()), deps);
      assert.equal((await row(database, 'CAPTUREEVENTA')).attempts, 2);
      assert.equal((await repository.loadWorkspace('owner-a')).events.length, 1);
    } finally { database.close(); }
  });

  await test('Capture amount mismatches remain durable and retryable without adding an expense', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedOrder(database);
      const payload = captureEvent(); payload.resource.amount.value = '91.00';
      await assert.rejects(receivePayPalWebhook(request(payload), inbox(database, value => processPayPalWebhook(value, reconcileDependencies(database, repository)))), retryable);
      assert.equal((await row(database, payload.id)).status, 'failed');
      assert.equal((await repository.loadWorkspace('owner-a')).events.length, 0);
    } finally { database.close(); }
  });

  async function seedRefund(database, repository, deleted = false, expiresAt = '2026-11-12T19:00:00Z') {
    const state = await repository.loadWorkspace('owner-a');
    state.events = [
      { id: 'expense-a', itemId: 'hike', kind: 'expense', mode: 'sandbox', amount: 9000, shares: { sam: 9000 }, contributions: { sam: 9000 }, providerId: 'CAPTUREA', status: 'confirmed' },
      { id: 'refund-a', itemId: 'hike', kind: 'refund', mode: 'sandbox', amount: -9000, shares: { sam: -9000 }, contributions: { sam: -9000 }, providerId: 'REFUNDA', status: 'pending', evidence: 'PayPal sandbox refund REFUNDA for capture CAPTUREA. Approved recovery proposal-a.' },
    ];
    if (deleted) {
      const snapshot = structuredClone(state); delete snapshot.archives; delete snapshot.deletedTrips;
      state.plan.id = 'another-trip'; state.events = []; state.deletedTrips = [{ id: 'trip-a', deletedAt: '2026-10-12T19:00:00Z', expiresAt, workspace: snapshot }];
    }
    await repository.saveWorkspace('owner-a', state, state.version);
    await database.prepare('INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind('operation-refund', 'owner-a', 'hike', 'sam', 1, 'refund', 9000, 'REFUNDA', 'refund-pending', JSON.stringify({ planrecoverTripId: 'trip-a', planrecoverCaptureId: 'CAPTUREA', planrecoverProposalId: 'proposal-a', planrecoverRevision: 1 })).run();
  }

  await test('Refund processing uses indexed operation owner and reconciles a deleted plan', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedRefund(database, repository, true);
      const deps = inbox(database, payload => processPayPalWebhook(payload, reconcileDependencies(database, repository)));
      await receivePayPalWebhook(request(refundEvent()), deps);
      await receivePayPalWebhook(request(refundEvent('REFUNDEVENTB')), deps);
      const saved = await repository.loadWorkspace('owner-a');
      assert.equal(saved.events.length, 0);
      assert.equal(saved.deletedTrips[0].workspace.events.find(entry => entry.providerId === 'REFUNDA').status, 'confirmed');
      assert.equal(saved.deletedTrips[0].workspace.events.length, 2);
      assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind('operation-refund').first()).status, 'refunded');
    } finally { database.close(); }
  });

  await test('Refund save conflicts retry without losing the pending ledger record', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedRefund(database, repository);
      let failures = true;const originalBatch=database.batch.bind(database);
      database.batch=statements=>failures&&statements.some(statement=>statement.sql.startsWith('UPDATE provider_operations SET status'))
        ?originalBatch([...statements,database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES ('webhook-refund-fault',0)")]):originalBatch(statements);
      const processor = reconcileDependencies(database, repository);
      const deps = inbox(database, payload => processPayPalWebhook(payload, processor));
      await assert.rejects(receivePayPalWebhook(request(refundEvent()), deps), retryable);
      assert.equal((await repository.loadWorkspace('owner-a')).events[1].status, 'pending');
      assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind('operation-refund').first()).status,'refund-pending');
      assert.equal((await row(database,'REFUNDEVENTA')).status,'failed');
      failures=false;
      await receivePayPalWebhook(request(refundEvent()), deps);
      assert.equal((await repository.loadWorkspace('owner-a')).events[1].status, 'confirmed');
      assert.equal((await row(database, 'REFUNDEVENTA')).attempts, 2);
    } finally { database.close(); }
  });

  await test('Late refunds reconcile retained accounting after the restoration window expires', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedRefund(database, repository, true, '2026-01-01T00:00:00Z');
      expectedRaw = JSON.stringify(refundEvent('EXPIREDREFUND'));
      assert.equal((await route.POST(request(refundEvent('EXPIREDREFUND'), expectedRaw))).status, 200);
      const workspace = await repository.loadWorkspace('owner-a');
      assert.equal(workspace.deletedTrips.length, 0); assert.equal(workspace.events.length, 0);
      const retained = await database.prepare('SELECT body,status FROM plans WHERE owner=? AND id=?').bind('owner-a', 'trip-a').first();
      assert.equal(retained.status, 'deleted');
      assert.equal(JSON.parse(retained.body).events.find(entry => entry.providerId === 'REFUNDA').status, 'confirmed');
    } finally { database.close(); }
  });

  await test('Late captures preserve retained cash without restoring an expired deleted plan', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedOrder(database);
      const state = await repository.loadWorkspace('owner-a'), snapshot = structuredClone(state);
      delete snapshot.archives; delete snapshot.deletedTrips;
      state.plan.id = 'another-trip'; state.deletedTrips = [{ id: 'trip-a', deletedAt: '2025-12-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z', workspace: snapshot }];
      await repository.saveWorkspace('owner-a', state, state.version);
      expectedRaw = JSON.stringify(captureEvent('EXPIREDCAPTURE'));
      assert.equal((await route.POST(request(captureEvent('EXPIREDCAPTURE'), expectedRaw))).status, 200);
      expectedRaw = JSON.stringify(captureEvent('EXPIREDCAPTUREB'));
      assert.equal((await route.POST(request(captureEvent('EXPIREDCAPTUREB'), expectedRaw))).status, 200);
      const workspace = await repository.loadWorkspace('owner-a');
      assert.equal(workspace.deletedTrips.length, 0); assert.equal(workspace.events.length, 0);
      const retained = await database.prepare('SELECT body,status FROM plans WHERE owner=? AND id=?').bind('owner-a', 'trip-a').first();
      assert.equal(retained.status, 'deleted'); assert.equal(JSON.parse(retained.body).events.length, 1);
      assert.equal(JSON.parse(retained.body).events[0].amount, 9000);
    } finally { database.close(); }
  });

  await test('Refund capture mismatch remains failed and leaves cash accounting unchanged', async () => {
    const database = createTestD1(); globalThis.paypalWebhookTestEnv.DB = database;
    try {
      const repository = await seedWorkspace(database); await seedRefund(database, repository);
      const processor = reconcileDependencies(database, repository, { fetchRefund: async () => ({ ...canonicalRefund(), links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/OTHER' }] }) });
      await assert.rejects(receivePayPalWebhook(request(refundEvent()), inbox(database, payload => processPayPalWebhook(payload, processor))), retryable);
      assert.equal((await repository.loadWorkspace('owner-a')).events[1].status, 'pending');
      assert.match((await row(database, 'REFUNDEVENTA')).last_error, /saved approved capture/);
    } finally { database.close(); }
  });

  await test('Raw transport is forbidden for ordinary payment endpoints', async () => {
    await assert.rejects(adapter.paypal('/v2/checkout/orders', 'POST', {}, undefined, '{}'), /restricted to webhook verification/);
  });
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.paypalWebhookTestEnv;
  if (!bundleDirectory.startsWith(buildRoot + '\\') && !bundleDirectory.startsWith(buildRoot + '/')) throw Error('Unsafe temporary bundle path.');
  rmSync(bundleDirectory, { recursive: true, force: true });
}

console.log(`${checks} durable webhook checks passed.`);
