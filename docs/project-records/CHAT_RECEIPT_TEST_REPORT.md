# PlanRecover chat and receipt scanning

Updated October 14, 2026 (America/Toronto).

## Changes

- Website Chat section with saved-plan answers, next-step cards, receipt shortcut, private planning preferences, and reviewable AI itinerary drafts.
- Authenticated, read-only assistant endpoint with scoped plan context, membership rechecks, bounded inputs, shared AI quotas, and a saved-record fallback when Bedrock is unavailable.
- Self-hosted browser receipt OCR with image preparation, paper detection, a second pass for faint print, cancellation, saved-photo rescanning, rotation, and pasted-text recovery.
- Parsed receipt items populate an editable saved draft. Missing facts remain blank. Foreign-currency prices stay visible in their original currency and require documented plan-currency amounts; no exchange rate is invented.
- Receipt review, exact totals, item assignment, payer confirmation, and affected-member approval remain required before shared expense recording.

## Verification

- All 40 backend suites passed after merging the independently completed recovery backend source.
- Final TypeScript check and production build passed.
- Assistant integration checks use offline provider fixtures and cover identity, membership, private preferences, stale responses, provider failure, quotas, and absence of financial effects.
- Scanner checks cover exact cents, CHF/inclusive VAT, unknown values, foreign-currency review, source ownership, viewer permissions, concurrent scans, and paper detection fallback.
- Browser: saved-plan schedule response worked; a synthetic local dietary preference saved successfully.
- Browser: the previously failed receipt photo automatically populated all four item lines after fixing a stray OCR border character. The scanner still misread the total, correctly triggering the mismatch warning. I corrected the saved source draft against the photo, including names, date, and CHF 54.50 total, through the pasted-text recovery path. CAD conversion and financial review remain incomplete; no expense was approved.
- The original photo is CHF 54.50. Its EUR equivalent is not another purchase. Included VAT must not be added twice. No hosted expense or payment was approved during this work.
- The connected PlanRecover Sandbox MCP successfully returned the caller's three accessible plans during final verification.

## AWS status

The separate chat **Set up AWS Bedrock** configured the Canada Central application profile and server secret, then deployed environment revision 4. Its bounded live test reached AWS but returned 403 because the account is still being verified. Live inference remains unverified. See [AWS_SETUP_STATUS.md](AWS_SETUP_STATUS.md) and follow [AWS_TESTING_POLICY.md](AWS_TESTING_POLICY.md) before another live test. This chat made no additional live AWS test calls.

## Source

The combined source commit is `0082bda0b265952fe361a8e960aefa4012a11b2a`, retained in `planrecover-ai-site`. Only chat/scanner files were copied into the older local working copies; their hosting manifests, secrets, runtime data, and concurrent recovery edits were preserved. Synced `sources/` files were untouched.

## Try it

1. Reload the private PlanRecover Site and select **Chat**.
2. Try **Show my schedule**, **Explain my money**, or **What needs my attention?** Saved-record answers remain available if AWS cannot answer.
3. Choose **Scan a receipt**. For an existing upload, select it under **Saved uploads**, then choose **Scan again**.
4. Check the populated names and source prices. Correct missed lines, enter any documented currency conversion, assign items, and reconcile the total before saving for group review.

The temporary local preview server was stopped after browser testing. No temporary AWS infrastructure was created by this work.

## Publication result

The final private deployment succeeded: `appgdep_6ad025ad19548191a57e353fb4faa879`, environment revision 4, source `0082bda0b265952fe361a8e960aefa4012a11b2a`. Website: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site/

The final browser check confirmed the corrected four-line source and CHF 54.50 total, the foreign-currency card layout, and a scrollable review body. The Site tab is left on Chat. The final parser changes passed both affected receipt suites (9 scanner checks and 10 durable receipt checks); the final UI passed TypeScript and production build. Cached HTML briefly referenced the prior stylesheet; a fresh URL loaded the verified current assets. Temporary local preview processes, the test tab, and the matching temporary photo download were cleaned up. The hosted original receipt remains saved and unapproved.
