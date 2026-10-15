# PlanRecover PayPal sandbox relay

Local-only preparation, October 15, 2026. No receiver has been published and no PayPal registration has been changed. This is a standalone successor to the minimal relay scaffold in `infrastructure/paypal-relay`.

The receiver accepts only `POST /paypal`. It preserves the signed bytes and five PayPal signature headers, then forwards to the pinned private PlanRecover webhook handler. It never forwards visitor identity, cookies or arbitrary authorization. The private handler still verifies the signature with PayPal, stores the event and deduplicates its effects. This relay cannot approve a plan, capture payments, send invoices or issue refunds.

## Run checks locally

From this directory, using Node 22 or newer:

```powershell
node --check worker.mjs
node --test tests/relay.test.mjs
node --experimental-transform-types --disable-warning=ExperimentalWarning tests/inbox.integration.mjs
```

The integration check uses this repository's root `lib/` source and real migrated SQLite test helper. It injects signature and provider fixtures, not real PayPal verification. All test network access is disabled.

`package.json` pins Wrangler 4.92.0. After installing development dependencies, `npm run dev` serves on loopback port 5190, and `npm run build` creates a dry-run Worker bundle without deploying. The existing checkout's Wrangler can also run these commands with `--config` pointing at this directory's `wrangler.json`.

The checked-in configuration has `RELAY_ENABLED=false`, no account ID or credentials, and public workers.dev and preview URLs disabled. It therefore responds 503 to receipt attempts. Use test fixtures to exercise successful forwarding; do not add a real service token merely to test locally. No development server is left running by this preparation.

## What was hardened

- The default Worker entry point wraps the receiver correctly. Cloudflare's third `ExecutionContext` argument cannot be mistaken for an injected HTTP client.
- A configured rate limiter is required before forwarding. The included binding allows 60 requests per minute using one ingress key. Cloudflare rate limiting is per location and permissive; this is not a global traffic or billing cap.
- Exact JSON media type, sandbox-only certificate hosts/paths, a valid event envelope, a 200,000-byte streaming limit, strict UTF-8 and a 10-second body deadline reject malformed requests early.
- Only an explicit JSON acknowledgment with `received:true` and `status:processed` yields 200. A login page, incomplete response or failed processing cannot masquerade as delivery success.
- The relay makes one attempt with a 15-second HTTP deadline. Transient/authentication failures return 503 for a later provider retry; permanent verification/content conflicts return rejection. Error bodies, credentials and cookies are not exposed or logged.
- Repeated valid deliveries always reach the private inbox; the relay does not acknowledge unverified events from a local duplicate cache.

## Move online later

These are future actions, not steps performed by this preparation:

1. Select the hosting account, verify its plan and cost constraints, and authorize public deployment of this narrow receiver. Keep the PlanRecover application owner-private.
2. Run `node scripts/prepare-online.mjs ACCOUNT_ID` with the selected Cloudflare account ID. It writes ignored `wrangler.online.json` without overwriting an existing file. It neither logs in nor deploys. Account IDs are not credentials.
3. Review the generated configuration, required rate-limit binding and pinned destination. Use `wrangler deploy --dry-run --config wrangler.online.json --outdir dist` to validate it. Preparing the config does not supply a token, so the receiver still fails closed without the secret.
4. At actual deployment time, obtain the existing PlanRecover Site service credential through supported Sites access. Store it as secret `PLANRECOVER_SITE_SERVICE_TOKEN` in the selected relay runtime. Use hidden stdin or a secure secret prompt; never pass the token as a command argument, put it in source/config files or print it. This grants the relay server private service access, so review the recipient account before configuring it.
5. Deploy the reviewed configuration and record the actual HTTPS `/paypal` URL. No AWS resources are required by this relay.
6. Register that URL on the **same PayPal sandbox app** used by PlanRecover, with the capture/refund/order/invoice events supported by its handler. Use the returned registration ID for the private Site's `PAYPAL_WEBHOOK_ID` secret. Preserve the previous registration until the cutover is verified. Apply the new private Site environment revision through its supported deployment workflow.
7. Resend a genuine sandbox event from that app's event history. Verify receipt, signature success and persisted inbox completion. Resend the same event and confirm no duplicate financial effects. A simulator payload alone is not proof of a genuine app delivery.
8. Verify that private plans, conversations and financial records remain inaccessible anonymously. Record the exact relay, webhook ID and deployment ownership for rollback.

For rollback, disable this relay with `RELAY_ENABLED=false` in its deployed configuration and redeploy that exact Worker. Remove only its registered PayPal webhook if abandoning it; preserve unrelated registrations and the private application. Do not rotate shared Site service access just to remove this receiver without considering its existing runner.

References: [Cloudflare rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [PayPal webhook integration and signature verification](https://developer.paypal.com/api/rest/webhooks/rest/), [PayPal event history and resend](https://developer.paypal.com/api/rest/webhooks/events-dashboard/).
