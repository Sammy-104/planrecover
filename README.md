# PlanRecover

Full application source for the Paypal + Amazon Hackathon project: shared planning, per-person approvals, PayPal sandbox payments, recovery workflows and receipt review.

The original Site deployment is available at [PlanRecover](https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site). This public repository contains the complete frontend/backend source and a Vercel target using native Next.js, Turso, Clerk and private Vercel Blob. A build or source push does not migrate accounts, plans, files or provider settings. **GitHub Pages cannot run this backend.** See [hosting and migration](docs/HOSTING.md) for setup and verification.

## Run locally

Use Node.js 24 and the pinned pnpm version from `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate:local
pnpm start
```

These commands use the original Vinext/Cloudflare runtime and local storage. The local migration command changes local development storage only. Private provider settings belong in ignored `.dev.vars` or the deployed platform's secret settings; [config/server.env.example](config/server.env.example) and [config/adapters.env.example](config/adapters.env.example) contain setting names only. The source works with manual receipt review and saved-plan answers when AI providers are unavailable. Local development can also use `pnpm dev` with the starter's loopback-only mock sign-in.

## Vercel hosting

[`vercel.json`](vercel.json) runs `pnpm build:vercel`, which builds native Next.js without changing the original Cloudflare target. The Vercel runtime uses a Turso/libSQL adapter for the application's D1 database operations, verified Clerk sessions with exact allowed origins, and private Blob storage with direct uploads and authenticated streaming downloads.

Link and verify the intended Vercel project, configure the names in [config/vercel.env.example](config/vercel.env.example) privately, then review `pnpm db:migrate:vercel`. Applying migrations requires `--apply --project=<verified-project-id>`; builds never apply them automatically. Run tests and type checking, build with `pnpm build:vercel`, and verify a hosted preview before release. [The hosting guide](docs/HOSTING.md) covers the sequence and migration boundaries.

Clerk users have a separate identity namespace: an email match does not transfer an existing Site account or its plans. Existing saved data and files need an explicit import. AWS/PayPal/email credentials and registrations remain separate optional setup, and no Vercel cron schedule is enabled by this deployment configuration.

## What is included

- `app/`, `components/`, `lib/`: React/TypeScript interface, API routes, domain services, validated agent tools and provider adapters.
- `db/`, `drizzle/`: schema plus additive migrations, financial-history protection and durable workflow state.
- `public/`: application assets, browser receipt OCR runtime/language files and their licenses.
- `tests/`: offline regression suites using real migrated SQLite and injected provider fixtures. The main test runner disables live network calls.
- `services/paypal-relay/`: separately deployable, disabled-by-default PayPal webhook receiver, offline tests and cutover guide.
- `docs/project-records/`: implementation/audit/testing records. Historical reports are preserved as evidence and may describe earlier releases.
- `.openai/hosting.json`, `build/`, `scripts/`: original Site/Cloudflare build and hosting integration.
- `platform/vercel/`, `lib/vercel/`, `vercel.json`: native Next.js Vercel target, verified identity, database compatibility and private file adapters.

The first source import is based on application commit `8bd3ed44d97fea2948234eccaa1f4f4ca2f909ab` (Site version 14). See [source provenance](config/source-export.json) for later imports. The original beta walkthrough is retained in [README-HISTORICAL.md](README-HISTORICAL.md).

## Current behavior and limits

The [October17 audit resolution](docs/AUDIT_RESOLUTION.md) lists each correction and remaining external evidence gate.

Use [current readiness](CURRENT_BACKEND_STATUS.md) and [scope](docs/CURRENT_SCOPE.md) for current behavior; [the eight backend gap fixes](BACKEND_GAP_FIXES.md) describe the prior release, alongside the historical [backend expansion](BACKEND_EXPANSION.md). Run the full offline suite for this source; the October17 audit fixes add dedicated financial, receipt, browser and operations regressions. `/flows` exposes recovery/departure proposals, invoices, private availability and source evidence. `/agent-demo` is a simulated client using the same validated tools as the OAuth MCP transport; it does not establish a physical Alexa+ connection.

PayPal calls remain pinned to sandbox. New external adapters require explicit private configuration and approvals. Pending refunds never fund new payments. Live AWS inference is dependent on the account's quota and the [zero-spend testing policy](docs/project-records/AWS_TESTING_POLICY.md). Provider setup, genuine invoice/multi-account testing, public relay activation and scheduler access remain separate operational work. See the [judge walkthrough](docs/JUDGE_WALKTHROUGH.md), [operations runbook](docs/OPERATIONS_RUNBOOK.md) and [submission draft](docs/SUBMISSION_DRAFT.md).

## Relay checks

After installing the root dependencies:

```sh
node --test services/paypal-relay/tests/relay.test.mjs
node --experimental-transform-types --disable-warning=ExperimentalWarning services/paypal-relay/tests/inbox.integration.mjs
```

These checks use fixtures and the application's actual migrated webhook inbox. Deployment of the relay remains a separate explicit action; [its guide](services/paypal-relay/README.md) explains configuration and rollback.

Credentials, real customer/payment/receipt data, local databases, dependency folders, generated builds, screenshots, source archives and duplicate historical checkouts are excluded from the public source. Synced project attachments were preserved locally and are not deployment source.
