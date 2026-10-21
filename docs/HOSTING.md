# Hosting and migration

This public repository contains the application's frontend and backend source. Publishing source does not publish saved plans, accounts, private files or server secrets, and does not migrate the original [Site deployment](https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site). The source now includes a separate Vercel target; deployment and hosted verification must establish its live status.

## Vercel target

[`vercel.json`](../vercel.json) selects native Next.js and `pnpm build:vercel`. [`scripts/build-vercel.mjs`](../scripts/build-vercel.mjs) prepares PDF assets, temporarily copies the Vercel proxy template to the ignored root `proxy.ts`, builds Next.js with webpack, and removes its generated proxy afterward. The output is `.next-vercel`, using `tsconfig.vercel.json` to keep generated route types separate from Vinext's `.next/types`.

The build aliases the existing server environment to [`lib/vercel/runtime-env.ts`](../lib/vercel/runtime-env.ts) and the identity wrapper to [`platform/vercel/identity-provider.tsx`](../platform/vercel/identity-provider.tsx):

- **Database:** Turso/libSQL supplies persistent SQLite through an adapter for the D1 operations used by this application. Existing repositories and financial checks retain SQL-backed storage. Builds and application startup do not run migrations.
- **Authentication:** Clerk verifies each session. The proxy strips every incoming `oai-authenticated-user-*` header, then supplies internal identity from the verified user and verified primary email. Invalid sessions, unavailable profiles and unverified primary emails supply no application identity.
- **Origins:** Clerk's authorized parties use exact deployment/branch origins from Vercel's system environment. Production also includes the production domain. `CLERK_AUTHORIZED_PARTIES` allows additional exact HTTPS origins; no wildcard trusts unrelated previews. Missing production origin configuration fails closed.
- **Private files:** Private Vercel Blob replaces the object-storage binding. Short-lived scoped grants let browsers upload directly. Before attaching a file to a receipt or plan, the application rechecks membership, size, type and digest. Authorized downloads stream through application routes; receipts and documents are not public Blob files.

Clerk account IDs use a separate `clerk:` namespace. Matching an email does **not** claim an old Site account or transfer plans, approvals, financial history or file access. Existing data requires a reviewed import and explicit identity mapping.

## Configure and deploy to Vercel

Use Node.js 24 and the pnpm version pinned in `package.json`. Link and inspect the intended Vercel team/project before pulling environment settings or applying migrations. Configure the selected environment using [`config/vercel.env.example`](../config/vercel.env.example):

| Setting | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | TLS libSQL/HTTPS database endpoint |
| `TURSO_AUTH_TOKEN` | Server-side database credential |
| `CLERK_SECRET_KEY` | Server-side Clerk credential |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public Clerk browser key |
| `BLOB_READ_WRITE_TOKEN` | Server-side token for a **private** Blob store |
| `CLERK_AUTHORIZED_PARTIES` | Optional comma-separated exact HTTPS custom-domain origins |

Keep private values in Vercel settings and ignored local environment files. Only Clerk's publishable key is intended for the browser. Expose Vercel system environment variables so origin checks identify the current deployment. The build script and `vercel.json` supply hosting flags.

After selecting and pulling the correct environment:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm db:migrate:vercel
```

The migration command reviews pending changes without applying them. After reviewing the database, environment and backup, apply them explicitly:

```sh
pnpm db:migrate:vercel --apply --project=<verified-project-id>
pnpm build:vercel
```

The tool checks `.vercel/project.json`, requires its matching project ID for writes, records migration checksums and refuses to initialize a database containing unmanaged tables. Schema migration does not copy Site data.

Deploy the selected source to the linked project and verify its preview before production release. Check sign-in/out, account separation, plan saving, editor/viewer access, private uploads and streamed downloads. Check provider-dependent features separately when configured. A successful build or fixture test does not establish hosted/provider verification.

## Optional services and migration boundaries

AWS Bedrock, SES, PayPal sandbox, supplier adapters, Web Push and external workflow services retain their optional settings in [`config/server.env.example`](../config/server.env.example), [`config/adapters.env.example`](../config/adapters.env.example) and [`config/operations.env.example`](../config/operations.env.example). Deployment does not transfer credentials, quota, verified senders, callback/webhook registrations or live status. Manual receipt review and saved-plan answers work without a live AI provider.

PayPal remains sandbox-only. Deliberately register new approved destinations and retain signature/duplicate-event checks before verifying payments, refunds and invoices. Webhook and scheduled-runner routes remain reachable without a Clerk visitor session; their provider signatures or service credentials enforce access.

**No Vercel cron schedule is configured.** Deployment does not enable reminder delivery, scheduled cleanup or a background runner. Configure and verify those operational paths separately, including service access and saved enabled state. The Site's request-scoped connected-app capabilities are not automatically available on Vercel.

Keep the original deployment and backups available during cutover. Imports must preserve provider IDs, immutable financial records, approval history, membership and object references. Verify database/file restoration and explicit old-to-new identity mappings before moving existing users.

## Original Site/Cloudflare target

`pnpm build` still uses Vinext/Vite with a Cloudflare Worker, D1 binding `DB` and private R2 binding `BUCKET`. `pnpm db:migrate:local` and `pnpm start` use local storage; `pnpm dev` retains loopback-only mock sign-in. The default identity wrapper is a no-op, preserving the Site gateway's authenticated identity.

`.openai/hosting.json` preserves the original Site/binding metadata and contains no server credentials. Publishing that deployment still uses its supported Site workflow. A GitHub push does not itself update the Site. Select the intended source revision so an older mirror cannot replace newer work.

## GitHub Pages

GitHub Pages serves static HTML/CSS/JavaScript. It cannot run this application's APIs, database, private file access, AI calls, webhook verification or payment reconciliation. An intentionally separate static demo could show a limited frontend but would not replace either full application target. See [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
