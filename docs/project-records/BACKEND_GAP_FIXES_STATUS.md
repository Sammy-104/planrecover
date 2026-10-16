# Eight backend gap fixes — release evidence

October 15, 2026, America/Toronto. The release addresses section A's eight code gaps in `BACKEND_GAP_AUDIT.md`. Detailed behavior, code locations and remaining external boundaries are in [BACKEND_GAP_FIXES.md](../../BACKEND_GAP_FIXES.md).

## Published application

- Site: [PlanRecover](https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site), version **16**.
- Source: **`1071166a1a05e6c34538ed1507ac91435ae15c57`**, working checkout `planrecover-gap-fixes-site`.
- Deployment: **`appgdep_6ad16dc1fb58819196407fd63b60e4e8`**, native status **succeeded** at `2026-10-16T00:20:32.922745+00:00`.
- Saved version: `appgprj_6acda78092f88191983f45ead7f29505~appgver_c7a5c4049d088191a732e756ad73497a`.
- Audience readback: custom owner-only, one allowed account, current user owner. Environment revision **4**, unchanged by this release. No credentials were added to source or displayed.
- Hosted database readback: all **48** application tables, including seven new workflow/supplier/invoice/checkpoint tables. Invoice `lifecycle_status` and reminder `source_type` columns verified.

## Validation

- **49 offline regression suites passed** after the final source changes. Real migrated SQLite tests include lost responses/checkpoints, invoice-only recovery, exact refund approvals/capacity, booking-status projection, reminder source revocation, deposit credits/remainder collection and concurrent cancellation versus checkout closure.
- **Full TypeScript checking passed** and the supported production Worker build passed from this exact source revision.
- `db:generate` reports **48 tables and no further schema changes**. Migration `0017` only adds tables/indexes/triggers and two nullable columns; a populated migration rehearsal retains old plans, partial invoices and conversation history with integrity/foreign-key checks.
- Isolated local Worker smoke checks passed for plan creation/editing, private preferences, workspace compatibility and MCP reads. An independent MCP SDK client discovers all **10** tools and reads a saved personal plan without changing its version.
- Browser checks verified saved parent recovery progress after reload, current private affordability without replacement self-overlap, explicit fictional replacement quote controls, receipt-scanner deep links and free-form simulated assistant controls. Tests used a separate local database with fictional unpaid drafts and no live provider credentials.
- Windows packaging required the installed Git Bash path and GNU tar's local-drive option. The supported source helper pushed and packaged the same verified source; its resulting archive was passed unchanged to the native private deployment operation.

## External limits retained

These are not hidden implementation completions:

- Invoice refunds use an explicit sandbox merchant-account action followed by canonical refund reconciliation; no unsupported invoice refund-record API is represented as moving money.
- Supplier and email/push adapters still need a selected compatible provider/bridge, private credentials and genuine delivery journeys.
- Bedrock still needs the previously recorded access/quota resolution. No live AWS calls were made and the zero-spend/Free-plan instruction remains in effect.
- The public webhook relay remains local-only. No `PAYPAL_WEBHOOK_ID` was configured by this release.
- The existing hourly schedule `Automation_01635d3924948191971a67a2cb856d4c` still reads **disabled**. It was not replaced or duplicated.
- Real multi-person payments, invoice deposit/balance/refund, connected supplier recovery, hosted restore and operational alerting remain verification/operations work.
- The existing private [GitHub repository](https://github.com/Sammy-104/planrecover) is the full-source mirror. GitHub Pages cannot run this backend; a hosting move still requires the identity/data/secrets/jobs migration described in its hosting guide.

Synced files under `sources/` were preserved. No new live payment, refund, invoice send, supplier booking, external notification or AWS inference was initiated by these checks.
