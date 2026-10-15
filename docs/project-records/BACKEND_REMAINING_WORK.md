# PlanRecover: remaining backend work

**Implementation follow-up, October 15:** The code gaps in this audit have now been implemented in `planrecover-completion-site`, with 46 passing regression suites, full TypeScript validation and local browser checks. See [BACKEND_EXPANSION.md](planrecover-completion-site/BACKEND_EXPANSION.md) for the delivered flows, adapter contracts and exact external setup/verification still open. Publication and hosted verification are recorded in [BACKEND_IMPLEMENTATION_PROGRESS.md](BACKEND_IMPLEMENTATION_PROGRESS.md). The assessment below remains the original pre-implementation audit.

Audit date: October 15, 2026, America/Toronto.

## Assessment

The core CAD sandbox backend is substantially implemented. The statement that all remaining backend features are complete is broader than the code supports: the conversational agent, general recovery comparison, general member departures, several receipt features, and parts of the planned Amazon integration remain unfinished.

Some older backlog entries are already complete. Others describe provider verification or missing browser controls rather than missing backend services. This audit separates those cases.

The latest combined published source identified by the project reports is `planrecover-ai-site`, commit `0082bda0b265952fe361a8e960aefa4012a11b2a`. The older `planrecover-sandbox-site` and `planrecover-backend` folders contain earlier source history and synchronized changes. Their document dates and Git HEADs alone do not establish the current deployed feature set.

## 1. Backend implementation still needed

| Priority | Work | Existing behavior and evidence | Completion target |
| --- | --- | --- | --- |
| High | General recovery comparison and execution across connected bookings | The new recovery service implements approved, policy-backed cancellation and exact partial refunds for one booking. It blocks cancellation while dependent bookings remain unresolved. The older keep/replace/cancel comparison still uses fixed demo figures and requires the Algonquin scenario. See [model.ts](planrecover-ai-site/lib/model.ts), `recoveryFigures` at line 141 and `propose_recovery` at line 254; [recovery-service.ts](planrecover-ai-site/lib/recovery-service.ts), `propose` at line 317 and dependency checks at line 485. | Calculate alternatives from arbitrary saved bookings, retained costs, policies, replacement quotes, dates and participant shares. Persist the selected sequence, obtain approvals for its exact terms, and resume cancellation, replacement payment and booking steps after interruptions. Existing refund safeguards should be reused. |
| High | General member departure and changed participation across a plan | The `departure` action looks up the fixed item ID `lodge` and reallocates that booking. Membership management and preserved financial history already exist, but this does not provide the broader departure analysis promised in the product plan. See [model.ts](planrecover-ai-site/lib/model.ts), line 255. | Identify all affected bookings and participants; distinguish refundable and retained obligations; propose revised shares and dependencies; retain existing liabilities until the required people approve the revision. Work on ordinary personal/shared plans without demo item IDs. |
| High | Conversational Alexa+/MCP action workflow | The four MCP tools read plans, schedules, money and decisions. Website Chat also returns `readOnly: true`. The separate AI draft endpoint suggests additions to an existing plan. Bedrock deliberately offers no tools and rejects tool-use output. See [plan-mcp.ts](planrecover-ai-site/lib/plan-mcp.ts), line 20; [assistant route](planrecover-ai-site/app/api/assistant/route.ts), line 49; [bedrock.ts](planrecover-ai-site/lib/bedrock.ts), line 188; [ai-plan.ts](planrecover-ai-site/lib/ai-plan.ts). | Connect the planned simulated Alexa+ client to validated services for creating plans, preparing edits, comparing recoveries and checking execution. Add structured proposal previews and explicit approval handoffs. A natural-language answer must not itself approve an obligation or initiate payment. |
| Medium | Persisted conversation and agent continuation | Saved plans and payment/recovery records are durable, but website messages are component state and a short history is sent with each request. This is not a saved conversation/session workflow. See [plan-assistant.tsx](planrecover-ai-site/components/plan-assistant.tsx), line 19, and [assistant route](planrecover-ai-site/app/api/assistant/route.ts). | Store scoped conversation/proposal references and reconnect them to current plan versions, so the intended agent experience can continue after a reload or interruption. Preserve per-member privacy. |
| Medium | Finish the receipt lifecycle | Upload persistence, browser OCR/rescanning, editable source review, exact splitting and group approval are implemented. Remaining features include provider-assisted PDF extraction, provider extraction retry with preserved revision history, explicit quantities/unit prices and line discounts, and attachment retention/orphan cleanup. See [RECEIPT_BACKEND.md](planrecover-ai-site/RECEIPT_BACKEND.md), line 31; [receipt-extraction.ts](planrecover-ai-site/lib/receipt-extraction.ts), line 24; [receipt-drafts.ts](planrecover-ai-site/lib/receipt-drafts.ts), lines 8 and 102; [receipt upload route](planrecover-ai-site/app/api/receipt/route.ts), line 68. | PDFs can produce reviewed drafts; retries preserve prior source facts; richer receipt lines reconcile exactly; abandoned objects are cleaned up without deleting approved accounting evidence. Browser rescan already exists and should not be rebuilt. |
| Later | Email and push reminder delivery | Preferences are saved, but these channels produce `unavailable` jobs. Only in-app delivery is implemented. See [reminder-jobs.ts](planrecover-ai-site/lib/reminder-jobs.ts), lines 65 and 154. | Add the selected delivery providers, opt-in handling, retries and deduplication, and verify delivery. This is an extension beyond the current in-app reminder milestone. |
| Later | Live supplier booking and cancellation adapters | Place discovery, routing and owner-confirmed evidence exist. Automated merchant operations are limited to the fictional CAD sandbox catalog; external cancellations/refunds remain manual. See [RECOVERY_BACKEND.md](planrecover-ai-site/RECOVERY_BACKEND.md) and [recovery-service.ts](planrecover-ai-site/lib/recovery-service.ts), line 483. | For a selected supplier, integrate current availability, quotes, booking confirmation, cancellation and authorized refunds. A place listing or owner attestation cannot substitute for that supplier integration. |

