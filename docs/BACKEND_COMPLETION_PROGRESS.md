# Backend completion progress — October 18, 2026

The latest batch implements work that does not require Bedrock and carries forward the audited backend into the supplied frontend. The private Worker/D1/R2 architecture, immutable financial records and explicit approvals remain authoritative. External delivery, a public relay, the existing paused schedule and provider mutations are not activated by this source update.

| Area | Implemented and fixture-testable | External completion still required |
| --- | --- | --- |
| Bedrock | October 19: applied quota 400,000 TPM / 20 RPM; console JSON and corrected hosted diagnostic passed (110 hosted tokens). A private chat survived reload and a CAD 0 itinerary preview passed validation. Worker redirects, bounded answer formatting and the receipt data-instance prompt are corrected. | Keep feature evidence scoped: confirm receipt images, full tool-proposal journeys and wider input/error cases individually. A connection check or one successful preview does not certify every workflow. |
| SES email | Durable SES sends, signed delivery outcomes, recipient suppression and owner-scoped evidence. Authorized follow-up setup created restricted private credentials; sender Verified; sending false. | Controlled self-recipient send, signed callback configuration, delivery outcome and unattended evidence. |
| Browser push | Scoped subscriptions, VAPID configuration, encrypted delivery, device expiry/revocation and durable attempt outcomes. Disabled by default. | Dedicated private VAPID setup, consented subscription and real device delivery. |
| Operations alerts | Durable deduped issue/recovery episodes, coarse receiver contract, bounded known-rejection retries and manual review after ambiguity. Disabled by default. | Approved receiver, private settings and observed external on-call delivery/recovery. |
| Background jobs | Bounded batches plus persisted manual/scheduled origin and completion evidence; external phases retain disabled gates. | Explicit resumption/readback of the existing hourly schedule and actual unattended completion. |
| Backups | Standalone exported SQLite plus all referenced receipt/document bytes, captured hashes, bounded resumable copying, verification, dry-run retention and isolated local rehearsal. Object readback respects owner and document visibility. | Host-supported consistent export/restore access, separate private storage, independent manifests, schedule and measured hosted recovery drill. |
| PayPal ingress | Existing narrow relay preparation, app signature verification, durable inbox and duplicate handling retained. | Approved public receiver/service access, same-app PayPal registration and genuine signed delivery/replay. |
| Frontend data | Existing durable plan services plus document lifecycle/hash/access, ideas, presence and private preferences support the supplied experience. | Hosted browser/multi-user acceptance evidence is recorded in the final publication report. |
| Supplier | Existing validated sandbox bridge and retained booking/status workflow. | Select a real supplier and authorize/configure its integration; fixtures do not establish availability or booking. |
| Optional funding/receipts | Whole-group CAD sandbox designated payer with exact affected-member approvals/full-group funding claims; split receipt cash contributions with contributor consent and immutable identities/corrections. | Final fixture validation and controlled hosted acceptance; no live PayPal production activation. |

Readiness inspection makes no external provider request. Scoped observations distinguish canonical payment facts, processed signed callbacks, SES acceptance/signed outcomes, push provider results, scheduled completion and alert receiver acceptance. `fullWorkflowVerification` stays unverified until a full hosted acceptance journey exists. Configuration and activation are separate: valid retained SES credentials can be configured while sending is disabled.

Tests use real migrated SQLite and injected providers with live network disabled. The final delivery report records aggregate suite counts, typecheck/build, exact source and deployment; earlier56-suite results describe the prior batch. No local test establishes inbox reading, real device receipt, hosted recovery or AWS approval.

## Operator entry points

- `/flows`: select an owned personal plan and inspect **Connected services and recent checks**. Refresh is read-only; Bedrock checking remains an explicit inference action.
- `GET /api/plans/:planId/backup-objects`: paginated accessible receipt/document inventory; `?key=` returns scoped bytes with SHA-256. This is not a complete hosted backup and excludes other members' private documents.
- `node scripts/manage-backups.mjs --help`: capture already exported data, resume, rehearse a separate local copy, or inspect/apply retention. Follow [backup operations](BACKUP_OPERATIONS.md).
- Follow [SES setup](SES_EMAIL_SETUP.md) and [operations](OPERATIONS_RUNBOOK.md) before activation. No GET/readiness control sends email, push or alerts.

Historical account observation on October17: Free plan, USD120.00 credits, access ending April14,2027 or on credit exhaustion. This is not a current quota/billing guarantee. Recheck eligibility and costs before live tests. An email-only consumer sender can encounter DMARC restrictions; use an owned authenticated domain for broader delivery.
