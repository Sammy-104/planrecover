# Backend delivery — October 14, 2026

The remaining backend code features are implemented and published to the existing owner-private [PlanRecover Sandbox](https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site).

Delivered: immutable financial/approval history and atomic money transitions; individual member checkout; bounded lost-order identity recovery; generic approved partial refunds and cancellation; plan-linked invoices; private planning preferences; saved supplier/travel evidence; code-validated AI planning checks; durable in-app reminders; authenticated automatic jobs; expanded read-only MCP decisions; paginated financial history.

Verification:

- All 38 regression suites passed with fixture providers and isolated real SQLite migrations; full TypeScript and final Worker/client builds passed.
- Built local Worker exercised private planning preferences, invoice/recovery/evidence reads, actual in-app reminder delivery, unchanged money/history and MCP decisions. An independent official SDK client verified all four read-only tools and the Agent Skill. The owned preview was stopped.
- Published backend version6 and its hourly-instructions update version7 succeeded. Final source `0d4fdae6a056efd626c498600de087cb9d6981cc`; deployment `appgdep_6acfb474855481919a603b6bfca84720`; runtime environment revision3. The native saved-version provenance matches the pushed source/archive. All 32 database tables are present.
- The four connected OAuth MCP tools passed after the backend deployment. The verification plan remained at version0 with zero money events.
- The hosted unattended writer ran through supported private service access. Its completed result was read back from D1 with the lease released: two plans synchronized, zero failures and zero due notifications. There were no payment, invoice or refund operations to process, and no provider money mutation occurred.
- A fresh linked-source checkout retrieved the published backend revision and automation instructions. The enabled Site schedule **PlanRecover payment checks and reminders** is saved hourly in America/Toronto, starting on the hour. Sites rejected a 15-minute cadence because it permits at most one run per hour; instructions were corrected and republished. A future scheduler tick has not yet been observed.
- All 75 changed source files were synchronized to the older `planrecover-backend` mirror. Its original Site identity, credentials and runtime data were preserved. Synced `sources/` and the original export were not edited.

Start with **Settings → Payments and reminders → Run background checks**. Use [the step-by-step feature guide](planrecover-sandbox-site/BACKEND_FEATURE_GUIDE.md) for the complete API examples and sandbox exercises.

Account-dependent work remains: configure the actual Canada Central Bedrock application inference profile ARN and AWS bearer key; connect/test an actual Alexa+ client or device; establish signed PayPal webhook ingress without weakening the private Site; and verify genuine sandbox refund/invoice flows with explicit user approvals. Email/push providers and live supplier inventory/booking authority are unconfigured. The new invoice, generalized recovery, evidence and availability flows currently have authenticated APIs; fuller browser forms remain to add. Hosted multi-account testing requires separately authorized private Site access for those members.
