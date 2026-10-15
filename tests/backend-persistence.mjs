import assert from 'node:assert/strict';
import { createTestD1, applyMigrations } from './helpers/d1.mjs';
import { PlanRepository, visibleWorkspace } from '../lib/plan-repository.ts';
import { initialState, applyAction, normalizeWorkspace, suggestionFit } from '../lib/model.ts';
import { initializePeople, addPerson } from '../lib/people.ts';

const alice = { id: 'person-alice', name: 'Alice Owner' };
const bob = { id: 'person-bob', name: 'Bob Editor' };
const carol = { id: 'person-carol', name: 'Carol Viewer' };
const stranger = { id: 'person-stranger', name: 'Unrelated Person' };
const planInput = name => ({
  kind: 'trip', name, destination: 'Toronto, Ontario, Canada',
  goal: 'A shared weekend with private budgets.', start: '2027-04-04', end: '2027-04-06',
  timezone: 'America/Toronto', currency: 'CAD', budget: 50000,
});
const preferences = (budget, cash = budget) => ({
  budget, cash, reserve: 1000, pace: 'balanced', interests: ['museums'], paypalMe: '', financing: 0,
});
let checks = 0;
async function check(name, callback) {
  await callback();
  checks += 1;
  console.log(`PASS ${name}`);
}
function statusIs(status) {
  return error => error?.status === status;
}
function sharedLegacyWorkspace() {
  const workspace = applyAction(initialState(), { type: 'create_trip', actor: 'sam', plan: planInput('Existing shared plan') });
  initializePeople(workspace, alice);
  addPerson(workspace, bob, 'editor');
  addPerson(workspace, carol, 'viewer');
  workspace.preferences[alice.id] = preferences(74000, 36000);
  workspace.preferences[bob.id] = preferences(28000, 12000);
  workspace.preferences[carol.id] = preferences(61000, 25000);
  return workspace;
}

await check('SQL migration retains legacy workspaces and provider records', async () => {
  const database = createTestD1({ migrations: { through: '0003_brief_shaman.sql' } });
  try {
    const state = sharedLegacyWorkspace();
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind('legacy-account', JSON.stringify(state), 7, '2026-10-12T18:00:00Z').run();
    await database.prepare('INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,provider_id,status,payload) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind('operation-old', 'legacy-account', 'hike', 'sam', 1, 'capture', 9000, 'PAYPAL-CAPTURE-OLD', 'confirmed', '{"receipt":"retained"}').run();
    await database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,created,role) VALUES (?,?,?,?,?,?)')
      .bind('legacy-hash', 'legacy-token', 'legacy-account', state.plan.id, '2026-10-12T18:00:00Z', 'editor').run();
    await database.prepare('INSERT INTO webhook_events(id,body,received) VALUES (?,?,?)')
      .bind('event-old', '{"id":"event-old"}', '2026-10-12T18:00:00Z').run();
    const before = await database.prepare('SELECT * FROM workspaces WHERE owner=?').bind('legacy-account').first();
    applyMigrations(database);
    assert.deepEqual(await database.prepare('SELECT * FROM workspaces WHERE owner=?').bind('legacy-account').first(), before);
    assert.equal((await database.prepare('SELECT * FROM provider_operations WHERE id=?').bind('operation-old').first()).provider_id, 'PAYPAL-CAPTURE-OLD');
    assert.equal((await database.prepare('SELECT * FROM trip_links WHERE token_hash=?').bind('legacy-hash').first()).role, 'editor');
    assert.equal((await database.prepare('SELECT * FROM webhook_events WHERE id=?').bind('event-old').first()).body, '{"id":"event-old"}');
    const repository = new PlanRepository(database);
    await repository.importWorkspace('legacy-account', { ...state, version: 7 }, alice);
    const loaded = await repository.loadWorkspace('legacy-account');
    assert.deepEqual(loaded.events, state.events);
    assert.deepEqual(loaded.items, state.items);
    assert.deepEqual(loaded.archives[0].workspace.events, state.archives[0].workspace.events);
    assert.deepEqual(loaded.preferences, state.preferences);
    const first = await repository.getPlan(state.plan.id, alice);
    await repository.importWorkspace('legacy-account', { ...state, version: 7 }, alice);
    const second = await repository.getPlan(state.plan.id, alice);
    assert.equal(second.version, first.version, 'Repeated imports do not reset a persisted plan version');
    assert.deepEqual(second.state.items, first.state.items);
  } finally {
    database.close();
  }
});

