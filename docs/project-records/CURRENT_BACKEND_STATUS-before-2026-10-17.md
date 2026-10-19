# Current backend status — October 15, 2026

**Current release:** [BACKEND_GAP_FIXES.md](BACKEND_GAP_FIXES.md) supersedes the historical implementation counts and remaining code gaps below. The eight audited code gaps now have implementations and regression coverage; 49 suites pass. External provider activation and genuine hosted journeys remain separate.

The October 15 implementation is documented in [BACKEND_EXPANSION.md](BACKEND_EXPANSION.md), which supersedes the historical report below. General recoveries/departures, private conversation continuation, nine MCP tools with review previews, receipt extraction history/retries/PDF/quantity support, safe source cleanup and configurable external adapters are implemented. Browser controls are at `/flows` and `/agent-demo`. All 46 regression suites and full TypeScript checking pass. External adapter activation and genuine provider journeys remain explicitly open; no live AWS calls or new provider payments were made by this implementation. Publication details are recorded separately after the supported build/deployment finishes.

## Historical October 14 report

This report supersedes earlier milestone lists. Canonical source is `planrecover-sandbox-site`, linked to the existing private PlanRecover Sandbox Site. Synced references and the original export remain read-only.

## Implemented

- Append-only relational financial facts, status history and exact approval snapshots. Database triggers protect immutable records. Provider operations, balances and financial history commit in the same transaction; duplicate provider effects cannot add money twice.
- Each participating signed-in editor can check out their own approved share. Canonical order identity, purchase unit, currency and amount are checked before capture. Owner-only fictional merchant quotes preserve archived/deleted history. Checkout and invoices share a funding claim to prevent collecting the same share twice.
- Immutable original provider requests support bounded recovery of a missing approval-order identity. Existing captures/refunds are repaired from canonical reads. Automatic jobs do not capture money, issue refunds or send invoices.
- General policy-backed recovery proposals record source terms, exact per-capture partial refunds and affected-member approvals. Reserved plus confirmed refunds cannot exceed captured capacity or the confirmed policy ceiling. External supplier bookings remain manual; only the fictional sandbox merchant can issue PayPal refunds.
- Plan-linked invoices freeze the approved item, recipient, amount, partial-payment minimum and explicit due instant. Recipients approve terms before the owner explicitly sends. Verified PayPal payments increment cost/contribution once; unsupported or mismatched evidence requires review.
- Private availability, dietary/accessibility needs, time zone, buffers and reminder preferences. Durable in-app reminder jobs support cancellation/rescheduling, leases, current-source fences and unique notifications. Email/push preferences are saved but their delivery providers are unconfigured.
- Owner-confirmed supplier and travel evidence has public HTTPS provenance, freshness/expiry, venue identity checks, versioned revocation and bounded storage. AI suggestions attach evidence only to an exact unique saved place; unmatched facts stay unknown. Code checks availability, schedule conflicts, travel/buffers, hours, needs, budgets and cash reserve. Inference-time changes invalidate stale previews.
- The four OAuth-connected MCP tools remain read-only. Decisions include recipient-scoped invoice actions, required recovery approvals and the caller's unread notifications, with currency/decimal metadata. The actual MCP route skips normalization writes.
- Owner-triggered background checks in Settings plus a separately authorized unattended runner. Fair owner selection and persisted plan cursors prevent starvation. Renewed leases and cooldowns fence concurrent jobs. Paginated financial history retains access to later events and approval revisions.

## Verification

All **38 regression suites** passed with live provider access disabled. Tests include actual bundled routes and real migrated SQLite transactions, financial fault injection, lost responses, duplicate events, canonical value mismatches, changed approvals, private member access, lease theft, cursor fairness and source changes during inference. Full TypeScript checking passed. The supported Site helper performs the final Worker build, source push and package from the same source revision.

New migrations `0010`–`0013` are additive and retain prior data; schema now contains 32 tables. Credentials stay in runtime secret settings. No invoice was sent or PayPal refund/capture submitted during these regression checks.

## Account-dependent verification still open

- Live Bedrock needs an AWS bearer key and the actual account-specific application inference profile ARN. The hosted region is Canada Central (`ca-central-1`) and application-profile mode is required. No AWS resources were provisioned and no inference was billed.
- The authenticated MCP connection is established; a physical Alexa+ device/service is not connected. The read-only MCP/Agent Skill path can support the hackathon client/demo.
- Signed PayPal webhook delivery remains unverified. The private Site gateway cannot accept an anonymous provider callback; keep its audience private and use an appropriate authenticated forwarding design before enabling signed delivery.
- Genuine partial refunds and invoice payment/send flows still need sandbox account testing with explicit approvals. Offline fixtures establish implementation behavior, not provider delivery.
- Live supplier inventory/booking authority, email and push delivery remain unconfigured. Saved owner-confirmed evidence and in-app reminders are usable now. Pending refunds never prove cash availability.

See `BACKEND_FEATURE_GUIDE.md`, `PLAN_INVOICES.md`, `RECOVERY_BACKEND.md`, `docs/PLANNING_AND_REMINDERS.md`, `AUTOMATION.md` and `BEDROCK_SETUP.md` for use and setup.
