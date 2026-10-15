# PlanRecover backend: features and demo guide

**October 15 update:** [BACKEND_EXPANSION.md](BACKEND_EXPANSION.md) supersedes the historical capability/browser limitations below. Settings links to `/flows` for recovery/departures, cancellations, invoices, evidence and private availability; `/agent-demo` uses the expanded nine-tool MCP surface. Chat resumes private conversations and receipts retain immutable extraction history with explicit retries.

Updated October 14, 2026. Use [PlanRecover Sandbox](https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site) while signed in to its permitted account. Create a personal CAD test plan for payment exercises. Each participant must join and use their own signed-in account to approve or pay their share.

## What is implemented

- Saved plans, membership, private spending preferences and version checks that protect simultaneous edits.
- Permanent financial facts, payment-status history and approved revision snapshots. Financial effects and provider status commit together. Duplicate provider IDs cannot credit money twice, and accounting survives deleted plans.
- Individual member checkout for approved fictional merchant quotes. The server verifies the exact CAD amount, payer and provider order before capture. Checkout and invoice funding claims protect the same share from double collection.
- Plan-linked invoices with reviewed deadlines, optional partial payments, explicit sending, verified payment balances and recovery after interruptions.
- Recorded cancellation policies, affected-member approval, exact partial-refund allocations and shared refund limits. Generalized recovery supports fictional sandbox merchants; external bookings follow manual supplier review.
- Saved private availability, dietary/accessibility needs, travel buffers and reminder preferences. Owner-confirmed supplier/travel facts can inform draft checks while stale or missing facts stay unknown.
- Saved receipt uploads, extraction drafts, explicit source review and separate group approval. Model output cannot establish payment evidence.
- Owner background checks and an authenticated scheduled runner. They reconcile saved payment/invoice results, finish previously authorized recoveries, and deliver durable in-app reminders. They can recover an original approval-order identity within its saved replay window. They never submit unattended capture, refund or invoice-send requests.
- Four authenticated MCP tools: `list_plans`, `get_plan`, `get_my_money` and `get_decisions`. Decisions now include saved invoice/recovery actions and notifications.

The browser currently exposes Settings background checks, item review/approval, PayPal checkout and receipt review. The newer plan-linked invoice, generalized recovery, planning-evidence and private availability features are available through the authenticated endpoints below; full browser forms for those flows remain to add.

## Start with these browser checks

1. Open your personal test plan and go to **Settings → Payments and reminders → Run background checks**.
2. Expect either “Checks finished,” a review message, or “A check is already running or was completed recently.” A completed check does not mean a payment occurred. Review messages identify saved operations needing attention.
3. Refresh the plan and inspect its money and upcoming decisions. Repeat after one minute. Already recorded captures, invoice payments and reminders should remain recorded once.
4. In this chat, ask the connected **PlanRecover Sandbox** plugin: “List my plans, then show the test plan's schedule, my money and pending decisions.” The four MCP reads should return your accessible data without changing the plan version. Pending refunds must remain separate from cash available to spend.
5. For a receipt check, open the receipt editor and upload a PNG, JPEG, WebP or PDF under 8 MB. Refresh or reopen the draft. Fill unclear fields, verify the currency, claims, payer and exact total, and confirm the source review. Save the reviewed receipt for group approval. Each affected member then approves their share. A reviewed upload alone creates no financial expense.

The original Algonquin cancellation and “Simulate” controls use fixtures. A **PayPal sandbox** checkout uses actual PayPal test transactions with virtual funds. The automated test suite uses fake provider responses and sends no transactions or notifications.

## Prepare authenticated API exercises

The following requests run from the signed-in Site origin with `Content-Type: application/json`. Browser requests use your existing session; the server supplies the identity. API examples use sample IDs and versions that you must replace with returned values. Amounts are integer CAD cents: `1600` means CAD 16.00.

Fetch `GET /api/plans`, then `GET /api/plans/{planId}`. The latter returns `state`, `version` and `role`. Read actual member IDs from `state.people`. Re-read the plan after each change. A 409 means the saved version changed; fetch the latest version and review again. Preference, invoice, evidence and recovery versions are separate from the plan version.

For convenient same-origin requests, paste this helper into the signed-in Site's browser developer console:

```javascript
async function planRecoverRequest(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
```

Use the routes and payloads below with that helper or another authenticated application client. Keep payment approvals as deliberate user actions. Never insert a merchant secret or AWS key into browser requests.

## Quote, approve and pay one member's share

