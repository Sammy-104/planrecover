# Operations and recovery

The project owner is the operator until another operator is assigned. Preserve the private audience, immutable financial records, provider identities and explicit financial approvals during every intervention.

## Checks and intervention

The owner-only `/flows` service panel displays overdue/failed background checks and counts of payments, invoices and adapter operations requiring review. The operations API restricts those records to the owner and selected plan. The 90-minute threshold is an alert threshold, not a guaranteed service level. There is no configured external alert-delivery channel.

The same panel now shows validated service configuration separately from saved verification. Refreshing it never invokes AWS. The explicit Bedrock control makes one synthetic request with at most 128 output tokens and an eight-second provider deadline; verify account access, quotas and applicable credits first. Reuse the saved request after an uncertain browser response. It cannot approve, pay, book, refund or send email.

SES is disabled until private sending settings are supplied. Before activating it, complete [SES setup](SES_EMAIL_SETUP.md), including recipient consent and verified addresses. An uncertain SES send is a manual-review operation; do not erase attempts or create a replacement reminder to force a retry. A known SES MessageId proves acceptance, not inbox delivery.

1. Inspect the saved operation and its last canonical provider result. Preserve the original request key and transaction identity.
2. For a missing order result, use the existing bounded reconciliation path. Never issue a new capture/refund to discover whether the original succeeded.
3. Resolve a paid/booking-failed condition through the displayed compensation review. Payment evidence and booking status are independent.
4. A provider outage leaves the original facts intact. Retry the supported status/reconciliation control after access recovers. Never delete an immutable row or reduce an approval requirement to unblock a job.
5. Check saved status after the operation. A button click or HTTP success alone does not prove a completed provider action.

## Scheduled checks

Reuse the existing linked hourly automation; do not create a duplicate. Its paused/enabled state is a separate operational setting. The authenticated writer accepts only an empty body and obtains targets from saved workspaces.

The writer starts up to25 owners per invocation by default, with three owner runners in parallel and a 45-second budget for starting additional work. Already-started owner runners complete under their existing phase timeouts/leases. `JOB_BATCH_SIZE` can be set privately from1 to100 after load verification. Results include total eligible owners, selected-batch deferrals and the whole eligible backlog. Each owner retains its persisted ten-plan cursor, lease and cooldown.

Size capacity for the actual number of owners/plans. If backlog or deadline lateness grows, increase validated capacity or move to a dedicated sharded scheduler. Do not claim a one-hour delivery guarantee for arbitrary volume.

After publishing a changed writer, exercise it through supported Site service access and read back `background_job_runs`. Record enabled schedule readback separately from a manual invocation. Recheck an unattended completion when available. No runner captures payments, issues refunds, sends invoices or approves a proposal.

## Backup and restoration

Before any hosted financial release or data migration, take a supported database export/restore point and an inventory/copy of referenced private receipt objects. The operator must select retention/storage appropriate to the hosting account; repository source is not a data backup.

Baseline target for the small private demo: no unbacked schema/data migration, a recovery point no older than24 hours during active use, and a rehearsed recovery within4 hours. These are operational targets awaiting hosted rehearsal, not measured guarantees.

Run the [offline verifier](BACKUP_VERIFICATION.md) against the standalone exported SQLite file, exported receipt bytes and an independently preserved hash inventory before and after rehearsal. A verifier pass does not prove that the hosting recovery controls work.

Rehearse in an isolated destination:

1. Restore the database through the host's supported recovery/import controls; restore the actual referenced object bytes, not only object keys.
2. Apply only missing additive migrations matching the target source. Inspect SQLite integrity/foreign keys and the current immutable triggers.
3. Check plan/member identity mappings, financial event counts/sums, unique provider effects, approvals, conversations and receipt object hashes/access.
4. Keep provider mutations disabled during rehearsal. Replay canonical duplicate reads using fixtures or controlled sandbox evidence; prove no duplicate ledger effect.
5. Restore a deleted paid plan and confirm original invoice/refund authority and revoked invitation links remain correct.
6. Document source revision, restore point, object inventory, timings and rollback. A successful local SQLite rehearsal does not certify this hosted procedure.

If publication fails after migrations, inspect which migrations applied before retrying. Do not edit an applied migration or drop new tables to roll back a Worker. Keep additive tables and deploy the compatible prior Worker, then repair forward.

## Credentials and relay

Use `services/paypal-relay/` as the only online relay package. `infrastructure/paypal-relay/` is a disabled legacy fixture with a distinct name. Keep the app private and register genuine signed sandbox callbacks only through the supported ingress design.

The supplied AWS record lists a November23,2026 Bedrock key expiry. Verify the actual account value before use and assign renewal before that date. Site service access rotation must update the scheduler runner key and activated relay consumer together, preserving their existing scope. Store values only in private runtime settings; never in reports, screenshots, prompts or command arguments.

## External readiness

Bedrock account/quota access, genuine invoice/multi-person journeys, relay activation, unattended scheduling, real supplier/notification delivery and a hosted restore remain independent evidence gates. Current source and fixture tests must not be used to mark them complete.
