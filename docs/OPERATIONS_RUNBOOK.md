# Operations and recovery

The project owner is the operator until another operator is assigned. Preserve the private audience, immutable financial records, provider identities and explicit financial approvals during every intervention.

## Checks and intervention

The owner-only `/flows` panel displays overdue/failed checks and payments, invoices and adapter operations needing review. APIs restrict records to the owner/selected plan. The 90-minute threshold is an alert threshold, not a guaranteed service level. External issue/recovery alerts are implemented with durable dedupe, coarse payloads and disabled defaults; no receiver is configured. Follow [alert setup](HEALTH_ALERTS.md) before activation.

The same panel now shows validated service configuration separately from saved verification. Refreshing it never invokes AWS. The explicit Bedrock control makes one synthetic request with at most 128 output tokens and an eight-second provider deadline; verify account access, quotas and applicable credits first. Reuse the saved request after an uncertain browser response. It cannot approve, pay, book, refund or send email.

SES has a Verified sender and restricted credentials in private settings, with sending disabled. Before activating, complete [SES setup](SES_EMAIL_SETUP.md), recipient consent and controlled self-delivery. Signed delivery/bounce/complaint outcomes and suppression are implemented but require configured event ingress and genuine evidence. Web Push is separately disabled until dedicated configuration, consented subscription and device acceptance. Never erase uncertain attempts or create replacement reminders to force retries. SES MessageId or push acceptance does not prove a person received/read the message.

1. Inspect the saved operation and its last canonical provider result. Preserve the original request key and transaction identity.
2. For a missing order result, use the existing bounded reconciliation path. Never issue a new capture/refund to discover whether the original succeeded.
3. Resolve a paid/booking-failed condition through the displayed compensation review. Payment evidence and booking status are independent.
4. A provider outage leaves the original facts intact. Retry the supported status/reconciliation control after access recovers. Never delete an immutable row or reduce an approval requirement to unblock a job.
5. Check saved status after the operation. A button click or HTTP success alone does not prove a completed provider action.

## Scheduled checks

Reuse the existing linked hourly automation; do not create a duplicate. Its paused/enabled state is a separate operational setting. The authenticated writer accepts only an empty body and obtains targets from saved workspaces.

The writer starts up to25 owners per invocation by default, with three owner runners in parallel and a 45-second budget for starting additional work. Already-started owner runners complete under their existing phase timeouts/leases. `JOB_BATCH_SIZE` can be set privately from1 to100 after load verification. Results include total eligible owners, selected-batch deferrals and the whole eligible backlog. Each owner retains its persisted ten-plan cursor, lease and cooldown.

Size capacity for the actual number of owners/plans. If backlog or deadline lateness grows, increase validated capacity or move to a dedicated sharded scheduler. Do not claim a one-hour delivery guarantee for arbitrary volume.

After publishing a changed writer, exercise supported Site service access and read back `background_job_runs` plus `background_run_evidence`. Evidence retains manual/scheduled source, running/completed/failed state and coarse times, without raw error payloads. Skipped invocations do not become completed evidence. Record enabled schedule readback separately, then inspect an actual scheduled completion. No runner captures payments, issues refunds, sends invoices or approves proposals. External phases honor their own disabled settings.

## Backup and restoration

Before hosted financial releases or data migrations, take a supported full database export/restore point plus actual referenced receipt and document bytes. Select private retention/storage appropriate to the hosting account; repository source is not a data backup.

Baseline target for the small private demo: no unbacked schema/data migration, a recovery point no older than24 hours during active use, and a rehearsed recovery within4 hours. These are operational targets awaiting hosted rehearsal, not measured guarantees.

Use [offline capture/resume/retention/rehearsal](BACKUP_OPERATIONS.md) with an already exported standalone SQLite file and object mirror. Preserve the capture-time hash manifest independently. The [verifier](BACKUP_VERIFICATION.md) checks receipt/document content, financial invariants and complete migration schema. These local tools neither perform a hosted export nor certify provider restoration. Accessible-object readback respects private document visibility and is not a complete consistent hosted backup.

Rehearse in an isolated destination:

1. Restore the database through the host's supported recovery/import controls; restore the actual referenced object bytes, not only object keys.
2. Apply only missing additive migrations matching the target source. Inspect SQLite integrity/foreign keys and the current immutable triggers.
3. Check plan/member identity mappings, financial event counts/sums, unique provider effects, approvals, conversations and receipt/document hashes/access. Restore wallet visibility, member-scoped notification settings and deletion tombstones without reviving retired bytes.
4. Keep provider mutations disabled during rehearsal. Replay canonical duplicate reads using fixtures or controlled sandbox evidence; prove no duplicate ledger effect.
5. Restore a deleted paid plan and confirm original invoice/refund authority and revoked invitation links remain correct.
6. Document source revision, restore point, object inventory, timings and rollback. A successful local SQLite rehearsal does not certify this hosted procedure.

If publication fails after migrations, inspect which migrations applied before retrying. Do not edit an applied migration or drop new tables to roll back a Worker. Keep additive tables and deploy the compatible prior Worker, then repair forward.

## Credentials and relay

Use `services/paypal-relay/` as the only online relay package. `infrastructure/paypal-relay/` is a disabled legacy fixture with a distinct name. Keep the app private and register genuine signed sandbox callbacks only through the supported ingress design.

The supplied AWS record lists a November23,2026 Bedrock key expiry. Verify the actual account value before use and assign renewal before that date. Site service access rotation must update the scheduler runner key and activated relay consumer together, preserving their existing scope. Store values only in private runtime settings; never in reports, screenshots, prompts or command arguments.

## External readiness

Bedrock account/quota access, genuine invoice/multi-person journeys, relay activation, unattended scheduling, real supplier/notification delivery and a hosted restore remain independent evidence gates. Current source and fixture tests must not be used to mark them complete.
