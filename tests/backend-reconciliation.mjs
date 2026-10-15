import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestD1 } from './helpers/d1.mjs';
import { initialState } from '../lib/model.ts';
import { PlanRepository } from '../lib/plan-repository.ts';
import { receivePayPalWebhook, processPayPalWebhook } from '../lib/paypal-webhooks.ts';

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite')), { build } = require(viteRequire.resolve('esbuild'));
const buildRoot = resolve(root, 'build'); mkdirSync(buildRoot, { recursive: true });
const bundleDirectory = mkdtempSync(join(buildRoot, 'backend-reconciliation-'));
const originalFetch = globalThis.fetch;
globalThis.paypalRecoveryTestEnv = { DB: undefined, PAYPAL_CLIENT_ID: 'fixture-client', PAYPAL_CLIENT_SECRET: 'fixture-secret' };
let checks = 0, providerCalls = [], orderResponse, refundResponse;
const order = () => ({ id: 'ORDERA', status: 'COMPLETED', purchase_units: [{ reference_id: 'hike', custom_id: 'operation-order',
  payments: { captures: [{ id: 'CAPTUREA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' } }] } }] });
const refund = () => ({ id: 'REFUNDA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' },
  links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTUREA' }] });
const captureEvent = (id = 'EVENTA', orderId = 'ORDERA') => ({ id, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {
  id: 'CAPTUREA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' }, supplementary_data: { related_ids: { order_id: orderId } },
} });
const refundEvent = () => ({ id: 'REFUNDEVENT', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: {
  id: 'REFUNDA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' }, supplementary_data: { related_ids: { capture_id: 'CAPTUREA' } },
} });
try {
  const modules = {};
  for (const [name, entry] of [['adapter', 'lib/paypal.ts'], ['store', 'lib/store.ts'], ['service', 'lib/paypal-reconciliation.ts'], ['route', 'app/api/paypal/[action]/route.ts']]) {
    const outfile = join(bundleDirectory, `${name}.mjs`);
    await build({ entryPoints: [resolve(root, entry)], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24',
      packages: 'external', tsconfig: resolve(root, 'tsconfig.json'), logLevel: 'silent', plugins: [{ name: 'fixture-workers', setup(builder) {
        builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'test-workers' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-workers' }, () => ({ contents: 'export const env = globalThis.paypalRecoveryTestEnv;', loader: 'js' }));
      } }] });
    modules[name] = await import(pathToFileURL(outfile).href);
  }
  const { adapter, service, route } = modules;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(new URL(url).origin, 'https://api-m.sandbox.paypal.com');
    const path = new URL(url).pathname;
    if (path === '/v1/oauth2/token') { assert.equal(options.method, 'POST'); return Response.json({ access_token: 'fixture-token' }); }
    assert.equal(options.method, 'GET', 'Recovery must never capture or refund money.');
    assert.ok(options.signal instanceof AbortSignal, 'Canonical reads have a bounded deadline.');
    providerCalls.push(path);
    if (path === '/v2/checkout/orders/ORDERA') return Response.json(orderResponse);
    if (path === '/v2/payments/refunds/REFUNDA') return Response.json(refundResponse);
    throw Error('Unexpected fixture provider read.');
  };
  async function test(name, callback) {
    const database = createTestD1(); globalThis.paypalRecoveryTestEnv.DB = database;
    providerCalls = []; orderResponse = order(); refundResponse = refund();
    try { await callback(database); checks++; console.log(`PASS ${name}`); }
    finally { database.close(); globalThis.paypalRecoveryTestEnv.DB = undefined; }
  }
  async function seed(database) {
    const state = initialState(); state.plan.id = 'trip-a'; state.events = [];
    state.items.find(item => item.id === 'hike').paid = [];
    state.items.find(item => item.id === 'hike').status = 'awaiting-payment';
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind('owner-a', JSON.stringify(state), state.version, '2026-10-14T12:00:00Z').run();
    const repository = new PlanRepository(database); await repository.importWorkspace('owner-a', state); return repository;
  }
  async function seedOrder(database, overrides = {}) {
    const operation = { id: 'operation-order', owner: 'owner-a', item_id: 'hike', member: 'sam', revision: 1,
      kind: 'order', amount: 9000, provider_id: 'ORDERA', status: 'created', payload: JSON.stringify({ planrecoverTripId: 'trip-a' }), ...overrides };
    await database.prepare('INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(...['id', 'owner', 'item_id', 'member', 'revision', 'kind', 'amount', 'provider_id', 'status', 'payload'].map(key => operation[key])).run();
    return operation;
  }
  async function seedRefund(database, repository, { ledger = false, status = 'refunded' } = {}) {
    const state = await repository.loadWorkspace('owner-a');
    state.events = [{ id: 'expense-a', itemId: 'hike', kind: 'expense', mode: 'sandbox', amount: 9000,
      shares: { sam: 9000 }, contributions: { sam: 9000 }, providerId: 'CAPTUREA', status: 'confirmed', evidence: 'Verified capture.' }];
    if (ledger) state.events.push({ id: 'refund-a', itemId: 'hike', kind: 'refund', mode: 'sandbox', amount: -9000,
      shares: { sam: -9000 }, contributions: { sam: -9000 }, providerId: 'REFUNDA', status: 'pending',
      evidence: 'PayPal sandbox refund REFUNDA for capture CAPTUREA. Approved recovery proposal-a.' });
    await repository.saveWorkspace('owner-a', state, state.version);
    return seedOrder(database, { id: 'operation-refund', kind: 'refund', provider_id: 'REFUNDA', status,
      payload: JSON.stringify({ planrecoverTripId: 'trip-a', planrecoverCaptureId: 'CAPTUREA', planrecoverProposalId: 'proposal-a', planrecoverRevision: 1, refund: refund() }) });
  }
  function dependencies(database, repository, overrides = {}) {
    return { database, fetchOrder: id => adapter.paypal(`/v2/checkout/orders/${id}`), fetchRefund: id => adapter.paypal(`/v2/payments/refunds/${id}`),
      reconcileCapture: adapter.reconcileCapture, loadState: owner => modules.store.loadState(owner),
      saveState: (...args) => repository.saveWorkspace(...args), cooldownMs: 0, now: () => new Date('2026-10-14T12:00:00Z'), ...overrides };
  }
  const attempt = (database, id = 'operation-order') => database.prepare('SELECT * FROM provider_reconciliation_attempts WHERE operation_id=?').bind(id).first();
  function request(body = {}, { account = 'owner-a', origin = 'https://planrecover.test', token, raw } = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: origin });
    if (account) headers.set('oai-authenticated-user-id', account);
    if (token) headers.set('x-trip-share', token);
    return new Request('https://planrecover.test/api/paypal/reconcile', { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
  }
  const context = { params: Promise.resolve({ action: 'reconcile' }) };

  await test('Owner recovery atomically rolls back a capture-save failure and records cash once on retry', async database => {
    const repository = await seed(database); await seedOrder(database);
    const originalBatch = database.batch.bind(database); let crash = true;
    database.batch = statements => {
      if (crash && statements.some(statement => statement.sql.startsWith('UPDATE provider_operations SET status')))
        return originalBatch([...statements,database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES ('capture-gap-fault',0)")]);
      return originalBatch(statements);
    };
    const deps = dependencies(database, repository);
    assert.equal((await service.reconcileOwnerPayments('owner-a', { retryWebhooks: false }, deps)).operations[0].status, 'failed');
    const before = await repository.loadWorkspace('owner-a');
    assert.equal(before.events.length, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM financial_events').first()).count,0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM financial_event_history').first()).count,0);
    assert.equal((await database.prepare('SELECT status FROM provider_operations WHERE id=?').bind('operation-order').first()).status, 'created');
    crash=false;
    assert.equal((await service.reconcileOwnerPayments('owner-a', { retryWebhooks: false }, deps)).operations[0].status, 'captured');
    const after = await repository.loadWorkspace('owner-a'); assert.equal(after.events.length, 1); assert.equal(after.version, before.version+1);
    assert.equal(after.events[0].amount, 9000); assert.equal((await attempt(database)).attempts, 2);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM financial_events').first()).count,1);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM financial_event_history').first()).count,1);
  });

  await test('A provider refund persisted before the ledger is reconstructed exactly once', async database => {
    const repository = await seed(database); await seedRefund(database, repository);
    const deps = dependencies(database, repository);
    for (let i = 0; i < 2; i++) assert.equal((await service.reconcileOwnerPayments('owner-a', {}, deps)).operations[0].status, 'refunded');
    const state = await repository.loadWorkspace('owner-a'); assert.equal(state.events.length, 2);
    const recovered = state.events.find(event => event.providerId === 'REFUNDA');
    assert.equal(recovered.status, 'confirmed'); assert.equal(recovered.amount, -9000);
    assert.deepEqual(recovered.shares, { sam: -9000 }); assert.deepEqual(recovered.contributions, { sam: -9000 });
    assert.ok(providerCalls.every(path => path.startsWith('/v2/payments/refunds/')));
  });

  await test('Pending canonical refunds stay pending and never imply available cash', async database => {
    const repository = await seed(database); await seedRefund(database, repository, { status: 'refund-pending' });
    refundResponse.status = 'PENDING';
    assert.equal((await service.reconcileOwnerPayments('owner-a', {}, dependencies(database, repository))).operations[0].status, 'refund-pending');
    const recovered = (await repository.loadWorkspace('owner-a')).events.find(event => event.providerId === 'REFUNDA');
    assert.equal(recovered.status, 'pending'); assert.match(recovered.evidence, /Bank availability unverified/);
  });

  await test('A stale pending worker cannot overwrite a concurrently confirmed refund', async database => {
    const repository=await seed(database);await seedRefund(database,repository,{status:'refund-pending'});
    refundResponse.status='PENDING';
    const deps=dependencies(database,repository);
    await service.reconcileOwnerPayments('owner-a',{},deps);
    const originalBatch=database.batch.bind(database);let raced=false;
    database.batch=async statements=>{
      if(statements.some(statement=>statement.sql.startsWith('UPDATE provider_operations SET status'))){
        if(!raced){raced=true;
          const state=await repository.loadWorkspace('owner-a');state.events.find(event=>event.providerId==='REFUNDA').status='confirmed';
          await repository.saveWorkspace('owner-a',state,state.version);
          const op=await database.prepare('SELECT payload FROM provider_operations WHERE id=?').bind('operation-refund').first();
          const payload=JSON.parse(op.payload);payload.refund=refund();
          await database.prepare("UPDATE provider_operations SET status='refunded',payload=? WHERE id=?").bind(JSON.stringify(payload),'operation-refund').run();
        }
      }
      return originalBatch(statements);
    };
    const result=await service.reconcileOwnerPayments('owner-a',{},deps);
    assert.equal(raced,true);assert.equal(result.operations[0].status,'failed');
    const op=await database.prepare('SELECT status,payload FROM provider_operations WHERE id=?').bind('operation-refund').first();
    assert.equal(op.status,'refunded');assert.equal(JSON.parse(op.payload).refund.status,'COMPLETED');
    assert.equal((await repository.loadWorkspace('owner-a')).events.find(event=>event.providerId==='REFUNDA').status,'confirmed');
  });

  await test('Ledger conflicts remain retryable and preserve the saved refund response', async database => {
    const repository = await seed(database); await seedRefund(database, repository);
    let fails = true;const originalBatch=database.batch.bind(database);
    database.batch=statements=>fails&&statements.some(statement=>statement.sql.startsWith('UPDATE provider_operations SET status'))
      ?originalBatch([...statements,database.prepare("INSERT INTO backend_write_guards(id,valid) VALUES ('refund-gap-fault',0)")]):originalBatch(statements);
    const deps = dependencies(database, repository);
    assert.equal((await service.reconcileOwnerPayments('owner-a', {}, deps)).operations[0].status, 'failed');
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 1);
    fails=false;
    assert.equal((await service.reconcileOwnerPayments('owner-a', {}, deps)).operations[0].status, 'refunded');
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 2);
  });

  await test('Canonical amount, currency, capture and approval mismatches add no refund', async database => {
    const repository = await seed(database); await seedRefund(database, repository);
    const deps = dependencies(database, repository);
    for (const changed of [
      { ...refund(), amount: { currency_code: 'CAD', value: '91.00' } },
      { ...refund(), amount: { currency_code: 'USD', value: '90.00' } },
      { ...refund(), links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/OTHER' }] },
    ]) {
      refundResponse = changed;
      assert.equal((await service.reconcileOwnerPayments('owner-a', {}, deps)).operations[0].status, 'failed');
    }
    refundResponse = refund();
    await database.prepare('UPDATE provider_operations SET revision=2 WHERE id=?').bind('operation-refund').run();
    assert.equal((await service.reconcileOwnerPayments('owner-a', {}, deps)).operations[0].status, 'failed');
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 1);
  });

  await test('Incomplete approved orders are observed without performing capture', async database => {
    const repository = await seed(database); await seedOrder(database); orderResponse.status = 'APPROVED';
    const result = await service.reconcileOwnerPayments('owner-a', {}, dependencies(database, repository));
    assert.equal(result.operations[0].status, 'waiting'); assert.equal(result.readOnlyProvider, true);
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 0);
    assert.deepEqual(providerCalls, ['/v2/checkout/orders/ORDERA']);
  });

  await test('No provider ID cannot be guessed or recovered by another money mutation', async database => {
    const repository = await seed(database); await seedOrder(database, { provider_id: null, status: 'creating' });
    assert.equal((await service.reconcileOwnerPayments('owner-a', {}, dependencies(database, repository))).operations[0].status, 'failed');
    assert.deepEqual(providerCalls, []); assert.equal((await repository.loadWorkspace('owner-a')).events.length, 0);
  });

  await test('Concurrent workers respect a lease and expired claims can resume', async database => {
    const repository = await seed(database); await seedOrder(database);
    let entered, release;
    const started = new Promise(resolve => entered = resolve), waiting = new Promise(resolve => release = resolve);
    const deps = dependencies(database, repository, { fetchOrder: async () => { entered(); await waiting; return order(); } });
    const first = service.reconcileOwnerPayments('owner-a', { retryWebhooks: false }, deps);
    await started;
    assert.equal((await service.reconcileOwnerPayments('owner-a', { retryWebhooks: false }, deps)).operations[0].status, 'already-processing-or-recent');
    const newer = await service.reconcileOwnerPayments('owner-a', { retryWebhooks: false }, dependencies(database, repository, { now: () => new Date('2026-10-14T12:06:00Z') }));
    assert.equal(newer.operations[0].status, 'captured'); release();
    assert.equal((await first).operations[0].status, 'lease-changed');
    const saved = await attempt(database); assert.equal(saved.attempts, 2); assert.equal(saved.status, 'captured');
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 1);
  });

  await test('Failed and stale verified inbox events retry only for their saved operation owner', async database => {
    const repository = await seed(database); await seedOrder(database);
    await seedOrder(database, { id: 'foreign-operation', owner: 'owner-b', provider_id: 'OTHERORDER' });
    const fail = async () => { throw Error('A prior interruption.'); };
    for (const payload of [captureEvent(), captureEvent('FOREIGNEVENT', 'OTHERORDER')]) {
      await assert.rejects(receivePayPalWebhook(new Request('https://planrecover.test/api/webhooks/paypal', { method: 'POST', body: JSON.stringify(payload) }),
        { database, verify: async () => true, process: fail }), error => error.status === 503);
    }
    await database.prepare("UPDATE webhook_events SET status='processing',processing_started='2026-10-14T11:00:00Z' WHERE id='EVENTA'").run();
    const result = await service.reconcileOwnerPayments('owner-a', {}, dependencies(database, repository));
    assert.deepEqual(result.webhooks, [{ eventId: 'EVENTA', status: 'processed' }]);
    const foreign = await database.prepare('SELECT status,attempts FROM webhook_events WHERE id=?').bind('FOREIGNEVENT').first();
    assert.equal(foreign.status, 'failed'); assert.equal(foreign.attempts, 1);
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 1);
  });

  await test('A signed refund event can heal a completely missing refund ledger entry', async database => {
    const repository = await seed(database); await seedRefund(database, repository);
    await processPayPalWebhook(refundEvent(), dependencies(database, repository));
    await processPayPalWebhook(refundEvent(), dependencies(database, repository));
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 2);
    assert.equal((await repository.loadWorkspace('owner-a')).events[1].status, 'confirmed');
  });

  await test('Recovery retains accounting after a deleted plan expires without restoring it', async database => {
    const repository = await seed(database); await seedRefund(database, repository);
    const state = await repository.loadWorkspace('owner-a'), snapshot = structuredClone(state);
    delete snapshot.archives; delete snapshot.deletedTrips;
    state.plan.id = 'another-trip'; state.events = []; state.deletedTrips = [{ id: 'trip-a', workspace: snapshot,
      deletedAt: '2025-12-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }];
    await repository.saveWorkspace('owner-a', state, state.version);
    assert.equal((await service.reconcileOwnerPayments('owner-a', {}, dependencies(database, repository))).operations[0].status, 'refunded');
    const saved = await repository.loadWorkspace('owner-a'); assert.equal(saved.deletedTrips.length, 0); assert.equal(saved.events.length, 0);
    const retained = await database.prepare('SELECT body,status FROM plans WHERE owner=? AND id=?').bind('owner-a', 'trip-a').first();
    assert.equal(retained.status, 'deleted'); assert.equal(JSON.parse(retained.body).events.length, 2);
  });

  await test('Actual owner endpoint checks authentication, ownership and request shape before provider access', async database => {
    const repository = await seed(database); await seedOrder(database);
    assert.equal((await route.POST(request({}, { account: null }), context)).status, 401);
    assert.equal((await route.POST(request({ operationId: 'operation-order' }, { account: 'owner-b' }), context)).status, 404);
    assert.equal((await route.POST(request({ provider_id: 'ORDERA' }), context)).status, 400);
    assert.equal((await route.POST(request({ retryWebhooks: 'true' }), context)).status, 400);
    assert.equal((await route.POST(request({}, { raw: '{bad' }), context)).status, 400);
    assert.equal((await route.POST(request({}, { raw: ' '.repeat(8193) }), context)).status, 413);
    assert.equal((await route.POST(request({}, { origin: 'https://another.test' }), context)).status, 400);
    assert.deepEqual(providerCalls, []);
    const response = await route.POST(request({ operationId: 'operation-order' }), context);
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.equal((await response.json()).operations[0].status, 'captured');
    assert.equal((await repository.loadWorkspace('owner-a')).events.length, 1);
    assert.equal((await route.POST(request({ operationId: 'operation-order' }), context)).status, 200);
    assert.equal(providerCalls.length, 1, 'A recently completed operation is throttled.');
  });

  await test('Shared invitation access cannot reconcile the owner financial operations', async database => {
    await seed(database); await seedOrder(database);
    const token = 'a'.repeat(64), bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    await database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)')
      .bind(hash, token, 'owner-a', 'trip-a', 'editor', '2026-10-14T12:00:00Z', null).run();
    assert.equal((await route.POST(request({}, { account: 'owner-b', token }), context)).status, 403);
    assert.deepEqual(providerCalls, []);
  });

  await test('One batch attempts at most five saved operations and errors omit provider data', async database => {
    const repository = await seed(database);
    for (let i = 0; i < 6; i++) await seedOrder(database, { id: `missing-${i}`, provider_id: null });
    const result = await service.reconcileOwnerPayments('owner-a', {}, dependencies(database, repository));
    assert.equal(result.operations.length, 5); assert.equal(result.moreMayRemain, true);
    assert.ok(result.operations.every(operation => Object.keys(operation).length === 2 && operation.status === 'failed'));
    assert.deepEqual(providerCalls, []);
  });
} finally {
  globalThis.fetch = originalFetch; delete globalThis.paypalRecoveryTestEnv;
  if (!bundleDirectory.startsWith(buildRoot + '\\') && !bundleDirectory.startsWith(buildRoot + '/')) throw Error('Unsafe temporary bundle path.');
  rmSync(bundleDirectory, { recursive: true, force: true });
}
console.log(`${checks} payment reconciliation checks passed.`);
