# Planning constraints and scheduled reminders

Planning preferences are private per signed-in member and plan. `member_planning_preferences` stores them separately from the shared plan body. Neither the plan owner nor another participant receives another member's availability, dietary needs, accessibility needs or reminder settings through the private routes. A server-side planning adapter may evaluate saved constraints; only the caller's private values may be sent to an AI provider. Other participants' unprovided constraints remain unknown.

`GET /api/plans/:planId/me/planning-preferences` reads the caller's values and optimistic version. `PATCH` requires `{version,preferences}`. Preferences contain:

- `timezone`: valid IANA time zone for reminder display.
- `availability`: up to 100 `{start,end,status}` intervals with ISO timestamps and explicit offsets; status is `available` or `unavailable`. An empty list is unknown availability. A positive available window must fully contain the proposed activity; unavailable intervals always exclude overlapping activities.
- `dietaryNeeds` and `accessibilityNeeds`: explicit bounded strings; no needs are inferred.
- `bufferMinutes`: minimum personal schedule buffer, 0–240 minutes.
- `leadMinutes`: distinct notification lead times, 0–10,080 minutes, up to ten values. Zero means the saved deadline itself.
- `delivery`: `{inApp,email,push}` booleans. In-app delivery is implemented. Email and push are unconfigured and never represented as sent.

Defaults use the plan time zone, unknown availability, no specified needs, a 15-minute buffer, leads of 60 and zero minutes, and in-app delivery. Updating preferences cancels outstanding jobs for the caller before resynchronization. Existing delivered notifications retain their history.

## Constraint evaluation

`checkPlanningConstraints(state,candidates,preferences,options)` is deterministic and creates no financial action, approval or booking. Candidates require a name, category, ISO start with offset, duration in minutes, selected participants and price in minor currency units or null. IDs are optional; missing IDs become `draft-0`, `draft-1`, and so on.

The checker reports known errors and explicit unknowns for selected participants only. It checks local plan date bounds, availability, overlapping existing/draft activities, required buffers, travel evidence, fresh supplier hours, matching dietary/accessibility evidence, cumulative budget and available cash after the reserve. Pending refunds never provide spendable cash. Unknown prices do not become zero. Unknown member preferences are not assumed to match the caller's.

Supplier evidence must come from a trusted server adapter, never an AI response. It names the item, HTTPS source URL, `checkedAt`, optional `expiresAt`, absolute `openIntervals`, and optional exact-need maps for `dietary` and `accessibility` with supported/unsupported/unknown values. Evidence older than 24 hours by default, future-dated beyond five minutes, or expired becomes unknown. Missing opening intervals mean unknown; an explicit empty interval list means the supplier is closed. No natural-language source is converted into invented hours or assurances.

Travel evidence identifies `fromId`, `toId`, `minutes`, `checkedAt`, and `basis` (`provider` or `estimate`). Missing/stale travel is unknown. An estimate remains qualified and still must fit alongside the personal buffer. Results always require human review, including when there are no known blocking issues.

## Owner-confirmed supplier and travel evidence

`GET /api/plans/:planId/planning-evidence` reads relevant source facts; `POST` confirms them and `DELETE` revokes them. Only the signed-in plan owner can write or revoke. A member can read supplier facts for their own planned activities and the saved place catalog, plus travel legs whose endpoints are relevant to them. Owner confirmation is recorded as `owner-confirmed`; it does not establish live supplier inventory, booking authority, a connected provider verification, or any participant's approval. No source URL is fetched by these endpoints.

The POST envelope is `{kind,planVersion,version,evidence,confirm:true}`. `kind` is `supplier` or `travel`; `planVersion` is the current saved plan version; `version` starts at zero for new evidence and increments for each confirmation/revocation. Supplier evidence names `itemId`, a public HTTPS `sourceUrl`, an ISO `checkedAt` with offset, optional `expiresAt`, and explicit absolute `openIntervals`, `dietary` or `accessibility` maps. Travel evidence names `fromId`, `toId`, the source URL/check/expiry, integer `minutes` and provider/estimate `basis`. Unprovided source facts remain unknown. An explicit empty opening interval list means closed. Input cannot claim provider-verified provenance or include personal availability/preferences.

