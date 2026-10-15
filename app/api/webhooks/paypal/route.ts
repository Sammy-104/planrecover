import { env } from 'cloudflare:workers';
import { db, loadState, saveState } from '@/lib/store';
import { paypal, reconcileCapture } from '@/lib/paypal';
import { receivePayPalWebhook, processPayPalWebhook, webhookVerificationPayload, WebhookDeliveryError } from '@/lib/paypal-webhooks';

export async function POST(request: Request) {
  try {
    const database = db();
    const result = await receivePayPalWebhook(request, {
      database,
      verify: async (headers, _event, rawBody) => {
        const webhookId = (env as unknown as Record<string, string>).PAYPAL_WEBHOOK_ID;
        if (!webhookId) throw new WebhookDeliveryError(503, 'Webhook verification is not configured.');
        const rawVerificationJson = webhookVerificationPayload(headers, webhookId, rawBody);
        const verified = await paypal('/v1/notifications/verify-webhook-signature', 'POST', undefined, undefined, rawVerificationJson);
        return verified.verification_status === 'SUCCESS';
      },
      process: event => processPayPalWebhook(event, {
        database,
        fetchOrder: id => paypal(`/v2/checkout/orders/${encodeURIComponent(id)}`),
        fetchRefund: id => paypal(`/v2/payments/refunds/${encodeURIComponent(id)}`),
        reconcileCapture, loadState, saveState,
      }),
    });
    return Response.json(result);
  } catch (error) {
    const status = error instanceof WebhookDeliveryError ? error.status : 503;
    const message = error instanceof WebhookDeliveryError ? error.message : 'PayPal webhook could not be completed. Retry this delivery.';
    return Response.json({ error: message }, { status, headers: status === 503 ? { 'Retry-After': '30' } : undefined });
  }
}
