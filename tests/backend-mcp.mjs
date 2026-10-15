import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePlanMcp } from '../lib/plan-mcp.ts';
import { planningSkill } from '../lib/planrecover-skill.ts';
import { PlanRepository } from '../lib/plan-repository.ts';
import { BackendError } from '../lib/backend-errors.ts';
import { applyAction, personalMoney, fixtureReceipt } from '../lib/model.ts';
import { addPerson } from '../lib/people.ts';
import { createTestD1 } from './helpers/d1.mjs';

const origin = 'https://planrecover.test';
const alice = { id: 'person-mcp-alice', name: 'Alice' };
const bob = { id: 'person-mcp-bob', name: 'Bob' };
const stranger = { id: 'person-mcp-stranger', name: 'Stranger' };
let checks = 0;
let providerCalls = 0;
globalThis.fetch = async () => { providerCalls += 1; throw new Error('MCP tests cannot call live providers.'); };

function request(message, { headers = {}, raw } = {}) {
  return new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: raw ?? JSON.stringify(message),
  });
}
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function decoded(response, status = 200) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('Cache-Control') ?? '', /private/);
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
  const message = await response.json();
  assert.equal(message.jsonrpc, '2.0');
  assert.ok('id' in message);
  assert.ok(('result' in message) !== ('error' in message));
  return message;
}
async function check(name, callback) {
  await callback();
  checks += 1;
  console.log(`PASS ${name}`);
}
const neverResolve = async () => { throw new Error('Static MCP discovery must not resolve an authenticated data context.'); };

await check('July 2026 discovery and tool calls validate request metadata and preserve legacy clients', async () => {
  const modern=(method,params={},headers={})=>request(rpc(method,{...params,_meta:{
    'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':{},
    'io.modelcontextprotocol/clientInfo':{name:'Modern agent',version:'1'},
  }}),{headers:{'mcp-protocol-version':'2026-07-28','mcp-method':method,
    ...(params.name?{'mcp-name':params.name}:params.uri?{'mcp-name':params.uri}:{}),...headers}});
  const discover=await decoded(await handlePlanMcp(modern('server/discover'),neverResolve));
  assert.equal(discover.result.resultType,'complete');
  assert.deepEqual(discover.result.supportedVersions,['2026-07-28']);
  assert.equal(discover.result._meta['io.modelcontextprotocol/serverInfo'].name,'PlanRecover');
  const tools=await decoded(await handlePlanMcp(modern('tools/list'),neverResolve));
  assert.equal(tools.result.tools.length,9);
  assert.equal(tools.result.tools.find(t=>t.name==='prepare_plan').annotations.readOnlyHint,false);
  assert.equal(tools.result.resultType,'complete');
  const resource=await decoded(await handlePlanMcp(modern('resources/read',{uri:'planrecover://skills/planning'},
    {'mcp-name':'=?base64?'+btoa('planrecover://skills/planning')+'?='}),neverResolve));
  assert.equal(resource.result.contents[0].text,planningSkill);
  const mismatch=await decoded(await handlePlanMcp(modern('tools/list',{}, {'mcp-method':'tools/call'}),neverResolve),400);
  assert.equal(mismatch.error.code,-32020);
  const missingName=await decoded(await handlePlanMcp(modern('tools/call',{name:'list_plans',arguments:{}},{'mcp-name':''}),neverResolve),400);
  assert.equal(missingName.error.code,-32020);
  const unsupported=await decoded(await handlePlanMcp(modern('tools/list',{}, {'mcp-protocol-version':'2099-01-01'}),neverResolve),400);
  assert.equal(unsupported.error.code,-32022);
  assert.ok(unsupported.error.data.supported.includes('2026-07-28'));
  const database=createTestD1();
  try {
    const repository=new PlanRepository(database);
    const created=await repository.createPlan('modern-mcp-alice',alice,{name:'Modern private plan',destination:'Toronto, Canada',
      start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:30000});
    const money=await decoded(await handlePlanMcp(modern('tools/call',{name:'get_my_money',arguments:{planId:created.state.plan.id}}),
      async()=>({identity:alice,repository})));
    assert.equal(money.result.resultType,'complete');
    assert.equal(money.result.structuredContent.amounts.cost,0);
    const anonymous=await decoded(await handlePlanMcp(modern('tools/call',{name:'list_plans',arguments:{}}),
      async()=>{throw new BackendError('AUTH_REQUIRED','Sign in.',401);}),401);
    assert.equal(anonymous.error.code,-32000);
  } finally {database.close();}
});

