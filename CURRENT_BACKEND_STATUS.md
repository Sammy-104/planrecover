# Current implementation and readiness — October 19, 2026

The current scope is [CURRENT_SCOPE.md](docs/CURRENT_SCOPE.md). Earlier milestone counts and four-tool claims are historical. The current source has ten review-oriented MCP tools, persisted workflows, receipt revisions and policy-backed refunds.

## October 19 Bedrock follow-up

AWS now shows an applied Canada Central Nova Lite cross-region quota of 400,000 tokens/minute and 20 requests/minute. The existing Canadian application inference profile is Active. The current Free plan, $120 applicable credits and April 14, 2027 access end date were checked before testing. One synthetic AWS console request returned valid JSON using 17 input and 6 output tokens.

The pre-fix hosted check failed before inference. A local real Worker reproduction identified unsupported `redirect: 'error'` as the connection bug. Affected adapters now use manual redirect handling and continue rejecting redirect responses, without forwarding credentials. Bedrock failures retain only allowlisted connection stage/status metadata for owner inspection. Hosted checks and feature acceptance remain distinct from this console and offline evidence; inspect the saved Service readiness result and the October 19 verification report. See [the connection fix](docs/BEDROCK_CONNECTION_FIX_2026-10-19.md).

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

## Non-Bedrock completion and frontend integration

- Added owner-only service readiness inspection and an explicit bounded synthetic Bedrock check. Inspection never contacts providers. Checks retain coarse outcomes and token counts, reuse request IDs, and apply shared AI limits. A synthetic pass does not verify full chat, itinerary or receipt workflows.
- Direct SES reminder email uses durable attempts and remains disabled. The Canada Central sender is Verified and a dedicated sender/recipient-restricted credential was created and stored in private runtime settings during authorized setup (revision5). No credential value belongs in source or reports. Controlled delivery and unattended reminder evidence remain open.
- Signed SES delivery-event ingestion/suppression, browser Web Push subscriptions/delivery and expired-subscription handling are implemented with disabled configuration defaults. Provider acceptance and signed delivery outcomes retain their exact evidence scope; device or inbox receipt requires live acceptance testing.
- External operational alerts record durable issue/recovery episodes, deduplicate attempts and block ambiguous resends. They default to disabled and need an approved receiver. Background runs retain distinct manual/scheduled evidence; manual success cannot establish unattended scheduling.
- Offline backup tooling captures an explicit standalone database export, all referenced receipt/document bytes and a SHA-256 manifest. Bounded captures resume, retention defaults to dry-run, and isolated local restore rehearsal verifies a separate copy. Owner-only accessible-object readback respects private document visibility. Hosted provider export access, independent storage/scheduling and an actual hosted restoration remain open.
- The new frontend uses existing repository-backed plan, approval, immutable money, sharing, receipt review and recovery boundaries. Private document metadata/bytes, presence, saved ideas and planning settings have durable backend support.
- Prepared the existing PayPal relay for the authenticated Cloudflare account and validated its deployment bundle with a dry run. No public receiver, service credential grant or PayPal webhook registration was created by this preparation.

See [this batch's completion and verification](docs/FRONTEND_BACKEND_COMPLETION_2026-10-18.md), [completion progress](docs/BACKEND_COMPLETION_PROGRESS.md), [SES setup](docs/SES_EMAIL_SETUP.md), and [backup verification](docs/BACKUP_VERIFICATION.md).

## Evidence levels

Code/fixture tests are distinct from configured and hosted-verified services. Consult [the audit resolution report](docs/AUDIT_RESOLUTION.md) for the final test/build/publication result for this source.

The existing Site remains owner-private. The last completed credential setup recorded runtime settings revision5: Bedrock, runner, PayPal and restricted SES secret names are present; SES sending is false. Secret presence is configuration, not proof of provider success. The current publication report records any newer revision and exact deployment; this source file contains no credentials.

Remaining external gates: genuine Bedrock output after account/quota resolution; multi-user checkout and invoice deposit/balance/refund; activated signed webhook ingress; enabled/unattended existing schedule; a selected real supplier; controlled SES/device delivery and signed callbacks; hosted database/object export and restore; external alert reception. Code and injected fixtures do not close these gates. This batch makes no Bedrock call and activates no sending, public ingress or schedule.

Optional whole-group CAD sandbox funding and split-contribution receipts are implemented in the current source batch, with final validation in the publication report. All affected members approve the exact amount/funder; funding claims reserve the full group and preserve the original contributor for capture/refund. Receipt contributions sum exactly to the total and retain contributor identities through immutable corrections. Defaults remain individual checkout/single receipt payer.

Migrations 0019–0022 add delivery/push, operations evidence, frontend data and immutable receipt upload digests; existing migrations remain unchanged. Before this batch's publication, the current private hosted release was v19 with runtime settings revision5. The delivery report records the final new version/source rather than treating source edits as deployment evidence.

See [operations](docs/OPERATIONS_RUNBOOK.md), [judge walkthrough](docs/JUDGE_WALKTHROUGH.md), and [submission draft](docs/SUBMISSION_DRAFT.md).
