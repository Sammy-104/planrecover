# Backend completion work started October 17, 2026

This is the first implementation batch following the audit corrections. It keeps the current private Worker/D1/R2 application, financial approval boundaries and existing paused schedule. It does not activate paid services or send application reminder email. The owner-selected SES sender identity was created separately and its Verified status was read back after the owner completed address verification.

| Area | Delivered in this batch | Still required |
| --- | --- | --- |
| Bedrock | Owner-only readiness GET; explicit synthetic inference POST with durable results, replay protection, shared limits and an operator view in `/flows`. AWS sign-in and quota inspection completed. | Applied Nova Lite quota remains 0. The 400,000 TPM request is Case Opened and AWS says it is under review. No repeat inference was attempted; a bounded check and feature-level verification follow resolution. |
| Email | Direct SES v2 signing and opted-in reminder delivery with durable attempt evidence. Uncertain outcomes block automatic resends, including after switching providers. The user-selected email identity is Verified in Canada Central. | Restricted sending credentials, authorized acceptance test, bounce/complaint monitoring and inbox evidence. Disabled by default. |
| Backups | Read-only exported-database and receipt-byte verification CLI; schema, immutable financial facts, canonical provider identities, allocation caps and object hashes checked. | Actual hosted database/object exports, retention/storage selection and an isolated hosted restoration drill. |
| PayPal ingress | Existing narrow relay prepared for the authenticated Cloudflare account; bundle passed `wrangler deploy --dry-run`. | Approved public receiver and private service-credential placement, registration on the same sandbox PayPal app, genuine signed callback and duplicate replay evidence. |
| Background jobs | Existing bounded writer and health/review queue retained; readiness shows its observed run separately from unattended schedule verification. | Explicit resumption of the existing paused hourly automation and an unattended completion record. |

The new tests use real migrated SQLite and injected provider fixtures. No live AWS inference, SES send, PayPal financial action, supplier booking or restore was performed by this batch. A configured secret, accepted email, local restore bundle or manual job run is not proof of the corresponding full hosted journey.

The authenticated account menu was read on October 17: Free plan, USD 120.00 credits remaining, access ending April 14, 2027 or on credit exhaustion. No paid upgrade, dedicated IP, delivery-manager add-on or new sending credential was created. Recheck account eligibility and applicable credits before any future live test. An email-only consumer-address identity can encounter DMARC delivery restrictions; use an owned authenticated domain before broader delivery.

Validation: all 56 application suites passed with live network disabled. Final targeted SES, adapter, reminder, expansion-route and readiness suites also pass after the provider-switch safeguards, along with TypeScript and the production Worker build. Local browser QA verified independent email/push status, read-only refresh, and a disabled provider-call control when unconfigured.

Supplier-specific inventory/booking, browser push subscriptions and device delivery, external operations-alert delivery, one-member group merchant funding, split-tender new receipts and physical Alexa+/Fire TV integrations remain outside this batch.

## Operator entry points

- Open `/flows`, select an owned personal plan, and expand **Connected services and recent checks**. Refreshing readiness is read-only; **Run one Bedrock check** is an explicit provider call.
- Follow [SES email setup](SES_EMAIL_SETUP.md) before enabling `AWS_SES_ENABLED`. No readiness or setup control sends a test email.
- Run `node scripts/verify-backup.mjs --help` for the offline verifier; follow [backup verification](BACKUP_VERIFICATION.md) for independent inventory requirements.
- Use only `services/paypal-relay` for the optional public receiver. Its ignored online configuration contains the account selection but no service secret. Keep the main application private.