1. As owner, create a fictional merchant quote using a time inside the selected plan. Catalog choices are `museum` (CAD 16 per participant), `equipment-rental` (CAD 60), and `guided-activity` (CAD 90). Quotes expire after 24 hours.

```http
POST /api/plans/{planId}/merchant-quotes
Content-Type: application/json

{"version":0,"catalogId":"museum","start":"2026-10-16T14:00:00-04:00","participants":["YOUR_MEMBER_ID"]}
```

2. Read the returned item ID and revision. Each affected member reviews and approves from their own account, through the browser Review control or this request:

```http
PATCH /api/plans/{planId}
Content-Type: application/json

{"version":1,"action":{"type":"approve_item","itemId":"RETURNED_ITEM_ID","revision":1}}
```

3. Once all required approvals exist, each member pays their own share through **PayPal sandbox** in the browser. The API creation contract is:

```http
POST /api/plans/{planId}/checkout
Content-Type: application/json

{"operation":"create","itemId":"RETURNED_ITEM_ID","revision":1,"version":2}
```

The returned `orderId` identifies an approval order. Complete the buyer's sandbox approval through PayPal checkout before capture. The app then submits:

```json
{"operation":"capture","orderId":"RETURNED_ORDER_ID"}
```

4. Inspect the plan and `GET /api/plans/{planId}/financial-history?limit=100`. A completed CAD 16 single-member payment should create one confirmed sandbox expense of `1600`, with that member's cost and contribution recorded separately. Run background checks again and verify the expense remains single. Payment confirmation remains separate from supplier booking confirmation.

## Plan-linked invoice: deposit and balance

Use a separate approved, unpaid equipment-rental item for this exercise. The server blocks invoicing a share already reserved for checkout.

1. As owner, create the plan-linked invoice draft. This example uses a CAD 15 minimum against the catalog's CAD 60 single-member rental. The amount itself comes from the approved share.

```http
POST /api/plans/{planId}/invoices
Content-Type: application/json

{"version":2,"requestId":"11111111-1111-4111-8111-111111111111","itemId":"RENTAL_ITEM_ID","revision":1,"memberId":"BILLED_MEMBER_ID","email":"YOUR_SANDBOX_BUYER_EMAIL","due":"2026-10-16","dueAt":"2026-10-16T18:00:00-04:00","allowPartial":true,"minimum":1500}
```

Use a new UUID for a new invoice. Retry the same request ID and exact terms after an interruption. `dueAt` must fall on `due` in the plan's time zone. A full-payment invoice uses `allowPartial: false` and a minimum equal to the full share.

2. Fetch `GET /api/plans/{planId}/invoices/{invoiceId}`. Expect an unpaid `draft`, the approved amount, and zero paid. Draft creation sends no buyer notification.
3. The billed member explicitly approves its due date and partial-payment terms:

```http
POST /api/plans/{planId}/invoices/{invoiceId}
Content-Type: application/json

{"version":2,"invoiceVersion":1,"action":"approve","confirm":true}
```

4. The owner re-reads the latest versions, then sends `action: "send"` with `confirm: true`. This action can notify the sandbox buyer. Open the returned, verified sandbox `paymentUrl` as that buyer and make the CAD 15 payment.
5. Send `action: "reconcile"` with current plan/invoice versions, or run Settings background checks. Expect paid `1500`, outstanding `4500`, status `partially-paid`, and one incremental ledger expense. Repeat reconciliation: balances should remain unchanged.
6. Let the buyer pay the remaining CAD 45 and reconcile again. Expect paid `6000`, outstanding `0`, status `paid`, and the unchanged approved share marked paid.

Owners can see all plan invoices; other members see only their own invoice and recipient email. Paid invoices require refund review. The owner can explicitly cancel an unpaid invoice with `action: "cancel", confirm: true`. Changed terms need a new reviewed item revision. The Demo tools CAD 240 invoice remains a separate compatibility example. See [PLAN_INVOICES.md](PLAN_INVOICES.md).

## General cancellation and partial refund

Use an item paid through a verified sandbox checkout for this exercise. Existing seeded payments and invoice payment IDs do not establish a checkout capture eligible for this workflow.

