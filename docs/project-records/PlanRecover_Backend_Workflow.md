# PlanRecover backend implementation workflow

**October 14 current status:** The remaining code milestones below are implemented in `planrecover-sandbox-site`: immutable financial history, member checkout, partial recovery, invoices, reminders/jobs and saved-evidence planning checks. All 38 suites passed. Use [the current report](planrecover-sandbox-site/CURRENT_BACKEND_STATUS.md) and [feature guide](planrecover-sandbox-site/BACKEND_FEATURE_GUIDE.md); historical next-step lists below are superseded. Live Bedrock credentials/profile, physical Alexa+ and signed provider delivery remain separate setup/verification steps.

Prepared 12 October 2026, America/Toronto.

Basis: the expanded `unpacked-v25/PlanRecover/PlanRecover_Blueprint.md`, including sections 16–18, checked against the saved v25 implementation. This is a proposed implementation backlog. Existing source and synced references have not been changed.

**Start by extending the existing backend.** The current app already has server routes, D1 persistence, R2 receipt storage, authenticated collaboration, exact-money calculations, sandbox checkout and verified webhooks. The work is to make those foundations support the complete product reliably.

**Recommended architecture:** retain TypeScript, Vinext/Workers, D1, R2 and the existing trusted Sites identity integration for the first milestones. The blueprint's Next.js/Supabase/Render architecture is an alternative design, not the stack in this export. Moving to it would require database, storage, deployment and authentication migration. Record that decision before implementation; the workflow below assumes the current stack.

## What exists and what needs work

| Area | Existing v25 implementation | Backend work remaining |
|---|---|---|
| Plans and collaboration | Personal plans, named members, viewer/editor links, server-bound actors, version checks | Per-plan persistence, validated API contracts, normalized roles/invitations, private preferences, explicit membership lifecycle |
| Planning and approvals | Items, participants, flexible shares, tasks, schedule rules, votes and revision approvals | Durable immutable approval snapshots, quote/policy records, availability and constraint handling across arbitrary plans |
| Money | Integer minor units, exact receipt splitting, contribution/cost separation, manual repayments | Append-only relational ledger, purchase/payment reconciliation, durable financial projections and evidence links |
| PayPal | Sandbox order creation/capture, provider IDs, signature verification | Reliable operation state and reconciliation, participating-member checkout, capture-bound refund authorization, partial refunds |
| Receipts | R2 uploads, optional AI extraction, manual review, claims and approvals | Persist upload/extraction drafts, preserve unknown fields, extraction/review revisions, richer item/tax/discount data, abandoned-upload cleanup |
| Recovery | Exact Algonquin demo, dependency traversal, departure proposals | General supplier-backed options, real-capture recovery, resumable execution and compensation |
| Invoices | Separate fixed draft service example | Plan/member linkage, issuance, deposits/balance schedules, provider lifecycle and payment reconciliation |
| Suggestions | City/place discovery, sources/photos, saved ideas and scheduling previews | Complete constraint-driven personalized evaluation, provenance/freshness, natural-language plan drafting, supported supplier inventory |
| Reminders | Stored/derived in-app deadlines and task completion | Configurable lead times, durable deduplication, rescheduling, optional delivery |
| Operations | Domain invariant tests and optimistic writes | Route/database/provider integration tests, jobs, monitoring, migrations, recovery and hosted verification |

The READMEs contain some historical descriptions; use the actual v25 code as the behavioral baseline.

## Dependency-ordered implementation

