import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {PlanChangeService} from '../lib/plan-changes.ts';
import {accountPersonId, addPerson} from '../lib/people.ts';
import {applyAction} from '../lib/model.ts';

// These are simulated trusted gateway identities against the real HTTP handlers
// and migrated SQLite. They are not hosted multi-account/browser acceptance.
const root = fileURLToPath(new URL('../', import.meta.url)), origin = 'https://planrecover.test';
const require = createRequire(import.meta.url), {build} = require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root, 'build'), {recursive:true});
const directory = mkdtempSync(join(root, 'build', 'bedrock-multiuser-'));
const accounts = {owner:'matrix-owner', editor:'matrix-editor', viewer:'matrix-viewer', bystander:'matrix-bystander', outsider:'matrix-outsider'};
const people = Object.fromEntries(await Promise.all(Object.entries(accounts).map(async ([role, account]) =>
  [role, {id:await accountPersonId(account), name:role[0].toUpperCase() + role.slice(1)}])));
const configuration = {AWS_BEARER_TOKEN_BEDROCK:'offline-fixture', BEDROCK_REGION:'ca-central-1',
  BEDROCK_REQUIRE_APPLICATION_PROFILE:'true', BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/offline'};
const token = 'c'.repeat(64), tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
globalThis.bedrockMultiuserEnv = {};
let provider, calls = 0, checks = 0, fixtureError;
globalThis.fetch = async (url, ...args) => {
  assert.match(String(url), /^https:\/\/bedrock-runtime\.ca-central-1\.amazonaws\.com\/model\//, 'Only intercepted Bedrock requests are permitted.');
  calls += 1; try{return await provider(url, ...args);}catch(error){fixtureError=error;throw error;}
};
const request = (path, body, account = accounts.owner, extra = {}) => new Request(origin + path, {
  method:body === undefined ? 'GET' : 'POST', headers:{origin, 'content-type':'application/json',
    ...(account ? {'oai-authenticated-user-id':account} : {}), ...extra},
  ...(body === undefined ? {} : {body:JSON.stringify(body)}),
});
async function decoded(response, status = 200) {
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value));
  if (status === 200) assert.match(response.headers.get('cache-control'), /private, no-store/);
  return value;
}
const model = (content, stopReason = 'tool_use') => Response.json({output:{message:{role:'assistant', content}},
  stopReason, usage:{inputTokens:80, outputTokens:40, totalTokens:120}});
const tool = (name, input, toolUseId = name) => ({toolUse:{toolUseId, name, input}});
const completion = text => model([{text}], 'end_turn');
const toolResults = init => JSON.parse(init.body).messages.at(-1).content.map(block => block.toolResult);

