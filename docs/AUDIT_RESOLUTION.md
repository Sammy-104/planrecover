# October 17 audit resolution

This matrix separates implemented corrections from external evidence and deliberate extensions. The project owner remains responsible for account access, judging access and any provider activation. Source changes do not certify a hosted financial journey.

| Audit ID | Resolution | Evidence / next action |
|---|---|---|
| F01 | Fixed | Distinct immutable invoice refund allocation; partial/combined/legacy reconciliation and parent-recovery regressions. |
| F02 | Fixed | Restore preserves financial plan identity; invitation revocation is transactional; paid history/reconciliation tests. |
| F03 | Fixed | Validated reimbursement currency and minor-unit precision; unsupported amount/currency cases explain the missing handoff. |
| F04 | Fixed | Linked purchase reconciles once; evidence attachments and corrections preserve original facts; alias/payment races fenced. |
| F05 | Fixed | Frozen invoice/refund terms are visible; approval submits the displayed invoice revision. |
| F06 | Fixed | Prerequisite editor, graph validation, evidence, affected approvals and pending-change guards; AI edges remain suggestions until confirmed. |
| F07 | Fixed | Recipient-scoped inbox, unread state, mark-read and reload/poll behavior. |
| F08 | Fixed | Deterministic interleavings now tested; payment/change writes share transaction fences. |
| F09 | Implemented manual closure | Exact received-refund evidence and original payer allocations require all affected approvals. No provider refund is fabricated. |
| F10 | Fixed within current receipt scope | Custom line allocations, PDF view/open/download, reviewed total/contribution adjustments and stale-edit rejection. New split-tender receipts remain an explicit extension. |
| F11 | Fixed | Multiple private windows, timezone, reminder lead times/channels and interests are editable. |
| F12 | Fixed | Visible revisable group votes, withdrawal, skip/time alternatives and interested-subset cost. |
| F13 | Explicit future mode | Current merchant checkout charges individual approved shares. Group-funder merchant checkout is not represented as implemented. |
| O01 | External gate | Secret names/profile settings exist; successful model output still needs account/quota evidence. Do not assume redacted values are missing. |
| O02 | External gate | Existing linked hourly automation was read as disabled. Verify service writer and resume only through supported task controls; enabled state and unattended tick are separate evidence. |
| O03 | External gate | Hardened relay remains disabled locally; online account/registration/webhook ID and genuine signature delivery are required. |
| O04 | External gate | Distinct identities pass offline authenticated tests. Real owner/editor/viewer hosted journeys require authorized accounts/access. |
| O05 | External gate | Invoice services and regressions pass; genuine sandbox deposit/balance/refund requires the authorized buyer/merchant journey. |
| O06 | Explicit provider extension | Select a compatible supplier or implement its bridge before claiming real inventory/booking. |
| O07 | Explicit provider extension | In-app inbox works. Email/push require selected services; browser Web Push is not claimed without subscriptions/device proof. |
| O08 | Rehearsal prepared, hosted proof open | Operations runbook defines backup/object restoration, targets and verification. Actual hosted restore still requires account recovery controls. |
| O09 | Local monitoring implemented | Owner-only health alerts and intervention queue plus runbook. External alert delivery and operator drill remain open. |
| O10 | Fixed capacity defect | Fair bounded multi-owner batches, concurrency, start budget and total backlog reporting replace the single-owner tick. Capacity must match actual workload. |
| O11 | Implemented | Pinned portable installer, Node24 requirement and CI for full offline tests/typecheck/relay/build. |
| O12 | Fixed | One documented online relay package; legacy fixture has a distinct name and configuration pointer is corrected. |
| O13 | Prepared, account action open | Credential renewal/consumer rotation documented; actual key expiration and renewal must be verified privately. |
| P01 | Fixed | CURRENT_SCOPE records the actual Worker/D1/R2 architecture and selected boundaries; old architecture/setup claims corrected or labelled historical. |
| P02 | Fixed | This owned evidence matrix and current readiness document replace inconsistent completion banners. |
| P03 | Local route prepared | Clean startup and judge walkthrough supplied. Hosted/source audience remains private; deliberate outsider access rehearsal still required. |
| P04 | Drafts prepared | Product narrative, recording script and submission checklist supplied. Actual final video and official current-rule verification remain open. |
| P05 | Local validation expanded | Real migrated regression tests and local browser checks cover connected behavior. Genuine hosted multi-account/provider sequence remains an evidence gate. |

## Validation locations

Fresh final local validation: **53 application suites pass**, full TypeScript checking passes, **15 hardened relay tests** and the migrated inbox integration pass. All **19 migrations** produce **51 application tables**, SQLite integrity is `ok`, and foreign-key checks find no violations. The production Worker build passes. Browser checks verify persisted private preferences/availability after reload and no horizontal overflow at the observed narrow viewport.


The default test runner automatically includes all `backend-*.mjs` suites. New suites are `backend-financial-review-fences`, `backend-receipt-accounting`, `backend-browser-gaps` and `backend-operations-review`. They exercise actual migrations, services and HTTP routes with injected providers; live network calls are disabled.

Migration0018 is additive and schema-only. Drizzle's generated snapshot is included; regeneration reports no changes. Historical completed invoice refund requests are revalidated in bounded runtime reconciliation, not through a migration backfill.

See `FINANCIAL_REVIEW_FIXES.md`, `OPERATIONS_RUNBOOK.md`, `JUDGE_WALKTHROUGH.md` and `SUBMISSION_DRAFT.md`. Final command outputs, packaged source revision and native deployment result are recorded with the delivered project outside this source report.