| Phase | Deliverables | Completion check |
|---|---|---|
| 0. Reproducible development | Working checkout, pinned dependencies, separate local/test D1 and R2, applied migrations, repeatable test/build commands | App runs locally; existing checks have a recorded baseline; test configuration is separate from the hosted Site |
| 1. Plans, identity and privacy | Plan repository, validated requests, authenticated roles, membership/invitations, private member preferences, per-plan versions | Owner/editor/viewer permissions work through the API; another member cannot read private budgets; concurrent edits cannot overwrite one another |
| 2. Planning, approvals and ledger | Plan items, participants, dependencies, immutable allocation/approval revisions, append-only financial events and summaries | Every approved share reconciles; changed terms invalidate approval; transfers and installments do not duplicate expenses |
| 3. Reliable PayPal sandbox | Durable order/capture/refund operations, verified webhook inbox, indexed provider references, retry/reconciliation worker | A genuine sandbox capture is recorded once despite retries, duplicate events or a failed database write; payment and booking remain separate |
| 4. Complete receipt lifecycle | Persisted upload drafts, extraction/review status, editable items and allocation rules, approved expense/adjustments, repayment confirmation | A receipt survives refresh/extraction failure; exact totals match; linking a purchase cannot create a duplicate expense |
| 5. General recovery and departures | Disruptions, confirmed dependency graph, supplier policy/quote snapshots, computed options, current approvals, action execution | A non-fixture sandbox booking supports cancellation/refund/replacement; departing members retain unresolved obligations until an approved adjustment |
| 6. Invoices and reminders | Real plan-linked merchant invoices, partial-payment reconciliation, due dates, configurable in-app reminders | Deposit and balance reconcile once; rescheduling retires obsolete reminders; invoice status is verified from the provider |
| 7. AI, suggestions and supplier adapters | Natural-language draft generation, personalized fit engine, sourced candidate adapters, feedback, explanations | Hard schedule/budget constraints are checked by code; unknown facts remain unknown; adding a suggestion creates a draft |
| 8. Hosted reliability | Integration checks, resumable jobs, operational diagnostics, migration/backfill validation, backup/restore rehearsal, end-to-end demo | Complete create → approve → pay → receipt → disruption → recovery journey works with genuine sandbox evidence |

Verification belongs in every phase. Phase 8 is the hosted end-to-end gate, not the first time tests are added. After phase 2, receipt work and AI/suggestion work can proceed alongside payment reliability. General recovery execution depends on the payment work.

## First implementation sprint

**First ticket: create, list, load and edit a personal plan with real membership, private preferences and concurrent-edit protection.** This establishes the boundary that every financial and recovery action will use.

1. **Create a working repository from the v25 export.** Preserve the export and `sources/`. Keep the lockfile. Use the export's declared Node minimum and pnpm version. The archive contains source, not saved user database contents or uploaded receipts.
2. **Establish the baseline.** Apply the four existing migrations to a separate local/test database. Run type checking, financial invariants, people/sharing, blueprint alignment and worldwide-planning checks, then build. Consolidate the relevant checks into a repeatable test command. The export notes that the current build wrapper expects GNU `timeout`; resolve local Windows compatibility during setup.
3. **Introduce an authenticated server boundary and runtime request schemas.** Resolve actor IDs from trusted authentication, validate each supported action, and enforce plan roles centrally. Reject malformed payloads, forged actors and unsupported money/currency inputs. If hosting outside Sites, configure a trusted identity integration before accepting its headers.
4. **Add the first schema migration and repository.** Introduce users/profiles, plans, plan_members, plan_invites and private plan_member_preferences. Initially store each plan's existing domain aggregate in `plans.body` with its own version. Normalize money/items/approvals as their phases are implemented. This reduces migration scope while preserving tested domain logic.
5. **Add the initial endpoints and compatibility adapter.** Implement create/list/load/edit plans and member-owned preferences. Keep `/api/workspace` serving the existing frontend while the new repository becomes authoritative. Return a member-safe projection; never return everyone else's budget, cash limit, reserve or private financing details.
6. **Prove the slice with route/D1 integration checks.** Verify owner/editor/viewer access, private-preference isolation, actor spoofing rejection, stale edits, independent edits to different plans, expired/revoked invites and lossless migration. Preserve historical member IDs, approved shares and provider evidence.

**Sprint exit:** two authenticated people can use one plan with the correct roles, maintain separate private limits, edit through the server, and survive refresh and conflicting updates. The existing financial invariant tests still pass.

The next ticket is durable sandbox payment operations and webhook reconciliation. Configure sandbox business credentials, separate buyer test accounts and a registered webhook in the test environment when that ticket begins. Configure the AI key for extraction/drafting work. These credentials do not block the foundation sprint.

## Proposed data and API boundaries

The following are proposed additions, not claims that these tables or routes already exist. Keep repository/service code between routes and persistence; reuse the pure calculations currently in `lib/model.ts` and `lib/money.ts`.

