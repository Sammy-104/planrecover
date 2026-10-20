# UI and performance improvements — 20 October 2026

This update preserves the frontend redesign and adds reviewed itinerary drafts, manual time entry, clearer screens and performance fixes.

## Behavior

- Selected ideas and reviewed AI drafts are saved atomically as actual itinerary drafts. Adding a batch opens the day containing its first new activity.
- Time fields support keyboard entry and optional native pickers; invalid partial values cannot be saved. Activity edits and new-activity navigation use the activity’s local timezone.
- Money fields preserve typed decimals. Unsaved preferences survive background refreshes and report conflicting saved values explicitly.
- Planner rows, Discover cards, Money, Settings, Today, To do and review workflows reveal secondary details on demand.
- Payment, receipt, cancellation and refund terms retain their separate review and approval steps.
- Unchanged background snapshots retain rendering identity. Responses from before newer edits cannot overwrite them, including same-version private preference changes.
- Recommendations run only while visible and needed; repeated date formatting uses bounded caches. Hidden chat and optional discussion/offline tools defer work until visited.
- Invoice refreshes retain existing results, route previews reject stale responses, solo plans avoid presence traffic and offline database opening has a bounded wait.

## Measurements and validation

A synthetic fixture with 60 venue suggestions and 12 itinerary items measured median recommendation calculation time of 2,801.46 ms before and 40.50 ms after. Repeating 2,000 local-time projections measured 523.27 ms before and 2.47 ms after. These are isolated CPU measurements, not an end-to-end site speed guarantee.

All 90 isolated test suites passed. Targeted planner, timezone, suggestion-batch and workspace-refresh suites passed after final changes. TypeScript and the optimized production build passed. Browser checks covered desktop and narrow layouts, manual times, decimal amounts, unsaved preferences, adding multiple ideas, payment tabs and review workflows.

Live provider requests are disabled by the test runner. Bedrock and other provider credentials remain server-side configuration and are not part of this update.

## Local preview

Use the existing project scripts to install dependencies, build, apply local database migrations and start the preview. `scripts/start-local.mjs --port 5173` runs an optimized loopback-only preview after the build; local state stays in the ignored `.wrangler` directory. The development command remains available for editing with automatic refresh.
