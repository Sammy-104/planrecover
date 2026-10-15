# PlanRecover hackathon integrations

**Current status:** [CURRENT_BACKEND_STATUS.md](CURRENT_BACKEND_STATUS.md) supersedes earlier unfinished-feature lists. Immutable financial history, participant checkout, generic partial recovery, invoices, automatic jobs, reminders and richer planning checks are implemented. Live AWS/Alexa+ and signed payment delivery still require account-dependent verification.

Implementation notes checked against organizer and vendor documentation on October 12, 2026.

## Implemented in this backend increment

The existing PayPal sandbox REST adapter remains the transaction boundary. It stays pinned to `https://api-m.sandbox.paypal.com`; this increment never creates a live transaction, sends an invoice, changes credentials, or deploys infrastructure.

- Orders require a CAD plan, a current revision, all required approvals, a positive unpaid payer share, an unexpired quote, and shares that sum to the quoted total. Personal plan payers are bound to the authenticated account supplied by the trusted Sites gateway.
- Captures recheck those conditions before calling PayPal. Server reconciliation checks the exact order, purchase-unit reference, operation custom ID, completed capture, currency, and amount. If an edit races an actual capture, the expense is preserved without marking a changed revision paid.
- Full refunds require the exact fully approved fixed demo hike recovery plus a matching original server-verified capture. A lodge cancellation cannot authorize a refund of its nonrefundable charge. The shuttle's partial cancellation policy requires a durable per-capture allocation and remains blocked.
- Refund provider responses are persisted before the workspace revision check, allowing a retry after a conflicting save to reconstruct the same ledger entry. This is an improvement to the existing operation table, not a complete durable payment worker.
- Invoice requests are isolated by authenticated workspace and request ID; retries with another buyer email are rejected. The created invoice ID is persisted before fetching its details. The invoice remains the separate CAD 240 demo example with a CAD 60 partial-payment minimum; it is not yet connected to plan balances.
- Shared-link payment and invoice requests are explicitly rejected until shared payer permissions and reconciliation are implemented. Payment responses use the same private-preference filtering as workspace responses.

PayPal documents server order capture after buyer approval and recommends request IDs for idempotent API calls. Its refunds API accepts a captured payment ID and an optional amount for partial refunds. Provider request-ID retention varies by endpoint; a deterministic key does not replace durable internal reconciliation. See [capture API](https://developer.paypal.com/api/orders/v2/orders-capture), [refund API](https://developer.paypal.com/api/payments/v2/captures-refund), and [REST request guidance](https://developer.paypal.com/api/make-api-requests/).

## Available PayPal hackathon resources

The [PayPal AI Hackathon resource page](https://paypalaihackathon.devpost.com/resources) lists the REST APIs, Checkout, Invoicing, Webhooks, AI Toolkit, Agent Toolkit, MCP quickstart, and Postman among its resources.

The [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit) provides coding-agent skills and a sandbox MCP integration. The [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) exposes PayPal capabilities to agent frameworks. These are optional integration tools; they do not replace application authorization, revision approval, or payment accounting. No PayPal MCP tool is connected in this session, so implementation uses the existing REST adapter and official API references. No toolkit package or credential configuration was added.

The [official Postman guide](https://developer.paypal.com/api/rest/postman/) provides a route for exploring and manually verifying PayPal APIs. Add a project-owned sandbox collection covering create, approve, capture, completed-capture webhook, authorized refund, pending refund, duplicate event, and conflicting revision when sandbox credentials and a test endpoint are configured. Do not put a client secret or access token in an exported collection.

## Amazon track fit

The [Build, Ship, Shape: Amazon Developer Hackathon resources](https://amazonappdev2026.devpost.com/resources) describe primary tracks for Fire TV, Alexa+, Bee, and Ring. AWS Builder is a mini-challenge attached to a primary-track submission. A generic AWS-backed website alone does not demonstrate a primary-track device integration. Confirm the selected submission track before investing in device-specific code.

The user selected the Alexa+ track. This increment adds POST /mcp with initialization, tool/resource discovery and four authenticated read-only planning tools, plus a packaged planning Agent Skill. The organizer permits a simulated Alexa+ web experience using MCP, Agent Skills and Streamable HTTP. No external Alexa+ agent or device is connected yet; connect and verify that client after hosting access is restored. Future proposal previews should use the same validated planning services.

The [Amazon Devices Builder Tools documentation](https://developer.amazon.com/docs/adbt/get-started) provides an MCP server and skills for device development, with Vega support and limited Fire OS support. These tools focus on setup, documentation, profiling, crash analysis, and device testing. They are not a database, payment processor, or backend hosting layer. Installing them now would not help the current plan-persistence work.

The organizer page lists Amazon Bedrock, AgentCore, Strands, Kiro, and SageMaker as examples for the AWS Builder mini-challenge. A later backend adapter could use Bedrock for draft planning or receipt interpretation while retaining the current server validation and reviewed receipt revisions. No compatible Amazon or AWS backend connector is available in this session, and no AWS account resources, billable services, or infrastructure were created.

## Required payment work before broader rollout

1. Freeze approved item/revision/payer/currency amounts in a durable intent record, including the exact cancellation policy and refund allocation for each capture.
2. Reserve and transition each intent atomically; add provider timeouts, classified retries, a recoverable provider-response store, and a scheduled reconciliation worker for uncertain outcomes.
3. The indexed, durable verified-event inbox is implemented with fenced processing leases, retries and error state. Raw signed event formatting survives verification. Capture/refund accounting is preserved after the plan restoration window expires. Genuine signed sandbox delivery remains to verify; add scheduled reconciliation for unresolved operations.
4. Commit ledger events and operation transitions together, with unique capture/refund constraints. Avoid text evidence as the duplicate-refund relation.
5. Implement partial refunds and cross-plan/shared-payer permissions against durable records, then add meaningful sandbox integration tests for late webhooks, lost responses, duplicate requests, changed revisions, and rejected refunds.
6. Link invoices to an approved plan revision, reconcile deposits and balances from provider events, and keep draft creation distinct from sending.

The current code and ten pure payment-boundary checks cover authorization and value validation. They do not establish end-to-end PayPal delivery, complete retry durability, or production readiness.

## October 14, 2026 connected integration update

Actual PlanRecover Sandbox plugin calls now succeed through platform OAuth: `list_plans`, `get_plan`, `get_my_money`, `get_decisions`. The verification plan remained unchanged. This resolves the earlier tool-loading issue and validates the hosted MCP connection; it does not establish a physical Alexa+ device link.

Amazon Bedrock integration uses the official AWS bearer-key Converse API. The server adapter and planning/receipt routes are implemented and tested with injected provider fixtures. No live AWS call was made; account region, Converse model/profile and server secret still need configuration. See `BEDROCK_SETUP.md` and `AI_BACKEND_TESTING.md`.

Owner-triggered PayPal reconciliation now repairs saved canonical capture/refund outcomes and retries previously verified webhook inbox entries. It initiates no new payment/refund. Scheduled retries, signed delivery and general refund policies remain later work.