await check('Independent plan rows support create, list and private member reads', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const first = await repository.createPlan('alice-account', alice, planInput('First personal plan'));
    const second = await repository.createPlan('alice-account', alice, planInput('Second personal plan'));
    assert.notEqual(first.state.plan.id, second.state.plan.id);
    const ids = (await repository.listPlans(alice.id)).map(plan => plan.id);
    assert.ok(ids.includes(first.state.plan.id));
    assert.ok(ids.includes(second.state.plan.id));
    assert.deepEqual(await repository.listPlans(stranger.id), []);
    await assert.rejects(() => repository.getPlan(first.state.plan.id, stranger), statusIs(404));
    const one = await repository.getPlan(first.state.plan.id, alice);
    const two = await repository.getPlan(second.state.plan.id, alice);
    const changed = await repository.updatePlan(first.state.plan.id, alice, one.version, {
      type: 'plan', actor: stranger.id, plan: { ...one.state.plan, name: 'Edited first plan' },
    });
    assert.equal(changed.state.plan.name, 'Edited first plan');
    assert.equal((await repository.getPlan(second.state.plan.id, alice)).version, two.version);
    assert.equal((await repository.getPlan(second.state.plan.id, alice)).state.plan.name, 'Second personal plan');
    assert.ok(changed.state.audit.every(entry => entry.actorId !== stranger.id), 'Caller actor values cannot forge attribution');
  } finally {
    database.close();
  }
});

await check('Plan compare-and-swap permits one concurrent write and preserves compatibility state', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const original = await repository.createPlan('alice-account', alice, planInput('Concurrent plan'));
    const planId = original.state.plan.id;
    const results = await Promise.allSettled(['Saved A', 'Saved B'].map(name => repository.updatePlan(planId, alice, original.version, {
      type: 'plan', actor: alice.id, plan: { ...original.state.plan, name },
    })));
    const successful = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 409);
    const reloaded = await repository.getPlan(planId, alice);
    assert.equal(reloaded.version, original.version + 1);
    assert.equal(reloaded.state.plan.name, successful[0].value.state.plan.name);
    assert.equal((await repository.loadWorkspace('alice-account')).plan.name, reloaded.state.plan.name);
    await assert.rejects(() => repository.updatePlan(planId, alice, original.version, {
      type: 'plan', actor: alice.id, plan: { ...original.state.plan, name: 'Stale overwrite' },
    }), statusIs(409));
    assert.equal((await repository.getPlan(planId, alice)).state.plan.name, reloaded.state.plan.name);
  } finally {
    database.close();
  }
});

await check('Membership enforces editor/viewer access and private preference versioning', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const legacy = sharedLegacyWorkspace();
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind('alice-account', JSON.stringify(legacy), legacy.version, '2026-10-12T18:00:00Z').run();
    await repository.importWorkspace('alice-account', legacy, alice);
    const planId = legacy.plan.id;
    const aliceView = await repository.getPlan(planId, alice);
    const bobView = await repository.getPlan(planId, bob);
    const carolView = await repository.getPlan(planId, carol);
    assert.equal(aliceView.role, 'owner');
    assert.equal(bobView.role, 'editor');
    assert.equal(carolView.role, 'viewer');
    assert.deepEqual(Object.keys(aliceView.state.preferences), [alice.id]);
    assert.deepEqual(Object.keys(bobView.state.preferences), [bob.id]);
    assert.deepEqual(Object.keys(carolView.state.preferences), [carol.id]);
    assert.deepEqual(bobView.state.preferences[bob.id], legacy.preferences[bob.id]);
    assert.deepEqual(bobView.state.archives ?? [], []);
    await assert.rejects(() => repository.updatePlan(planId, carol, carolView.version, {
      type: 'plan', actor: alice.id, plan: { ...carolView.state.plan, name: 'Viewer overwrite' },
    }), statusIs(403));
    const edited = await repository.updatePlan(planId, bob, bobView.version, {
      type: 'plan', actor: alice.id, plan: { ...bobView.state.plan, name: 'Editor saved this' },
    });
    assert.equal(edited.state.plan.name, 'Editor saved this');
    assert.ok(edited.state.audit.some(entry => entry.actorId === bob.id));
    const before = await repository.getPreferences(planId, bob);
    const ownerBefore = await repository.getPreferences(planId, alice);
    const updated = await repository.updatePreferences(planId, bob, preferences(33000, 18000), before.version);
    assert.equal(updated.version, before.version + 1);
    assert.equal(updated.preferences.budget, 33000);
    assert.deepEqual(await repository.getPreferences(planId, alice), ownerBefore);
    await assert.rejects(() => repository.updatePreferences(planId, bob, preferences(99000), before.version), statusIs(409));
    await assert.rejects(() => repository.getPreferences(planId, stranger), statusIs(404));
    assert.equal((await repository.getPlan(planId, bob)).state.preferences[bob.id].budget, 33000);
    assert.equal((await repository.loadWorkspace('alice-account')).preferences[bob.id].budget, 33000);
    const sharedBodies = await database.prepare('SELECT body FROM plans').all();
    for (const row of sharedBodies.results) {
      const body = JSON.parse(row.body);
      if (body.plan.template !== 'algonquin') assert.deepEqual(body.preferences ?? {}, {}, 'Personal plan JSON never contains private member budgets');
    }
  } finally {
    database.close();
  }
});

