# Verify an exported database and receipt bytes offline

This tool checks a candidate restore bundle. It does **not** export a hosted
database, restore a database, upload objects, contact providers or certify that a
hosted restoration has succeeded. Use an isolated, consistent SQLite export and
an exported directory of receipt and document object bytes. Never point it at the running
application's local SQLite file.

Run with Node 24 from this repository:

```powershell
node scripts/verify-backup.mjs --database 'D:\isolated-backup\export.sqlite' --objects 'D:\isolated-backup\objects' --manifest 'D:\isolated-backup\inventory.json' --require-manifest
$LASTEXITCODE
```

The CLI prints one JSON report to standard output. Exit **0** means the requested
checks passed; **1** means verification failed; **2** means invalid CLI arguments.
Warnings remain visible even when checks pass. Redirect standard output to a new
report file outside the input bundle if a durable operator record is required.
The tool itself never writes a report, changes an input file or overwrites a
previous report. Filesystem read timestamps can still be updated by the OS.

The database opens with SQLite's `readOnly` flag, extension loading disabled and
connection-level `query_only` enabled. A sibling `-wal`, `-shm` or `-journal` file
causes refusal before SQLite opens. Obtain a proper standalone export through
the platform's backup mechanism; do not delete a live sidecar to make this check
pass. Expected schema construction occurs only in a separate in-memory database.

## Receipt byte layout and independent inventory

Preserve R2 object keys exactly under the supplied `objects` directory. Application
keys are a SHA-256 workspace-owner prefix followed by a receipt UUID, or `documents/` and a document UUID, with no
filename extension:

```text
objects/
  <64 lowercase hexadecimal characters>/
    12345678-1234-4234-8234-123456789abc
    documents/
      12345678-1234-4234-8234-123456789abd
```

The independent JSON inventory has this format:

```json
{
  "version": 1,
  "databaseSha256": "<optional 64-character SHA-256 of the exported database>",
  "objects": [
    {
      "key": "<64-character owner prefix>/12345678-1234-4234-8234-123456789abc",
      "size": 12345,
      "sha256": "<64-character SHA-256 of the original exported object>",
      "contentType": "image/png"
    }
  ]
}
```

`contentType` and `databaseSha256` are optional. Object `key`, exact byte `size`
and `sha256` are required. Supported media types are PNG, JPEG, WebP and PDF,
matching the upload API's 8 MiB limit. Preserve an inventory captured alongside
the original export in independently controlled storage. Computing a new
inventory from an already damaged restore candidate cannot establish that its
content matches the original.

Documents and new receipts retain original upload digests, checked against restored content and lifecycle metadata. Migration0022 leaves legacy receipt digests NULL instead of inventing an original baseline; once set, digests are immutable. Legacy receipts retain size/MIME but no original
cryptographic digest. Without `--manifest`, the verifier checks
presence, saved draft size and recognizable file signature, computes candidate
digests and emits `NO_INDEPENDENT_OBJECT_HASHES`. Such checks cannot detect every
same-size substitution. Use `--require-manifest` for the stronger acceptance gate.
File signature checks do not fully decode an image or parse a PDF.

## What the report establishes

- SQLite integrity and foreign-key checks; expected tables, columns, indexes,
  CHECK constraints and protective triggers from every bundled migration. Every
  application table receives a row count. A missing provider migration ledger is
  disclosed: structural completeness does not establish deployment provenance.
- Integer financial amounts; reconciled shares and contributions; immutable
  event facts and status-history fingerprints; saved-plan projection and
  approval-history consistency; canonical provider identity, exact CAD amount,
  original plan/item binding and duplicate-effect detection.
- Invoice gross collections, canonical payment/refund effects, finite refund
  allocations and capture refund capacity. A legacy refund request claiming
  completion without distinct allocated proof fails verification and needs
  bounded authorized reconciliation in the isolated restored environment.
- Receipt references from saved active, archived and retained deleted plans,
  drafts, documents and lifecycle rows. Required bytes, owner/plan scope, size, file
  signature and independent hashes are checked. Missing sources, retired source
  bytes unexpectedly present, malformed keys and links/junctions fail. Extra
  unreferenced files are warnings for operator review.

The JSON includes `ok`, `summary`, grouped `findings` with stable codes and up to
12 examples per code, schema and financial counts, database digest, and a receipt
byte inventory. It contains private identifiers and financial references. Store
it with the backup's access controls. It contains no object contents, provider
credentials or access tokens.

Pending provider operations and staged/deleting receipt/document sources are warnings
because a consistent backup may legitimately contain unfinished work. Keep
provider mutations disabled in the isolated environment. Resolve their original
canonical identities and authorization before enabling any processing. The
offline verifier cannot establish bank availability, external provider state,
object ACLs, credential validity, RPO/RTO or genuine hosted restore success.

## Failure handling and rehearsal

Preserve the failed bundle and report. Export a new consistent candidate or
investigate a separate copy; this tool deliberately has no repair mode. Never
remove immutable facts, allocations or protective triggers to make verification
pass. After an actual authorized isolated restore, run the verifier against a
fresh exported snapshot of that environment, inspect warnings, and separately
prove identity/access, receipt downloads and read-only provider reconciliation.

Regression tests use migrated SQLite fixtures, genuine local object bytes and
independent hashes:

```powershell
node scripts/test.mjs backend-backup-verification
node scripts/test.mjs backend-backup-bundle backend-backup-objects
```

They cover input byte/timestamp preservation, machine-readable CLI exits,
missing/mismatched objects, same-size tampering, broken foreign keys, missing
migrations/triggers, financial inconsistency, duplicate provider effects,
corruption, sidecars and intentionally retired source bytes. These fixtures are
offline checks, not hosted backup or restoration evidence.

The [capture/retention/rehearsal CLI](BACKUP_OPERATIONS.md) creates a local bundle from explicit provider exports, preserves hashes at capture time, resumes bounded batches and verifies a separate isolated copy. It does not create provider exports or activate restored runtimes.
