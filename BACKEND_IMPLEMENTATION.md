# PlanRecover backend: implemented increment

**Current release:** [BACKEND_GAP_FIXES.md](BACKEND_GAP_FIXES.md) supersedes the historical implementation counts and remaining code gaps below. The eight audited code gaps now have implementations and regression coverage; 49 suites pass. External provider activation and genuine hosted journeys remain separate.

**Current status:** [BACKEND_EXPANSION.md](BACKEND_EXPANSION.md) and [CURRENT_BACKEND_STATUS.md](CURRENT_BACKEND_STATUS.md) supersede the historical milestones below. The October 15 expansion passes 46 regression suites. Configurable adapters are implemented; external setup and genuine provider verification remain open. Use `/flows` for changes, cancellations, invoices and private preferences, and `/agent-demo` for the simulated voice client.

12 October 2026. Working checkout: `planrecover-backend/`. The v25 export and synced project references are preserved. This increment implements the first backend milestone and adds payment/webhook safeguards plus the selected Alexa+ integration foundation. The full product backlog remains in `../PlanRecover_Backend_Workflow.md`.

## Implemented

- Separate plan records and versions, normalized membership and profile records, and member-owned private preference records.
- Atomic database writes that update the existing workspace interface and the new plan records together. Edits to different plans through the new API use independent plan versions; the existing interface retains its workspace version during this staged migration.
- Idempotent legacy import, guarded structural normalization, preserved approval/payment IDs, and inaccessible accounting records after plan deletion.
- Strict action, membership and invitation request validation. Personal action actors come from trusted server identity.
- Private preferences filtered from every plan-state response, including history, sharing, place search and payment results. Explicitly approved PayPal.Me links remain available for repayments. Missing private budgets produce a member-review state rather than a confirmed affordability claim.
- New invitations expire after seven days, expired invitations can renew, and revocation cannot race a successful shared write. Historical memberships and financial obligations remain intact. Existing invitations with no expiry remain compatible.
- CAD-only sandbox payment gates, exact approved payer amounts, quote/revision checks, authenticated personal payer checks and canonical capture verification.
- Refund authorization for the exact approved demo hike cancellation and capture. Saved refund responses and invoice IDs support retries. General recovery, partial shuttle refunds and shared-member provider checkout are subsequent milestones.
- Durable verified webhook inbox with attempts, processing leases, errors and completion state. Raw signed event formatting is preserved. Repeated events and late capture/refund events reconcile without duplicate money, including retained deleted-plan accounting.
- Stateless MCP endpoint and a packaged planning Agent Skill for the user-selected Amazon Alexa+ track. Tools read accessible plans, schedules, the caller's money and outstanding decisions.

## API contracts

| Route | Behavior |
|---|---|
| `GET /api/plans` | Lists plans owned or joined by the signed-in caller |
| `POST /api/plans` | Creates a personal plan from `{plan:{...}}` |
| `GET /api/plans/:planId` | Returns an authorized plan with its plan version and the caller's own preferences |
| `PATCH /api/plans/:planId` | Applies `{version,action}` with a server-bound actor; rejects stale plan versions |
| `GET /api/plans/:planId/me/preferences` | Returns only the caller's preference record and its version |
| `PATCH /api/plans/:planId/me/preferences` | Updates `{version,preferences}` with private-record conflict protection |
| `/api/workspace` | Compatibility interface used by the current app, backed by the same transaction/repository |
| `/api/trip-share`, `/api/plan-members` | Validated invitation, joining, profile and owner-role management |
| `/api/paypal/:action` | Existing sandbox checkout/capture and narrowly supported refunds with stronger value/authority checks |
| `/api/webhooks/paypal` | Verified, durable and retryable provider event processing |
| `POST /mcp` | MCP initialization, discovery, resource reading and authenticated tool calls |

Plan update actions cannot create/select/reset/delete another plan through this endpoint. Destination changes that create another identity use the existing workspace flow or a new plan. Unknown and inaccessible plan IDs are concealed. Viewer roles cannot mutate plans or preferences.

The current Sites gateway supplies trusted identity headers. This source does not treat arbitrary public client headers as an authentication system for a different host. The existing localhost-only test identity fallback is preserved for local previews.

## Run locally

Use Node.js 24 and the checked-in pnpm version. Keep the lockfile.

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate:local
pnpm dev
```

`db:migrate:local` uses the built app's D1 binding, applies only missing migrations and explicitly runs in local mode. It cannot select a remote database. The initial four migrations are preserved; additions are `0004_pretty_lester.sql` (plans/members/privacy/transaction guards), `0005_dusty_thor.sql` (nullable invitation expiry), and `0006_spooky_blink.sql` (webhook lifecycle/index).

For a built Worker preview on a separate port:

```text
pnpm start --port 5184
node scripts/smoke-local.mjs http://127.0.0.1:5184
```

The smoke check creates a clearly named verification plan in the local test database. It uses no payment provider. The built preview does not emulate Sites sign-in; hosted authentication is verified separately. The local development preview supports its existing mock sign-in integration.

In this Windows session the first portable development preview conflicted with an existing server and a second development launch disconnected. The supported built-Worker preview ran successfully on port 5184; its actual database/API/MCP flow passed. No existing preview was stopped.

## Alexa+ foundation

Endpoint: `/mcp`. Streamable HTTP uses a stateless JSON response to each POST. The client sends `Accept: application/json, text/event-stream`, `Content-Type: application/json` and its negotiated `MCP-Protocol-Version`. Supported versions are 2025-11-25, 2025-06-18 and 2025-03-26. GET returns 405 because this implementation provides no SSE listening stream.

Tools:

- `list_plans` with `{}`.
- `get_plan` with `{planId}`.
- `get_my_money` with `{planId}`; the caller's private preferences stay scoped to their identity.
- `get_decisions` with `{planId}`.

Discovery and the static skill resource contain no user data. Every data-bearing call resolves current identity and plan membership. These tools do not execute payments, refunds, bookings or edits. The skill is available as the MCP resource `planrecover://skills/planning` and as `public/agent-skills/planrecover-planning/SKILL.md`.

