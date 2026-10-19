import type { Item, MoneyEvent, State } from './model.ts';
import {freezeMerchantFunding,captureShares,equalMoneyMaps} from './merchant-funding.ts';

/** The existing fictional merchant adapter quotes and settles in CAD only. */
export const PAYPAL_CURRENCY = 'CAD';
type PaymentTrip = Pick<State, 'plan' | 'items' | 'events' | 'proposals' | 'people'>;
export type PaymentOperation = {
  id: string; owner: string; item_id: string; member: string; revision: number;
  kind: string; amount: number; status: string; payload: string | null; provider_id?: string | null;
};
type ProviderAmount = { currency_code?: string; value?: string };
export type ProviderCapture = { id?: string; status?: string; amount?: ProviderAmount; custom_id?: string };
export type ProviderOrder = {
  id?: string; status?: string;
  purchase_units?: { reference_id?: string; custom_id?: string; amount?:ProviderAmount; payments?: { captures?: ProviderCapture[] } }[];
};

export function requirePayPalCurrency(plan: { currency?: string }) {
  if ((plan.currency ?? PAYPAL_CURRENCY) !== PAYPAL_CURRENCY)
    throw Error('PayPal sandbox checkout currently supports CAD plans only.');
}

export function requirePaymentActor(trip: Pick<State, 'people'>, actor: string, signedInPersonId: string) {
  // The fixed demo retains its four selectable fictional payers. Personal plans
  // must bind the payer to the identity supplied by the trusted Sites gateway.
  if (!trip.people) return;
  if (actor !== signedInPersonId || !trip.people.some(p => p.id === actor && ['owner', 'editor'].includes(p.role)))
    throw Error('Only your own approved share can be paid with this account.');
}

