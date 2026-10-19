import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {ConversationRepository} from '../lib/conversations.ts';
import {PlanChangeService} from '../lib/plan-changes.ts';
import {accountPersonId, addPerson} from '../lib/people.ts';
import {applyAction} from '../lib/model.ts';
import {extractReceipt} from '../lib/receipt-extraction.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const {build} = require(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root, 'build'), {recursive:true});
const directory = mkdtempSync(join(root, 'build', 'bedrock-workflows-'));
const origin = 'https://planrecover.test';
const owner = 'workflow-owner', other = 'workflow-member';
const alice = {id:await accountPersonId(owner), name:'Alice'};
const bob = {id:await accountPersonId(other), name:'Bob'};
const configuration = {
  AWS_BEARER_TOKEN_BEDROCK:'fixture-key', BEDROCK_REGION:'ca-central-1',
  BEDROCK_REQUIRE_APPLICATION_PROFILE:'true',
  BEDROCK_MODEL_ID:'arn:aws:bedrock:ca-central-1:123456789012:application-inference-profile/fixture',
};
globalThis.bedrockWorkflowTestEnv = {};
let provider, calls = 0, checks = 0;
globalThis.fetch = async (...args) => { calls += 1; return provider(...args); };

function request(path, body, account = owner, extraHeaders = {}) {
  return new Request(origin + path, {
    method:body === undefined ? 'GET' : 'POST',
    headers:{origin, 'content-type':'application/json', ...(account ? {'oai-authenticated-user-id':account} : {}), ...extraHeaders},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
}
async function decoded(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  if (status === 200) assert.match(response.headers.get('cache-control'), /private, no-store/);
  return value;
}
const tool = (name, input, toolUseId = name) => ({toolUse:{toolUseId, name, input}});
const model = (content, stopReason = 'tool_use') => Response.json({
  output:{message:{role:'assistant', content}}, stopReason,
  usage:{inputTokens:80, outputTokens:40, totalTokens:120},
});
const results = body => body.messages.at(-1).content.map(block => block.toolResult);
const completion = text => model([{text}], 'end_turn');

try {
  const routes = {};
  for (const [name, path] of Object.entries({assistant:'app/api/assistant/route.ts', proposals:'app/api/agent-proposals/route.ts'})) {
    const outfile = join(directory, name + '.mjs');
    await build({entryPoints:[resolve(root, path)], outfile, bundle:true, platform:'node', format:'esm',
      target:'node24', packages:'external', logLevel:'silent', tsconfig:resolve(root, 'tsconfig.json'),
      plugins:[{name:'workflow-bindings', setup(builder) {
        builder.onResolve({filter:/^cloudflare:workers$/}, () => ({path:'env', namespace:'workflow-test'}));
        builder.onLoad({filter:/.*/, namespace:'workflow-test'}, () => ({contents:'export const env=globalThis.bedrockWorkflowTestEnv;', loader:'js'}));
      }}],
    });
    routes[name] = await import(pathToFileURL(outfile).href);
  }

  async function check(name, run) {
    const database = createTestD1();
    for (const key of Object.keys(globalThis.bedrockWorkflowTestEnv)) delete globalThis.bedrockWorkflowTestEnv[key];
    Object.assign(globalThis.bedrockWorkflowTestEnv, configuration, {DB:database});
    calls = 0;
    provider = async () => { throw Error('An offline workflow must select a fixture response.'); };
    try {
      const repository = new PlanRepository(database);
      const created = await repository.createPlan(owner, alice, {name:'Synthetic workflow acceptance', destination:'Toronto',
        start:'2027-04-04', end:'2027-04-04', timezone:'America/Toronto', currency:'CAD', budget:5000});
      let state = await repository.loadWorkspace(owner);
      addPerson(state, bob, 'editor');
      state.preferences[bob.id] = {...state.preferences[alice.id], budget:987654321, cash:456789123,
        interests:['PRIVATE_OTHER_MEMBER_SENTINEL'], paypalMe:'https://paypal.me/private-workflow-sentinel'};
      state = applyAction(state, {type:'add_item', actor:alice.id, name:'Synthetic shared venue', category:'Activity',
        start:'2027-04-04T10:00:00-04:00', duration:60, price:2000, participants:[alice.id, bob.id]});
      state.items[0].id = 'synthetic-shared-venue';
      await repository.saveWorkspace(owner, state, state.version);
      const id = created.state.plan.id, record = await repository.getPlan(id, alice);
      const conversations = new ConversationRepository(database);
      const session = await conversations.create(owner, alice, id);
      const send = (message, requestId = crypto.randomUUID()) => routes.assistant.POST(request('/api/assistant', {
        planId:id, agent:true, message, conversationId:session.id, conversationVersion:session.version, requestId,
      }));
      const before = structuredClone(record.state), planCount = (await repository.listPlans(alice.id)).length;
      const effectTables = ['financial_events', 'provider_operations', 'plan_change_approvals'];
      const effectCounts = Object.fromEntries(effectTables.map(table => [table, database.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));
      const unchanged = async () => {
        assert.deepEqual((await repository.getPlan(id, alice)).state, before);
        for (const table of effectTables)
          assert.equal(database.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, effectCounts[table], table);
      };
      await run({database, repository, record, id, conversations, session, send, unchanged, planCount});
      checks += 1;
      console.log('PASS ' + name);
    } finally { database.close(); }
  }

  await check('A multiround action preview uses saved IDs, restores its private review and replays once without applying it',
    async ({database, repository, record, id, conversations, session, send, unchanged, planCount}) => {
      let round = 0, reviewUrl, proposalId;
      provider = async (url, init) => {
        assert.match(String(url), /^https:\/\/bedrock-runtime\.ca-central-1\.amazonaws\.com\/model\//);
        assert.ok(!init.body.includes('PRIVATE_OTHER_MEMBER_SENTINEL'));
        assert.ok(!init.body.includes('private-workflow-sentinel'));
        assert.ok(!init.body.includes('987654321'));
        const body = JSON.parse(init.body);
        if (++round === 1) {
          const context = JSON.parse(body.messages[0].content[0].text);
          assert.equal(context.facts.plan.version, record.version);
          assert.equal(context.callerMemberId, alice.id);
          return model([tool('prepare_plan_action', {planId:context.facts.plan.id, version:context.facts.plan.version,
            action:{type:'add_item', name:'Synthetic packing check', category:'Preparation',
              start:'2027-04-04T09:00:00-04:00', duration:15, price:0,
              participants:[context.callerMemberId], taskOwner:context.callerMemberId}})]);
        }
        const [result] = results(body);
        assert.equal(result.status, 'success');
        const saved = result.content[0].json;
        assert.equal(saved.applied, false);
        assert.equal(saved.status, 'review');
        assert.equal(saved.review.requiresReview, true);
        assert.equal(saved.review.planVersion, record.version);
        assert.match(saved.reviewUrl, /^\/flows\?proposal=[a-f0-9-]{36}$/);
        ({reviewUrl, proposalId} = saved);
        assert.equal(database.sqlite.prepare('SELECT status FROM agent_proposals WHERE id=?').get(proposalId).status, 'review');
        return completion(`The synthetic packing check awaits review: ${reviewUrl}`);
      };
      const requestId = crypto.randomUUID();
      const first = await decoded(await send('Prepare a free synthetic packing check for review only.', requestId));
      assert.equal(first.mode, 'bedrock');
      assert.equal(first.prepared.length, 1);
      assert.equal(first.prepared[0].result.proposalId, proposalId);
      assert.equal(first.financialEffects, false);
      assert.equal(first.planUnchanged, true);
      const restored = await conversations.read(owner, alice, session.id);
      assert.equal(restored.messages.at(-1).metadata.prepared[0].result.reviewUrl, reviewUrl);
      const review = await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + proposalId)));
      assert.equal(review.preview.action.name, 'Synthetic packing check');
      assert.equal(review.status, 'review');
      await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + proposalId, undefined, other)), 404);
      await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + proposalId, undefined, null)), 401);
      const replay = await decoded(await send('Prepare a free synthetic packing check for review only.', requestId));
      assert.equal(replay.duplicate, true);
      assert.equal(replay.prepared[0].result.proposalId, proposalId);
      assert.equal(calls, 2);
      assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n, 1);
      assert.equal((await repository.listPlans(alice.id)).length, planCount);
      await unchanged();
    });

  await check('Recovery compare then prepare finishes, survives reload and replay, and leaves every approval and booking untouched',
    async ({database, record, id, conversations, session, send, unchanged}) => {
      const change = {type:'recovery', version:record.version, itemIds:['synthetic-shared-venue'], option:'cancel', replacements:[]};
      let round = 0, figures, changeId;
      provider = async (_url, init) => {
        const body = JSON.parse(init.body);
        if (++round === 1) return model([tool('compare_recovery_options', {planId:id, change})]);
        const [result] = results(body);
        assert.equal(result.status, 'success');
        const saved = result.content[0].json;
        if (round === 2) {
          figures = saved.figures;
          assert.deepEqual(saved.affected, [{id:'synthetic-shared-venue', name:'Synthetic shared venue'}]);
          assert.equal(figures.expectedRefund, 0);
          assert.equal(figures.newPaymentNow, 0);
          assert.equal(figures.finalTotal, 0);
          assert.equal(saved.review.requiresReview, true);
          return model([tool('prepare_plan_change', {planId:id, change})]);
        }
        assert.deepEqual(saved.figures, figures);
        assert.equal(saved.status, 'review');
        assert.equal(saved.applied, false);
        assert.deepEqual(saved.required, [alice.id, bob.id].sort());
        assert.equal(saved.reviewUrl, '/flows?plan=' + encodeURIComponent(id));
        changeId = saved.changeId;
        return completion(`Your cancellation proposal awaits affected-member review: ${saved.reviewUrl}`);
      };
      const message = 'Compare cancelling the synthetic shared venue, then prepare it for review without applying or approving it.';
      const requestId = crypto.randomUUID();
      const first = await decoded(await send(message, requestId));
      assert.equal(first.mode, 'bedrock');
      assert.deepEqual(first.prepared.map(entry => entry.name), ['compare_recovery_options', 'prepare_plan_change']);
      assert.equal(first.prepared[1].result.changeId, changeId);
      const restored = await conversations.read(owner, alice, session.id);
      assert.equal(restored.messages.at(-1).metadata.prepared[1].result.changeId, changeId);
      const saved = await new PlanChangeService(database).get(id, alice, changeId);
      assert.deepEqual(saved.approved, []);
      assert.equal(saved.status, 'review');
      assert.equal(saved.fullyApproved, false);
      const replay = await decoded(await send(message, requestId));
      assert.equal(replay.duplicate, true);
      assert.equal(replay.prepared[1].result.changeId, changeId);
      assert.equal(calls, 3);
      assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 1);
      await unchanged();
    });

  await check('An unrelated recovery created during inference still invalidates the answer while retaining the caller preview',
    async ({database, record, id, conversations, session, send, unchanged}) => {
      const change = {type:'recovery', version:record.version, itemIds:['synthetic-shared-venue'], option:'cancel', replacements:[]};
      let round = 0, preparedId;
      provider = async (_url, init) => {
        if (++round === 1) return model([tool('prepare_plan_change', {planId:id, change})]);
        const [result] = results(JSON.parse(init.body));
        assert.equal(result.status, 'success');
        preparedId = result.content[0].json.changeId;
        await new PlanChangeService(database).propose(id, bob, {...change, option:'keep'});
        return completion('STALE_SYNTHETIC_RECOVERY_REPLY');
      };
      const value = await decoded(await send('Prepare a cancellation review for the synthetic venue only.'), 409);
      assert.ok(!JSON.stringify(value).includes('STALE_SYNTHETIC_RECOVERY_REPLY'));
      const restored = await conversations.read(owner, alice, session.id);
      assert.equal(restored.messages.some(message => message.role === 'assistant'), false);
      assert.equal(restored.messages[0].mode, 'interrupted');
      assert.equal(restored.prepared[0].result.changeId, preparedId);
      assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM plan_changes').get().n, 2);
      assert.equal(database.sqlite.prepare('SELECT lease_until FROM assistant_conversations WHERE id=?').get(session.id).lease_until, 0);
      await unchanged();
    });

  await check('A joined editor keeps actor-private action previews while the usage and readback proof belong to the shared plan owner',
    async ({database, record, id, conversations, unchanged}) => {
      const session = await conversations.create(owner, bob, id);
      let round = 0;
      provider = async (_url, init) => {
        const body = JSON.parse(init.body);
        if (++round === 1) {
          const context = JSON.parse(body.messages[0].content[0].text);
          assert.equal(context.callerMemberId, bob.id);
          return model([tool('prepare_plan_action', {planId:id, version:record.version, action:{type:'add_item',
            name:'Joined editor synthetic task', category:'Preparation', start:'2027-04-04T09:00:00-04:00',
            duration:15, price:0, participants:[bob.id], taskOwner:bob.id}})]);
        }
        const [result] = results(body);
        assert.equal(result.status, 'success');
        return completion(`Your private task preview awaits review: ${result.content[0].json.reviewUrl}`);
      };
      const value = await decoded(await routes.assistant.POST(request('/api/assistant', {planId:id, agent:true,
        message:'Prepare my free synthetic task for review only.', conversationId:session.id,
        conversationVersion:session.version, requestId:crypto.randomUUID()}, other)));
      assert.equal(value.mode, 'bedrock');
      assert.equal(value.prepared.length, 1);
      const proposalId = value.prepared[0].result.proposalId;
      assert.equal(database.sqlite.prepare('SELECT owner FROM agent_proposals WHERE id=?').get(proposalId).owner, other);
      const review = await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + proposalId, undefined, other)));
      assert.equal(review.preview.action.taskOwner, bob.id);
      await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + proposalId)), 404);
      const restored = await conversations.read(owner, bob, session.id);
      assert.equal(restored.messages.at(-1).metadata.prepared[0].result.proposalId, proposalId);
      const operation = database.sqlite.prepare("SELECT owner,member_id,plan_id,state FROM bedrock_operations WHERE feature='agent'").get();
      assert.deepEqual({...operation}, {owner, member_id:bob.id, plan_id:id, state:'succeeded'});
      const proof = database.sqlite.prepare("SELECT owner,member_id,plan_id FROM bedrock_workflow_evidence WHERE feature='agent'").get();
      assert.deepEqual({...proof}, {owner, member_id:bob.id, plan_id:id});
      assert.equal(calls, 2);
      await unchanged();
    });

  await check('An invitation editor can read and list a private preview after leaving the share link, with legacy ownership and revoked-membership fences',
    async ({database, record, id, conversations, unchanged}) => {
      const token = 'a'.repeat(64);
      const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
      database.sqlite.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)')
        .run(tokenHash, token, owner, id, 'editor', new Date().toISOString(), new Date(Date.now() + 3600000).toISOString());
      const session = await conversations.create(owner, bob, id);
      let round = 0;
      provider = async (_url, init) => {
        if (++round === 1) return model([tool('prepare_plan_action', {planId:id, version:record.version, action:{
          type:'add_item', name:'Invitation editor synthetic task', category:'Preparation',
          start:'2027-04-04T09:00:00-04:00', duration:15, price:0, participants:[bob.id], taskOwner:bob.id,
        }})]);
        const [result] = results(JSON.parse(init.body));
        assert.equal(result.status, 'success');
        return completion(`Your private synthetic review is ready: ${result.content[0].json.reviewUrl}`);
      };
      const value = await decoded(await routes.assistant.POST(request('/api/assistant', {planId:id, agent:true,
        message:'Prepare my free synthetic task through this shared plan, without applying it.',
        conversationId:session.id, conversationVersion:session.version, requestId:crypto.randomUUID()},
      other, {'x-trip-share':token})));
      assert.equal(value.mode, 'bedrock');
      assert.equal(value.prepared.length, 1);
      const proposalId = value.prepared[0].result.proposalId;
      assert.equal(database.sqlite.prepare('SELECT owner,member_id FROM agent_proposals WHERE id=?').get(proposalId).owner, other);
      const restored = await conversations.read(owner, bob, session.id);
      assert.equal(restored.messages.at(-1).metadata.prepared[0].result.proposalId, proposalId);

      // /flows leaves the invitation hash behind. All reads below deliberately omit its header.
      const review = await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + proposalId, undefined, other)));
      assert.equal(review.preview.action.taskOwner, bob.id);
      const legacyId = crypto.randomUUID();
      database.sqlite.prepare('INSERT INTO agent_proposals(id,owner,member_id,plan_id,body,plan_version,created) VALUES (?,?,?,?,?,?,?)')
        .run(legacyId, owner, bob.id, id, JSON.stringify(review.preview), record.version, new Date().toISOString());
      const legacy = await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + legacyId, undefined, other)));
      assert.equal(legacy.preview.action.taskOwner, bob.id);
      assert.equal(database.sqlite.prepare('SELECT owner FROM agent_proposals WHERE id=?').get(legacyId).owner, owner);
      assert.equal('owner' in legacy, false);
      const listed = await decoded(await routes.proposals.GET(request('/api/agent-proposals', undefined, other)));
      assert.deepEqual(listed.proposals.map(proposal => proposal.id).sort(), [proposalId, legacyId].sort());
      for (const inaccessible of [proposalId, legacyId])
        await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + inaccessible)), 404);
      const ownerList = await decoded(await routes.proposals.GET(request('/api/agent-proposals')));
      assert.equal(ownerList.proposals.some(proposal => [proposalId, legacyId].includes(proposal.id)), false);
      const operation = database.sqlite.prepare("SELECT owner,member_id,plan_id FROM bedrock_operations WHERE feature='agent'").get();
      assert.deepEqual({...operation}, {owner, member_id:bob.id, plan_id:id});
      assert.equal(calls, 2);

      database.sqlite.prepare("UPDATE plan_members SET role='legacy' WHERE owner=? AND plan_id=? AND member_id=?").run(owner, id, bob.id);
      for (const inaccessible of [proposalId, legacyId])
        await decoded(await routes.proposals.GET(request('/api/agent-proposals?id=' + inaccessible, undefined, other)), 404);
      const revokedList = await decoded(await routes.proposals.GET(request('/api/agent-proposals', undefined, other)));
      assert.equal(revokedList.proposals.some(proposal => [proposalId, legacyId].includes(proposal.id)), false);
      await unchanged();
    });

  for (const [name, input] of [
    ['a stale plan version', ({id, record}) => ({planId:id, version:record.version + 1, action:{type:'task', itemId:'synthetic-shared-venue', done:true}})],
    ['an invented item ID', ({id, record}) => ({planId:id, version:record.version, action:{type:'task', itemId:'invented-item', done:true}})],
    ['an invented participant', ({id, record}) => ({planId:id, version:record.version, action:{type:'add_item', name:'Invalid participant', category:'Preparation', start:'2027-04-04T09:00:00-04:00', duration:15, price:0, participants:['invented-member']}})],
    ['an invented task owner', ({id, record}) => ({planId:id, version:record.version, action:{type:'add_item', name:'Invalid owner', category:'Preparation', start:'2027-04-04T09:00:00-04:00', duration:15, price:0, participants:[alice.id], taskOwner:'invented-member'}})],
    ['an unbound plan', ({record}) => ({planId:'unbound-plan', version:record.version, action:{type:'task', itemId:'synthetic-shared-venue', done:true}})],
    ['a financial approval action', ({id, record}) => ({planId:id, version:record.version, action:{type:'approve_item', itemId:'synthetic-shared-venue', revision:1}})],
    ['unknown action fields', ({id, record}) => ({planId:id, version:record.version, action:{type:'task', itemId:'synthetic-shared-venue', done:true, executePayment:true}})],
  ]) {
    await check(`Agent tool rejects ${name} before saving a review`, async context => {
      let round = 0;
      provider = async (_url, init) => {
        if (++round === 1) return model([tool('prepare_plan_action', input(context))]);
        const [result] = results(JSON.parse(init.body));
        assert.equal(result.status, 'error');
        assert.deepEqual(result.content[0].json, {error:'This preview could not be prepared. Check current details in PlanRecover.'});
        return completion('Check the current plan details before preparing this review.');
      };
      const value = await decoded(await context.send('Prepare the requested synthetic preview, awaiting my review.'));
      assert.deepEqual(value.prepared, []);
      assert.equal(context.database.sqlite.prepare('SELECT COUNT(*) n FROM agent_proposals').get().n, 0);
      await context.unchanged();
    });
  }

  await check('PDF extraction preserves multiline arithmetic and rejects nested action data without coercion', async ({unchanged}) => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n%synthetic fixture\n%%EOF');
    const facts = {merchant:'FixtureCafe', date:'2026-10-19', currency:'CAD', items:[
      {name:'Coffee', amountCents:500, quantityMilli:1000, unitPriceCents:500, lineDiscountCents:0},
      {name:'Sandwich', amountCents:1200, quantityMilli:1000, unitPriceCents:1200, lineDiscountCents:0},
    ], taxCents:195, tipCents:300, discountCents:200, totalCents:1995, flags:['Synthetic test; no money paid.']};
    let acquired = 0, released = 0, fetches = 0;
    const run = value => extractReceipt(configuration, {mime:'application/pdf', bytes}, 'CAD', {
      acquire:async () => { acquired += 1; return async () => { released += 1; }; },
      fetch:async (_url, init) => {
        fetches += 1;
        const requestBody = JSON.parse(init.body), content = requestBody.messages[0].content;
        assert.equal(content[1].document.format, 'pdf');
        assert.equal(content[1].document.name, 'Receipt');
        assert.equal(content[1].document.source.bytes, Buffer.from(bytes).toString('base64'));
        assert.equal(content.some(part => part.image), false);
        return model([{text:JSON.stringify(value)}], 'end_turn');
      },
    });
    const extracted = await run(facts);
    assert.deepEqual(extracted.facts, facts);
    assert.equal(extracted.provider, 'bedrock');
    assert.ok(!extracted.warnings.some(value => value.includes('do not reconcile')));
    assert.ok(extracted.warnings.some(value => value.includes('Review all extracted values')));
    const mismatch = await run({...facts, totalCents:2195});
    assert.equal(mismatch.facts.totalCents, 2195);
    assert.ok(mismatch.warnings.some(value => value.includes('do not reconcile')));
    const invalid = await run({...facts, items:[{...facts.items[0], approve:true}]});
    assert.equal(invalid.facts, null);
    assert.equal(invalid.failed, true);
    assert.equal(acquired, 3); assert.equal(released, 3); assert.equal(fetches, 3);
    const malformed = await extractReceipt(configuration, {mime:'application/pdf', bytes:new TextEncoder().encode('not-a-pdf')}, 'CAD', {
      acquire:async () => { throw Error('Invalid document must fail before acquiring model quota.'); },
      fetch:async () => { throw Error('Invalid document must not leave the application.'); },
    });
    assert.equal(malformed.failed, true);
    assert.equal(malformed.facts, null);
    await unchanged();
  });

  console.log(`${checks} authenticated Bedrock workflow checks passed; all provider responses are offline fixtures.`);
} finally {
  rmSync(directory, {recursive:true, force:true});
  delete globalThis.bedrockWorkflowTestEnv;
}