1. As owner, record the actual reviewed cancellation terms using `POST /api/plans/{planId}/recoveries` with `type: "register-policy"`, current plan `version`, `itemId`, `revision`, and the policy object. Required policy fields are `merchant`, `merchantName`, `confirmedTerms: true`, `terms`, `evidence`, HTTPS `sourceUrl`, `refundableBps`, `cancellationFeeUnits` and an ISO `cutoff` or `null`. `8000` basis points means 80%; a `1000` fee means CAD 10. Use deliberately published fictional terms for the sandbox merchant, and actual reviewed supplier terms for `external-manual` bookings. AI text cannot supply this authorization.
2. Create the proposal using the returned policy ID:

```http
POST /api/plans/{planId}/recoveries
Content-Type: application/json

{"type":"propose","version":3,"policyId":"RETURNED_POLICY_ID","reason":"The fictional supplier cancelled this sandbox activity."}
```

3. Read the returned proposal, exact refund allocation and affected members. Each required member approves from their own account with `{ "type": "approve", "proposalId": "RETURNED_PROPOSAL_ID", "version": 1, "planVersion": 3 }`. Use current returned versions.
4. The owner reviews again and explicitly executes:

```json
{"type":"execute","proposalId":"RETURNED_PROPOSAL_ID","version":1,"planVersion":3,"confirmSandboxRefunds":true}
```

5. Inspect `GET /api/plans/{planId}/recoveries?proposalId=...` and financial history. Pending refunds remain pending; bank availability stays unverified. Run background checks after completion. Already submitted refunds should reconcile once, and the previously authorized cancellation should finish once all required refunds are confirmed.

Unresolved dependent bookings block execution. Price, participant, policy or revision changes require fresh review. External supplier refunds need completion outside PlanRecover. See [RECOVERY_BACKEND.md](RECOVERY_BACKEND.md) for the exact policy contract and refund limits.

## Private planning needs, source facts and AI drafts

1. Read `GET /api/plans/{planId}/me/planning-preferences`. Save your own availability, needs and reminder choices using its returned preference version:

```http
PATCH /api/plans/{planId}/me/planning-preferences
Content-Type: application/json

{"version":0,"preferences":{"timezone":"America/Toronto","availability":[{"start":"2026-10-16T13:00:00-04:00","end":"2026-10-16T18:00:00-04:00","status":"available"}],"dietaryNeeds":["vegetarian"],"accessibilityNeeds":[],"bufferMinutes":20,"leadMinutes":[60,0],"delivery":{"inApp":true,"email":false,"push":false}}}
```

These values stay private to you. Other members must review their own needs. In-app delivery is configured; email and push remain unconfigured even if requested.

2. The owner can save confirmed source facts at `/api/plans/{planId}/planning-evidence`. A supplier request has `{kind: "supplier", planVersion, version, confirm: true, evidence: {itemId, sourceUrl, checkedAt, openIntervals?, dietary?, accessibility?, expiresAt?}}`. A travel request uses `kind: "travel"` and evidence `{fromId, toId, sourceUrl, checkedAt, minutes, basis: "provider" | "estimate", expiresAt?}`. Use actual saved item/place IDs, a public HTTPS source and facts checked within the past 24 hours. Fetch existing evidence versions first; new evidence starts at version zero. Changed places, revoked evidence and expired facts stop influencing checks. Owner confirmation remains an attestation requiring review; live inventory has not been independently connected.
3. Follow [BEDROCK_SETUP.md](BEDROCK_SETUP.md) to configure an actual application inference profile ARN in **Canada Central (`ca-central-1`)** and an authorized server-side `AWS_BEARER_TOKEN_BEDROCK`. Required application-profile mode rejects direct models or profiles from another source region. Inspect the profile's actual inference destinations in AWS. The profile ARN and API key still need configuration and a live account test. Keep the key in server secret settings.
4. Once configured, request one short preview:

```http
POST /api/plans/{planId}/draft
Content-Type: application/json

{"version":3,"prompt":"Suggest a museum visit that fits my availability, dietary needs, travel buffers and current budget. Leave unknown prices unknown."}
```

5. Review `draft.warnings`, `draft.constraints` and every proposed item. Code checks dates, participants, overlaps, your availability, buffers, source-backed opening/needs facts and budget/cash fit. Missing evidence and other members' preferences remain unknown. The draft endpoint changes no plan or money.
6. To keep an item, explicitly submit its returned `action` to `PATCH /api/plans/{planId}` with the latest plan version. Review ordinary approvals afterward. An AI estimate supplies no merchant quote or refund authority.

Without valid Bedrock configuration, the preview returns a clear configuration error. Each member has at most one active request and 20 attempts per hour per AI feature. Live inference can incur AWS charges and is not part of the offline test suite. Receipt extraction additionally needs an image-capable model; PDFs remain available for manual entry. See [RECEIPT_BACKEND.md](RECEIPT_BACKEND.md).

