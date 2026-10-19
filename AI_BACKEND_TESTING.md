# Bedrock and backend verification

**Current readiness:** see [CURRENT_BACKEND_STATUS.md](CURRENT_BACKEND_STATUS.md). This guide preserves test procedures; older counts/setup assumptions below are historical. Bedrock secret names/profile mode are configured in the supplied deployment records, but successful hosted inference remains unverified. The MCP surface now has ten validated review-oriented tools.


The broader backend feature set is now implemented. See [CURRENT_BACKEND_STATUS.md](CURRENT_BACKEND_STATUS.md) and [BACKEND_FEATURE_GUIDE.md](BACKEND_FEATURE_GUIDE.md) for the complete current flows and 38-suite regression result. Canada Central, application-profile mode and secret names are configured; live AWS still needs account/quota resolution and successful invocation evidence.

The connected PlanRecover Sandbox MCP was verified on October 14, 2026 through its actual authenticated tools. `list_plans`, `get_plan`, `get_my_money` and `get_decisions` all succeeded on the existing **MCP connection verification** plan. Reading the plan again left its version at zero. This verifies the hosted MCP/OAuth connection; a physical Alexa+ device/service is a separate integration.

## Connect Bedrock

1. In your AWS account, select a Bedrock region and a Converse-compatible model or inference profile. Choose an image-capable model if you want receipt extraction. Record the exact model/profile ID.
2. Create an authorized Bedrock API key using the [AWS API key instructions](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html). Review the model's permissions, access and price in your account.
3. Set `AWS_BEARER_TOKEN_BEDROCK` as a **server secret**, plus `BEDROCK_REGION` and `BEDROCK_MODEL_ID` as server settings. Use the private Site's environment settings or the ignored `.dev.vars` file for local tests. Keep the key out of chat and source control.
4. Follow [BEDROCK_SETUP.md](BEDROCK_SETUP.md) for optional timeout/output limits. Rebuild/restart the local Worker after local settings change. Hosted secret updates use the Site's environment revision/deployment workflow.
5. Test one short plan draft first. The server makes one potentially billed call, checks the output in code and returns a preview. It does not change the plan or transact money. Each member has at most one active request and 20 attempts per hour per AI feature.

## Test a plan draft

Sign in, create/select a personal plan and obtain its current `planId` and version using `GET /api/plans` and `GET /api/plans/{planId}`. Send this same-origin authenticated request:

```http
POST /api/plans/{planId}/draft
Content-Type: application/json

{"version":0,"prompt":"Suggest an afternoon museum visit and a free preparation task for the current participants."}
```

Replace zero with the returned current version. The response contains `provider`, `modelId`, token usage and `draft` with warnings, unknown prices, equal-share previews and ordinary editable actions. Review any chosen action and submit it individually to `PATCH /api/plans/{planId}` with the current version. Re-read the plan after each edit. Free items create no financial events; priced items remain subject to normal review/approval rules. AI estimates supply no merchant checkout or refund authority.

Without configured AWS settings the draft endpoint returns HTTP 503 / `BEDROCK_NOT_CONFIGURED`. This is the behavior for an unconfigured environment. The existing private deployment has settings present; inspect its actual sanitized provider error and account/quota evidence rather than assuming a missing key. A changed plan/private budget returns 409; missing membership returns 404; viewing-only members get 403; a concurrent call or hourly limit returns 429. Provider errors are sanitized, and potentially billed requests are never automatically retried.

## Test receipt review

Open the receipt editor, upload a PNG/JPEG/WebP/PDF and refresh/reopen it to check its saved draft. PDFs and unavailable providers stay available for manual review. Extracted unknown source amounts remain null in saved facts and require explicit correction and review before group approval. Review every participant claim, payer, total, tax, tip, discount and any linked purchase. AI extraction never establishes payment evidence.

## Run the automated checks

From this directory, with Node 24 and installed dependencies:

```text
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate:local
pnpm start --port 5184
```

In a second terminal use `pnpm test:mcp:local` while the preview runs. The offline suites block live network access and use actual SQLite migrations and route code with fixture provider responses. They cover invalid AI fields, currencies and participants, timezone/DST, privacy, stale versions, request limits, interrupted provider outcomes and receipt draft lifecycle. The independent local MCP client reads the four tools and Agent Skill.

Live AWS access, signed PayPal webhook delivery, actual refund delivery and an Amazon Alexa+ device require separate account/provider checks. General partial-refund policies, plan-linked invoices, scheduled reminder delivery and relational immutable ledger history remain later backend work.

The selected hosted Bedrock settings are Canada Central (`ca-central-1`) and required application profile mode. Use the Canada-specific commands in `BEDROCK_SETUP.md` to obtain an actual application profile ARN. Partial settings return HTTP503 / `BEDROCK_CONFIG`; entirely absent settings return `BEDROCK_NOT_CONFIGURED`. Live AI remains unavailable until the ARN and server secret are configured.
