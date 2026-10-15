import assert from 'node:assert/strict';
import { approvedCheckoutAmount, approvedFullRefund, requirePaymentActor, requirePayPalCurrency, verifiedOrderCapture, requireCaptureEventMatch, providerCents, dataTripId } from '../lib/payment-guards.ts';

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const ids = ['sam', 'alex', 'maya', 'chris'];
const plan = { id: 'trip-a', currency: 'CAD', template: 'algonquin', destination: 'Algonquin area, Ontario' };
const item = () => ({
  id: 'hike', name: 'Hike', source: 'Fictional demo merchant · fixed quote', price: 36000,
  revision: 1, participants: [...ids], shares: Object.fromEntries(ids.map(id => [id, 9000])),
  approvals: [...ids], required: [...ids], paid: [], status: 'awaiting-payment', expires: null,
});
const operation = () => ({ id: 'operation-a', owner: 'owner-a', item_id: 'hike', member: 'sam', revision: 1, kind: 'order', amount: 9000, status: 'captured', payload: JSON.stringify({ planrecoverTripId: 'trip-a' }), provider_id: 'ORDERA' });
const order = () => ({ id: 'ORDERA', status: 'COMPLETED', purchase_units: [{ reference_id: 'hike', custom_id: 'operation-a', payments: { captures: [{ id: 'CAPTUREA', status: 'COMPLETED', amount: { currency_code: 'CAD', value: '90.00' } }] } }] });
const expense = () => ({ id: 'paypal-CAPTUREA', itemId: 'hike', kind: 'expense', mode: 'sandbox', status: 'confirmed', amount: 9000, shares: { sam: 9000 }, contributions: { sam: 9000 }, providerId: 'CAPTUREA' });
const proposal = () => ({ id: 'proposal-a', kind: 'recovery', status: 'executed', revision: 1, required: [...ids], approved: [...ids], option: 'replace', snapshot: JSON.stringify({ groupFinal: 102000, eachFinal: 25500, groupRefund: 36000, eachRefund: 9000, cash: 10500, extra: 1500 }) });
const refundTrip = () => ({ plan: { ...plan }, items: [{ ...item(), status: 'cancelled' }], events: [expense()], proposals: [proposal()] });