The [Amazon Alexa+ hackathon resources](https://amazonappdev2026.devpost.com/resources) describe MCP, Agent Skills and Streamable HTTP, including a simulated web experience. This source implements that backend surface; an actual external Alexa+ agent connection and demo client remain to connect and verify. Sites is configured with the `mcp` capability and owns its hosted OAuth integration.

## Verification completed

- Full TypeScript check passed.
- Final Worker/client build passed, including `/mcp` and all new plan routes.
- All 24 test suites passed with live provider access disabled. They include real SQLite migration/repository tests and bundled actual-route tests, rather than canned database responses.
- 85 named checks cover plan persistence, access/privacy, concurrent writes, invitations, MCP, webhooks, payment boundaries and existing financial invariants; additional request-validation and feature checks also passed.
- All seven migrations applied successfully to the isolated local D1 database.
- Actual built Worker smoke passed: create/list/edit plan, private preferences, current workspace compatibility and authenticated MCP money.

PayPal tests use provider fixtures. Actual buyer approval/capture and signed sandbox delivery are not established by these tests. The current local configuration has no PayPal credentials. No real money moved, no invoice was sent and no Amazon/AWS account resources were provisioned.

## Hosting and next work

The existing manifest identifies `appgprj_6ac5a35ae2308191ac33bd2bf8a8ef9a`. Both Site lookup and source-write credential requests returned `Sites project not found` in the connected account. The source identity is preserved; no replacement Site was created and no hosted source/database was changed. Restoring access to that Site or selecting an explicitly authorized deployment target is needed before publishing or connecting its hosted MCP server.

Next implementation milestones:

1. Connect sandbox credentials and verify genuine buyer approval, capture and webhook delivery.
2. Freeze durable approval/payment intents and make ledger/operation transitions atomic; add scheduled reconciliation of unresolved operations.
3. Support participating shared members' individual checkouts and source-backed recovery for arbitrary bookings, including partial refund allocation.
4. Complete persisted receipt extraction/review drafts, real plan-linked invoices and configurable reminder delivery.
5. Connect an Alexa+ agent/demo client to this MCP surface; then add proposal previews through the same validated plan services.
6. Add natural-language draft generation and complete personalized supplier-backed suggestions.

See `HACKATHON_INTEGRATIONS.md` for the official tools and provider references.

## October 14, 2026 implementation update

This update supersedes the earlier connection and hosting status above. The implementation is now maintained in `planrecover-sandbox-site`, linked to private Site `appgprj_6acda78092f88191983f45ead7f29505`. The four connected PlanRecover Sandbox MCP tools were called through platform OAuth against the saved verification plan; each passed and the plan stayed at version zero. The older original Site ID remains preserved separately.

Amazon Bedrock now has a Workers-compatible Converse adapter with mandatory schema validation, fixed AWS endpoints, bounded input/output, a deadline and sanitized errors. `POST /api/plans/{planId}/draft` returns reviewed suggestions only; it verifies member role, plan/private-budget freshness, real participant IDs, currency, local dates and task owners. Code adds budget/cash/conflict warnings. AI has no provider transaction tools. Durable per-member leases and hourly limits bound request concurrency and usage.

Receipt uploads and extraction/review drafts are persisted before inference, retain null source facts and warnings, survive reopening, and require explicit source-field resolution before the existing group-review action. Bedrock is preferred when configured; existing OpenAI extraction and manual review remain supported.

Owner-triggered `POST /api/paypal/reconcile` repairs saved interrupted capture/refund outcomes using canonical provider GETs and replays saved verified failed/stale webhook events. Fenced leases, bounded batches and cooldowns prevent uncontrolled retries. It never creates, captures or refunds a payment. Provider IDs must already be saved; a provider response lost before ID persistence needs separate merchant review.

The new work uses additive migrations0007(receipt drafts),0008(provider reconciliation attempts) and0009(AI usage limits). AWS region/model/key are not configured. An actual AWS inference call, an Alexa+ device/service, signed PayPal webhook delivery and genuine refunds remain unverified. General policy-backed partial refunds, participant checkout, plan-linked invoices, scheduled reminders/reconciliation and relational immutable financial history remain unfinished. See `AI_BACKEND_TESTING.md` for account setup, route examples and validation steps.
