import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestD1 } from './helpers/d1.mjs';
import { PlanRepository } from '../lib/plan-repository.ts';
import { initialState } from '../lib/model.ts';
import { accountPersonId } from '../lib/people.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const { build } = require(viteRequire.resolve('esbuild'));
const buildRoot = resolve(root, 'build');
mkdirSync(buildRoot, { recursive: true });
const bundleDirectory = mkdtempSync(join(buildRoot, 'backend-routes-'));
const origin = 'https://planrecover.test';
const accounts = { alice: 'route-alice-account', bob: 'route-bob-account', carol: 'route-carol-account' };
const people = Object.fromEntries(await Promise.all(Object.entries(accounts).map(async ([name, account]) => [name, await accountPersonId(account)])));
globalThis.backendTestEnv = { DB: undefined };
globalThis.fetch = async () => { throw new Error('Live provider calls are disabled in route integration tests.'); };

const entries = {
  plans: 'app/api/plans/route.ts',
  plan: 'app/api/plans/[planId]/route.ts',
  preferences: 'app/api/plans/[planId]/me/preferences/route.ts',
  workspace: 'app/api/workspace/route.ts',
  members: 'app/api/plan-members/route.ts',
  sharing: 'app/api/trip-share/route.ts',
  mcp: 'app/mcp/route.ts',
  paypal: 'lib/paypal.ts',
};
const routes = {};
let checks = 0;