test('Adapter refuses non-CAD plans instead of silently charging CAD', () => {
  requirePayPalCurrency(plan);
  requirePayPalCurrency({}); // Legacy plans were always CAD.
  for (const currency of ['USD', 'JPY', 'cad', '']) assert.throws(() => requirePayPalCurrency({ currency }), /CAD/);
});
test('Checkout uses the current exact server-side approved share', () => {
  assert.equal(approvedCheckoutAmount({ plan }, item(), 'sam', 1), 9000);
  assert.throws(() => approvedCheckoutAmount({ plan }, item(), 'sam', 2), /latest approved/);
  for (const change of [{ approvals: ['sam'] }, { participants: ['alex', 'maya', 'chris'] }, { paid: ['sam'] }, { status: 'cancelled' }])
    assert.throws(() => approvedCheckoutAmount({ plan }, { ...item(), ...change }, 'sam', 1));
});
test('Checkout rejects invalid prices, expired quotes and mismatched allocations', () => {
  for (const change of [{ price: null }, { expires: 'invalid-date' }, { expires: '2026-01-01T00:00:00Z' }, { shares: { sam: 1, alex: 9000, maya: 9000, chris: 9000 } }, { shares: { sam: 9000.1, alex: 8999.9, maya: 9000, chris: 9000 } }])
    assert.throws(() => approvedCheckoutAmount({ plan }, { ...item(), ...change }, 'sam', 1, Date.parse('2026-10-12T00:00:00Z')));
  assert.throws(() => approvedCheckoutAmount({ plan }, { ...item(), shares: { sam: 0, alex: 18000, maya: 9000, chris: 9000 } }, 'sam', 1), /positive/);
});
test('Personal payer is the authenticated editor, while fixed demo preserves actor selection', () => {
  const people = [{ id: 'person-a', role: 'owner' }, { id: 'person-b', role: 'editor' }, { id: 'person-c', role: 'viewer' }];
  requirePaymentActor({ people }, 'person-a', 'person-a');
  requirePaymentActor({}, 'sam', 'signed-in-account');
  assert.throws(() => requirePaymentActor({ people }, 'person-b', 'person-a'), /own approved share/);
  assert.throws(() => requirePaymentActor({ people }, 'person-c', 'person-c'), /own approved share/);
});
test('Provider amounts require exact CAD cents', () => {
  assert.equal(providerCents({ currency_code: 'CAD', value: '0.01' }), 1);
  for (const value of ['90.001', '90', 'NaN', '-90.00', '9e1', '0.00']) assert.throws(() => providerCents({ currency_code: 'CAD', value }));
  assert.throws(() => providerCents({ currency_code: 'USD', value: '90.00' }));
});
test('Completed provider capture belongs to this exact order, item and operation', () => {
  assert.equal(verifiedOrderCapture(operation(), order()).id, 'CAPTUREA');
  const captureCustomId = order();
  delete captureCustomId.purchase_units[0].custom_id;
  captureCustomId.purchase_units[0].payments.captures[0].custom_id = 'operation-a';
  assert.equal(verifiedOrderCapture(operation(), captureCustomId).id, 'CAPTUREA');
  for (const mutate of [data => data.id = 'OTHER', data => data.status = 'APPROVED', data => data.purchase_units[0].reference_id = 'lodge', data => data.purchase_units[0].custom_id = 'other-op', data => data.purchase_units[0].payments.captures[0].status = 'PENDING', data => data.purchase_units[0].payments.captures[0].amount.value = '91.00', data => data.purchase_units.push(data.purchase_units[0]), data => data.purchase_units[0].payments.captures.push(data.purchase_units[0].payments.captures[0])]) {
    const data = order(); mutate(data); assert.throws(() => verifiedOrderCapture(operation(), data));
  }
});
test('Full refund is limited to the fully approved cancelled hike quote', () => {
  assert.deepEqual(approvedFullRefund(refundTrip(), expense()), { amount: 9000, member: 'sam', proposalId: 'proposal-a', revision: 1 });
  for (const id of ['lodge', 'shuttle', 'replacement']) {
    const trip = refundTrip(), event = expense(); trip.items[0].id = id; event.itemId = id;
    assert.throws(() => approvedFullRefund(trip, event), /reviewed refund allocation/);
  }
});
test('Unrelated, stale, incomplete and malformed proposals cannot authorize refunds', () => {
  for (const change of [{ kind: 'departure' }, { status: 'approved' }, { revision: 2 }, { itemId: 'lodge' }, { approved: ['sam'] }, { required: ['sam'] }, { snapshot: '{}' }, { snapshot: 'invalid' }]) {
    const trip = refundTrip(); Object.assign(trip.proposals[0], change);
    assert.throws(() => approvedFullRefund(trip, expense()), /fully approved recovery/);
  }
  const trip = refundTrip(); trip.items[0].status = 'scheduled'; assert.throws(() => approvedFullRefund(trip, expense()), /Cancel/);
  const changed = refundTrip(); changed.items[0].shares = { sam: 9000, alex: 18000, maya: 4500, chris: 4500 };
  assert.throws(() => approvedFullRefund(changed, expense()), /booking changed/);
});
test('Fixtures, altered capture amounts and multi-payer events cannot be refunded', () => {
  for (const change of [{ mode: 'fixture' }, { status: 'pending' }, { providerId: undefined }, { amount: 18000 }, { contributions: { sam: 9000, alex: 9000 } }, { shares: { sam: 9000, alex: 0 } }])
    assert.throws(() => approvedFullRefund(refundTrip(), { ...expense(), ...change }));
});
test('Refund binds the ledger entry to original payer, capture and plan', () => {
  requireCaptureEventMatch(operation(), expense(), order(), 'trip-a');
  assert.throws(() => requireCaptureEventMatch(operation(), expense(), order(), 'trip-b'), /original server-verified/);
  assert.throws(() => requireCaptureEventMatch({ ...operation(), member: 'alex' }, expense(), order(), 'trip-a'));
  assert.throws(() => requireCaptureEventMatch(operation(), { ...expense(), providerId: 'OTHER' }, order(), 'trip-a'));
  assert.throws(() => requireCaptureEventMatch({ ...operation(), status: 'created' }, expense(), order(), 'trip-a'));
  assert.equal(dataTripId(operation()), 'trip-a');
  assert.equal(dataTripId({ payload: 'invalid' }), undefined);
});

console.log(`${checks} payment boundary checks passed.`);
