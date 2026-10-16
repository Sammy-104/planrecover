# Backend expansion — October 15, 2026

**Current release:** [BACKEND_GAP_FIXES.md](BACKEND_GAP_FIXES.md) supersedes the historical implementation counts and remaining code gaps below. The eight audited code gaps now have implementations and regression coverage; 49 suites pass. External provider activation and genuine hosted journeys remain separate.

This implements the code gaps recorded in the project-wide `BACKEND_REMAINING_WORK.md` audit. The working source is `planrecover-completion-site`, opened from the existing private Site. Historical checkouts and synced `sources/` are preserved. External providers use configurable adapters first, as requested. Account setup and real provider verification remain separate from implementation.

## Available flows

- **Settings → Review changes** (`/flows`): general member departures, connected-booking recovery comparisons, exact member approvals, dependency progress, replacement drafts, policy-backed refunds, invoices, private availability/reminders and confirmed opening-hours evidence.
- **Chat**: private saved conversations, continuation after reload, paginated history, durable interrupted inputs and idempotent completed replies. Demo member views have distinct contexts. Agent mode can prepare reviewed changes through bounded Bedrock tool use. Reads/replay never reinvoke inference. The saved-plan fallback works while AWS is unavailable.
- **Receipts**: immutable extraction revisions, explicit versioned retries, retained previous facts after failed retries, quantities/unit prices/line discounts, PDF extraction through a document-capable Bedrock profile, and tracked abandoned-source cleanup. Model results remain drafts requiring source review and member approval.
- **Voice assistant demo** (`/agent-demo`): a simulated client uses the actual authenticated MCP tools to read plans/money/decisions and prepare a new-plan preview. Browser speech playback is optional. This does not establish an Alexa+ device/service connection.

Recovery comparisons expose retained recorded costs, expected source-backed refunds, new cash required, final total, per-member cost changes and refund cash recipients. Dependency closure uses arbitrary saved bookings; cancellations proceed dependent-first. A paid cancellation pauses for each booking's existing approved refund workflow. Replacement items are separate unpaid drafts. Expected refunds never pay for replacements.

Departures retain the original captured payer/revision evidence. Approved zero-sum adjustments reallocate costs without rewriting contributions. Subsequent refunds return to original capture payers and reverse the current cost allocation. Partially collected bookings require explicit merchant review before departure reallocation.

## Authenticated endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /api/plans/:id/changes` | List, propose, approve, apply or cancel exact recovery/departure terms |
| `GET/POST /api/agent-proposals` | Read prepared item/task/new-plan previews; confirm application separately |
| `POST /api/agent-client` | Browser-session transport to the same validated MCP tools; `/mcp` retains OAuth gateway authentication |
| `GET/POST /api/conversations` | Caller-private conversation creation, list and paginated continuation |
| `POST /api/assistant` | Saved-plan answers; optional `agent:true`; durable conversation/request IDs |
| `GET /api/receipt/history` | Immutable source-extraction snapshots, using returned version cursor |
| `POST /api/receipt/retry` | Explicit current-version retry against the retained source |
| `GET/POST /api/plans/:id/supplier` | Owner-only saved quote/booking operations and explicit sandbox requests |
| `GET/PATCH /api/plans/:id/me/notification-destinations` | Private confirmed email/push destination; email must match signed-in identity |
| `POST /api/plans/:id/location` | Opt-in signed Canada Central place search and route estimates |
| `POST /api/plans/:id/workflow` | Explicit STANDARD Step Functions start, approval activity claim/callback and status |
| `GET /api/plans/:id/operations` | Owner-only operation metadata, configuration flags and background status |

All mutations validate identity, origin, membership, versions and bounded strict input. The nine MCP tools are four existing reads, `compare_recovery_options`, `get_change_status`, and three preparation tools (`prepare_plan`, `prepare_plan_action`, `prepare_plan_change`). Preparation saves previews; no MCP tool approves terms or executes payments/refunds. JSON schemas describe valid inputs; server validation remains authoritative.

## Configurable providers

Set credentials only in private server environment settings. `config/adapters.env.example` names settings without storing keys. Absent configuration causes no delivery/provider request. The deployed environment is preserved by this release.

**Supplier HTTP adapter:** public HTTPS origin, bearer token and `SUPPLIER_MODE=sandbox`; booking/cancellation additionally require `SUPPLIER_BOOKING_ENABLED=true`. The adapter receives `POST /quote`, `/book`, `/cancel`, `/status` with `Idempotency-Key` and a server-bound request/item snapshot. Quote response fields: `sandbox:true`, `quoteId`, `itemId`, `revision`, integer minor-unit `amount`, `currency`, ISO `expiresAt`, `available`, `terms`, HTTPS `sourceUrl`. Booking/status/cancellation fields: `sandbox:true`, `requestId`, `bookingId`, `quoteId`, `status` (`confirmed|pending|cancelled|failed`), `amount`, `currency`. Provider idempotency must survive retries. Booking requires exact unexpired quote, current participant approvals and verified sandbox funding. Different booking request IDs cannot book the same item revision twice. Uncertain outcomes retain the original request ID. This is a provider contract, not a claim of live inventory.

