# Recovery backend implementation and verification

October 14, 2026 — America/Toronto.

Implemented in the canonical `planrecover-sandbox-site` checkout using `RECOVERY_BACKEND.md` as the reference. Synced project sources and the original export were preserved.

## Changes

- A renewable execution lease serializes each proposal's refund submissions. Expired workers cannot reserve funds, overwrite a newer execution, or release its lease. Returned refund identities survive a lease loss.
- The original immutable provider request bounds retries even when a process dies before saving its uncertain result. Known refund identities use canonical reads after the replay window. Untouched reservations start their own window on first submission.
- Each refund submission rechecks current owner authority, booking terms, approvals, dependencies and the supplier cutoff. A mid-flight change stops subsequent submissions while retaining confirmed history and reserved capacity.
- Additive migration `0014_recovery_execution.sql` supplies lease fields and database protections for immutable supplier terms, recovery snapshots and member approvals. Existing approved recoveries remain executable after migration.

## Verification

All checks used bundled Node.js 24.19.0. The machine's default Node.js 20 cannot run this project's TypeScript test runner.

| Check | Result |
| --- | --- |
| Recovery service and actual API route | 30 checks passed; 11 added in this change |
| Complete regression run | All 40 suites passed |
| Full TypeScript check | Passed |
| Production Worker/client build | Passed in an isolated source copy; recovery service content matched the working source |
| Existing-data migration | Passed against real SQLite using migrations through `0013`, followed by `0014` |

Tests exercised real migrated SQLite transactions and injected provider responses. Coverage includes overlapping requests, stolen/expired leases, interrupted responses, replay expiry, current booking/cutoff changes, immutable consent, six-member batch continuation, partial refunds, capacity limits, canonical reconciliation and deleted-plan history. Live network access was disabled by the regression runner.

The existing output directory could not be cleared on Windows. The isolated build used the same project configuration and installed dependencies, completed successfully, and its temporary source copy was removed afterward. Build and regression logs remain in the ignored `work/` directory.

## Rollout

Apply migration `0014_recovery_execution.sql` before starting or deploying this backend revision. This task changed local source and isolated test databases; it did not deploy the Site or change hosted records. Genuine PayPal sandbox refund execution remains an account-dependent verification step. No live payment, refund, invoice or supplier booking was submitted.