// Only the deployment binding is replaced. Actual route, auth, schema, service
// and SQL code are bundled unchanged. Header identities below are test fixtures
// representing headers injected by the trusted hosted runtime.
try {
  for (const [name, path] of Object.entries(entries)) {
    const outfile = join(bundleDirectory, `${name}.mjs`);
    await build({
      entryPoints: [resolve(root, path)], outfile, bundle: true, platform: 'node', format: 'esm',
      target: 'node24', packages: 'external', tsconfig: resolve(root, 'tsconfig.json'), logLevel: 'silent',
      plugins: [{
        name: 'test-cloudflare-binding',
        setup(builder) {
          builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'test-workers' }));
          builder.onLoad({ filter: /.*/, namespace: 'test-workers' }, () => ({
            contents: 'export const env = globalThis.backendTestEnv;', loader: 'js',
          }));
        },
      }],
    });
    routes[name] = await import(pathToFileURL(outfile).href);
  }

  function request(path, method = 'GET', body, { account = accounts.alice, token, requestOrigin = origin } = {}) {
    const headers = new Headers();
    if (account) {
      headers.set('oai-authenticated-user-id', account);
      headers.set('oai-authenticated-user-email', `${Object.entries(accounts).find(([, value]) => value === account)?.[0] ?? 'person'}@example.test`);
    }
    if (token) headers.set('x-trip-share', token);
    if (method !== 'GET') {
      headers.set('Content-Type', 'application/json');
      headers.set('Origin', requestOrigin);
    }
    return new Request(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const context = planId => ({ params: Promise.resolve({ planId }) });
  async function decoded(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    if (status < 300) {
      assert.match(response.headers.get('Cache-Control') ?? '', /private/);
      assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    }
    return body;
  }
  const planInput = name => ({
    kind: 'trip', name, destination: 'Toronto, Ontario, Canada', start: '2027-04-04', end: '2027-04-06',
    timezone: 'America/Toronto', currency: 'CAD', budget: 50000, goal: 'A shared weekend.',
  });
  const preferenceInput = (budget, cash = budget, paypalMe = '') => ({
    budget, cash, reserve: 1000, financing: 0, pace: 'balanced', interests: ['museums'], paypalMe,
  });
  async function createPlan(name = 'Route test plan') {
    return decoded(await routes.plans.POST(request('/api/plans', 'POST', { plan: planInput(name) })), 201);
  }
  async function workspaceFor(account = accounts.alice, token) {
    return decoded(await routes.workspace.GET(request('/api/workspace', 'GET', undefined, { account, token })));
  }
  async function share(planId, role) {
    return decoded(await routes.sharing.POST(request('/api/trip-share', 'POST', { tripId: planId, operation: 'create', role })));
  }
  async function joinMember(planId, account, token, name) {
    const before = await workspaceFor(account, token);
    return decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'join', tripId: planId, version: before.state.version, name,
    }, { account, token })));
  }
  async function check(name, callback) {
    const database = createTestD1();
    globalThis.backendTestEnv.DB = database;
    try {
      await callback(database);
      checks += 1;
      console.log(`PASS ${name}`);
    } finally {
      database.close();
      globalThis.backendTestEnv.DB = undefined;
    }
  }

  await check('Hosted authentication and mutation schemas return explicit HTTP errors', async database => {
    await decoded(await routes.plans.GET(request('/api/plans', 'GET', undefined, { account: null })), 401);
    await decoded(await routes.workspace.GET(request('/api/workspace', 'GET', undefined, { account: null })), 401);
    await decoded(await routes.plans.POST(request('/api/plans', 'POST', { plan: planInput('Invalid'), owner: accounts.bob })), 400);
    await decoded(await routes.plans.POST(request('/api/plans', 'POST', { plan: { ...planInput('Invalid date'), start: '2027-02-30' } })), 400);
    const created = await createPlan();
    const planId = created.state.plan.id;
    await decoded(await routes.plan.PATCH(request(`/api/plans/${planId}`, 'PATCH', {
      version: created.version, action: { type: 'plan', plan: { ...created.state.plan, name: 'Unexpected fields' }, owner: accounts.bob },
    }), context(planId)), 400);
    await decoded(await routes.plan.PATCH(request(`/api/plans/${planId}`, 'PATCH', {
      version: created.version, action: { type: 'plan', plan: { ...created.state.plan, name: 'Wrong origin' } },
    }, { requestOrigin: 'https://another.example' }), context(planId)), 400);
    const before = await workspaceFor();
    await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
      version: before.state.version, action: { type: 'arbitrary_unrecognized_action', actor: people.alice },
    })), 400);
    assert.equal((await new PlanRepository(database).loadWorkspace(accounts.alice)).version, before.state.version);
  });

  await check('Plan create/list/patch and legacy workspace adapters persist the same records', async database => {
    const first = await createPlan('First API plan');
    const second = await createPlan('Second API plan');
    const firstId = first.state.plan.id;
    const secondId = second.state.plan.id;
    assert.notEqual(firstId, secondId);
    const listed = await decoded(await routes.plans.GET(request('/api/plans')));
    assert.ok(listed.plans.some(plan => plan.id === firstId));
    assert.ok(listed.plans.some(plan => plan.id === secondId));
    assert.ok(listed.plans.every(plan => !('preferences' in plan) && !('owner' in plan)));
    const current = await decoded(await routes.plan.GET(request(`/api/plans/${firstId}`), context(firstId)));
    assert.equal(current.owner, undefined, 'The API omits internal account ownership identifiers');
    assert.deepEqual(Object.keys(current.state.preferences), [people.alice]);
    const saved = await decoded(await routes.plan.PATCH(request(`/api/plans/${firstId}`, 'PATCH', {
      version: current.version, action: { type: 'plan', actor: people.bob, plan: { ...current.state.plan, name: 'Saved from the plan API' } },
    }), context(firstId)));
    assert.equal(saved.state.plan.name, 'Saved from the plan API');
    assert.ok(saved.state.audit.some(entry => entry.actorId === people.alice));
    await decoded(await routes.plan.PATCH(request(`/api/plans/${firstId}`, 'PATCH', {
      version: current.version, action: { type: 'plan', plan: { ...current.state.plan, name: 'Stale patch' } },
    }), context(firstId)), 409);
    const legacy = await workspaceFor();
    assert.equal(legacy.state.plan.id, secondId);
    assert.equal(legacy.state.archives.find(value => value.workspace.plan.id === firstId).workspace.plan.name, 'Saved from the plan API');
    const selected = await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
      version: legacy.state.version, action: { type: 'select_trip', tripId: firstId, actor: people.bob },
    })));
    assert.equal(selected.state.plan.id, firstId);
    assert.equal((await new PlanRepository(database).loadWorkspace(accounts.alice)).plan.name, saved.state.plan.name);
    const normalized = await decoded(await routes.plan.GET(request(`/api/plans/${firstId}`), context(firstId)));
    assert.equal(normalized.state.plan.name, selected.state.plan.name);
  });

  await check('Invitation membership and workspace/plan responses expose only the caller private settings', async database => {
    const created = await createPlan();
    const planId = created.state.plan.id;
    const editor = await share(planId, 'editor');
    const guest = await workspaceFor(accounts.bob, editor.token);
    assert.deepEqual(guest.state.preferences, {});
    assert.equal(guest.collaboration.canJoin, true);
    const joined = await joinMember(planId, accounts.bob, editor.token, 'Bob');
    assert.deepEqual(Object.keys(joined.state.preferences), [people.bob]);
    assert.equal(joined.collaboration.role, 'editor');
    const viewer = await share(planId, 'viewer');
    const viewerJoined = await joinMember(planId, accounts.carol, viewer.token, 'Carol');
    assert.equal(viewerJoined.collaboration.role, 'viewer');
    assert.deepEqual(Object.keys(viewerJoined.state.preferences), [people.carol]);
    const beforeProfile = await workspaceFor(accounts.bob, editor.token);
    const renamed = await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'profile', tripId: planId, version: beforeProfile.state.version, name: 'Bobby',
    }, { account: accounts.bob, token: editor.token })));
    assert.deepEqual(Object.keys(renamed.state.preferences), [people.bob]);
    assert.equal(renamed.state.people.find(person => person.id === people.bob).name, 'Bobby');
    await decoded(await routes.plan.GET(request(`/api/plans/${planId}`, 'GET', undefined, {
      account: accounts.bob, token: editor.token,
    }), context(planId)), 403);
    const bobPlan = await decoded(await routes.plan.GET(request(`/api/plans/${planId}`, 'GET', undefined, { account: accounts.bob }), context(planId)));
    assert.deepEqual(Object.keys(bobPlan.state.preferences), [people.bob]);
    const carolPlan = await decoded(await routes.plan.GET(request(`/api/plans/${planId}`, 'GET', undefined, { account: accounts.carol }), context(planId)));
    await decoded(await routes.plan.PATCH(request(`/api/plans/${planId}`, 'PATCH', {
      version: carolPlan.version, action: { type: 'plan', actor: people.alice, plan: { ...carolPlan.state.plan, name: 'Viewer overwrite' } },
    }, { account: accounts.carol }), context(planId)), 403);
    const currentViewer = await workspaceFor(accounts.carol, viewer.token);
    await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
      version: currentViewer.state.version, action: { type: 'plan', actor: people.alice, plan: { ...currentViewer.state.plan, name: 'Viewer overwrite' } },
    }, { account: accounts.carol, token: viewer.token })), 403);
    const ownerView = await workspaceFor();
    assert.deepEqual(Object.keys(ownerView.state.preferences), [people.alice]);
    assert.equal((await new PlanRepository(database).loadWorkspace(accounts.alice)).preferences[people.bob].budget, 50000);
  });

  await check('Legacy private settings edits persist through normalized APIs and reject stale versions', async database => {
    const created = await createPlan();
    const planId = created.state.plan.id;
    const editor = await share(planId, 'editor');
    await joinMember(planId, accounts.bob, editor.token, 'Bob');
    const repository = new PlanRepository(database);
    const aliceBefore = await repository.getPreferences(planId, { id: people.alice, name: 'Alice' });
    const before = await workspaceFor(accounts.bob, editor.token);
    const preferences = preferenceInput(33000, 17000, 'https://paypal.me/bob.test');
    const updated = await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
      version: before.state.version, action: { type: 'preferences', actor: people.alice, preferences },
    }, { account: accounts.bob, token: editor.token })));
    assert.deepEqual(updated.state.preferences, { [people.bob]: preferences });
    assert.deepEqual(await repository.getPreferences(planId, { id: people.alice, name: 'Alice' }), aliceBefore);
    assert.equal((await repository.loadWorkspace(accounts.alice)).preferences[people.bob].budget, 33000);
    const ownPreferences = await decoded(await routes.preferences.GET(request(`/api/plans/${planId}/me/preferences`, 'GET', undefined, { account: accounts.bob }), context(planId)));
    assert.deepEqual(ownPreferences.preferences, preferences);
    assert.equal(ownPreferences.version, 1);
    await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
      version: before.state.version, action: { type: 'preferences', preferences: preferenceInput(99000) },
    }, { account: accounts.bob, token: editor.token })), 409);
    await decoded(await routes.preferences.PATCH(request(`/api/plans/${planId}/me/preferences`, 'PATCH', {
      version: 0, preferences: preferenceInput(99000),
    }, { account: accounts.bob }), context(planId)), 409);
    await decoded(await routes.preferences.PATCH(request(`/api/plans/${planId}/me/preferences`, 'PATCH', {
      version: ownPreferences.version, preferences: { ...preferences, memberId: people.alice },
    }, { account: accounts.bob }), context(planId)), 400);
    const owner = await workspaceFor();
    assert.deepEqual(Object.keys(owner.state.preferences), [people.alice]);
    assert.equal(owner.state.reimbursementLinks[people.bob], preferences.paypalMe, 'Public repayment links survive private budget filtering');
    const patched = await decoded(await routes.preferences.PATCH(request(`/api/plans/${planId}/me/preferences`, 'PATCH', {
      version: ownPreferences.version, preferences: preferenceInput(34000, 18000),
    }, { account: accounts.bob }), context(planId)));
    assert.equal(patched.version, 2);
    assert.equal((await workspaceFor(accounts.bob, editor.token)).state.preferences[people.bob].budget, 34000);
  });

  await check('Revoked invitation races abort shared plan and preference writes in the SQL transaction', async database => {
    const created = await createPlan();
    const planId = created.state.plan.id;
    let editor = await share(planId, 'editor');
    await joinMember(planId, accounts.bob, editor.token, 'Bob');
    const originalBatch = database.batch.bind(database);
    async function revokeDuringWrite(callback) {
      let revoked = false;
      database.batch = async statements => {
        if (!revoked && statements[0]?.sql.includes('trip_links')) {
          await database.prepare('DELETE FROM trip_links WHERE owner=? AND trip_id=?').bind(accounts.alice, planId).run();
          revoked = true;
        }
        return originalBatch(statements);
      };
      try {
        await callback();
        assert.equal(revoked, true, 'The link was revoked after access checking and before its write guard');
      } finally {
        database.batch = originalBatch;
      }
    }
    const before = await workspaceFor(accounts.bob, editor.token);
    const repository = new PlanRepository(database);
    await revokeDuringWrite(async () => {
      await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
        version: before.state.version, action: { type: 'plan', plan: { ...before.state.plan, name: 'Must roll back' } },
      }, { account: accounts.bob, token: editor.token })), 409);
    });
    let retained = await repository.loadWorkspace(accounts.alice);
    assert.equal(retained.version, before.state.version);
    assert.equal(retained.plan.name, before.state.plan.name);
    editor = await share(planId, 'editor');
    const beforePreference = await workspaceFor(accounts.bob, editor.token);
    const privateBefore = await repository.getPreferences(planId, { id: people.bob, name: 'Bob' });
    await revokeDuringWrite(async () => {
      await decoded(await routes.workspace.POST(request('/api/workspace', 'POST', {
        version: beforePreference.state.version, action: { type: 'preferences', preferences: preferenceInput(99000) },
      }, { account: accounts.bob, token: editor.token })), 409);
    });
    retained = await repository.loadWorkspace(accounts.alice);
    assert.equal(retained.version, beforePreference.state.version);
    assert.deepEqual(await repository.getPreferences(planId, { id: people.bob, name: 'Bob' }), privateBefore);
    assert.equal((await database.prepare('SELECT count(*) AS count FROM backend_write_guards').first()).count, 0);
  });

  await check('Concurrent legacy read repairs persist one missing plan ID without orphan rows', async database => {
    const legacy = initialState();
    delete legacy.plan.id;
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind(accounts.alice, JSON.stringify(legacy), 0, '2026-10-12T18:00:00Z').run();
    const [first, second] = await Promise.all([workspaceFor(), workspaceFor()]);
    assert.ok(first.state.plan.id);
    assert.equal(first.state.plan.id, second.state.plan.id);
    assert.equal((await database.prepare('SELECT count(*) AS count FROM plans').first()).count, 1);
    const row = await database.prepare('SELECT body,version FROM workspaces WHERE owner=?').bind(accounts.alice).first();
    assert.equal(JSON.parse(row.body).plan.id, first.state.plan.id);
    assert.equal(row.version, 1);
  });

  await check('Invitation expiry, renewal and concurrent creation preserve the valid persisted token', async database => {
    const created = await createPlan();
    const planId = created.state.plan.id;
    const started = Date.now();
    const [first, second] = await Promise.all([share(planId, 'editor'), share(planId, 'editor')]);
    assert.match(first.token, /^[a-f0-9]{64}$/);
    assert.equal(first.token, second.token);
    assert.equal(first.expires, second.expires);
    const lifetime = Date.parse(first.expires) - started;
    assert.ok(lifetime >= 7 * 86_400_000 - 1000 && lifetime <= 7 * 86_400_000 + 10000);
    assert.equal((await share(planId, 'editor')).token, first.token);
    assert.equal((await database.prepare("SELECT count(*) AS count FROM trip_links WHERE owner=? AND trip_id=? AND role='editor'").bind(accounts.alice, planId).first()).count, 1);
    await database.prepare('UPDATE trip_links SET expires=? WHERE token=?').bind(new Date(Date.now() - 60_000).toISOString(), first.token).run();
    const expired = await decoded(await routes.workspace.GET(request('/api/workspace', 'GET', undefined, { account: accounts.bob, token: first.token })), 410);
    assert.equal(expired.code, 'INVITATION_EXPIRED');
    const renewed = await share(planId, 'editor');
    assert.notEqual(renewed.token, first.token);
    assert.ok(Date.parse(renewed.expires) > Date.now());
    assert.equal(await database.prepare('SELECT token FROM trip_links WHERE token=?').bind(first.token).first(), null);
    await database.prepare('UPDATE trip_links SET expires=NULL WHERE token=?').bind(renewed.token).run();
    const legacy = await share(planId, 'editor');
    assert.equal(legacy.token, renewed.token);
    assert.equal(legacy.expires, null);
    assert.deepEqual((await workspaceFor(accounts.bob, legacy.token)).state.preferences, {});
  });

  await check('Strict member requests bind join role and profile identity while preserving owner permissions', async database => {
    const created = await createPlan();
    const planId = created.state.plan.id;
    const editor = await share(planId, 'editor');
    const guest = await workspaceFor(accounts.bob, editor.token);
    await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'join', tripId: planId, version: guest.state.version, name: 'Bob', role: 'owner',
    }, { account: accounts.bob, token: editor.token })), 400);
    assert.equal(await database.prepare('SELECT role FROM plan_members WHERE owner=? AND plan_id=? AND member_id=?')
      .bind(accounts.alice, planId, people.bob).first(), null);
    await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'join', tripId: planId, version: guest.state.version, name: 'Anonymous',
    }, { account: null, token: editor.token })), 401);
    const joined = await joinMember(planId, accounts.bob, editor.token, 'Bob');
    assert.equal(joined.state.people.find(person => person.id === people.bob).role, 'editor');
    await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'profile', tripId: planId, version: joined.state.version, name: 'Overwrite owner', memberId: people.alice,
    }, { account: accounts.bob, token: editor.token })), 400);
    await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'role', tripId: planId, version: joined.state.version, memberId: people.bob, role: 'viewer',
    }, { account: accounts.bob, token: editor.token })), 403);
    await decoded(await routes.sharing.POST(request('/api/trip-share', 'POST', {
      tripId: planId, operation: 'create', role: 'viewer',
    }, { account: accounts.bob, token: editor.token })), 403);
    await decoded(await routes.sharing.POST(request('/api/trip-share', 'POST', {
      tripId: planId, operation: 'revoke',
    }, { account: accounts.bob, token: editor.token })), 403);
    const before = await workspaceFor(accounts.bob, editor.token);
    const saved = await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'profile', tripId: planId, version: before.state.version, name: 'Bobby Self',
    }, { account: accounts.bob, token: editor.token })));
    assert.equal(saved.state.people.find(person => person.id === people.bob).name, 'Bobby Self');
    assert.equal(saved.state.people.find(person => person.id === people.bob).role, 'editor');
    assert.equal(saved.state.people.find(person => person.id === people.alice).role, 'owner');
    await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'profile', tripId: planId, version: before.state.version, name: 'Stale profile',
    }, { account: accounts.bob, token: editor.token })), 409);
  });

  await check('Owner revocation removes invitations and retains existing member history and private settings', async database => {
    const created = await createPlan();
    const planId = created.state.plan.id;
    const editor = await share(planId, 'editor');
    await joinMember(planId, accounts.bob, editor.token, 'Bob');
    const repository = new PlanRepository(database);
    const preferences = await repository.getPreferences(planId, { id: people.bob, name: 'Bob' });
    const owner = await workspaceFor();
    const changed = await decoded(await routes.members.POST(request('/api/plan-members', 'POST', {
      operation: 'role', tripId: planId, version: owner.state.version, memberId: people.bob, role: 'viewer',
    })));
    assert.equal(changed.state.people.find(person => person.id === people.bob).role, 'viewer');
    const revoked = await decoded(await routes.sharing.POST(request('/api/trip-share', 'POST', { tripId: planId, operation: 'revoke' })));
    assert.equal(revoked.sharingEnabled, false);
    assert.equal((await database.prepare('SELECT count(*) AS count FROM trip_links WHERE owner=? AND trip_id=?').bind(accounts.alice, planId).first()).count, 0);
    assert.equal((await database.prepare('SELECT role FROM plan_members WHERE owner=? AND plan_id=? AND member_id=?')
      .bind(accounts.alice, planId, people.bob).first()).role, 'viewer');
    assert.deepEqual(await repository.getPreferences(planId, { id: people.bob, name: 'Bob' }), preferences);
    const existing = await decoded(await routes.plan.GET(request(`/api/plans/${planId}`, 'GET', undefined, { account: accounts.bob }), context(planId)));
    assert.equal(existing.role, 'viewer');
    assert.deepEqual(existing.state.preferences, { [people.bob]: preferences.preferences });
  });

  await check('Actual MCP endpoint permits public discovery and binds authentication for saved plan reads', async database => {
    const rejectedMethod = routes.mcp.GET();
    assert.equal(rejectedMethod.status, 405);
    assert.equal(rejectedMethod.headers.get('Allow'), 'POST');
    const message = (name, parameters) => ({ jsonrpc: '2.0', id: 1, method: name, ...(parameters === undefined ? {} : { params: parameters }) });
    function mcpRequest(body, account = null) {
      const input = request('/mcp', 'POST', body, { account });
      input.headers.set('Accept', 'application/json, text/event-stream');
      return input;
    }
    const discovery = await decoded(await routes.mcp.POST(mcpRequest(message('tools/list'))));
    assert.equal(discovery.result.tools.length, 9);
    assert.equal((await database.prepare('SELECT count(*) AS count FROM workspaces').first()).count, 0, 'Public discovery does not create a saved workspace');
    const anonymous = await decoded(await routes.mcp.POST(mcpRequest(message('tools/call', { name: 'list_plans', arguments: {} }))), 401);
    assert.equal(anonymous.error.code, -32000);
    const created = await createPlan('Authenticated MCP route plan');
    const result = await decoded(await routes.mcp.POST(mcpRequest(message('tools/call', {
      name: 'get_plan', arguments: { planId: created.state.plan.id },
    }), accounts.alice)));
    assert.equal(result.result.isError, false);
    assert.equal(result.result.structuredContent.plan.name, 'Authenticated MCP route plan');
    assert.equal(result.result.structuredContent.preferences, undefined);
  });

  await check('PayPal transport preserves exact webhook verification JSON and ordinary order serialization', async () => {
    const deniedFetch = globalThis.fetch;
    const calls = [];
    globalThis.backendTestEnv.PAYPAL_CLIENT_ID = 'sandbox-client-fixture';
    globalThis.backendTestEnv.PAYPAL_CLIENT_SECRET = 'sandbox-secret-fixture';
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      assert.equal(new URL(url).origin, 'https://api-m.sandbox.paypal.com');
      if (new URL(url).pathname === '/v1/oauth2/token') return Response.json({ access_token: 'fixture-access-token' });
      if (new URL(url).pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
      return Response.json({ id: 'fixture-order', status: 'CREATED' });
    };
    try {
      const raw = '{"auth_algo":"SHA256withRSA","webhook_event": { "precise":9007199254740993.001,"memo":"escaped\\nline" }}';
      const verification = await routes.paypal.paypal('/v1/notifications/verify-webhook-signature', 'POST', { ignored: 'object-body' }, undefined, raw);
      assert.equal(verification.verification_status, 'SUCCESS');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].options.body, raw, 'Exact bytes and numeric tokens are retained for signature verification');
      const order = { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'CAD', value: '12.34' } }] };
      const result = await routes.paypal.paypal('/v2/checkout/orders', 'POST', order, 'fixture-idempotency-key');
      assert.equal(result.id, 'fixture-order');
      assert.equal(calls[3].options.body, JSON.stringify(order));
      assert.equal(calls[3].options.headers['PayPal-Request-Id'], 'fixture-idempotency-key');
      const before = calls.length;
      await assert.rejects(() => routes.paypal.paypal('/v2/checkout/orders', 'POST', order, undefined, raw), /restricted to webhook verification/);
      await assert.rejects(() => routes.paypal.paypal('/v1/notifications/verify-webhook-signature', 'GET', undefined, undefined, raw), /restricted to webhook verification/);
      assert.equal(calls.length, before, 'Rejected raw payload paths do not request an OAuth token');
    } finally {
      globalThis.fetch = deniedFetch;
      delete globalThis.backendTestEnv.PAYPAL_CLIENT_ID;
      delete globalThis.backendTestEnv.PAYPAL_CLIENT_SECRET;
    }
  });

  console.log(`${checks} actual API route integration checks passed against real SQLite migrations.`);
} finally {
  // Restrict recursive cleanup to this freshly created directory under build/.
  const cleanupPath = resolve(bundleDirectory);
  if (dirname(cleanupPath) !== buildRoot || !basename(cleanupPath).startsWith('backend-routes-')) {
    throw new Error('Refusing to remove an unexpected route test directory.');
  }
  rmSync(cleanupPath, { recursive: true, force: true });
  delete globalThis.backendTestEnv;
}
