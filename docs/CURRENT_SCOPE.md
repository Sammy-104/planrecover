# Current scope and architecture

Updated October 18, 2026. This is the current specification. Earlier project records describe earlier releases and are evidence, not the current backlog.

PlanRecover helps people agree on a shared plan, understand each person's cost and cash contribution, and review changes after a disruption. Financial approval is always an explicit human step. The assistant prepares previews; it cannot approve, capture payments or issue refunds.

## Supported product

- Personal/shared trips, days out and events with saved membership, private budgets/preferences, activities, preparation tasks and confirmed prerequisites.
- Equal, fixed, percentage and weighted allocation; reviewed receipt lines with a default single payer or explicit split contributions that exactly match the receipt total. All consumers/contributors approve. Original contributor identities and immutable correction history remain preserved.
- Individual checkout or optional reviewed whole-group funding against a fictional merchant quote, in **PayPal CAD sandbox only**. A designated participating editor can pay the whole group price after all affected approvals; mode/funder changes require a new revision and cannot change after funding claims or payments. Cost shares and the original cash contributor remain distinct. Whole-group items cannot also create individual collection invoices.
- Separate payment, booking and refund states. Captured transactions and original contribution identities survive deletion/restoration and allocation corrections.
- Recovery comparisons, member departures, independently approved cancellations/refunds, replacement progress and reviewed manual closure for outside cancellations. A manual received-refund record is explicitly human evidence, not provider verification.
- Plan-linked invoices with recipient-reviewed due times and optional partial-payment minimum. Sending, buyer payments and merchant refunds are separate actions. Invoice refunds require the merchant handoff and distinct canonical refund evidence.
- Persistent in-app reminders and a recipient inbox. SES email has a verified sandbox sender and restricted private credentials, with sending disabled pending a controlled test. Signed delivery outcomes and suppression are implemented. Browser Web Push subscriptions, encryption and expiry handling are implemented but disabled until private configuration and a controlled device test; an opt-in is not a connection.
- Private/scoped document wallet with durable metadata, upload byte hashes, member visibility, version fences and retained deletion lifecycle; saved ideas, presence and private planning settings support the refreshed frontend.
- Owner-only service observations, distinct manual/scheduled job evidence and a disabled external alert dispatcher. Offline backup capture/resume, independently preservable hashes, retention and isolated local restore rehearsal cover receipt and document bytes.
- Saved conversations, ten validated MCP tools, reviewable proposals and a simulated Alexa+ web client. Genuine hosted model output remains dependent on provider access.

Planning/receipt currencies can differ from CAD where the existing money model supports them. There is no automatic FX conversion. Reimbursement handoffs use the exact supported plan currency and precision or explain why no handoff can be built.

## Chosen implementation

The application uses React/TypeScript, Vinext/Vite, a Cloudflare Worker, D1 binding `DB`, private R2 binding `BUCKET`, and the trusted Sites identity gateway. The current private Site and its supported source repository are the publication authority. GitHub is a source mirror until deliberate synchronization/deployment is configured. A push to GitHub does not publish the Site.

Bedrock uses a Canadian application inference profile when configured. Manual receipt review and saved-plan answers remain available if model inference is unavailable. The actual recovery state machine is stored in D1. The optional Step Functions example is an approval handoff, not a second recovery engine.

Use Node24 and pinned pnpm11.25.0. CI runs offline application/relay tests, typecheck and the Worker build. Migrations are additive/schema-only; legacy refund evidence is revalidated in bounded canonical reconciliation, without rewriting financial history.

## Explicit extensions

Live supplier inventory, a real Alexa+/Fire TV connection, optional Location/Textract/Step Functions activation, live email/push delivery, live PayPal merchant onboarding, a lending product and FX remain extensions. Optional whole-group funding and split-contribution receipts are implemented in this source batch and undergo the final validation recorded in its delivery report. Existing adapter code is a contract and testable boundary, not proof a service is active. Hosted export/restore, public webhook registration, external receiver provisioning and resumption of the existing paused schedule are separate acceptance steps.

## Completion evidence

Track each requirement as implemented, configured, fixture-tested and hosted-verified separately. Current validation and remaining external work belong in `CURRENT_BACKEND_STATUS.md` and the audit resolution report. No local test or screenshot establishes a genuine provider journey.