The first three items are the most material gaps between the broader product discussed in the chats and the currently implemented backend.

## 2. Integration and operational work still open

| Priority | Item | Current evidence | Remaining action |
| --- | --- | --- | --- |
| High | Reachable, signed PayPal webhooks | Signature verification, raw-body handling, a durable inbox and idempotent reconciliation are implemented. The private Site gateway prevents an anonymous PayPal callback from reaching that handler. The latest recovery report still lists signed delivery as unverified. | Establish a supported public ingress/authenticated relay while preserving the private app audience and original signature evidence. Test genuine signed delivery, retries and duplicate events against the hosted ledger. |
| High | Scheduled payment checks/reminders | The authenticated runner and in-app jobs exist. The delivery report records an enabled hourly schedule and a successful manual hosted run. A later chat, **PlanRecover payment checks and reminders**, dated October 14 at 1:06 p.m., reports a timeout and says the automation was paused after the previous successful 12:53 p.m. run. | Inspect the current schedule and service-access configuration, repair the failing access path, then verify a real scheduled tick in persisted run records. The later chat is evidence of an unresolved operational issue; this audit did not independently read the current native schedule state. |
| High | Live Bedrock verification | The Canada Central application profile and restricted Site secret are already configured. The prior direct provider result was HTTP 403 during AWS account verification. The October 15 retry has restored AWS/Site sign-in and completed the Free plan/credit check; its bounded hosted inference test is still in progress as this audit closes. | Read the active retry's result, then complete any outstanding hosted Chat, draft and image-extraction checks. Do not treat the old “credentials not configured” entries as current. Follow [AWS_TESTING_POLICY.md](AWS_TESTING_POLICY.md) and [AWS_SETUP_STATUS.md](AWS_SETUP_STATUS.md). No live AWS call was made for this audit. |
| Medium | Sandbox invoice journey | Draft creation, recipient approval, explicit sending, partial payments, reconciliation and funding-claim protection exist and pass fixture tests. No later report establishes a complete genuine invoice deposit-and-balance journey. | Verify a sandbox invoice send, partial payment, balance payment and repeated reconciliation with exact incremental ledger effects. This is live validation of implemented code. |
| Medium | Hosted collaboration and individual checkout | Backend tests cover multiple identities and member checkout, but the hosted Site has been owner-only. The verified live capture/refund used a one-person plan. | Exercise separate signed-in owner/editor/viewer accounts, private preferences, approvals, each participant's checkout and removed/revoked access using authorized Site access. |
| Medium | Hosted operational resilience | Persisted job status and error records exist. The original workflow also calls for monitoring and a backup/restore rehearsal; no reviewed report establishes those exercises. | Verify recoverability of the hosted database and receipt objects and make stalled/failed jobs visible. This is a readiness task, not evidence that the existing financial transaction protections are missing. |

The physical Alexa+ device/service is not connected. The accepted initial product scope in **Fleshing Out PlanRecover** was a simulated Alexa+ web experience, so a physical device should not be treated as a prerequisite for completing that scope. The richer simulated agent workflow still needs implementation and demonstration.

## 3. Planned Amazon additions that are absent

The Amazon expansion described in **Fleshing Out PlanRecover** and **Brainstorm Hackathon Ideas** included more than the current read-only MCP surface and Bedrock JSON adapter:

- **Bedrock tool calling:** absent; the current adapter explicitly rejects tool calls.
- **AWS Step Functions:** no state-machine integration was found. Existing D1 approvals, leases and jobs already supply some durable behavior, but they do not demonstrate Step Functions integration.
- **Amazon Location Service:** no integration was found. Current route requests use OpenStreetMap routing; saved supplier/travel evidence is a separate feature.
- **Amazon Textract and Fire TV:** absent, and described as optional extensions in those chats.