await check('MCP initialization, discovery and the matching Agent Skill remain public and read-only', async () => {
  const initialized = await decoded(await handlePlanMcp(request(rpc('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Test Alexa Client', version: '1.0' },
  })), neverResolve));
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.equal(initialized.result.serverInfo.name, 'PlanRecover');
  assert.ok(initialized.result.capabilities.tools);
  for (const protocolVersion of ['2025-06-18', '2025-03-26']) {
    const negotiated = await decoded(await handlePlanMcp(request(rpc('initialize', {
      protocolVersion, capabilities: {}, clientInfo: { name: 'Older Test Client', version: '1.0' },
    }), { headers: { 'mcp-protocol-version': protocolVersion } }), neverResolve));
    assert.equal(negotiated.result.protocolVersion, protocolVersion);
  }
  const listed = await decoded(await handlePlanMcp(request(rpc('tools/list')), neverResolve));
  assert.deepEqual(listed.result.tools.map(tool => tool.name).sort(), ['compare_recovery_options','get_change_status','get_decisions','get_my_money','get_plan','list_plans','prepare_plan','prepare_plan_action','prepare_plan_change']);
  for (const tool of listed.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, !tool.name.startsWith('prepare_'));
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const resources = await decoded(await handlePlanMcp(request(rpc('resources/list')), neverResolve));
  assert.equal(resources.result.resources.length, 1);
  assert.equal(resources.result.resources[0].uri, 'planrecover://skills/planning');
  const resource = await decoded(await handlePlanMcp(request(rpc('resources/read', { uri: 'planrecover://skills/planning' })), neverResolve));
  assert.equal(resource.result.contents[0].mimeType, 'text/markdown');
  assert.equal(resource.result.contents[0].text, planningSkill);
  const file = readFileSync(new URL('../public/agent-skills/planrecover-planning/SKILL.md', import.meta.url), 'utf8');
  assert.equal(file.replaceAll('\r\n', '\n').trimEnd(), planningSkill.replaceAll('\r\n', '\n').trimEnd());
  assert.deepEqual((await decoded(await handlePlanMcp(request(rpc('ping')), neverResolve))).result, {});
  const notification = await handlePlanMcp(request({ jsonrpc: '2.0', method: 'notifications/initialized' }), neverResolve);
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
});

await check('MCP rejects malformed transport, batches, unknown operations and invalid tool arguments before data access', async () => {
  const malformed = await decoded(await handlePlanMcp(request({}, { raw: '{not-json' }), neverResolve), 400);
  assert.equal(malformed.error.code, -32700);
  const batch = await decoded(await handlePlanMcp(request([rpc('ping')]), neverResolve), 400);
  assert.equal(batch.error.code, -32600);
  await decoded(await handlePlanMcp(request(rpc('ping'), { headers: { 'Content-Type': 'text/plain' } }), neverResolve), 415);
  await decoded(await handlePlanMcp(request(rpc('ping'), { headers: { Accept: 'text/event-stream' } }), neverResolve), 406);
  await decoded(await handlePlanMcp(request(rpc('ping'), { headers: { Accept: 'application/json' } }), neverResolve), 406);
  await decoded(await handlePlanMcp(request(rpc('ping'), { headers: { Accept: '*/*' } }), neverResolve), 406);
  await decoded(await handlePlanMcp(request(rpc('ping'), { headers: { Origin: 'https://another.example' } }), neverResolve), 403);
  await decoded(await handlePlanMcp(request(rpc('ping'), { headers: { 'mcp-protocol-version': '1900-01-01' } }), neverResolve), 400);
  const unknown = await decoded(await handlePlanMcp(request(rpc('payments/create', {})), neverResolve));
  assert.equal(unknown.error.code, -32601);
  const mutation = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'create_payment', arguments: {} })), neverResolve));
  assert.equal(mutation.error.code, -32602);
  const invalid = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'get_plan', arguments: { planId: 'valid-id', actor: bob.id } })), neverResolve));
  assert.equal(invalid.error.code, -32602);
  const badList = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'list_plans', arguments: { owner: 'another-account' } })), neverResolve));
  assert.equal(badList.error.code, -32602);
  const tooLarge = await decoded(await handlePlanMcp(request({}, { raw: JSON.stringify({ payload: 'x'.repeat(66000) }) }), neverResolve), 413);
  assert.equal(tooLarge.error.code, -32000);
});