**Email/push HTTP adapter:** `POST /deliver` gets `{requestId,channel,destination,title,text}`, bearer authorization and stable `Idempotency-Key`. Respond `{accepted:true,requestId,deliveryId}`. Delivery requires current opt-in, source/member fences and a confirmed private destination. Provider acceptance is recorded separately from proof of inbox/device receipt. No provider account is selected or delivery enabled by this release.

**Amazon Location:** optional restricted AWS access credentials, `AWS_ADAPTERS_ENABLED=true`, pinned `ca-central-1` Places/Routes endpoints, SigV4, bounded validated responses and quota leases. Search uses `IntendedUse:SingleUse`; results are not persisted as licensed stored provider data. Route distances remain metres and durations seconds. These facts do not establish booking availability or supplier hours. [AWS SearchText](https://docs.aws.amazon.com/location/latest/APIReference/API_geoplaces_SearchText.html).

**Textract:** optional `RECEIPT_EXTRACTION_PROVIDER=textract` plus separately restricted AWS adapter credentials. Signs `Textract.AnalyzeExpense` in Canada Central. Inline PNG/JPEG only, up to 5 MB; PDFs use Bedrock/manual review. Missing/ambiguous amounts, currency, discounts and dates stay unknown. Raw detections/confidence are retained for review. No S3 bucket or AWS resources are provisioned. [AnalyzeExpense](https://docs.aws.amazon.com/textract/latest/APIReference/API_AnalyzeExpense.html).

**Step Functions:** needs a preconfigured Canada Central **STANDARD** state machine/activity, restricted credentials and `WORKFLOW_TOKEN_KEY` (32+ characters). `infrastructure/approval-workflow.asl.json` is a reviewable template. Activity tokens are encrypted at rest, scope-checked and sent only after saved affected-member approvals. Lost callbacks use execution-status reconciliation, not repeated approvals. Callback output explicitly leaves payment execution to the existing reviewed workflow. No machine/activity is created or invoked by this release. [Activity integration](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html).

**PayPal signed ingress:** `infrastructure/paypal-relay/worker.ts` provides a narrow public receiver forwarding original raw bytes and five signature headers to the existing private Site handler using supported service access. The private handler still verifies PayPal signatures and deduplicates events. Deploy/register this relay separately with private runtime secrets; it is not deployed or registered by this release. The Site audience stays owner-private. [PayPal verification](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post).

## Data and operations

Additive migrations `0015`–`0016` add nine tables (41 total), immutable change terms/approvals, receipt revision triggers, tracked object retention, private transcripts, provider operations and conversation context metadata. Applied migrations are unchanged. Abandoned managed receipt sources become eligible after 30 days; reviewed/referenced sources are retained. Deletion leases fence late review; extraction/financial history stays retained. Older untracked objects are not blindly deleted.

Full regression: **46 suites passed**, with all live network requests disabled unless a fixture provider is explicitly injected. Full TypeScript checking passed. Tests cover actual routes, real migrated SQLite transactions, atomic failures, privacy, funding limits, tool-loop validation, provider idempotency and encrypted callbacks. An isolated SQLite backup/restore rehearsal verified integrity, foreign keys, financial facts/history, object references and immutable triggers. It does not prove hosted D1/R2 disaster restoration.

The existing hosted private background runner completed successfully before this release. The existing hourly automation is retained; its saved enabled state is reported in the deployment report after verification. The runner never submits unattended capture/refund/invoice-send requests. When explicitly configured, external reminder delivery additionally requires the recipient's opt-in and destination confirmation.

## Still dependent on external setup or real verification

- Bedrock's Canada cross-region account quota remains zero. The existing quota request is pending; do not repeat inference until AWS state changes and the Free plan checks pass (`../AWS_SETUP_STATUS.md`, `../AWS_TESTING_POLICY.md`). This release makes no live AWS requests.
- Live supplier, notification, Location, Textract and Step Functions verification requires configured accounts, restricted credentials and the project's zero-spend policy. The Bedrock bearer key grants no general AWS adapter access.
- Public webhook relay deployment/registration and genuine signed end-to-end delivery remain open.
- Genuine invoice sending/partial payment and hosted multi-account approval/checkout journeys remain open. The previously verified CAD16 capture/CAD12.80 refund remains valid for that specific sandbox scenario.
- Physical Alexa+ linkage and optional Fire TV client work remain separate client/setup work.