Step Functions and Location are remaining work if those specific Amazon promises stay in scope. They are not dependencies of the already working CAD sandbox capture/refund path. The checked-in blueprint also lacks the Amazon section described in the later chat, so the source specification should be reconciled with the chosen final scope.

## 4. Deliberate scope limits

- Provider checkout/invoicing/refunds currently use CAD sandbox amounts. Broader currencies and live merchant onboarding are future extensions; the blueprint explicitly allows a CAD-first demo. See [payment-guards.ts](planrecover-ai-site/lib/payment-guards.ts), line 4.
- Receipt source currencies are preserved, but conversion into plan currency requires documented manual values. A dated FX quote and conversion service would be additional work.
- Invoice partial payments and one due instant are implemented. A general merchant milestone/installment calendar is separate; the invoice service explicitly does not collect arbitrary installments automatically.
- Financing is a private saved amount, not a verified lender repayment schedule. Provider-controlled Pay Later eligibility should not be presented as an implemented custom lending service.

## 5. Already implemented: remove these from old implementation backlogs

- Per-plan persistence, authenticated membership, private preferences, optimistic concurrency and invitation expiry/revocation.
- Immutable financial facts and approval snapshots, atomic provider/ledger transitions and duplicate-effect protection.
- Individual member checkout against an approved fictional merchant quote.
- General policy-backed single-booking cancellation and exact partial refunds, capacity reservations, immutable requests, execution leases and bounded recovery of interrupted results.
- Plan-linked invoice services, recipient approval, explicit send, partial-payment reconciliation and protection against duplicate collection through checkout.
- Saved receipt drafts, browser image OCR/rescanning, editable review and exact financial allocation.
- Private planning constraints, confirmed supplier/travel evidence and code-validated AI itinerary previews.
- Durable in-app reminder jobs and authenticated manual/scheduled background-runner services.
- Four authenticated read-only MCP tools and an Agent Skill; connected OAuth reads have passed.
- Website Chat and saved-plan fallback answers.

Actual sandbox capture and partial refund are already verified in [RECOVERY_DEPLOYMENT_STATUS.md](RECOVERY_DEPLOYMENT_STATUS.md): CAD 16.00 captured, CAD 12.80 refunded, CAD 3.20 retained, with repeated execution producing no duplicate financial records. A genuine refund is no longer an open verification task for that scenario.

## 6. Suggested order

1. Resolve live Bedrock verification in the already active setup/integration chats; repair webhook ingress and verify the scheduler's actual state.
2. Implement general recovery options and member departures using existing payment/approval services.
3. Add conversational proposal/action tools and the simulated Alexa+ client, including persisted continuation.
4. Complete the hosted multi-account and invoice journeys, then finish browser controls for the existing APIs.
5. Complete receipt history/PDF/cleanup features. Add supplier, external notification and further Amazon adapters according to the final scope and zero-spend constraint.

## 7. Review coverage and validation

Read all 11 existing project chats returned by the app, following older-turn pagination where present:

1. Plan backend implementation workflow
2. Set up AWS Bedrock
3. Implement recovery backend
4. Plan backend implementation workflow (2)
5. Fleshing Out PlanRecover
6. Unpack ZIP and preview website
7. Hackathon Brainstorming Breakdown
8. Brainstorm Hackathon Ideas
9. PayPal AI Hackathon Summary
10. Access ChatGPT Chatlog
11. Refine ContextFlow and brainstorm

Also read the directly related **PlanRecover payment checks and reminders** chat. The archived-chat listings returned no archived chats. Some early brainstorming replies contain content-reference placeholders; the later substantive planning chats and saved blueprint provide the concrete requirements used here.

Compared those records with `BACKEND_IMPLEMENTATION.md`, the backend workflow, feature guides, AWS setup/testing records, deployment reports and current combined source. `BACKEND_IMPLEMENTATION.md` explicitly marks its older milestone lists as superseded, but its later historical paragraph still says several now-delivered features are unfinished. Conversely, its broad completion banner does not cover the remaining product gaps above.

Fresh validation during this audit: **all 40 test suites passed**, with live network access disabled by the test runner; full TypeScript checking also passed. No provider payments, refunds, invoices or AWS inference were submitted by this audit. The audit adds this report only; it does not change application code, synced references, hosting configuration or schedules.

Browser completion remains separate: plan-linked invoices, general recovery management, evidence entry, full availability and reminder preferences still need fuller controls. The dedicated recovery verification page and the newer Chat dietary/accessibility/buffer controls cover only parts of those flows. See [BACKEND_FEATURE_GUIDE.md](planrecover-ai-site/BACKEND_FEATURE_GUIDE.md), line 17.