try {
  const routes = {};
  for (const [name, path] of Object.entries({assistant:'app/api/assistant/route.ts', conversations:'app/api/conversations/route.ts',
    changes:'app/api/plans/[planId]/changes/route.ts', proposals:'app/api/agent-proposals/route.ts'})) {
    const outfile = join(directory, name + '.mjs');
    await build({entryPoints:[resolve(root, path)], outfile, bundle:true, platform:'node', format:'esm', target:'node24',
      packages:'external', logLevel:'silent', tsconfig:resolve(root, 'tsconfig.json'), plugins:[{name:'multiuser-bindings', setup(builder) {
        builder.onResolve({filter:/^cloudflare:workers$/}, () => ({path:'env', namespace:'multiuser-test'}));
        builder.onLoad({filter:/.*/, namespace:'multiuser-test'}, () => ({contents:'export const env=globalThis.bedrockMultiuserEnv;', loader:'js'}));
      }}]});
    routes[name] = await import(pathToFileURL(outfile).href);
  }
  async function check(name, run) {
    const database = createTestD1();
    for (const key of Object.keys(globalThis.bedrockMultiuserEnv)) delete globalThis.bedrockMultiuserEnv[key];
    Object.assign(globalThis.bedrockMultiuserEnv, configuration, {DB:database});
    calls = 0; fixtureError = undefined; provider = async () => { throw Error('Choose an offline provider fixture.'); };
    try {
      const repository = new PlanRepository(database);
      const created = await repository.createPlan(accounts.owner, people.owner, {name:'Offline multi-user recovery acceptance',
        destination:'Toronto', start:'2027-04-04', end:'2027-04-04', timezone:'America/Toronto', currency:'CAD', budget:20000});
      const id = created.state.plan.id, context = {params:Promise.resolve({planId:id})};
      let state = await repository.loadWorkspace(accounts.owner);
      for (const role of ['editor', 'viewer', 'bystander']) addPerson(state, people[role], role === 'viewer' ? 'viewer' : 'editor');
      for (const role of ['owner', 'editor', 'viewer', 'bystander']) state.preferences[people[role].id] = {
        ...state.preferences[people[role].id], interests:[`PRIVATE_${role.toUpperCase()}_PREFERENCES`], cash:10000};
      state = applyAction(state, {type:'add_item', actor:people.owner.id, name:'Synthetic shared venue', category:'Activity',
        start:'2027-04-04T10:00:00-04:00', duration:60, price:2000, participants:[people.owner.id, people.editor.id]});
      state.items[0].id = 'matrix-venue';
      await repository.saveWorkspace(accounts.owner, state, state.version);
      // Private preferences are independently versioned, so seed their real
      // table rather than assuming a shared workspace write can replace them.
      for (const role of ['owner', 'editor', 'viewer', 'bystander']) database.sqlite.prepare('UPDATE member_preferences SET body=? WHERE owner=? AND plan_id=? AND member_id=?')
        .run(JSON.stringify(state.preferences[people[role].id]), accounts.owner, id, people[role].id);
      const current = () => repository.getPlan(id, people.owner), before = await current();
      const changes = new PlanChangeService(database);
      const create = async (role = 'owner', extra = {}) => decoded(await routes.conversations.POST(request('/api/conversations', {planId:id}, accounts[role], extra)));
      const send = (session, {role = 'owner', extra = {}, message = 'Prepare this exact synthetic review only.', requestId = crypto.randomUUID()} = {}) =>
        routes.assistant.POST(request('/api/assistant', {planId:id, agent:true, message, conversationId:session.id,
          conversationVersion:session.version, requestId}, accounts[role], extra));
      const act = (body, role = 'owner') => routes.changes.POST(request('/api/plans/' + id + '/changes', body, accounts[role]), context);
      const recovery = (option = 'cancel') => ({type:'recovery', version:before.version, itemIds:['matrix-venue'], option, replacements:[]});
      const countEffect = table => table === 'financial_events'
        ? database.sqlite.prepare('SELECT COUNT(*) n FROM financial_events WHERE owner=? AND plan_id=?').get(accounts.owner, id).n
        : database.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
      const moneyBefore = Object.fromEntries(['financial_events', 'provider_operations', 'refund_reservations', 'plan_change_approvals']
        .map(table => [table, countEffect(table)]));
      const unchanged = async ({approvals = true} = {}) => {
        assert.deepEqual((await current()).state, before.state);
        for (const [table, n] of Object.entries(moneyBefore)) if (approvals || table !== 'plan_change_approvals')
          assert.equal(countEffect(table), n, table);
      };
      const invitation = (role = 'editor') => database.sqlite.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)')
        .run(tokenHash, token, accounts.owner, id, role, new Date().toISOString(), new Date(Date.now() + 3600000).toISOString());
      await run({database, repository, id, context, current, before, changes, create, send, act, recovery, unchanged, invitation});
      checks += 1; console.log('PASS ' + name);
    } finally { database.close(); }
  }

  await check('Owner and editor receive distinct private conversations and current facts during concurrent model turns', async t => {
    const sessions = await Promise.all(['owner', 'editor'].map(role => t.create(role)));
    let admitted = 0, release;
    const bothAdmitted = new Promise(resolve => { release = resolve; });
    provider = async (_url, init) => {
      const body = JSON.parse(init.body), context = JSON.parse(body.messages[0].content[0].text);
      const role = context.callerMemberId === people.owner.id ? 'owner' : 'editor';
      assert.equal(context.facts.plan.version, t.before.version);
      assert.ok(init.body.includes(`PRIVATE_${role.toUpperCase()}_PREFERENCES`));
      for (const other of ['owner', 'editor', 'viewer', 'bystander'].filter(value => value !== role))
        assert.ok(!init.body.includes(`PRIVATE_${other.toUpperCase()}_PREFERENCES`), other);
      if (++admitted === 2) release(); await bothAdmitted;
      return completion(`Private ${role} synthetic reply.`);
    };
    const values = await Promise.all(sessions.map((session, index) => t.send(session, {role:index ? 'editor' : 'owner'}).then(decoded)));
    if(fixtureError)throw fixtureError;
    assert.ok(values.every(value=>value.mode==='bedrock'),JSON.stringify({calls,values}));
    assert.deepEqual(values.map(value => value.reply), ['Private owner synthetic reply.', 'Private editor synthetic reply.']);
    for (const [index, role] of ['owner', 'editor'].entries()) {
      const restored = await decoded(await routes.conversations.GET(request('/api/conversations?id=' + sessions[index].id, undefined, accounts[role])));
      assert.equal(restored.messages.at(-1).text, values[index].reply);
      await decoded(await routes.conversations.GET(request('/api/conversations?id=' + sessions[1 - index].id, undefined, accounts[role])), 404);
    }
    assert.equal(calls, 2); assert.equal(t.database.sqlite.prepare('SELECT COUNT(DISTINCT member_id) n FROM bedrock_operations').get().n, 2);
    await t.unchanged();
  });

  await check('Editor agent saves exact recovery terms shared for review but keeps its transcript private', async t => {
    const session = await t.create('editor'); let round = 0, changeId;
    provider = async (_url, init) => {
      if (++round === 1) return model([tool('prepare_plan_change', {planId:t.id, change:t.recovery()})]);
      const result = toolResults(init)[0]; assert.equal(result.status, 'success');
      const saved = result.content[0].json; changeId = saved.changeId;
      assert.deepEqual(saved.required, [people.owner.id, people.editor.id].sort());
      assert.equal(saved.figures.expectedRefund, 0); assert.equal(saved.figures.newPaymentNow, 0);
      return completion(`Synthetic recovery awaits review: ${saved.reviewUrl}`);
    };
    const value = await decoded(await t.send(session, {role:'editor'}));
    assert.equal(value.planUnchanged, true); assert.equal(value.financialEffects, false);
    for (const role of ['owner', 'editor', 'viewer']) {
      const list = await decoded(await routes.changes.GET(request('/api/plans/' + t.id + '/changes', undefined, accounts[role]), t.context));
      assert.deepEqual(list.changes[0].terms, (await t.changes.get(t.id, people.owner, changeId)).terms);
      assert.deepEqual(list.changes[0].approved, []);
    }
    await decoded(await routes.conversations.GET(request('/api/conversations?id=' + session.id)), 404);
    await decoded(await routes.changes.GET(request('/api/plans/' + t.id + '/changes', undefined, accounts.outsider), t.context), 404);
    assert.equal(calls, 2); await t.unchanged();
  });

  await check('Departure requires both affected identities; viewers, nonaffected editors and outsiders cannot approve or apply', async t => {
    const proposed = await decoded(await t.act({type:'departure', version:t.before.version, memberId:people.editor.id}, 'editor'));
    const {change} = proposed;
    assert.deepEqual(change.terms.required, [people.owner.id, people.editor.id].sort());
    assert.deepEqual(change.terms.updates[0].participants, [people.owner.id]);
    assert.equal(change.terms.updates[0].shares[people.owner.id], 2000);
    const approval = {type:'approve', changeId:change.id, version:t.before.version, confirm:true};
    for (const [role, status] of [['viewer', 403], ['bystander', 403], ['outsider', 404]]) await decoded(await t.act(approval, role), status);
    await decoded(await routes.changes.POST(request('/api/plans/' + t.id + '/changes', approval, null), t.context), 401);
    const apply = {...approval, type:'apply'};
    await decoded(await t.act(apply), 409);
    await decoded(await t.act(approval)); await decoded(await t.act(approval));
    await decoded(await t.act(apply), 409);
    await decoded(await t.act(approval, 'editor'));
    await decoded(await t.act(apply, 'editor'), 409);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_change_approvals').get().n, 2);
    await t.unchanged({approvals:false}); assert.equal(calls, 0);
  });

  await check('Fully approved departure applies once and preserves the original contributor without a provider effect', async t => {
    const root = await t.repository.loadWorkspace(accounts.owner), item = root.items[0];
    item.status = 'scheduled'; item.paid = [people.owner.id, people.editor.id]; item.approvals = [...item.paid];
    root.events.push({id:'matrix-paid', itemId:item.id, kind:'expense', label:'Offline original payment', amount:2000,
      shares:{[people.owner.id]:1000, [people.editor.id]:1000}, contributions:{[people.owner.id]:2000},
      status:'confirmed', mode:'manual', evidence:'Synthetic two-person acceptance fixture.', created:new Date().toISOString()});
    await t.repository.saveWorkspace(accounts.owner, root, root.version);
    const initial = await t.current(), original = structuredClone(initial.state.events[0]);
    const {change} = await decoded(await t.act({type:'departure', version:initial.version, memberId:people.editor.id}, 'editor'));
    for (const role of ['owner', 'editor']) await decoded(await t.act({type:'approve', changeId:change.id, version:initial.version, confirm:true}, role));
    const input = {type:'apply', changeId:change.id, version:initial.version, confirm:true};
    await decoded(await t.act(input)); await decoded(await t.act(input));
    const after = await t.current(); assert.deepEqual(after.state.events[0], original); assert.equal(after.state.events.length, 2);
    assert.equal(after.state.events[1].amount, 0); assert.deepEqual(after.state.events[1].contributions, {});
    assert.deepEqual(after.state.items[0].participants, [people.owner.id]);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n, 0); assert.equal(calls, 0);
  });

  await check('Viewer membership cannot prepare recovery or departure, and anonymous callers never reach Bedrock', async t => {
    for (const change of [t.recovery(), {type:'departure', version:t.before.version, memberId:people.editor.id}])
      await decoded(await t.act(change, 'viewer'), 403);
    await decoded(await routes.assistant.POST(request('/api/assistant', {planId:t.id, agent:true, message:'Prepare a cancellation.'}, null)), 401);
    assert.equal(calls, 0); assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 0);
    await t.unchanged();
  });

  await check('A viewer invitation preserves read-only chat even for a member who can edit outside that link', async t => {
    t.invitation('viewer'); const extra = {'x-trip-share':token}, session = await t.create('editor', extra);
    provider = async (_url, init) => {
      const names = JSON.parse(init.body).toolConfig.tools.map(value => value.toolSpec.name);
      assert.deepEqual(names.sort(), ['compare_recovery_options', 'get_change_status']);
      return completion('This viewer link can explain saved facts; editing previews require the plan workspace.');
    };
    const value = await decoded(await t.send(session, {role:'editor', extra}));
    assert.equal(value.mode, 'bedrock'); assert.deepEqual(value.prepared, []);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n, 0);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 0);
    await t.unchanged();
  });

  await check('A provider cannot save an unoffered mutation through a viewer invitation', async t => {
    t.invitation('viewer'); const extra = {'x-trip-share':token}, session = await t.create('editor', extra);
    provider = async () => model([tool('prepare_plan_change', {planId:t.id, change:t.recovery()})]);
    const value = await decoded(await t.send(session, {role:'editor', extra}));
    assert.equal(value.mode, 'saved-plan'); assert.deepEqual(value.prepared, []);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 0);
    assert.equal(calls, 1); await t.unchanged();
  });

  await check('Invitation downgrade between model rounds blocks mutation preparation at the next tool boundary', async t => {
    t.invitation(); const extra = {'x-trip-share':token}, session = await t.create('editor', extra); let round = 0;
    provider = async (_url, init) => {
      if (++round === 1) return model([tool('get_change_status', {planId:t.id})]);
      if (round === 2) {
        assert.equal(toolResults(init)[0].status, 'success');
        t.database.sqlite.prepare("UPDATE trip_links SET role='viewer' WHERE token_hash=?").run(tokenHash);
        return model([tool('prepare_plan_change', {planId:t.id, change:t.recovery()})]);
      }
      assert.equal(toolResults(init)[0].status, 'error');
      return completion('The invitation is now read-only. No recovery was prepared.');
    };
    const value = await decoded(await t.send(session, {role:'editor', extra}));
    assert.equal(value.prepared.some(entry => entry.name === 'prepare_plan_change'), false);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 0);
    assert.equal(calls, 3); await t.unchanged();
  });

  for (const race of ['revocation', 'downgrade', 'expiry']) for (const name of ['prepare_plan_change', 'prepare_plan_action', 'prepare_plan']) {
    await check(`${race} immediately before the ${name} INSERT cannot save a review`, async t => {
      t.invitation(); const extra = {'x-trip-share':token}, session = await t.create('editor', extra);
      const input = name === 'prepare_plan_change' ? {planId:t.id, change:t.recovery()} : name === 'prepare_plan_action' ? {
        planId:t.id, version:t.before.version, action:{type:'add_item', name:'Atomic invitation fixture task', category:'Preparation',
          start:'2027-04-04T09:00:00-04:00', duration:15, price:0, participants:[people.editor.id], taskOwner:people.editor.id},
      } : {plan:{name:'Atomic invitation fixture plan', destination:'Toronto', start:'2027-05-05', end:'2027-05-05', timezone:'America/Toronto', currency:'CAD'}};
      const original = t.database.prepare.bind(t.database); let raced = false, round = 0;
      t.database.prepare = sql => {
        const statement = original(sql);
        const target = name === 'prepare_plan_change' ? sql.startsWith('INSERT INTO plan_changes(') : sql.startsWith('INSERT OR IGNORE INTO agent_proposals(');
        if (!target) return statement;
        return {bind(...values) { const bound = statement.bind(...values); return {run:async () => {
          if (!raced) {
            raced = true;
            if (race === 'revocation') t.database.sqlite.prepare('DELETE FROM trip_links WHERE token_hash=?').run(tokenHash);
            else if (race === 'downgrade') t.database.sqlite.prepare("UPDATE trip_links SET role='viewer' WHERE token_hash=?").run(tokenHash);
            else t.database.sqlite.prepare('UPDATE trip_links SET expires=? WHERE token_hash=?').run(new Date(Date.now() - 1000).toISOString(), tokenHash);
          }
          return bound.run();
        }}; }};
      };
      provider = async (_url, init) => {
        if (++round === 1) return model([tool(name, input)]);
        assert.equal(toolResults(init)[0].status, 'error'); return completion('No review was saved after invitation access changed.');
      };
      const value = await decoded(await t.send(session, {role:'editor', extra}), race === 'revocation' ? 400 : race === 'expiry' ? 410 : 200);
      assert.equal(raced, true); assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n, 0);
      assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 0);
      assert.equal(t.database.sqlite.prepare("SELECT COUNT(*) n FROM agent_tool_calls WHERE status='completed'").get().n, 0);
      if (race === 'downgrade') assert.deepEqual(value.prepared, []);
      await t.unchanged();
    });
  }

  await check('A plan price change immediately before an action-preview INSERT prevents saving the stale preview', async t => {
    const session = await t.create('editor'), original = t.database.prepare.bind(t.database); let raced = false, round = 0;
    t.database.prepare = sql => {
      const statement = original(sql);
      if (!sql.startsWith('INSERT OR IGNORE INTO agent_proposals(')) return statement;
      return {bind(...values) { const bound = statement.bind(...values); return {run:async () => {
        if (!raced) {
          raced = true;
          await t.repository.updatePlan(t.id, people.owner, t.before.version, {type:'item_edit', actor:people.owner.id,
            itemId:'matrix-venue', participants:[people.owner.id, people.editor.id], price:2500, allocation:'equal'});
        }
        return bound.run();
      }}; }};
    };
    provider = async (_url, init) => {
      if (++round === 1) return model([tool('prepare_plan_action', {planId:t.id, version:t.before.version,
        action:{type:'add_item', name:'Stale atomic fixture task', category:'Preparation', start:'2027-04-04T09:00:00-04:00',
          duration:15, price:0, participants:[people.editor.id], taskOwner:people.editor.id}})]);
      assert.equal(toolResults(init)[0].status, 'error'); return completion('The plan changed; prepare a current review.');
    };
    await decoded(await t.send(session, {role:'editor'}), 409);
    assert.equal(raced, true); assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n, 0);
    assert.equal((await t.current()).state.items[0].price, 2500);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n, 0);
  });

  await check('Revoked invitation during inference cannot save a change or return the generated answer', async t => {
    t.invitation(); const extra = {'x-trip-share':token}, session = await t.create('editor', extra);
    let round = 0;
    provider = async (_url, init) => {
      if (++round === 1) {
        t.database.sqlite.prepare('DELETE FROM trip_links WHERE token_hash=?').run(tokenHash);
        return model([tool('prepare_plan_change', {planId:t.id, change:t.recovery()})]);
      }
      assert.equal(toolResults(init)[0].status, 'error'); return completion('REVOKED_INVITATION_REPLY');
    };
    const value = await decoded(await t.send(session, {role:'editor', extra}), 400);
    assert.ok(!JSON.stringify(value).includes('REVOKED_INVITATION_REPLY'));
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 0);
    assert.equal(t.database.sqlite.prepare("SELECT COUNT(*) n FROM assistant_messages WHERE role='assistant'").get().n, 0);
    await t.unchanged();
  });

  await check('An approval arriving while an agent prepares recovery invalidates its stale reply', async t => {
    const existing = await t.changes.propose(t.id, people.owner, t.recovery('keep'));
    const session = await t.create('editor');
    provider = async () => {
      await t.changes.act(t.id, people.editor, {type:'approve', changeId:existing.id, version:t.before.version, confirm:true});
      return completion('STALE_RECOVERY_DECISION_REPLY');
    };
    const value = await decoded(await t.send(session, {role:'editor'}), 409);
    assert.ok(!JSON.stringify(value).includes('STALE_RECOVERY_DECISION_REPLY'));
    assert.equal(t.database.sqlite.prepare("SELECT COUNT(*) n FROM assistant_messages WHERE role='assistant'").get().n, 0);
    await t.unchanged({approvals:false});
  });

  await check('A price revision prevents approving exact prior recovery terms even when the client supplies the latest version', async t => {
    const {change} = await decoded(await t.act(t.recovery()));
    await t.repository.updatePlan(t.id, people.owner, t.before.version, {type:'item_edit', actor:people.owner.id,
      itemId:'matrix-venue', participants:[people.owner.id, people.editor.id], price:3000, allocation:'equal'});
    const current = await t.current();
    await decoded(await t.act({type:'approve', changeId:change.id, version:current.version, confirm:true}, 'editor'), 409);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_change_approvals').get().n, 0);
    assert.equal((await t.changes.get(t.id, people.owner, change.id)).terms.originals[0].price, 2000);
    assert.equal(current.state.items[0].price, 3000); assert.equal(calls, 0);
  });

  await check('Concurrent owner cancellation rolls back an editor approval before it can attach to closed terms', async t => {
    const {change} = await decoded(await t.act(t.recovery()));
    const original = t.database.batch.bind(t.database); let raced = false;
    t.database.batch = async statements => {
      if (!raced && statements.some(statement => statement.sql.includes('INSERT OR IGNORE INTO plan_change_approvals'))) {
        raced = true;
        await t.changes.act(t.id, people.owner, {type:'cancel', changeId:change.id, version:t.before.version, confirm:true});
      }
      return original(statements);
    };
    await decoded(await t.act({type:'approve', changeId:change.id, version:t.before.version, confirm:true}, 'editor'), 409);
    assert.equal(raced, true); assert.equal((await t.changes.get(t.id, people.owner, change.id)).status, 'cancelled');
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_change_approvals').get().n, 0);
    await t.unchanged();
  });

  await check('A plan revision racing immediately before approval rolls back the approval transaction', async t => {
    const {change} = await decoded(await t.act({type:'departure', version:t.before.version, memberId:people.editor.id}));
    const original = t.database.batch.bind(t.database); let raced = false;
    t.database.batch = async statements => {
      if (!raced && statements.some(statement => statement.sql.includes('INSERT OR IGNORE INTO plan_change_approvals'))) {
        raced = true;
        await t.repository.updatePlan(t.id, people.owner, t.before.version, {type:'item_edit', actor:people.owner.id,
          itemId:'matrix-venue', participants:[people.owner.id, people.editor.id], price:2500, allocation:'equal'});
      }
      return original(statements);
    };
    await decoded(await t.act({type:'approve', changeId:change.id, version:t.before.version, confirm:true}, 'editor'), 409);
    assert.equal(raced, true); assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM plan_change_approvals').get().n, 0);
    assert.equal((await t.current()).state.items[0].price, 2500);
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n, 0);
  });

  await check('Loss of owner access after review lookup cannot persist a cancellation', async t => {
    const {change} = await decoded(await t.act(t.recovery()));
    const original = t.database.prepare.bind(t.database); let raced = false;
    t.database.prepare = sql => {
      const statement = original(sql);
      if (!sql.includes("UPDATE plan_changes SET status='cancelled'")) return statement;
      return {bind(...values) { const bound = statement.bind(...values); return {...bound, run:async () => {
        if (!raced) { raced = true; t.database.sqlite.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?")
          .run(accounts.owner, t.id, people.owner.id); }
        return bound.run();
      }}; }};
    };
    await decoded(await t.act({type:'cancel', changeId:change.id, version:t.before.version, confirm:true}), 409);
    assert.equal(raced, true); assert.equal(t.database.sqlite.prepare('SELECT status FROM plan_changes WHERE id=?').get(change.id).status, 'review');
    assert.equal(t.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_operations').get().n, 0); assert.equal(calls, 0);
  });

  console.log(`${checks} multi-user recovery and departure checks passed; simulated identities, real SQLite/HTTP handlers, intercepted Bedrock only.`);
} finally {
  rmSync(directory, {recursive:true, force:true}); delete globalThis.bedrockMultiuserEnv;
}
