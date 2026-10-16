# PlanRecover backend gap audit

**Implementation follow-up:** The eight code gaps in section A are addressed in [BACKEND_GAP_FIXES.md](../../BACKEND_GAP_FIXES.md). This document remains the historical pre-fix audit. External activation and live-provider/operational verification in sections B–C are separate work; see the release status for publication evidence.

Audited October 15, 2026, America/Toronto. This report supersedes the remaining-work lists and broad completion statements in earlier implementation reports.

The core CAD sandbox backend is implemented, but the broader product is not complete. There are **eight concrete implementation gaps**, additional provider connections to activate, and hosted verification/operations work. Configurable adapters, passing fixture tests and saved credentials do not establish a working external integration.

## Source and evidence

- Latest published source: `planrecover-qol-site`, commit `fd8853361076b2226c468e9fcd5ab0ad1e31508a`, Site **version 15**. Native deployment `appgdep_6ad15fb373b88191861b8859e5fc5d35` reports `succeeded`. It includes the version 14 backend expansion and the subsequent payment usability changes.
- GitHub at audit time: private `Sammy-104/planrecover`, main commit `54cc2847b05b0ce94412d38c1254492a2f95b7fb`, containing the version 14 application plus export documentation and the standalone relay. The version 15 usability delta was not yet in that readback.
- Compared `BACKEND_IMPLEMENTATION.md`, `BACKEND_EXPANSION.md`, `PlanRecover_Blueprint.md`, `PlanRecover_Backend_Workflow.md`, application/services/routes/migrations and relevant regression coverage. Historical descriptions in those documents are not treated as current implementation evidence.
- Refreshed all 11 discoverable project chats and the related **PlanRecover payment checks and reminders** chat, using the earlier full project audit for older context. Relevant latest reports were **Plan backend implementation workflow**, **Set up AWS Bedrock**, **Implement recovery backend**, **Fleshing Out PlanRecover** and **Brainstorm Hackathon Ideas**. Other brainstorm concepts were not added to PlanRecover's requirements.
- Read the current Site, deployment, automation and environment-variable names/secret flags. Environment revision remains **4**. No secret values were displayed or copied. No live payment, refund, invoice, supplier, notification or AWS inference was initiated.
- Version 15's release records report **48 passing regression suites**, type checking and a production build. This audit inspected the source and coverage; it did not rerun those unchanged release checks or substitute them for live-provider evidence.

## A. Backend features still requiring implementation

### 1. Complete recovery execution across multiple bookings — high priority

**Implemented:** arbitrary dependency closure, comparisons, exact member approvals, dependent-first ordering, per-booking approved partial refunds and replacement drafts.

**Missing:** a durable parent workflow linking each cancellation, refund, replacement item, separate buyer checkout and supplier booking. `PlanChangeService.act` returns `awaiting-cancellations` without saving that as a workflow state. After separate cancellations, applying the change creates replacement drafts and marks the proposal `applied`; it does not track their subsequent payment/booking completion or compensation if booking fails.