await check('MCP data calls require authentication and preserve private plan access', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const first = await repository.createPlan('mcp-alice-account', alice, {
      name: 'Alice private plan', destination: 'Toronto, Ontario, Canada', start: '2027-04-04', end: '2027-04-06',
      timezone: 'America/Toronto', currency: 'CAD', budget: 50000,
    });
    const planId = first.state.plan.id;
    const anonymous = async () => { throw new BackendError('AUTH_REQUIRED', 'Sign in to read saved plans.', 401); };
    const authRequired = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'get_plan', arguments: { planId } })), anonymous), 401);
    assert.equal(authRequired.error.code, -32000);
    const missing = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'get_plan', arguments: { planId } })), async () => ({ identity: stranger, repository })));
    assert.equal(missing.result.isError, true);
    assert.equal(missing.result.structuredContent, undefined);
    assert.ok(!JSON.stringify(missing.result).includes('Alice private plan'));
    const listed = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'list_plans', arguments: {} })), async () => ({ identity: stranger, repository })));
    assert.deepEqual(listed.result.structuredContent.plans, []);
    const owned = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'list_plans', arguments: {} })), async () => ({ identity: alice, repository })));
    assert.ok(owned.result.structuredContent.plans.some(plan => plan.id === planId));
    assert.ok(owned.result.structuredContent.plans.every(plan => !('owner' in plan) && !('preferences' in plan)));
  } finally {
    database.close();
  }
});

