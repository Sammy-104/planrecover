# Current implementation and readiness — October 17, 2026

The current scope is [CURRENT_SCOPE.md](docs/CURRENT_SCOPE.md). Earlier milestone counts and four-tool claims are historical. The current source has ten review-oriented MCP tools, persisted workflows, receipt revisions and policy-backed refunds.

## Audit corrections implemented

- Distinct invoice refund evidence allocation, including bounded revalidation of old completion claims without rewriting financial history.
- Stable paid-plan restoration and atomic invitation revocation.
- Currency/precision-correct reimbursement handoffs.
- Planned-purchase receipt reconciliation, immutable reviewed corrections, custom line allocation and inspectable PDF source.
- Exact invoice/refund approval terms displayed before approval; stale invoice versions rejected.
- Confirmed prerequisite editing, cycle checks, affected approvals and guarded staged changes.
- Recipient-scoped persistent reminders inbox, complete private availability/timezone/lead-time controls and revisable group preference responses.
- Transactional payment/change fencing and reviewed outside cancellation/received-refund closure.
- Fair bounded scheduled batches, backlog reporting, owner-only operational health/review queue, portable dependency installation and CI.

## Evidence levels

Code/fixture tests are distinct from configured and hosted-verified services. Consult [the audit resolution report](docs/AUDIT_RESOLUTION.md) for the final test/build/publication result for this source.

The existing Site remains owner-private. Runtime settings were read at revision4 during this work: Bedrock, runner and PayPal secret names are present; secret values are redacted by the service. This is not proof of provider success. No webhook ID or selected supplier/notification provider was present in that settings readback.

Remaining external evidence gates: genuine Bedrock output after account/quota resolution; genuine multi-user checkout and invoice deposit/balance/refund; activated signed webhook ingress; enabled/unattended existing schedule; connected supplier/notification journeys; hosted database plus object restore and external alert delivery. No source-only completion claim closes these gates.

See [operations](docs/OPERATIONS_RUNBOOK.md), [judge walkthrough](docs/JUDGE_WALKTHROUGH.md), and [submission draft](docs/SUBMISSION_DRAFT.md). One-member group merchant funding and split-tender new receipts are explicit future modes; current checkout collects each signed-in member's own share.
