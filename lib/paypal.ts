import { env } from 'cloudflare:workers';
import { config, db, loadState, saveState } from './store';
import { financialTrip, type MoneyEvent } from './model';
import { dataTripId, requirePayPalCurrency, requireCaptureLedgerMatch, verifiedOrderCapture, type PaymentOperation, type ProviderOrder } from './payment-guards';
import {commitFinancialEffect} from './financial-history';

// This beta adapter must never send demo merchant transactions to production.
const base = 'https://api-m.sandbox.paypal.com';
export async function paypal(path: string, method = 'GET', body?: unknown, key?: string, rawVerificationJson?: string) {
  if (!path.startsWith('/v1/') && !path.startsWith('/v2/')) throw Error('Unsupported PayPal sandbox endpoint.');
  if (rawVerificationJson !== undefined && (path !== '/v1/notifications/verify-webhook-signature' || method !== 'POST'))
    throw Error('Raw PayPal payloads are restricted to webhook verification.');
  const e = env as unknown as Record<string, string>;
  if (!config().paypal) throw Error('PayPal sandbox is not connected. Configure the sandbox client ID and secret to enable this action.');
  // Canonical recovery reads have one deadline covering authentication and the
  // provider response. Money mutations retain their existing idempotent flow.
  const signal = AbortSignal.timeout(method === 'GET' ? 10_000 : 20_000);
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${e.PAYPAL_CLIENT_ID}:${e.PAYPAL_CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal,
  });
  if (!tokenResponse.ok) throw Error('PayPal sandbox authentication failed. Check the sandbox credentials.');
  const token = await tokenResponse.json() as { access_token: string };
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(key ? { 'PayPal-Request-Id': key } : {}) },
    body: rawVerificationJson ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal,
  });
  const raw=await response.text();
  const data=raw?JSON.parse(raw):{};
  if (!response.ok) throw Error(`PayPal sandbox: ${data.name ?? 'request failed'}${data.details?.[0]?.description ? ` · ${data.details[0].description}` : ''}`);
  return data;
}

export const providerTripId = dataTripId;
export async function reconcileCapture(owner: string, op: PaymentOperation, data: ProviderOrder) {
  const capture = verifiedOrderCapture(op, data);
  const state = await loadState(owner);
  const trip = financialTrip(state, op.item_id, providerTripId(op));
  const item = trip?.items.find(i => i.id === op.item_id);
  if (!item || !trip) throw Error('Paid item no longer exists. Merchant review required.');
  requirePayPalCurrency(trip.plan);
  const existing = trip.events.filter(e => e.providerId === capture.id);
  if (existing.length > 1) throw Error('The existing capture ledger needs merchant review.');
  if (existing[0]) requireCaptureLedgerMatch(op, existing[0]);
  if (!existing.length) {
    const event: MoneyEvent = {
      id: `paypal-${capture.id}`, itemId: item.id, kind: 'expense', label: `${item.name} · sandbox payment`,
      shares: { [op.member]: op.amount }, contributions: { [op.member]: op.amount }, amount: op.amount,
      status: 'confirmed', evidence: `Server-verified sandbox capture ${capture.id}. Booking confirmation is separate.`,
      mode: 'sandbox', created: new Date().toISOString(), providerId: capture.id,
    };
    await commitFinancialEffect(db(),{owner,planId:trip.plan.id!,event,
      operation:{id:op.id,status:'captured',payload:JSON.stringify({...data,planrecoverTripId:providerTripId(op),planrecoverCurrency:'CAD'})},
      markPaid:{memberId:op.member,revision:op.revision,amount:op.amount}});
  }else{
    await commitFinancialEffect(db(),{owner,planId:trip.plan.id!,event:existing[0],
      operation:{id:op.id,status:'captured',payload:JSON.stringify({...data,planrecoverTripId:providerTripId(op),planrecoverCurrency:'CAD'})}});
  }
  return capture;
}