await check('MCP money and decisions use the caller identity and never mutate saved data or call providers', async () => {
  const database = createTestD1();
  try {
    const repository = new PlanRepository(database);
    const created = await repository.createPlan('mcp-alice-account', alice, {
      name: 'Shared MCP plan', destination: 'Toronto, Ontario, Canada', start: '2027-04-04', end: '2027-04-06',
      timezone: 'America/Toronto', currency: 'CAD', budget: 50000,
    });
    const planId = created.state.plan.id;
    let state = await repository.loadWorkspace('mcp-alice-account');
    addPerson(state, bob, 'editor');
    state.preferences[bob.id] = { budget: 27931, cash: 13917, reserve: 431, financing: 4971, pace: 'relaxed', interests: ['private-bob-interest'], paypalMe: '' };
    state = applyAction(state, {
      type: 'add_item', actor: alice.id, name: 'Paid museum visit', category: 'Activity',
      start: '2027-04-04T10:00:00-04:00', duration: 60, price: 10000, participants: [alice.id, bob.id],
    });
    const paid = state.items[0];
    paid.status = 'scheduled'; paid.approvals = [alice.id, bob.id]; paid.paid = [alice.id, bob.id];
    state.events.push({
      id: 'mcp-payment', itemId: paid.id, kind: 'expense', label: 'Reviewed museum expense', shares: paid.shares,
      contributions: { [alice.id]: 10000 }, amount: 10000, status: 'confirmed', evidence: 'Manual confirmed expense', mode: 'manual', created: '2027-04-04T12:00:00Z',
    });
    state.events.push({
      id: 'mcp-refund', itemId: paid.id, kind: 'refund', label: 'Pending museum refund', shares: { [alice.id]: -500, [bob.id]: -500 },
      contributions: { [alice.id]: -1000 }, amount: -1000, status: 'pending', evidence: 'Expected refund only', mode: 'manual', created: '2027-04-04T13:00:00Z',
    });
    state = applyAction(state, {
      type: 'add_item', actor: alice.id, name: 'Dinner requires approval', category: 'Meal',
      start: '2027-04-04T18:00:00-04:00', duration: 60, price: 2000, participants: [alice.id, bob.id],
    });
    const pending = state.items.at(-1);
    pending.approvals = [bob.id];
    state.proposals.push({ id: 'mcp-proposal', kind: 'departure', title: 'Review the changed obligation', revision: 2, required: [alice.id, bob.id], approved: [bob.id], status: 'pending', snapshot: 'Saved proposal' });
    const receipt = fixtureReceipt();
    const attachmentKey = `${'a'.repeat(64)}/00000000-0000-4000-8000-000000000001`;
    receipt.id = 'receipt-private-attachment'; receipt.fileKey = attachmentKey; receipt.payer = alice.id;
    receipt.rows.forEach(row => { row.claims = [...new Set(row.claims.map(member => member === 'sam' ? alice.id : bob.id))]; });
    state.receipts.push(receipt);
    await repository.saveWorkspace('mcp-alice-account', state, state.version);
    const ownPreferences = { budget: 88888, cash: 17777, reserve: 1000, financing: 2111, pace: 'balanced', interests: ['museums'], paypalMe: '' };
    const previous = await repository.getPreferences(planId, alice);
    await repository.updatePreferences(planId, alice, ownPreferences, previous.version);
    const before = await repository.loadWorkspace('mcp-alice-account');
    let resolutions = 0;
    const resolve = async () => { resolutions += 1; return { identity: alice, repository }; };
    const money = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'get_my_money', arguments: { planId } })), resolve));
    const value = money.result.structuredContent;
    assert.equal(money.result.isError, false);
    assert.deepEqual(JSON.parse(money.result.content[0].text), value);
    assert.deepEqual(value.amounts, personalMoney(before, alice.id));
    assert.equal(value.amounts.cost, 5000);
    assert.equal(value.amounts.contribution, 10000);
    assert.equal(value.amounts.expectedRefund, 500);
    assert.deepEqual(value.privatePreferences, ownPreferences);
    assert.equal(value.currency, 'CAD');
    assert.equal(value.decimalPlaces, 2);
    assert.equal(value.demo, false);
    assert.match(value.fundingAvailability, /Unverified/);
    assert.ok(!JSON.stringify(value).includes('private-bob-interest'));
    assert.ok(!JSON.stringify(value).includes('27931'));
    const plan = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'get_plan', arguments: { planId } })), resolve));
    assert.equal(plan.result.structuredContent.preferences, undefined);
    assert.equal(plan.result.structuredContent.receipts, undefined);
    assert.ok(!JSON.stringify(plan.result).includes(attachmentKey));
    const decisions = await decoded(await handlePlanMcp(request(rpc('tools/call', { name: 'get_decisions', arguments: { planId } })), resolve));
    assert.deepEqual(decisions.result.structuredContent.approvals.map(item => item.itemId), [pending.id]);
    assert.equal(decisions.result.structuredContent.approvals[0].share, 1000);
    assert.deepEqual(decisions.result.structuredContent.proposals.map(proposal => proposal.id), ['mcp-proposal']);
    assert.equal(resolutions, 3, 'Every data call resolves fresh membership context');
    assert.deepEqual(await repository.loadWorkspace('mcp-alice-account'), before);
    assert.equal(providerCalls, 0);
  } finally {
    database.close();
  }
});

console.log(`${checks} authenticated MCP integration checks passed against real persisted plans.`);