Evidence IDs must identify actual saved plan items or saved catalog places for that plan's current destination. Travel endpoints must be different. Source identity binds ID, name, category, location, address, coordinates and source URLs. Renamed, moved, removed, cancelled or wrong-city subjects invalidate old confirmations until the owner explicitly checks and confirms them again. The owner can still see old version metadata to refresh or revoke it. Revocation retains a tombstone and monotonic version, preventing a stale request from silently recreating old facts.

Writes require an unexpired source check within the last 24 hours and reject checks dated more than five minutes in the future. Saved evidence naturally becomes stale; the server-only `loadPlanningEvidence(database,owner,planId)` excludes stale/revoked/expired or identity-changed facts and returns `supplierEvidence` and `travelEvidence` compatible with the constraint checker. An optional `{now}` supports deterministic local verification. Only an exact server-resolved source match may bind a new draft's distinct `evidenceId` to saved evidence. Unmatched draft suggestions keep their supplier/travel facts unknown.

Requests accept at most 20 KB of strict JSON; each plan has at most 200 active evidence records, 50 opening intervals per supplier and 30 entries per needs map. Owner authority, saved plan version, evidence version and capacity are checked atomically. Source facts are stored in `planning_evidence`, separately from private member planning preferences and shared financial state.

## Durable job lifecycle

`syncPlanReminders(database,owner,state,{now})` uses only the supplied plan ID; deadlines and audiences come from canonical saved records. It derives reminders from incomplete preparation-task start times, explicit item deadlines, unfinished saved reminders, and sent/partially-paid invoices with an explicit `terms.dueAt` and outstanding balance. A date-only invoice due field does not define a cutoff and is skipped. Cancelled items, completed tasks, missing dates and orphan reminders do not create jobs.

Job IDs incorporate source, exact instant, recipient, lead, channel and display time zone. Synchronization cancels obsolete jobs and preserves delivered history. Plan, preference and invoice version guards abort stale synchronizations. `syncAllPlanReminders` provides a bounded batch and `{owner,id}` cursor for continuing across all plans.

`runDueReminderJobs` processes a bounded batch, claims expiring leases, checks canonical source/member versions again, and atomically inserts the notification and completes the job. Each job has at most one persisted notification. Concurrent workers, retries and expired leases cannot duplicate delivery. A changed/deleted source or removed member cancels stale work. Failed notification storage leaves the job retryable. No external provider runs in this module.

`GET /api/plans/:planId/reminders` returns only the caller's upcoming jobs and latest 100 notifications. `PATCH` accepts `{notificationId,read:true}` and can mark only that recipient's notification as read. Responses use private, no-store caching.

The root worker must invoke bounded synchronization and delivery from its authenticated job endpoint/native schedule. Both global synchronization and delivery accept an optional `owner` filter, bound as a SQL value. The signed-owner HTTP job route must supply it so one account cannot synchronize or deliver another account's jobs. A runner never sends email, push, payments or supplier messages. Requested email/push jobs carry `unavailable` and `delivery-channel-unconfigured`; notification status describes delivery into the in-app inbox, not device display or external transmission.

## Local verification

`tests/backend-reminders.mjs` uses the generated real SQLite migrations and exercises private access, optimistic updates, actual HTTP route modules, simultaneous workers, source/pref changes, expired leases, notification transaction failure, explicit invoice deadlines, plan deletion and recipient-scoped reads. `tests/backend-planning-constraints.mjs` exercises selected-member schedules, availability, freshness, dietary/accessibility evidence, travel, reserves and pending-refund separation without calling a provider.

`tests/backend-planning-evidence.mjs` verifies the generated SQLite evidence schema, owner-only confirmation/revocation, member relevance without private preference leakage, strict source/interval validation, freshness, venue identity binding, monotonic tombstones, concurrency, capacity and the actual HTTP route. All evidence tests disable provider calls.
