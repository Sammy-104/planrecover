# Recovery and multi-user acceptance — 19 October 2026

The backend now has a broader authenticated recovery/departure regression suite in `tests/backend-bedrock-multiuser.mjs`. It is discovered automatically by `scripts/test.mjs` and runs in an isolated process with all provider HTTP intercepted.

## Coverage

Twenty-four checks exercise the actual assistant, conversations, proposal and plan-change HTTP handlers against SQLite with the repository's real migrations. Five distinct simulated gateway identities represent the owner, affected editor, viewer, unaffected editor and outsider. These are test identities; no real account is impersonated.

- Concurrent owner/editor model turns receive current shared facts and only their own private preferences. Each can restore their own transcript, and neither can read the other's transcript.
- An editor's agent can save exact recovery terms for shared member review. Owner, editor and viewer can read those same terms; the agent's conversation stays private.
- Both affected identities must separately approve departure. Viewer, unaffected editor, outsider and anonymous attempts fail. Application remains owner-only after all affected approvals.
- An explicitly approved simulated departure applies once and retains the original contributor. Its accounting adjustment has zero amount and no contributions; no provider operation, payment or refund is created.
- Viewer membership cannot prepare recovery/departure. A viewer invitation permits read-only chat even when its signed-in member has editing membership elsewhere. Unoffered model mutations are rejected.
- Downgrading an invitation between agent rounds blocks the next mutation tool. Revoking the invitation during inference prevents saving the proposal and returning the generated reply.
- Revocation, downgrade and expiry immediately before each durable recovery, action-preview and new-plan-preview INSERT produce no new review. A price change immediately before an action-preview INSERT also prevents saving the stale preview.
- An approval arriving during inference invalidates the stale assistant answer. A changed item price cannot be approved under the old proposal even if a client submits the latest plan version.
- Owner cancellation racing an editor's approval rolls the approval back. A plan revision racing the approval also rolls it back. Loss of owner access immediately before a cancellation write prevents the cancellation.

## Corrections found by these tests

The assistant now filters mutation tools out of viewer invitation sessions and rechecks invitation scope and current role at every tool boundary. Existing read-only chat continues to work. A shared atomic review-write guard also checks current editor membership, exact plan version and invitation owner, plan, role and expiry inside each durable INSERT. A link that changes after the preflight read cannot save a new preview. Existing stable preview IDs still support durable checkpoint recovery.

Plan-change approval now checks that the saved proposal is still open inside its atomic write. A concurrent cancellation cannot receive a late approval. Owner cancellation checks current owner membership and the exact plan version in its conditional update. Failed review guards return a refresh conflict instead of exposing a database constraint error.

## Evidence boundaries

This suite proves route behavior, permissions, durable storage and controlled races using simulated identities and deterministic provider responses. It does not prove hosted multi-account browser behavior, the quality of arbitrary model output, supplier availability, real merchant cancellation/refund results or email delivery. Hosted acceptance with an independently signed-in second account remains a separate check. No model output authorizes an approval, applies a plan change or moves money.

Existing recovery, financial review, plan-change, invitation and Bedrock workflow suites continue to cover paid cancellation/refund fences, split-tender contributors, dependency ordering, provider reconciliation and stale review terms. These controls remain in place.

## Private fit review after switching plans

Hosted venue acceptance exposed a separate version-scope mismatch: the workbench uses the overall workspace revision, while the plan review API uses an individual plan revision. Creating or selecting another plan can separate those values without changing the reviewed plan. The workbench now explicitly submits its workspace revision, and the server binds it to the current authorized active plan before deriving the plan revision. Existing callers that provide a plan revision retain that contract.

The review rechecks workspace, plan, membership, invitation scope and private planning version before returning. Client results are keyed to the plan, member, version, action and invitation, so changing context hides the previous private result immediately. No automatic retry substitutes a newer version for a stale request. Ten additional HTTP/SQLite checks in `tests/backend-planning-fit-review.mjs` cover multiple plans, stale scopes, malformed requests, anonymous/outsider/viewer access and changes during review. The fix changes review inspection only and cannot apply a plan or create a financial effect.