await check('Real SQLite batch constraints roll back all earlier writes', async () => {
  const database = createTestD1();
  try {
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind('existing', '{}', 0, '2026-10-12T18:00:00Z').run();
    await assert.rejects(() => database.batch([
      database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)').bind('rollback-me', '{}', 0, '2026-10-12T18:00:00Z'),
      database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)').bind('existing', '{}', 0, '2026-10-12T18:00:00Z'),
    ]));
    assert.equal(await database.prepare('SELECT owner FROM workspaces WHERE owner=?').bind('rollback-me').first(), null);
  } finally {
    database.close();
  }
});

await check('Client projection hides private preferences in active, archived and deleted plans', async () => {
  const workspace = sharedLegacyWorkspace();
  const originalPreferences = structuredClone(workspace.preferences);
  const archived = structuredClone(workspace);
  delete archived.archives;
  archived.plan.id = 'archived-personal-plan';
  archived.plan.name = 'Another private plan';
  workspace.archives.push({ id: archived.plan.id, archivedAt: '2026-10-12T18:00:00Z', workspace: archived });
  const deleted = structuredClone(archived);
  deleted.plan.id = 'deleted-personal-plan';
  workspace.deletedTrips = [{
    id: deleted.plan.id, deletedAt: '2026-10-12T18:00:00Z', expiresAt: '2099-01-01T00:00:00Z', workspace: deleted,
  }];
  const mine = visibleWorkspace(workspace, alice.id);
  assert.deepEqual(mine.preferences, { [alice.id]: originalPreferences[alice.id] });
  assert.deepEqual(mine.archives.at(-1).workspace.preferences, { [alice.id]: originalPreferences[alice.id] });
  assert.deepEqual(mine.deletedTrips[0].workspace.preferences, { [alice.id]: originalPreferences[alice.id] });
  assert.deepEqual(mine.archives[0].workspace.preferences, workspace.archives[0].workspace.preferences, 'Labelled demo preferences stay available as fixtures');
  const guest = visibleWorkspace(workspace);
  assert.deepEqual(guest.preferences, {});
  assert.deepEqual(guest.archives.at(-1).workspace.preferences, {});
  assert.deepEqual(guest.deletedTrips[0].workspace.preferences, {});
  assert.deepEqual(workspace.preferences, originalPreferences, 'Client projection cannot mutate server calculations');
  const empty = visibleWorkspace({ ...workspace, empty: true }, alice.id);
  assert.deepEqual(empty.preferences, {});
  assert.deepEqual(empty.archives.at(-1).workspace.preferences, { [alice.id]: originalPreferences[alice.id] });
});

await check('Concurrent private preference and shared-plan writes both retain their changes', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const legacy = sharedLegacyWorkspace();
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind('alice-account', JSON.stringify(legacy), legacy.version, '2026-10-12T18:00:00Z').run();
    await repository.importWorkspace('alice-account', legacy, alice);
    const planId = legacy.plan.id;
    const beforePlan = await repository.getPlan(planId, alice);
    const beforePreference = await repository.getPreferences(planId, bob);
    const beforeRoot = await repository.loadWorkspace('alice-account');
    const [savedPlan, savedPreference] = await Promise.all([
      repository.updatePlan(planId, alice, beforePlan.version, {
        type: 'plan', actor: alice.id, plan: { ...beforePlan.state.plan, name: 'Concurrent name survived' },
      }),
      repository.updatePreferences(planId, bob, preferences(39000, 21000), beforePreference.version),
    ]);
    assert.equal(savedPlan.state.plan.name, 'Concurrent name survived');
    assert.equal(savedPreference.version, beforePreference.version + 1);
    const current = await repository.getPlan(planId, bob);
    assert.equal(current.version, beforePlan.version + 1);
    assert.equal(current.state.plan.name, 'Concurrent name survived');
    assert.equal(current.state.preferences[bob.id].budget, 39000);
    const loaded = await repository.loadWorkspace('alice-account');
    assert.equal(loaded.version, beforeRoot.version + 2);
    assert.equal(loaded.preferences[bob.id].cash, 21000);
    assert.deepEqual(loaded.preferences[alice.id], legacy.preferences[alice.id]);
    assert.equal((await database.prepare('SELECT count(*) AS count FROM backend_write_guards').first()).count, 0, 'Successful and rejected batches leave no transient guard rows');
    const stored = JSON.parse((await database.prepare('SELECT body FROM workspaces WHERE owner=?').bind('alice-account').first()).body);
    assert.deepEqual(stored.preferences, {}, 'Compatibility root is private-free after shared writes');
  } finally {
    database.close();
  }
});