## Current endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| GET, POST | `/api/plans` | List accessible plans; create a personal plan. |
| GET, PATCH | `/api/plans/{planId}` | Read a plan; apply a reviewed action with its current version. |
| GET, PATCH | `/api/plans/{planId}/me/preferences` | Your private spending preferences and version. |
| GET, PATCH | `/api/plans/{planId}/me/planning-preferences` | Your private availability, needs and reminder choices. |
| POST | `/api/plans/{planId}/merchant-quotes` | Owner creates a fictional CAD catalog quote. |
| POST | `/api/plans/{planId}/checkout` | Create or capture your approved sandbox checkout. |
| GET | `/api/plans/{planId}/financial-history` | Permanent event transitions and approval snapshots; paginated up to 100 per page. |
| GET, POST | `/api/plans/{planId}/invoices` | Read permitted invoices; owner creates an unpaid draft. |
| GET, POST | `/api/plans/{planId}/invoices/{invoiceId}` | Read; approve, send, reconcile or cancel as permitted. |
| GET, POST | `/api/plans/{planId}/recoveries` | Saved policies/proposals; register, propose, approve, execute or cancel a proposal. |
| GET, POST, DELETE | `/api/plans/{planId}/planning-evidence` | Read owner-confirmed facts; owner saves or revokes evidence. |
| POST | `/api/plans/{planId}/draft` | Validated Bedrock preview requiring review. |
| GET, PATCH | `/api/plans/{planId}/reminders` | Your saved reminders/notifications; mark your notification read. |
| GET, POST, PATCH | `/api/receipt` | Protected uploads, draft reads and explicit source review. |
| GET, POST | `/api/jobs/run` | Owner job status; Settings starts a bounded check using `{}`. |
| POST | `/api/jobs/scheduled` | Service-authenticated saved-workspace runner using `{}`. See `AUTOMATION.md`. |
| POST | `/mcp` | Authenticated Streamable HTTP with four read-only planning tools. |
| GET, POST | `/api/workspace` | Existing browser workspace compatibility. |
| POST | `/api/plan-members`, `/api/trip-share` | Existing membership and invitation workflows. |
| POST | `/api/paypal/{action}`, `/api/invoice` | Existing PayPal compatibility and separate draft-invoice example. |
| POST | `/api/webhooks/paypal` | Raw signed PayPal event verification and durable inbox processing. |

Receipt draft review accepts `{draftId, version, receipt, resolvedFields, currency}`. It uses the active selected plan, with optional `tripId` to guard against a plan switch. Invoices accept requests under 10 KB and actions under 1 KB; checkout/quotes are under 8 KB, recoveries and AI prompts under 20 KB, background request bodies under 64 bytes. A draft prompt is at most 4,000 characters. Protected routes derive identity from the authenticated gateway and enforce current membership.

## Automated and live verification

From this checkout, using Node 24 and installed dependencies:

```text
pnpm test
pnpm typecheck
pnpm build
```

These check the real migrations and application routes with isolated SQLite/R2 fixtures. They exercise transactions, concurrent edits, duplicate effects, interrupted outcomes, privacy, AI validation, reminder leases and service authentication. Passing them establishes application behavior under those fixtures.

For an independent local MCP check, migrate the separate local database, start the preview, then run the SDK test in another terminal:

```text
pnpm db:migrate:local
pnpm start --port 5184
pnpm test:mcp:local
```

Local data and hosted data are separate. Stop the preview after testing.

Live verification still needs the AWS application profile/key, an actual sandbox refund and plan-linked invoice payment journey. The connected PlanRecover MCP has passed real authenticated reads. A physical Alexa+ device/service is not connected. Signed PayPal webhook delivery currently needs a supported ingress that PayPal can reach; the private Site gateway blocks that provider callback. Owner/scheduled canonical reconciliation provides a separate path for saved results. Email and push delivery are unconfigured. The new API workflows still need fuller browser controls, live supplier integrations and broader production deployment checks.

Use [BEDROCK_SETUP.md](BEDROCK_SETUP.md), [PLAN_INVOICES.md](PLAN_INVOICES.md), [RECOVERY_BACKEND.md](RECOVERY_BACKEND.md), [RECEIPT_BACKEND.md](RECEIPT_BACKEND.md) and `AUTOMATION.md` for their detailed setup and testing contracts. Earlier implementation notes record earlier increments; this guide describes the current feature set.
