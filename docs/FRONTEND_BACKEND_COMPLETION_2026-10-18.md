# Frontend and non-Bedrock completion — October 18, 2026

The frontend supplied in `PlanRecover.zip` was merged into the canonical application. Its older hosting identity, database history, authentication and financial store were not imported. Earlier immutable payment/refund facts, exact approvals, invitation revocation, private preferences, receipt review, Chat, recovery and invoice workflows remain the authority.

## Implemented in this batch

- Refreshed desktop and mobile navigation, Today, multi-city stays, road-trip planning, mapped suggestions, source-based itinerary drafts, scenario comparisons, booking confirmation import, saved ideas and group feedback.
- Membership-scoped ticket wallet, private-by-default files, selected member visibility, bounded uploads, original byte hashes, optimistic revisions and tracked deletion/retry lifecycle. A viewing link alone grants no wallet access.
- Durable presence with current membership, invitation and workspace version fences; private planning/reminder preferences use the existing private preference transaction.
- Signed SES delivery/bounce/complaint ingestion, duplicate protection and recipient suppression; encrypted browser Web Push with structured device registration, VAPID signing, expiry cleanup and service-worker handling. Sending remains disabled.
- Disabled external operations alerts with durable issue/recovery episodes and conservative uncertain-send handling; narrowly scoped service evidence and distinct manual/scheduled run observations.
- Offline database/object backup capture, resume, independently preservable manifests, retention dry-run and isolated local restore rehearsal. Receipt and document original hashes detect changed source bytes. Legacy receipt hashes remain unknown instead of being backfilled from a later copy.
- Optional one-member whole-group funding for fictional CAD sandbox merchant quotes, with fresh affected-member approvals, designated-payer authentication, full group funding claims and original-funder refunds. Concurrent or later revisions cannot reserve a second full collection while an earlier claim remains.
- Split-tender receipts with exact contributor totals, all affected contributor/consumer approvals, locked original payer identities and immutable correction deltas. Review tables show proposed contribution amounts beside the previous amounts. Provider-linked evidence retains the original provider contributions.

Imported edit paths cannot extend merchant quote deadlines or revise paid/confirmed booking imports and accommodation dates. New plans do not inherit another plan's frontend metadata. Source-based drafts make no model call.

## Verification

The full offline application run passed **65 suites**. After an additional receipt review display fix, **two targeted suites** passed, including three rendered approval/input checks and all 17 receipt accounting checks. Together these cover all **66 distinct application suites** present at source freeze. TypeScript passed. The supported Worker build passed; the packaging workflow rebuilds the exact final source before publication.

The separate PayPal relay passed **15 tests** and its actual migrated private-inbox integration. All provider calls in application tests are injected fixtures; live network access is disabled by the runner. The new funding/refund tests include designated payer identity, duplicate capture/replay, cross-revision claims, original-funder departure/refunds and paid allocation revisions.

Browser QA covered the dashboard, planner, ticket wallet, split contribution inputs, Today, a 390-pixel phone layout and a 1280-pixel desktop layout. There was no horizontal overflow, the right-side scrollbars remained hidden, and no browser console errors were observed. A dark-card heading contrast issue found during QA was corrected.

Migrations 0019–0022 are additive; the original 0000–0018 files are preserved. Generated Drizzle metadata accompanies the additions. Local preview migrations and real SQLite integrity/foreign-key checks are part of verification.

## Remaining external acceptance

The following are not claimed complete by source code or fixtures: Bedrock account/quota acceptance; authorized public PayPal/SNS callback ingress and genuine signed deliveries; real multi-account payment/invoice/refund journeys; a selected real supplier; controlled SES inbox and browser device delivery; external alert reception; hosted database/object export and isolated hosted restoration; and a successful unattended tick after deliberately resuming the existing paused schedule.

The existing Site audience remains private. SES credentials already exist privately, with sending disabled; they are not missing. This batch creates no provider account, public ingress, live email, payment, refund, booking or model request. The separate delivery report records the exact published version, source commit/tree, GitHub draft PR and checksums after those operations complete.