Evidence: [plan-changes.ts:95](planrecover-qol-site/lib/plan-changes.ts#L95), [plan-changes.ts:127](planrecover-qol-site/lib/plan-changes.ts#L127), [plan-changes.ts:147](planrecover-qol-site/lib/plan-changes.ts#L147). The [Step Functions template](planrecover-qol-site/infrastructure/approval-workflow.asl.json) waits for approval and ends with a handoff; it is not the full recovery orchestrator.

**Completion:** persist linked step IDs, approved inputs, waiting/retry/review states and replacement dependencies; resume safely after closing the browser; expose actual overall progress; route payment-success/booking-failure into an explicit refund/review process. Keep buyer payment and refund authorization explicit.

### 2. Connect supplier operations to canonical booking state — high priority

**Implemented:** configurable sandbox `/quote`, `/book`, `/cancel`, `/status` contract, saved operations, idempotency, funding/approval checks and uncertain-response retention.

**Missing:** validated supplier responses are saved in `adapter_operations` and returned, but do not update the plan's `Item.booking`, reservation reference, cancellation state or financial/recovery workflow. No scheduled supplier-status reconciler or supplier disruption intake is wired into the background runner. A selected provider's actual API translation also remains to build.

Evidence: [supplier-adapter.ts:38](planrecover-qol-site/lib/supplier-adapter.ts#L38), [background-jobs.ts:51](planrecover-qol-site/lib/background-jobs.ts#L51), [owner-jobs.ts](planrecover-qol-site/lib/owner-jobs.ts).

**Completion:** map verified pending/confirmed/failed/cancelled responses to versioned booking records independently of payment status; reconcile delayed/uncertain bookings; associate supplier cancellations with affected commitments; retain an actionable paid-but-not-booked state. Define provider identity/status/refund semantics before enabling real booking.

### 3. Use one complete feasibility and affordability check across entry points — high priority

**Implemented:** the AI draft checker evaluates availability, travel/buffers, hours, dietary/accessibility evidence, budget and cash reserve. Ordinary suggestions have simpler overlap/budget checks. General recovery returns cost and cash figures.

**Missing:** ordinary suggestion previews/additions, MCP-prepared actions and general recovery/departure comparisons do not use that full checker. General recovery does not return a caller-private verdict against their budget/cash/reserve, and replacement drafts are only structurally/date validated. The normal itinerary routing path still uses OSRM; the optional Amazon Location endpoint is separate from this evaluation flow.

Evidence: [planning-constraints.ts:78](planrecover-qol-site/lib/planning-constraints.ts#L78), [ai-plan.ts:111](planrecover-qol-site/lib/ai-plan.ts#L111), [model.ts:142](planrecover-qol-site/lib/model.ts#L142), [agent-tools.ts:34](planrecover-qol-site/lib/agent-tools.ts#L34), [plan-changes.ts:58](planrecover-qol-site/lib/plan-changes.ts#L58), [travel-routes route](planrecover-qol-site/app/api/travel-routes/route.ts).

**Completion:** return consistent, source-backed feasibility issues for normal suggestions, agent previews and recovery replacements; show private affordability to the affected caller; treat other members' missing input as review pending. Prove the blueprint's CAD 105 needed now versus CAD 100 available case on an ordinary plan. Expected refunds must remain unavailable for immediate spending. Saving an explicitly unverified draft can remain allowed.

### 4. Refund and reconcile invoice-funded bookings — high priority

**Implemented:** invoice draft/approval/send, unpaid cancellation, exact incremental partial payments and collection-channel protection.

**Missing:** invoice actions have no refund operation. Cancelling an invoice that has received money directs the user to a reviewed refund, but no invoice refund service implements that path. `verifiedInvoicePayments` rejects nonzero refund evidence. The recovery service discovers checkout `kind='order'` captures rather than `plan_invoice_payments`. Invoice events also have no processing branch in the current webhook handler; they are recorded and ignored, with supported invoice payments handled through reconciliation reads.

Evidence: [plan-invoices.ts:15](planrecover-qol-site/lib/plan-invoices.ts#L15), [plan-invoices.ts:94](planrecover-qol-site/lib/plan-invoices.ts#L94), [plan-invoices.ts:242](planrecover-qol-site/lib/plan-invoices.ts#L242), [recovery-service.ts:271](planrecover-qol-site/lib/recovery-service.ts#L271), [paypal-webhooks.ts](planrecover-qol-site/lib/paypal-webhooks.ts).

**Completion:** define a provider-supported, explicitly approved refund path for invoice payments; retain original payment identity and refund capacity; reconcile pending/completed refunds into linked negative ledger effects; keep partial/full refunds idempotent. Route supported invoice notifications to canonical invoice reads, or explicitly document polling-only behavior and its latency. Do not assume an invoice payment ID is a checkout capture ID.

### 5. Finish the conversational creation/action experience — medium priority

**Implemented:** durable private chat, a bounded Bedrock tool loop, nine MCP tools, review-confirmation endpoints and a button/form-based simulated voice client.

**Missing:** normal website chat never sends the optional `agent:true` flag, so its natural-language requests use the answer-only branch. Even with that flag, inference requires an already selected plan (`provider && record && facts`), so a person with no plan cannot ask the model to create their first one. The simulated voice page calls fixed tools through buttons/forms; it does not provide a free-form conversational action flow. Receipt preparation/review is not exposed among the agent tools.

Evidence: [plan-assistant.tsx:62](planrecover-qol-site/components/plan-assistant.tsx#L62), [assistant route:36](planrecover-qol-site/app/api/assistant/route.ts#L36), [agent-tools.ts:18](planrecover-qol-site/lib/agent-tools.ts#L18), [agent-demo/page.tsx:12](planrecover-qol-site/app/agent-demo/page.tsx#L12).

**Completion:** connect normal authenticated chat to review-only planning tools, support a planless creation context, and provide a receipt-review handoff for the promised conversational workflow. Preserve explicit browser approval and exact financial controls. A physical Alexa+ service is a separate integration, not a prerequisite for the accepted simulator scope.

### 6. Preserve agent tool results when a turn is interrupted — medium priority

**Implemented:** inputs are reserved before inference; completed replies replay idempotently; transcripts reload; interrupted inputs are retained without automatic billed retries.

**Missing:** each preparation tool generates a new proposal UUID, without a conversation/request/tool-call idempotency key. Tool results accumulate in memory and reach transcript metadata only when the entire model turn succeeds. If a proposal is saved and the following inference or transcript save fails, its review reference can be lost to the conversation. The proposal endpoint requires a known UUID and has no private pending-proposal list.

Evidence: [bedrock.ts:148](planrecover-qol-site/lib/bedrock.ts#L148), [assistant route:44](planrecover-qol-site/app/api/assistant/route.ts#L44), [assistant route:55](planrecover-qol-site/app/api/assistant/route.ts#L55), [agent-tools.ts:30](planrecover-qol-site/lib/agent-tools.ts#L30), [agent-proposals route:6](planrecover-qol-site/app/api/agent-proposals/route.ts#L6).

**Completion:** checkpoint tool calls/results against the durable request before further inference, reuse a stable proposal identity on explicit continuation, and let the caller recover pending previews. Verify a failure after tool persistence exposes the same preview after reopening without duplicate proposals or financial actions.

### 7. Generate reminders from all promised canonical sources — medium priority

**Implemented:** preparation tasks, `item.deadline`, manually saved reminders and sent invoice due instants; lead times, deduplication, rescheduling and delivery fences.

**Missing:** reminder synchronization does not read `item.expires`, saved supplier quote expiry, `booking_policies.cutoff` or pending checkout/share-payment state. Registering a policy only inserts the policy; it does not create a matching reminder. These deadlines are covered only if someone separately copies them into an existing reminder/deadline field. Delivery status responses also always label email/push `unconfigured`, even when a delivery adapter could be configured.

Evidence: [reminder-jobs.ts:17](planrecover-qol-site/lib/reminder-jobs.ts#L17), [reminder-jobs.ts:154](planrecover-qol-site/lib/reminder-jobs.ts#L154), [recovery-service.ts:248](planrecover-qol-site/lib/recovery-service.ts#L248), [planning-preferences route](planrecover-qol-site/app/api/plans/[planId]/me/planning-preferences/route.ts).

**Completion:** derive quote-expiry, cancellation-cutoff and agreed outstanding-payment reminders from their canonical versioned records, retire obsolete reminders, preserve recipient scoping, and report actual channel configuration separately from delivery verification.

### 8. Handle departures from partially collected bookings — medium priority

**Implemented:** ordinary multi-item departures, affected-member approvals, zero-sum cost adjustments and preserved original capture/refund payees.

**Missing:** when confirmed collection is greater than zero but below the booking price, the service rejects departure reallocation and requires merchant review. There is no guided resolution for the common deposit-paid/balance-outstanding case, especially with an active invoice. Existing provider-operation and invoice blocks are protective, but they do not finish the departure workflow.

Evidence: [plan-changes.ts:49](planrecover-qol-site/lib/plan-changes.ts#L49), [plan-changes.ts:123](planrecover-qol-site/lib/plan-changes.ts#L123).

**Completion:** freeze or resolve existing collection, distinguish collected cost from the unpaid obligation, obtain revised approvals, replace affected invoice/payment terms safely, and retain original contributions/refund recipients. Never silently transfer the departing person's debt.

## B. Built adapters and services that still need activation

| Priority | Integration | Current verified position | Remaining work |
| --- | --- | --- | --- |
| High | Signed PayPal webhook delivery | Private verifier/inbox and hardened local relay exist. Production environment has **no `PAYPAL_WEBHOOK_ID`**; the handler returns 503 without it. Public relay remains undeployed by the user's local-only instruction. | When authorized to go online, deploy/register the relay for the same sandbox app, configure the returned webhook ID privately, verify genuine signed delivery and duplicate replay. Preserve the private Site audience. |
| High | Unattended background checks | Manual hosted runner previously passed. Native Site readback in this audit confirms the existing hourly task is still **`is_enabled:false`**. | Resume the same task through supported controls once account sign-in works, confirm enabled state and observe a new persisted unattended run. A manual run is not proof of a scheduled tick. |
| High | Working Bedrock inference | Credentials/profile are configured. Latest AWS chat/status records Canada Nova Lite cross-region **TPM/RPM zero** and a pending quota request. This audit made no AWS calls. | Wait for a concrete access/quota change, follow the zero-spend/Free-plan policy, then verify one bounded hosted call before broader chat/draft/receipt checks. |
| Medium | Supplier service | Generic sandbox contract exists; no supplier origin/token is present in the production environment. | Select an authorized supplier, implement its actual protocol, configure the account, and complete booking/cancellation verification plus A2. |
| Medium | Email/push service | Generic delivery contract, private destinations, opt-in and retries exist; no notification origin/token is present in production. Provider acknowledgment is not proof of receipt. | Supply a compatible service or provider-specific bridge, configure credentials, and verify delivery/failure handling. Browser Web Push subscription registration, service-worker push handling and VAPID setup are not supplied by the generic `/deliver` contract if that is the chosen push channel. |
| Optional Amazon scope | Location, Textract, Step Functions | Adapter code exists; production has no AWS adapter credentials/enable flag, activity/state-machine identifiers or workflow-token key. | Provision/configure only within the user's cost policy, then verify each selected integration. Bedrock's bearer key does not supply these credentials. A complete Step Functions recovery machine also depends on A1; the current template only demonstrates approval handoff. |

Environment readback establishes absence of the named settings in the current Site revision; it does not inspect other hosting accounts or establish their configuration.

## C. Hosted validation and operational readiness still open

1. **Invoice deposit/balance journey:** actual send, buyer partial payment, final payment and repeated reconciliation against exact incremental ledger effects. Then add the invoice refund journey once A4 exists.
2. **Multiple signed-in people:** owner/editor/viewer access, separate private preferences, exact approvals, each member's checkout and revoked membership. Current live evidence is a one-person CAD 16.00 capture / CAD 12.80 refund, with CAD 3.20 retained. That successful scenario should not be described as missing.
3. **Whole recovery journey:** ordinary plan → approvals → payments → independent supplier booking → disruption → multi-booking recovery/replacement → reconciled final balances. Existing component tests do not prove that connected journey.
4. **Hosted database plus receipt-object restore:** local SQLite backup/restore rehearses records, references and immutable triggers. No reviewed evidence establishes an actual hosted D1 and R2 restore, object-byte recovery or disaster-recovery runbook drill.
5. **Operational monitoring and intervention:** owner-only operation metadata and job status exist. A configured failure/staleness alert path, comprehensive stuck-operation queue and documented operator resolution/rollback procedures are still needed for unattended operation. No monitoring integration was found in this source. Keep alerts and recovery tools free of secrets and private member preferences.
6. **Hosting from GitHub:** the repository is currently a source mirror. It has no configured automatic deployment. Moving the backend requires a trusted identity/session gateway, identity mapping, actual database/object bindings and data migration, secrets, callbacks and jobs. See [HOSTING.md](planrecover-github/docs/HOSTING.md). Source upload does not move users or saved receipts. The latest Site usability delta also needs synchronization with the mirror before it becomes the release source.

## D. Deliberate limits and optional future work

These are not missing foundations for the agreed CAD sandbox demonstration:

- Production payments, multiple payment currencies/FX automation and multi-merchant onboarding are not implemented; the present provider flow is CAD sandbox.
- Invoices support buyer-initiated partial payments and one due instant, not a general merchant milestone/installment calendar or automatic debits.
- Financing is a private saved amount, not a lender-verified repayment schedule or custom lending service.
- A physical Alexa+ connection remains separate; Fire TV is an optional client extension. The accepted initial scope permits the simulator.
- Weather-triggered review and opt-in email ingestion remain future integrations. Calendar export already exists and should not be re-listed as missing.
- Receipt history/retry, browser OCR, Bedrock PDF handling, quantities/discounts and safe tracked-object cleanup are implemented. Real model extraction is externally blocked as described above; older untracked objects are intentionally not blindly deleted.

## Suggested implementation order

1. Unify constraints and private affordability (A3); finish invoice refund accounting (A4).
2. Implement supplier booking projection/reconciliation (A2), then the linked recovery workflow (A1).
3. Connect conversational tools and durable tool checkpoints (A5–A6).
4. Complete reminder sources and partial-collection departures (A7–A8).
5. Activate selected providers/scheduling, complete the hosted journeys and exercise restore/monitoring. Resume AWS testing only after the recorded restriction changes.

Existing identity/privacy, immutable financial history, exact approval snapshots, checkout, capture-based partial refunds, persisted receipt review and adapter safeguards should be extended rather than rebuilt.