| Domain | Records to introduce or extend | Example API boundary |
|---|---|---|
| Identity and plans | profiles, plans, plan_members, plan_invites, member_preferences | `/api/plans`, `/api/plans/:id`, `/members`, `/invites`, `/me/preferences` |
| Planning and decisions | plan_items, item_participants, dependencies, tasks, approval_revisions, approval_responses, suggestion_feedback | `/items`, `/items/:id/revisions`, `/revisions/:id/approve`, `/tasks` |
| Supplier evidence | supplier_offerings, quote_snapshots, policy_snapshots, bookings | `/items/:id/quote`, server-only supplier adapter methods |
| Receipts | receipts, receipt_items, receipt_extractions, allocation_revisions, receipt_attachments | `/receipts`, `/receipts/:id/revisions`, `/receipts/:id/approve` |
| Money and payments | financial_events, financial_allocations, settlements, provider_operations, provider_references, webhook_events | `/money`, `/payments/orders`, `/payments/:id/capture`, `/settlements` |
| Recovery | disruptions, recovery_options, recovery_actions | `/disruptions`, `/recovery/preview`, `/recovery/:id/approve`, `/recovery/:id/execute` |
| Invoices and reminders | invoices, invoice_payments, invoice_due_terms, reminders, notification_preferences | `/invoices`, `/reminders`, `/me/notification-preferences` |
| Suggestions and jobs | suggestions, source_cache, operation_jobs, reconciliation_attempts | `/suggestions`, `/suggestions/:id/preview`, `/draft-plan`, server-only job handlers |

Plan-owned routes are scoped under `/api/plans/:id` unless they are provider callbacks or global search. Keep search/location/route adapters already present and add shared contracts, caching and failure handling as needed. Free activities, tasks and buffers require no payment records.

Use immutable approval snapshots containing participants, payer arrangements, amounts, currency, dates, supplier terms and quote expiry. Preference votes remain separate. A majority vote does not approve a member's financial obligation. Each payer authorizes their own checkout.

## Payment and recovery implementation details

Current priority evidence:

- `db/schema.ts:2` and `lib/store.ts:24` store/version the whole owner workspace. Move gradually to per-plan records.
- `lib/model.ts:142` defines an open-ended action shape. Replace route casts with discriminated runtime schemas.
- `app/api/paypal/[action]/route.ts:5,7` and `lib/paypal.ts:7` hardcode CAD; the app otherwise has currency helpers. Initially reject non-CAD provider operations explicitly, then add supported provider currencies with correct minor-unit formatting. Preserve original currency balances and avoid cross-currency debt netting.
- `lib/paypal.ts:7` and the refund route commit provider/ledger updates separately. Add durable intent and reconciliation so provider success remains recoverable after a process or database failure.
- `app/api/webhooks/paypal/route.ts:4` processes before recording the event, has no processing lifecycle and uses workspace scanning for some outcomes. Introduce a durable inbox and direct provider-to-plan/capture mapping, including archived/deleted plans.
- `lib/model.ts:141,253–257` fixes recovery to demo figures and item IDs. Replace those inputs with confirmed relationships and source-backed policies/quotes.
- The refund route currently accepts any executed recovery proposal in the trip. Bind authorization to the specific approved cancellation, item, capture and permitted refund amount.

