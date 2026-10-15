# PlanRecover sandbox setup and test results

**October 14 feature completion update:** All 38 regression suites passed with live provider access disabled. The expanded backend includes immutable financial/approval records, atomic money transitions, participant checkout, generic partial recoveries, plan-linked invoices, durable reminders/automatic jobs, private planning constraints and owner-confirmed source evidence. [Current report](planrecover-sandbox-site/CURRENT_BACKEND_STATUS.md) and [step-by-step guide](planrecover-sandbox-site/BACKEND_FEATURE_GUIDE.md) supersede older unfinished-feature notes below. Live Bedrock, Alexa+ device/service, signed webhooks and genuine refund/invoice delivery remain unverified.

Verified October 12–13, 2026.

## Available now

- Private test website: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site
- Hosted MCP endpoint: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site/mcp
- Working hosted source: `planrecover-sandbox-site/`. The original Site identity and `sources/` references are preserved.
- Local implementation and sandbox payment history: `planrecover-backend/`.
- PayPal's existing Default Application supplies the sandbox client credentials. Local values are in an ignored `.dev.vars`; hosted values are masked Sites secrets, environment revision 1. Neither is committed to source.
- Verified Canadian personal buyer: `sb-axyye53123777@personal.example.com`, with CAD 5,000 in virtual test funds before checkout. Retrieve its password from PayPal Developer → Testing Tools → Sandbox Accounts → the personal account. The developer-dashboard tab remains available.

## Completed payment test

The newly staged fictional Local history museum quote had four demo members approving CAD 16 each. The buyer completed Sam's sandbox checkout.

| Evidence | Result |
| --- | --- |
| PayPal order | `62G44465GT905132M`, completed, CAD 16.00 |
| Capture in PlanRecover | `45Y272409N4413455` |
| Saved expense | One confirmed sandbox event for 1,600 CAD cents |
| Paid participant | Sam |
| Sam's confirmed cost and contribution | CAD 256.00, including CAD 240.00 seeded history and CAD 16.00 sandbox capture |
| Sam's merchant amount due | CAD 0.00 |

This transaction is saved in the local test database. The hosted copy has separate storage; local payment history was not copied into it. Payment completion does not establish a real supplier booking.

## MCP and backend verification

- Seven backend test suites passed, covering request validation, payment boundaries, invites, persistence, API routes, MCP and durable webhooks.
- Five MCP integration checks passed, including the July 2026 discovery protocol, metadata/header validation, legacy clients, authentication and private money access.
- An independent official MCP SDK client connected to the local Worker over Streamable HTTP, read the Agent Skill and successfully called all four tools: `list_plans`, `get_plan`, `get_my_money`, `get_decisions`. Read calls left the plan version unchanged.
- Type checking and the hosted build passed. Hosting applied the masked PayPal secrets successfully.
- The hosted personal plan **MCP connection verification** is available for the next authenticated remote call.

The platform uses protocol `2026-07-28`, which required adding `server/discover` and modern result metadata while retaining the older initialization handshake. The published server includes that compatibility fix.

## Remaining connection verification

The platform-provisioned PlanRecover Sandbox MCP plugin is installed, and the user completed Connect. Its callable tools have not appeared in this active chat's tool inventory. Start a fresh message asking: **Test the connected PlanRecover MCP and read my MCP connection verification plan.** The next check should call all four tools through platform OAuth.

Website sign-in and MCP OAuth are separate. The hosting gateway rejects browser-only and Site-service-token MCP calls before they reach the Worker. An unsuccessful browser-only test bridge was removed.

The Alexa+ track's permitted simulated integration has been tested locally. An Amazon Alexa+ device/service has not been linked. Signed sandbox webhook delivery and real sandbox refunds also remain unverified; no webhook listener was registered.

## Run the local checks again

Use Node 24 and the project directory `planrecover-backend/`. The local launcher now loads its ignored `.dev.vars` automatically:

```text
pnpm test --backend
pnpm typecheck
pnpm build
pnpm start --port 5184
```

In a second terminal, with that local preview running:

```text
pnpm test:mcp:local
```

The independent MCP check reads existing personal plans and does not make payments. The museum's fixed demo quote expires October 15, 2026; later checkout testing will need a refreshed quote.

## October 14, 2026: connected MCP and Bedrock/backend work

All four PlanRecover Sandbox tools are now available and successfully called in this chat through the platform OAuth connection: list_plans, get_plan, get_my_money, get_decisions. The saved MCP connection verification plan (8c7516cc-20ec-4f81-a662-43eb6e7cdbb1) remained at version0 after the reads. Earlier tool-loading-pending status above is resolved.

Implemented this turn:
- Bedrock Converse adapter, bounded request/output, strict validation, sanitized provider errors and no automatic billed retries.
- Authenticated plan draft preview endpoint, currency/participants/date/timezone/task-owner validation, private-budget projection, code-generated budget/cash/conflict warnings and stale-version protection.
- Durable per-member/per-feature inference leases and20-attempt hourly limits.
- Receipt upload/extraction/review drafts persisted before inference; nullable source facts, explicit review resolution, saved-upload reopening and server-side reviewed-draft matching guards.
- Owner-triggered canonical PayPal reconciliation for saved interrupted captures/refunds and previously verified inbox events; leases, bounded batches, retained deleted-plan accounting and terminal refund status protection. No new payment/refund is initiated by reconciliation.

The final full offline run passed all28suites. TypeScript passed. New suites contain16AI-route,10Bedrock-adapter,10receipt and15reconciliation checks. Ten additive/legacy migrations applied to isolated localD1. The built Worker passed the independent official MCP SDK client: four tools, Agent Skill, private preference access and unchanged plan version. A synthetic one-pixel receipt uploaded to localR2 survived a fresh draft read; the receipt screen reopened it with unknown values blank and group-review approval blocked.

Canada Central (ca-central-1) and required application inference profile mode are configured on the private Site. Live AWS inference is not tested: no Bedrock API key or account-specific application profile ARN is present. AWS's Canada Nova Lite system profile is a candidate source for an application profile; inspect actual Canadian routing destinations in your account before activation. See planrecover-sandbox-site/BEDROCK_SETUP.md and AI_BACKEND_TESTING.md for exact setup and tests.

Remaining work: provider response lost before ID persistence; scheduled reconciliation/reminders; generic policy-backed partial refunds and participant checkout; plan-linked invoices; append-only relational approval/ledger history; richer receipt allocations/PDF inference/retention; supplier-backed availability/accessibility/travel constraints; Amazon Alexa+ physical/service connection. Signed webhook delivery and actual refunds remain unverified. Synced references and the original export were preserved. The corresponding implementation files were synchronized back to planrecover-backend without copying secrets, database state or the separate hosted Site ID.

Published private Site version5 successfully on October14. Deployment: appgdep_6acfa14ce9c4819184615633a4024831; environment revision2; source commit cc1b827187192535422b9ba1fc36f18108b64acf. URL: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site. All four connected OAuth MCP tools passed again after deployment, with the verification plan still at version0. Site access remains owner-only (custom policy with one allowed account). The receipt UI correction was rebuilt/typechecked and verified: unknown source fields stay blank, no matched-share claim is displayed, and Save for group review is disabled until review is complete.
