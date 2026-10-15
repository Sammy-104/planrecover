import { owner, checkOrigin, apiError, db, loadState } from '@/lib/store';
import { paypal } from '@/lib/paypal';
import { requirePayPalCurrency, type PaymentOperation } from '@/lib/payment-guards';

type InvoiceResult = { invoiceId: string; status: string; url: string | null; amount: number; minimum: number };
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (request.headers.has('x-trip-share')) throw Error('Invoice creation through shared plan links is not supported yet. Open your own workspace.');
    const id = owner(request), input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Enter a valid invoice request.');
    const body = input as Record<string, unknown>;
    const state = await loadState(id);
    requirePayPalCurrency(state.plan);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw Error('Enter a sandbox buyer email.');
    if (typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.requestId))
      throw Error('A unique invoice request is required.');
    // Namespace caller-supplied UUIDs by authenticated workspace; the table's ID
    // is global and must not let another workspace reserve the same request.
    const key = (await hash(`invoice-${id}-${body.requestId}`)).slice(0, 38);
    const legacy = await db().prepare('SELECT * FROM provider_operations WHERE id = ? AND owner = ? AND kind = ?')
      .bind(body.requestId, id, 'invoice').first<PaymentOperation>();
    if (legacy?.provider_id) {
      const existing = await paypal(`/v2/invoicing/invoices/${encodeURIComponent(legacy.provider_id)}`);
      if (existing.primary_recipients?.[0]?.billing_info?.email_address !== email)
        throw Error('This invoice request already belongs to another buyer email. Start a new request.');
      const saved = JSON.parse(legacy.payload ?? '{}');
      return Response.json({ invoiceId: saved.invoiceId, status: saved.status, url: saved.url, amount: saved.amount, minimum: saved.minimum });
    }
    await db().prepare('INSERT OR IGNORE INTO provider_operations (id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(key, id, 'separate-invoice-example', 'sam', 1, 'invoice', 24000, 'creating', JSON.stringify({ email })).run();
    const op = await db().prepare('SELECT * FROM provider_operations WHERE id = ? AND owner = ? AND kind = ?').bind(key, id, 'invoice').first<PaymentOperation>();
    if (!op) throw Error('Invoice request could not be reserved.');
    const saved = JSON.parse(op.payload ?? '{}');
    if (saved.email !== email) throw Error('This invoice request already belongs to another buyer email. Start a new request.');
    if (saved.result) return Response.json(saved.result as InvoiceResult);
    let invoiceId = op.provider_id;
    if (!invoiceId) {
      const invoice = await paypal('/v2/invoicing/invoices', 'POST', {
        detail: { currency_code: 'CAD', note: 'Fictional merchant service invoice for PlanRecover beta. Deposit CAD 60; balance CAD 180. Partial payments are buyer initiated.' },
        primary_recipients: [{ billing_info: { email_address: email } }],
        items: [{ name: 'Demo equipment rental', quantity: '1', unit_amount: { currency_code: 'CAD', value: '240.00' } }],
        configuration: { partial_payment: { allow_partial_payment: true, minimum_amount_due: { currency_code: 'CAD', value: '60.00' } }, allow_tip: false },
      }, key);
      invoiceId = invoice.id ?? invoice.href?.split('/').pop();
      if (typeof invoiceId !== 'string' || !invoiceId) throw Error('PayPal returned no invoice ID.');
      // Preserve the invoice ID even if the subsequent details request fails.
      await db().prepare('UPDATE provider_operations SET provider_id = ?, status = ? WHERE id = ? AND owner = ?')
        .bind(invoiceId, 'created', key, id).run();
    }
    const full = await paypal(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
    const result: InvoiceResult = { invoiceId, status: String(full.status), url: full.detail?.metadata?.recipient_view_url ?? null, amount: 24000, minimum: 6000 };
    await db().prepare('UPDATE provider_operations SET status = ?, payload = ? WHERE id = ? AND owner = ?')
      .bind(result.status, JSON.stringify({ email, result }), key, id).run();
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
