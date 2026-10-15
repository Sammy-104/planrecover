# Cancellation and partial-refund backend

The generalized backend supports fictional CAD merchant bookings beyond the fixed Algonquin scenario. The original demo endpoint remains compatible. Existing fixture payments never become real captures.

## Review and execution workflow

1. Fetch the plan's current version, item revision and exact participant shares.
2. The authenticated plan owner registers source terms at `POST /api/plans/{planId}/recoveries`, with `type: "register-policy"`, the current `version`, `itemId`, `revision`, and a structured `policy`.
3. Required policy fields are `merchant` (`fictional-sandbox` or `external-manual`), `merchantName`, `confirmedTerms: true`, `terms`, `evidence`, an HTTPS `sourceUrl`, `refundableBps`, `cancellationFeeUnits` and an explicit ISO `cutoff` or `null`. The owner attests that the supplier terms were reviewed; this is not a supplier API confirmation. Saved terms are immutable. Corrected terms require a new policy.
4. The owner submits `type: "propose"`, current plan `version`, `policyId`, and a documented `reason`. Optional `refundAmounts` maps verified capture IDs to exact integer minor units. Requests exceeding source terms are rejected.
5. Every affected signed-in member submits `type: "approve"`, `proposalId`, proposal `version`, and current `planVersion` from their own account. The server derives the approver from the authenticated identity. Approvals never submit a refund.
6. The owner explicitly executes with `type: "execute"`, `proposalId`, proposal `version`, current `planVersion`, and `confirmSandboxRefunds: true`. All approvals, current terms, source scope, cutoff and dependent bookings are checked before provider submission.
7. `GET /api/plans/{planId}/recoveries` lists policies and proposals. Add `?proposalId=...` to reopen a specific proposal. `cancel-proposal` closes a review draft before execution; it cannot release uncertain provider funds.

Cancellation affects the selected booking. Dependent bookings retain their own policies and financial events; unresolved dependents block execution. Booking edits invalidate the previous recovery and require a new reviewed proposal.

## Exact allocation and durable accounting

Policy refunds are computed for each member's original verified capture, using integer arithmetic. The booking fee is allocated across approved shares with deterministic rounding. A CAD 100 booking split CAD 60 / CAD 40, with an 80% refund and CAD 10 group fee, produces CAD 42 / CAD 28 refunds. Neither free-text policies nor AI output authorize money.

Provider reads verify the original order, capture ID, per-member amount and currency. Each refund's canonical ID, capture relationship, amount, currency and status are verified again before recording it. Partially refunded captures retain their original expense history; they do not prove a subsequent refund completed. [PayPal's refund API](https://developer.paypal.com/api/payments/v2/captures-refund) supports an explicit amount for a partial refund.

`capture_refund_capacity` enforces `reserved + refunded <= captured`. An additional transaction guard enforces the supplier's cumulative refund ceiling across multiple partial proposals. An immutable claim keyed by provider operation makes reservations and legacy backfills idempotent. The old fixed refund endpoint and generalized recovery endpoint share these claims, so concurrent proposals cannot over-reserve a capture. Pending refunds keep their amount reserved. Canonical completion moves reserved capacity to confirmed refunds in the same D1 transaction as the financial history, plan projection, provider operation and reservation transition.

The exact refund request body, path and stable request ID are saved before provider submission. Provider identity is saved before ledger reconciliation. A dropped response retains its reservation and request ID. Unknown provider results are held for merchant review; explicit retries stop after a conservative five-hour replay window. Reconciliation of a known refund performs canonical reads only and preserves financial history even after a plan is deleted. Execution processes at most five unfinished refunds per request; larger groups resume the same saved proposal.

Execution now claims a renewable 60-second database lease for each proposal. Overlapping execute requests return HTTP 409 with `RECOVERY_BUSY`; an expired or superseded worker stops with `RECOVERY_EXECUTION_CHANGED`. Lease release cannot clear another worker's claim. Returned provider identities are retained even when execution loses its lease, so subsequent reconciliation can read the saved refund without submitting it again.

Every refund submission rechecks current owner access, booking terms, affected-member approvals, active dependencies and the supplier cutoff. Changes during provider verification stop later submissions. Refunds already confirmed remain recorded, and uncertain amounts remain reserved. The immutable request intent's original `replay_before` applies even if a crash left the reservation marked `reserved`. A reservation that has never had a provider request gets its own replay window when first submitted. A known refund can still be reconciled by canonical reads after the replay window or supplier cutoff.

Apply additive migration `0014_recovery_execution.sql` before running this version. It adds execution lease fields with safe defaults and database triggers protecting saved policies, proposal snapshots and member approvals. Existing proposals and financial history are preserved; corrected terms require a new policy and proposal.

`finalizeConfirmedRecoveries` completes previously started cancellations after every saved refund is canonically confirmed. It validates the unchanged booking, recorded approvals and current owner, then atomically cancels the item and completes the proposal without another provider request. Unconfirmed reservations are skipped and edited bookings remain for review. A deleted plan's proposal can finish while its financial tombstone remains unchanged and unavailable in the visible workspace. Explicitly started zero-refund cancellations can also recover from an interruption before their cancellation commit.

External/manual bookings support saved terms, proposal review and member approvals. Their supplier cancellation and refunds must be completed outside PlanRecover and documented manually. This backend does not claim merchant authority over public listing providers.

## Verification

Run `npm test -- tests/backend-recoveries.mjs` using Node 22.13 or newer, or the project's equivalent pnpm script. The suite uses the real migrations and in-memory SQLite, with injected provider responses. Its 30 checks cover member authorization, actor forgery, stale versions, source scope, exact partial allocations, pending-to-confirmed history, interrupted responses, canonical mismatches, concurrent capacity claims, overlapping execution, expired/stolen leases, bounded request replay, source changes during verification, immutable approvals, migration of existing proposals, six-member batch continuation, legacy retry backfill, dependent bookings, deleted-plan accounting and the actual API route. Tests never invoke live PayPal.

For a live sandbox check, create and approve a fictional CAD booking with actual sandbox captures. Follow the review steps above, then verify that the returned proposal is completed, each refund has a canonical PayPal ID, capacity is reduced once, and the booking is cancelled. This requires an explicit owner execution after all affected members approve; it is not an automated test-suite action.

See `RECOVERY_BACKEND_TEST_REPORT.md` for the latest implementation, full regression results and rollout requirements.
