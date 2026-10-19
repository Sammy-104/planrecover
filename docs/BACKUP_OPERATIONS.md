# Offline backup capture, retention and restore rehearsal

These tools operate on explicit provider exports. They do not authenticate to D1/R2, create a consistent hosted database export, schedule backups, upload data or activate a restored runtime. Source archives are not data backups. A platform-supported full database export and separately exported private object mirror remain prerequisites.

## Capture a private bundle

Use Node24 and a new output whose parent already exists:

```powershell
node scripts/manage-backups.mjs export --database 'D:\provider-export\database.sqlite' --objects 'D:\provider-export\objects' --output 'D:\private-backups\2026-10-18' --batch-size 100 --independent-manifest 'E:\independent-inventories\2026-10-18.json'
```

Source SQLite must be a standalone export without WAL, SHM or journal sidecars. Never point the tool at a running database or delete live sidecars to bypass checks. The source opens read-only/query-only with extensions disabled; SQLite backup writes a separate copy. Source bytes/mtime remain unchanged in regression tests; the OS can update access timestamps.

Discovery covers retained receipt lifecycle/draft/plan references and document lifecycle/metadata. Owner-scoped keys, regular paths without links, sizes/media signatures and original document/new-receipt upload hashes are checked. Legacy receipt hashes remain NULL: capture-time hashing cannot invent original-upload provenance. Deleted bytes are not revived. Every captured object receives a SHA-256 baseline at capture time. Final `manifest.json`, `verification.json` and `BACKUP_COMPLETE.json` appear only after complete verification. Preserve the optional second manifest in independently controlled private storage; a manifest only beside damaged bytes provides weaker evidence.

Safety bounds: database256MiB, object8MiB,10,000objects and512MiB object bytes per bundle;1–1,000copies per invocation. These are tool bounds, not hosting limits. Existing output requires explicit resume of a marked incomplete capture; completed bundles are immutable inputs.

```powershell
node scripts/manage-backups.mjs export --database 'D:\provider-export\database.sqlite' --objects 'D:\provider-export\objects' --output 'D:\private-backups\2026-10-18' --resume --batch-size 100 --independent-manifest 'E:\independent-inventories\2026-10-18.json'
```

Exit0 means complete;3 means bounded incomplete capture needs resume;1 failure;2 invalid arguments. Standard output is coarse counts/digests/status; private verification details remain in the protected bundle. Changed source database/objects, concurrent locks, altered copied bytes and uncheckpointed interrupted writes cause refusal. Preserve incomplete output; the tool neither erases evidence nor guesses a partial write is safe. Do not remove a live lock. After a dead process/partial write, perform explicit operator review or choose a new output.

## Accessible hosted object readback

Owner-only `GET /api/plans/:planId/backup-objects` returns at most50items, default20, with `nextCursor`. `?after=<cursor>&limit=20` reads another page. `?key=<exact key>` downloads retained bytes up to8MiB with `X-Content-SHA256`, attachment disposition and private/no-store headers. Reauthorization/digest/reference checks fence changes during download.

Document visibility is enforced: even an owner cannot read another member's private document through this route. Pages may observe concurrent changes and are not a point-in-time or complete backup. A provider/operator export under host access controls is needed for all database/object data.

## Rehearse a separate local restore

```powershell
node scripts/manage-backups.mjs rehearse --bundle 'D:\private-backups\2026-10-18' --output 'D:\isolated-rehearsal\2026-10-18'
```

This validates the completed source bundle/marker/hash, copies SQLite and actual bytes to a fresh directory and verifies the result. No network, runtime, credentials or provider operation is activated. `REHEARSAL_ONLY.json` records that scope. This convenience command handles at most1,000objects in one batch; larger captures can use explicit export/resume plus verification, then separately document the rehearsal. Local success does not establish hosted recovery controls, identity mappings, object ACLs or measured RPO/RTO.

## Private retention

```powershell
node scripts/manage-backups.mjs retain --directory 'D:\private-backups' --keep 7
node scripts/manage-backups.mjs retain --directory 'D:\private-backups' --keep 7 --apply
```

Default is dry-run. `--apply` explicitly deletes oldest verified marked complete bundles, retaining the chosen1–1,000count. Only direct children of the resolved root qualify; unmarked/incomplete directories remain. All marked candidates must pass manifest/byte verification first; corruption refuses pruning. Deletion targets are rechecked directly under the explicit root, with no links or external path traversal.

Select independent off-device storage, access controls, retention and an export schedule appropriate to the private account. This update creates no provider export job or hosted drill. See [verification](BACKUP_VERIFICATION.md) and [hosted procedure](OPERATIONS_RUNBOOK.md).
