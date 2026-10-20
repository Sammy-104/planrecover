# Planning and money interface updates — October 20, 2026

This source extends local commit `be4a9bf7d55968cc9419747aaa6742baf8f8b873` and retains the earlier backend fixes.

- New plans copy the selected saved ideas into real, unapproved itinerary drafts. Notes and links remain attached; costs are unknown until reviewed. Provisional slots use the correct plan/stay timezone. Source collections stay private and unchanged.
- The first-itinerary picker carries every selected place to review. It no longer silently omits selections to satisfy a pace cap. Conflicts or changed places must be resolved before adding the complete selection.
- Suggestions on the plan and Discover screens support multiple selection, a shared review and one atomic save. Version and retained batch-ID checks protect against stale reviews, duplicate additions and partial saves. The batch accepts draft additions only and never grants approvals or moves money.
- Time controls accept keyboard input such as `2:30 PM` and `14:30`, with an optional native picker. Invalid partial inputs cannot save an earlier availability time. Existing timezone/DST validation remains authoritative.
- Planning leads with the itinerary; secondary budget, group and conditions information expands on demand. Money separates Overview, Group and History. Settings, activity details and plan tools use smaller groups and progressive disclosure. Financial terms remain visible before approval/payment.
- The goal-based planning dialog and chat use the existing authenticated Bedrock draft endpoint when configured. People select and review AI suggestions before adding them together as drafts. Saved-place drafting remains available when Bedrock is unavailable. Async results are bound to the reviewed plan, version and person.

The owner chose to keep live Bedrock on the hosted Site. No AWS credentials were copied to the local preview, no live inference was performed during this change, and this local source update is not a hosted deployment. Configure/deploy this source with the existing private Bedrock settings to use the revised AI controls live.

Verification includes the offline application suites, new HTTP/SQLite regressions for idea creation and atomic batches, typed-time and selection-retention regressions, TypeScript and a production build. Browser checks cover the calmer screens, typed AM/PM entry, and adding two selected activities in one save. Detailed run records are saved beside the project in `review-evidence`.