Persist a provider operation before the network request. Include plan/item/member, approval revision, amount, currency, payload fingerprint, stable idempotency key, provider IDs, attempt count and status. A retry with the same key must carry the same approved payload. PayPal documents request-ID retries and endpoint-specific retention/support in its [idempotency guidance](https://developer.paypal.com/api/rest/reference/idempotency/).

Verify webhook authenticity, durably record the event, then process idempotently with retry/review states. Deduplicate provider event IDs and financial effects separately. Reconcile unresolved operations against provider state. This accommodates the repeated delivery described in [PayPal's webhook documentation](https://developer.paypal.com/api/rest/webhooks/).

Commit related local records together where practical. D1 provides transactional batches; use guarded transitions/constraints so a stale conditional write cannot leave another financial write committed. See [D1's database API](https://developers.cloudflare.com/d1/worker-api/d1-database/). External payments and bookings need explicit resumable steps and compensation rather than one database transaction. [Cloudflare Workflows](https://developers.cloudflare.com/workflows/) is a candidate for durable retries and waiting for provider events; confirm the existing host can bind it before choosing it. A persisted job worker can serve the same application interface.

General recovery must calculate retained costs, cancellation fees, refunds, replacement costs, new cash required, deadlines and per-member impacts from approved data. Reserve refundable capacity across pending operations so concurrent partial refunds cannot exceed the capture. Recheck current approvals and quote expiry before execution. A successful payment followed by failed booking remains visible and enters the refund/review path.

## Receipt, AI and discovery requirements

Persist the receipt record and object reference before extraction. Store extraction revisions, source evidence, unknown values and review flags; do not turn an unreadable amount into a confirmed zero. Add quantities, line discounts and explicit tax/tip allocation rules as required by the blueprint. Receipt reconciliation uses source totals, not an invented tax rate.

Keep the original approved expense and append reviewed corrections. Record actual payer contributions separately. Friend repayments have reported and recipient-confirmed states and do not create new expenses. A recipient-approved PayPal.Me handoff remains a user-operated payment instruction.

The existing receipt route already uses the Responses API. Reuse schema-constrained output for receipt extraction and natural-language draft plans, handle refusals/incomplete responses, and validate business facts independently. [OpenAI Docs on Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) documents the schema support; schema conformity does not establish price accuracy or authorize a financial action.

Evaluate suggestions in code before ranking: participant availability, dates, locations, opening-hours evidence, inbound/outbound travel, buffers, accessibility/dietary requirements, and complete per-member cost impact. Store source/freshness and distinguish unknown price, estimate and merchant quote. Private budgets stay private in returned group suggestions. Save/propose/add-draft flows remain separate from booking and payment.

Seed the expanded-plan acceptance catalog: a fitting free activity, a preparation task, a paid merchant item, a schedule conflict, an over-budget item and an unknown-price candidate. Supported live supplier inventory can replace the seeded adapter only when its availability, booking, cancellation and refund authority are actually available. A place-search result supplies none of that authority.

Invoices require the actual merchant service, provider ID, beneficiaries, agreed due terms and independent payment reconciliation. Partial payments do not establish automated installments. Financing remains provider-controlled; capture only member-provided or supported obligation data. Reminders use documented timezones/cutoffs, configurable lead times and deduplication keys; rescheduling replaces stale reminders. Start with in-app delivery, then add opted-in external delivery.

## Acceptance checks for the complete backend

- Shares exactly equal approved expense amounts in integer minor units.
- A dinner for two members creates no dinner obligation for the others.
- Private budgets/financing never appear in another member's API response or shared export.
- Changing dates, participants, shares, prices or terms invalidates prior financial approval.
- Duplicate captures/webhooks, out-of-order events and a crash after provider success produce one financial effect.
- Total pending plus completed refunds never exceed refundable capture capacity.
- A replacement costing CAD 15 more finally but CAD 105 now fails a CAD 100 immediate limit; pending refunds cannot fund it.
- Settled expenses followed by refunds create correct new friend balances through explicit adjustments.
- A departure preserves approved retained costs until all affected members accept a revision.
- Payment success and booking failure remain independent, reviewable states.
- A receipt linked to an existing purchase, repayment or installment never duplicates purchase cost.
- Schedule previews respect locked items, participant constraints, travel and buffers.
- Reminder changes persist and deduplicate; unknown deadlines remain unknown.
- Search/AI/provider outages leave saved plans and manual receipt review usable.
- Archiving/deleting a plan does not break reconciliation of outstanding provider operations.
- Hosted integration demonstrates real sandbox approval/capture, receipt review, general recovery and complete financial evidence.

For each ticket: define the API contract and completion examples, implement migration/service/route, add meaningful integration checks, connect the existing UI, and verify the complete user flow. Keep separate branches/commits for foundation, money/payments, receipts and recovery so each result is reviewable.

## October 14, 2026 current workflow

The connected hosted MCP is verified: all four tools passed on the saved verification plan through platform OAuth, with version unchanged. Active implementation is in `planrecover-sandbox-site`; the original export and synced `sources/` remain preserved.

The next backend slice is now implemented: Bedrock Converse transport; reviewed natural-language plan previews; durable receipt upload/extraction/review drafts; owner-triggered canonical PayPal reconciliation; and per-member AI concurrency/hourly usage controls. Follow `planrecover-sandbox-site/AI_BACKEND_TESTING.md` for tests and the live AWS configuration steps.

Continue in this order after AWS/provider verification:
1. Freeze immutable financial intent/approval snapshots and provider effects in append-only relational history with atomic operation transitions.
2. Resolve provider success when no response ID was persisted; add scheduled reconciliation using the same canonical service and safe job authentication.
3. Generalize supplier-backed policies, refundable capacity reservations, partial refunds and participant checkout beyond the fixed demo.
4. Link invoices to plans/beneficiaries/due terms and reconcile payments; implement opted-in reminder settings and durable delivery jobs.
5. Extend code-validated suggestions with availability, accessibility/dietary constraints, supplier evidence, travel and buffers; connect the permitted Alexa+ demo or actual device/service.

These remain implementation tasks; passing the current tests does not mark the whole backend complete.