export function approvedCheckoutAmount(trip: Pick<State, 'plan'>, item: Item | undefined, actor: string, revision: number, now = Date.now()) {
  requirePayPalCurrency(trip.plan);
  if (!item || item.revision !== revision || item.status !== 'awaiting-payment' ||
      !item.participants.includes(actor) || item.paid.includes(actor) ||
      !(item.required ?? item.participants).every(id => item.approvals.includes(id)) || !item.approvals.includes(actor))
    throw Error('Review the latest approved, unpaid share before checkout.');
  if (item.price === null || !Number.isSafeInteger(item.price) || item.price <= 0 ||
      (item.expires && (!Number.isFinite(Date.parse(item.expires)) || Date.parse(item.expires) <= now)))
    throw Error('A valid unexpired price is required.');
  const amounts = Object.entries(item.shares);
  if (amounts.length !== item.participants.length || new Set(item.participants).size !== item.participants.length ||
      amounts.some(([id, amount]) => !item.participants.includes(id) || !Number.isSafeInteger(amount) || amount < 0) ||
      amounts.reduce((sum, [, amount]) => sum + amount, 0) !== item.price)
    throw Error('Approved shares must match the exact quoted total.');
  const group=freezeMerchantFunding(item);
  if(group&&group.payerId!==actor)throw Error('Only the approved designated payer can fund this whole-group booking.');
  const amount = group?.amount??item.collection?.due[actor] ?? item.shares[actor];
  if(item.collection&&(!Number.isSafeInteger(amount)||amount<0||amount>item.shares[actor]))throw Error('Review the credited deposit and remaining balance.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('A positive approved share is required for checkout.');
  return amount;
}

export function providerCents(amount?: ProviderAmount) {
  if (amount?.currency_code !== PAYPAL_CURRENCY || typeof amount.value !== 'string' || !/^\d+\.\d{2}$/.test(amount.value))
    throw Error('PayPal amount or currency does not match the approved share.');
  const cents = Number(amount.value.replace('.', ''));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw Error('PayPal amount is invalid.');
  return cents;
}

export function verifyUncapturedOrder(op:PaymentOperation,data:ProviderOrder){
 if(data.id!==op.provider_id||data.status!=='APPROVED'||data.purchase_units?.length!==1)throw Error('The sandbox order must be approved for this exact checkout before capture.');
 const unit=data.purchase_units[0];
 if(unit.reference_id!==op.item_id||unit.custom_id!==op.id||providerCents(unit.amount)!==op.amount||unit.payments?.captures?.length)
  throw Error('The provider order no longer matches the approved item, currency or share.');
}
export function verifiedOrderCapture(op: PaymentOperation, data: ProviderOrder) {
  if (!op.provider_id || data.id !== op.provider_id || data.status !== 'COMPLETED' || data.purchase_units?.length !== 1)
    throw Error('PayPal order does not match this checkout.');
  const unit = data.purchase_units[0];
  const captures = unit.payments?.captures ?? [];
  if (unit.reference_id !== op.item_id || (unit.custom_id ?? captures[0]?.custom_id) !== op.id || captures.length !== 1 ||
      !(op.status==='captured'?['COMPLETED','PARTIALLY_REFUNDED','REFUNDED']:['COMPLETED']).includes(captures[0].status??'') || !captures[0].id)
    throw Error('Payment is not completed for the approved item. No expense has been recorded.');
  if (providerCents(captures[0].amount) !== op.amount) throw Error('Capture amount does not match the approved share.');
  return captures[0] as ProviderCapture & { id: string };
}

export function requireCaptureLedgerMatch(operation: PaymentOperation, event: MoneyEvent) {
  if (event.itemId !== operation.item_id || event.kind !== 'expense' || event.mode !== 'sandbox' || event.status !== 'confirmed' ||
      event.amount !== operation.amount || !equalMoneyMaps(event.shares,captureShares(operation)) || Object.keys(event.contributions).length !== 1 ||
      event.contributions[operation.member] !== operation.amount)
    throw Error('The existing capture ledger needs merchant review.');
}

/** No general supplier refund policy exists yet. Only the fixed fully refundable
 * hike quote can authorize a full refund. Shuttle cancellation is partial and
 * needs a durable allocation before it can move PayPal funds. */
export function approvedFullRefund(trip: PaymentTrip, event: MoneyEvent) {
  requirePayPalCurrency(trip.plan);
  if (trip.plan.template !== 'algonquin' || trip.plan.destination.trim().toLowerCase() !== 'algonquin area, ontario' ||
      event.kind !== 'expense' || event.mode !== 'sandbox' || event.status !== 'confirmed' || !event.providerId)
    throw Error('Select a server-verified sandbox capture from the demo merchant.');
  const item = trip.items.find(i => i.id === event.itemId);
  if (!item || item.status !== 'cancelled') throw Error('Cancel the corresponding booking before requesting this refund.');
  if (item.id !== 'hike' || item.price !== 36000)
    throw Error('This booking needs a reviewed refund allocation. Only the approved full hike refund is supported.');
  const demoMembers = ['sam', 'alex', 'maya', 'chris'];
  if (item.participants.length !== demoMembers.length ||
      !demoMembers.every(id => item.participants.includes(id) && item.shares[id] === 9000))
    throw Error('The cancelled booking changed. Review a new refund allocation.');
  const payer = Object.keys(event.contributions);
  const group=event.amount===36000&&demoMembers.every(id=>event.shares[id]===9000)&&Object.keys(event.shares).length===demoMembers.length;
  if (payer.length !== 1 || !demoMembers.includes(payer[0]) || !group&&event.amount !== 9000 ||
      event.contributions[payer[0]] !== event.amount || !group&&(event.shares[payer[0]] !== event.amount || Object.keys(event.shares).length !== 1))
    throw Error('The capture does not match the approved demo hike share.');
  const proposal = trip.proposals.find(p => {
    if (p.kind !== 'recovery' || p.status !== 'executed' || p.revision !== 1 || p.itemId ||
        !['replace', 'cancel'].includes(p.option ?? '') || p.required.length !== demoMembers.length ||
        !demoMembers.every(id => p.required.includes(id) && p.approved.includes(id))) return false;
    try {
      const snapshot = JSON.parse(p.snapshot);
      const expected = p.option === 'replace'
        ? { groupFinal: 102000, eachFinal: 25500, groupRefund: 36000, eachRefund: 9000, cash: 10500, extra: 1500 }
        : { groupFinal: 49000, eachFinal: 12250, groupRefund: 47000, eachRefund: 11750, cash: 0, extra: -11750 };
      return Object.entries(expected).every(([key, value]) => snapshot[key] === value);
    } catch { return false; }
  });
  if (!proposal) throw Error('A fully approved recovery for this exact cancelled booking is required.');
  return { amount: event.amount, member: payer[0], proposalId: proposal.id, revision: proposal.revision };
}

export function requireCaptureEventMatch(op: PaymentOperation, event: MoneyEvent, data: ProviderOrder, tripId?: string) {
  const capture = verifiedOrderCapture(op, data);
  if (op.kind !== 'order' || op.status !== 'captured' || op.item_id !== event.itemId || op.member !== Object.keys(event.contributions)[0] ||
      capture.id !== event.providerId || op.amount !== event.amount || dataTripId(op) !== tripId)
    throw Error('This refund must match the original server-verified checkout.');
  return capture;
}

export function dataTripId(op: Pick<PaymentOperation, 'payload'>): string | undefined {
  try { const id = JSON.parse(op.payload ?? '{}').planrecoverTripId; return typeof id === 'string' ? id : undefined; }
  catch { return undefined; }
}
