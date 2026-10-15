# Hosting from GitHub

The repository is private source control for the full application. Pushing files here does not migrate the existing live application, its users, database, uploaded receipts or server secrets. The current private deployment remains available at [PlanRecover](https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site).

## GitHub Pages

GitHub Pages publishes static HTML/CSS/JavaScript; it does not run the server/API routes, database, private receipt storage, webhook verification or payment reconciliation in this project. The user selected a full-source repository for backend-capable hosting rather than a static preview. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Existing supported hosting

The current build uses Vinext/Vite with a Cloudflare Worker, D1 binding `DB` and private R2 binding `BUCKET`. `.openai/hosting.json` preserves the existing Site identity/bindings; it is metadata, not a secret. The original Site workflow also provides authenticated visitor identity and request-scoped connected-app capabilities. Keep using that supported workflow to update the existing deployment.

GitHub is a source mirror unless an explicit synchronization/deployment integration is configured. A push here currently does not publish the Site. Later development should deliberately select which repository is authoritative and synchronize changes before publishing, to avoid replacing newer changes with an older snapshot.

## Moving to another backend host

Cloudflare Workers is compatible with the current runtime model, but the exported application is not a ready-made unauthenticated public Worker. A migration needs these concrete steps:

1. Select the hosting account and domain; confirm its plan/cost constraints. No cloud resources or paid hosting are created by this source import.
2. Add a trusted authentication gateway or verified session integration and map its verified identities into the existing membership model. The current `oai-authenticated-user-*` headers are trusted because the Site gateway supplies them. **Never accept those headers directly from public callers on a standalone deployment.** Preserve existing identity mappings so historical obligations do not move to another user. Replace the Site sign-in routes and connected-app binding where applicable.
3. Configure an actual D1 database and private R2 bucket. The starter's placeholder database ID is for local development. Review `vite.config.ts` and the generated `dist/server/wrangler.json` before configuring a new Worker. Migrate data through supported database/object-storage backup and import tools; repository files contain no production data.
4. Install the pinned dependencies and build with `pnpm build`. Run all tests and type checking. Use Node 24 for the SQLite-backed regression suites. All tests use injected provider fixtures; running them does not verify live providers.
5. Apply every additive `drizzle/` migration to the selected database before serving the matching code. Preserve immutable financial records, provider IDs, approval history and object references. Verify backups and restore behavior before moving real saved plans.
6. Enter provider credentials only in the new platform's private secret settings. `config/server.env.example` and `config/adapters.env.example` list the names. Reconfigure the PayPal sandbox SDK origin, allowed callbacks and webhook registration for the selected deployment. Keep sandbox-only gates in place.
7. Update absolute deployment references (for example, the relay destination, private background-runner allowlist and agent-skill links) deliberately. Configure the separate public webhook receiver only after the private authenticated app is ready. Keep the existing Site private until a different audience is explicitly requested.
8. Run hosted identity/membership, receipt privacy, duplicate-event, payment/refund and invoice checks. Re-enable a background schedule only after service access and the saved enabled state are verified. Then switch the chosen domain/entrypoint and retain a rollback route.

The source import neither provisions these resources nor enables automatic deployment. No credentials are needed to browse the code or run offline tests.