await check('Concurrent missing-ID repairs reject uncommitted imports and cannot create orphan plans', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const legacy = initialState();
    delete legacy.plan.id;
    await database.prepare('INSERT INTO workspaces(owner,body,version,updated) VALUES (?,?,?,?)')
      .bind('unrepaired-account', JSON.stringify(legacy), 0, '2026-10-12T18:00:00Z').run();
    const repairs = [normalizeWorkspace(legacy), normalizeWorkspace(legacy)];
    assert.notEqual(repairs[0].plan.id, repairs[1].plan.id);
    const imports = await Promise.allSettled(repairs.map(repair => repository.importWorkspace('unrepaired-account', repair, alice)));
    assert.ok(imports.every(result => result.status === 'rejected' && result.reason.status === 409));
    assert.equal((await database.prepare('SELECT count(*) AS count FROM plans').first()).count, 0);
    const saves = await Promise.allSettled(repairs.map(repair => repository.saveWorkspace('unrepaired-account', repair, 0)));
    assert.equal(saves.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(saves.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
    const stored = await repository.loadWorkspace('unrepaired-account');
    const stale = repairs.find(repair => repair.plan.id !== stored.plan.id);
    await assert.rejects(() => repository.importWorkspace('unrepaired-account', { ...stale, version: stored.version }, alice), statusIs(409));
    assert.equal((await database.prepare('SELECT count(*) AS count FROM plans').first()).count, 1);
    assert.equal(await database.prepare('SELECT id FROM plans WHERE id=?').bind(stale.plan.id).first(), null);
    assert.equal((await database.prepare('SELECT count(*) AS count FROM backend_write_guards').first()).count, 0);
  } finally {
    database.close();
  }
});

await check('Suggestion checks preserve unknown private budgets instead of claiming everyone fits', async () => {
  const state = visibleWorkspace(sharedLegacyWorkspace(), alice.id);
  const candidate = {
    id: 'museum-private-check', name: 'Museum visit', category: 'Activity',
    start: '2027-04-04T10:00:00-04:00', duration: 60, travelIn: 0, travelOut: 0, buffer: 0,
    price: 3000, reason: 'A priced visit', policy: 'Review opening hours', location: 'Toronto', tag: 'Museums',
  };
  const fit = suggestionFit(state, candidate, [alice.id, bob.id, carol.id]);
  assert.equal(fit.conflict, null);
  assert.deepEqual(fit.over, []);
  assert.deepEqual(fit.unknownBudgets, [bob.id, carol.id]);
  assert.equal(Object.values(fit.shares).reduce((total, share) => total + share, 0), 3000);
  assert.deepEqual(Object.keys(state.preferences), [alice.id]);
});

await check('Unknown-price edits still reject nonexistent participants without persisting changes', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const created = await repository.createPlan('alice-account', alice, planInput('Unknown estimate'));
    const planId = created.state.plan.id;
    const added = await repository.updatePlan(planId, alice, created.version, {
      type: 'add_item', actor: alice.id, name: 'Museum admission to confirm', category: 'Activity',
      start: '2027-04-04T10:00:00-04:00', duration: 60, price: null, participants: [alice.id],
    });
    const item = added.state.items[0];
    assert.equal(item.price, null);
    const before = await repository.loadWorkspace('alice-account');
    await assert.rejects(() => repository.updatePlan(planId, alice, added.version, {
      type: 'item_edit', actor: alice.id, itemId: item.id, price: null,
      participants: [alice.id, stranger.id], allocation: 'equal', values: {},
    }), /Select valid participants/);
    assert.deepEqual(await repository.loadWorkspace('alice-account'), before);
    const retained = await repository.getPlan(planId, alice);
    assert.equal(retained.version, added.version);
    assert.deepEqual(retained.state.items[0].participants, [alice.id]);
  } finally {
    database.close();
  }
});

console.log(`${checks} backend persistence integration checks passed against real migrations and SQLite.`);
