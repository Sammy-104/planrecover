# Financial review and recovery corrections

The October 17 audit fixes retain the individual approved CAD sandbox checkout
model and all immutable financial facts. No payment, supplier or deployment
request is made by applying these source changes.

## Invoice refund evidence (F01)

Migration `0018_financial_review_fences.sql` adds immutable evidence allocations.
Each allocation names a canonical invoice refund, an exact approved request and
the number of minor units it satisfies. Database triggers prevent total use
above either the verified refund or the request amount. One combined refund may
cover several requests; partial refunds may accumulate toward one request.
Repeated canonical reads retain the same allocations and money events.

The migration changes schema only and leaves populated legacy requests intact.
A legacy completed request is presented as `awaiting-merchant` until it has full
distinct allocations. Canonical invoice reconciliation rechecks a bounded batch
and records its resulting progress. It does not reverse, duplicate or rewrite a
financial event. Saved fully refunded invoices with unresolved requests remain
eligible for background reconciliation. Owner and billed-member approval remains
mandatory.

New requests reserve only their unallocated remaining amount, avoiding double
reservation of a received partial refund. Exact request-ID retries remain valid
when later canonical refunds change the invoice's saved evidence.

## Payment/change concurrency (F08)

Checkout/invoice funding claims now validate the current plan version and item
revision inside their write transaction. General change application repeats its
payment, invoice, refund-intent and incomplete funding-claim checks inside the
same transaction as the saved change. A checkout that starts after preliminary
change checks therefore fences the final change commit. A committed change
fences a stale checkout before any provider request.

An incomplete funding claim remains a safe blocker; resume the original saved
checkout/invoice request before resolving its collection. Do not delete a claim
or financial history to bypass an uncertain operation.

## Outside/manual cancellations (F09)

`GET /api/plans/{planId}/external-recoveries` lists saved reviews.
`POST` supports `prepare`, `approve`, `apply` and `cancel`. Prepare requires the
current version, a stable request UUID, the paid item, the refund already
received, supplier confirmation/reference, an HTTPS source and evidence text.
Split manual purchases must specify the exact received refund to each original
cash contributor. Amounts cannot exceed those original net contributions.

All affected active members approve the saved exact cost reduction, cash
recipients and evidence. The owner may then apply the closure. Application
atomically cancels the booking and appends a manual refund event; a zero-refund
cancellation retains the entire paid cost. Original contributions and payments
remain unchanged. Unresolved dependents, pending prerequisite reviews,
unapproved people, changed facts and uncertain provider operations block it.

This records human-reviewed outside evidence. It does not contact a supplier,
issue a refund, verify a bank credit or replace PayPal's canonical refund path.
An expected future refund cannot be entered as received money.

## Funding boundary (F13)

Integrated merchant checkout continues to charge only the signed-in member's
own exact approved share. One member funding the merchant purchase for the
whole group is a deferred product extension. An outside receipt may record a
single payer and the resulting reimbursement balances, but that is a separate
manual purchase. Do not describe it as group merchant checkout. Supporting that
extension requires a new immutable payer/beneficiary agreement, explicit
affected-member approvals, reimbursement accounting, original-payer refund
authority and provider-level regressions.

## Offline validation

Run under Node 24 with the pinned dependencies installed:

```powershell
node scripts/test.mjs backend-financial-review-fences backend-invoices backend-plan-changes backend-financial-history backend-checkout backend-connected-workflows backend-recoveries
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The regression suite uses the real migrations and in-memory SQLite. It
deterministically inserts checkout creation into the final change-save window,
checks both operation orderings, checks legacy refund-request migration and
finite evidence allocation, and verifies manual closure approvals, split cash
recipients, immutable original payments, rollback and repeat execution. Network
calls use fixtures only. Genuine hosted payment and invoice proof remains a
separate acceptance step.
