# PlanRecover beta

Backend implementation has started in this working checkout. Plan-level persistence, private member preferences, validated actions, expiring invitations, durable webhook processing and the Alexa+ MCP foundation are implemented. See [backend implementation and run instructions](BACKEND_IMPLEMENTATION.md) for current behavior, verification and remaining milestones. Historical notes below describe the earlier v25 beta.

A personal, editable beta of the PlanRecover blueprint: a seeded CAD weekend for Sam, Alex, Maya and Chris. Built with React, TypeScript, Vinext, shadcn/ui, a Cloudflare Worker, D1 and private R2 uploads.

## Try it

1. Open the October 17 itinerary. Preview the lakeside viewpoint and add it as a free draft. Switch the demo member view and approve as each participant.
2. Add the synthetic receipt. Review claims, confirm Sam's reported payment and save for review. Approve as every affected member. Shares are CAD 35.37, 30.13, 27.51 and 32.75.
3. Open Group money. Sam's contribution is separate from consumption. Report a repayment as Alex, then switch to Sam and confirm receipt.
4. Use Merchant demo to cancel the guided hike. Compare replacement (CAD 255 final each, CAD 105 due now, CAD 90 expected refund) with cancelling everything (CAD 122.50 loss each).
5. Propose an option, approve it as all four personas and apply it. Complete simulated refunds and each new share payment separately.
6. Switch to Maya: her CAD 100 immediate limit cannot cover a CAD 105 replacement, even when its final extra cost is CAD 15.
7. Propose Chris leaving. Existing lodge shares stay CAD 120 until every affected member approves the adjustment to CAD 160 for each remaining person.
8. Simulate a booking failure after payment. Completed payments remain visible; the booking state requires review.

The demo is deliberately seeded. Names, suppliers, routes, quotes, travel times, availability and historical captures are fictional. Demo member switching is limited to the seeded fixture. Personal plans use stable signed-in ChatGPT identities, chosen display names and viewer/editor access. Plan preferences and financial entries remain visible to people with access to the plan; private per-person budgets are not implemented. Data is owner-scoped and saved to D1. Receipts are private R2 objects.

## Integrations

All PayPal requests are pinned to **sandbox**. No live payment endpoint is implemented. Use server environment values from `.env.example`. Never commit secrets. Hosted values belong in the Site environment settings.

- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: business sandbox application's credentials.
- `PAYPAL_WEBHOOK_ID`: sandbox webhook registered at `/api/webhooks/paypal`, subscribing to capture-completed and capture-refunded events.
- `OPENAI_API_KEY`: enables receipt vision extraction with structured output.
- `OPENAI_MODEL`: optional; defaults to `gpt-4.1-mini`.

After configuring PayPal, create a paid catalog draft, approve its revision as every selected participant, and run each sandbox buyer checkout. Browser SDK v6 creates a payment session; Orders v2 create and capture run server-side. Amounts come from the approved persisted item. A verified capture records a payment and its provider ID; it does not confirm a booking. The fictional merchant can separately confirm a fully funded booking. Capture operations are idempotent, owner-scoped and currency/amount checked. Webhooks verify signatures and deduplicate event IDs. Fixture captures can only have **simulated** refunds; they cannot be used as PayPal capture IDs.

Recovery for the original fixture uses the blueprint's exact numbers. Sandbox refund endpoints operate on actual sandbox captures only, require an approved executed cancellation, and never pretend a seeded payment was provider verified. For a full end-to-end sandbox refund demo, use a sandbox-funded booking and a cancellation proposal covering that actual capture; extending recovery inventory beyond the fixture is an explicit next milestone.

The service invoice example creates a **draft** CAD 240 invoice with CAD 60 minimum partial payment. It is separate from the trip, is not automatically emailed and is not a financing or automatic installment agreement. Merchant invoice sending, lifecycle reconciliation and adding an invoice to a real group plan are follow-up work.

AI receipt extraction is optional and human reviewed. Without a key, uploads remain usable through manual entry. PDFs are stored for manual review; image extraction accepts JPEG, PNG and WebP. City discovery combines city guides, Wikipedia search, OpenStreetMap places and licensed Wikimedia Commons photos with credits. It is a place guide, not supplier availability or booking inventory. Natural-language itinerary generation remains a follow-up.

## Financial rules

- Integer cents; deterministic largest-remainder allocation. Fixed amounts must exactly reconcile; percentages must total 100.
- A receipt mismatch blocks recording. No hidden rounding adjustment absorbs extraction mistakes.
- Preference votes are separate from financial approval. Every obligation change requires every affected member's current revision approval.
- Price/share/date edits clear approvals. Already-paid price changes require merchant recovery; share-only reallocations append explicit ledger adjustments after all affected approvals.
- Expenses, personal contributions, repayments, refund expectations and completed refund adjustments stay distinct.
- Pending refunds never fund a new payment. Bank availability remains unverified even for a completed sandbox refund.
- Reported repayments need recipient confirmation and do not create purchase expenses.
- Reviewed receipt corrections retain the original purchase/payment and append an adjustment; total-changing corrections need a separate documented expense.
- Duplicate sample receipts are rejected; linking an already-recorded purchase does not create another expense.
- Persistent writes use optimistic version checks. An outdated tab must reload rather than overwrite another update.

## Plans and local activities

Home lists saved Trips, Days Out and Events with type filters, pending decisions and the next stored deadline. Create a plan with its own city, dates, schedule, receipts, ideas and balances. Days Out use one date; Events have agendas and assigned preparation tasks. Existing trips retain their identity, itinerary and financial history. Deletion requires confirmation; the Algonquin demo can be restored explicitly.

City suggestions use a bundled GeoNames index of 34,006 cities, independent of an external autocomplete service. Two-letter suggestions show country/region and save the selected coordinates. Pointer and keyboard selection work inside the modal.

Activity search shows matching saved places from two letters and queries the free Photon OpenStreetMap geocoder after an 800 ms typing pause and at least three letters. Results include names, addresses and distance from the city centre, including niche shops and venues. Search starts within 20 km; the area selector also supports 5, 50 and 100 km for both typeahead and discovery. Exact and prefix name matches rank first, with limited typo tolerance and closer matches preferred. Choosing a live result validates its provider ID server-side, saves its source coordinates to this plan's catalog, and opens the existing visit preview. Typing does not change the plan. Shared edit links support the same flow; client-supplied venue names and coordinates are ignored. No Google Maps key or billing setup is used. Public-service requests are coalesced and cached for an hour; the service has fair-use limits and no availability guarantee. During outages, search retries once automatically and provides a manual retry; saved places remain selectable. Photos are shown only when a real credited source is available.

Share plan creates separate persistent viewer and editor links scoped to that plan. Viewer links can be opened without an account. Friends opening an editor link sign in with ChatGPT, enter their display name and explicitly join. The server binds every personal-plan action and approval to that signed-in identity, ignoring a supplied actor. People lists the plan owner and joined friends, lets each person edit their own name, and lets the owner change a friend between viewer and editor. Existing members cannot regain editing access simply by reopening an old editor link. Updates poll every five seconds and use version checks. Owners can revoke both links. Links reveal no other plans, cannot delete/reset plans and do not grant provider payment access.

New personal plans start with their creator rather than four demo participants. Existing custom plans retain any previous participants referenced by activities, receipts or financial records as historical participants. Their items, approvals, shares, payments and histories are never reassigned automatically. The owner joins as their real identity; newly joined friends use their own identities. The original Algonquin fixture retains its clearly labelled demo personas.

The everyday interface has one Planner tab for trips (Schedule or Agenda for other plan types), plus Receipts, People and History. Its paired map remains inside the planner, with the mobile list/map switch. Routine screens emphasize dates, people and estimated costs. Merchant tools, connection status and developer links are inside collapsed Advanced settings. Source photos, credited licenses, category placeholders, address, city-centre distance and source links use the same card presentation in discovery, itinerary and details. Unknown costs stay labelled unknown; no stock venue photo is invented.

Discover combines curated guides, Wikipedia and OpenStreetMap points of interest. Coverage varies by city, with up to 1,200 sourced places per lookup where available, category filters and paged browsing. Eighteen one-tap collections include escape rooms, arcades and game shops, climbing, skating, music venues, vintage shops, books, records, galleries, sweets and swimming. These run focused local lookups without typing venue names. Bounded per-type queries and mixed browsing keep niche venues visible beside popular categories. Queries use the selected city and validate geographic bounds. Results are place information, not live opening hours, prices, reservation availability or participating-merchant inventory. Craft stores are described as stores, not invented workshops. OpenStreetMap queries use the Private.coffee global instance, with the VK Maps global instance as a bounded fallback. Source failures leave remaining real results and previously loaded same-city matches usable, with an outage notice. The synthetic Algonquin catalog continues to work independently.

Photo cards use actual source photos with author and license credits. Missing photos use a neutral fallback. Selecting a place opens a time, duration and participant preview; adding it creates a draft. Outside places remain outside bookings. An entered cost contributes to projected spending, but does not create an actual expense or merchant balance due. Group approval schedules the plan item; a reviewed receipt records outside spending. Only the fictional merchant catalog can use the beta checkout and booking-confirmation adapter.

The itinerary pairs its daily schedule with a zoomable world map on desktop, with a list/map toggle on smaller screens. The map shows all activity locations across the plan's days, with numbered pins, a world view and a control to fit the schedule. Selecting a schedule card focuses its pin; selecting a pin opens the activity details. Selected venue coordinates are preserved; sourced places are checked against exact identity and coordinate metadata. Named manual venues resolve automatically when unambiguous. Approximate mapped features are identified, and missing locations never become guessed city-centre pins. Preparation tasks are shown as tasks, rather than map stops. Map tiles carry OpenStreetMap attribution.

Drag an activity by its grip to reorder it or move it to another day. Touch dragging and a keyboard-accessible Move dialog support the same actions. Later flexible activities shift when needed, with a walking or driving buffer. Overlaps and short travel gaps are highlighted. Travel times are rough straight-line planning estimates, not live road routes or traffic. Confirmed or paid bookings and accommodation keep their fixed times; moves that cannot fit around them are rejected. Schedule changes retain prices, shares, source locations and financial history, archive the prior revisions and require affected members to review the new times.

Preparation tasks have an assignee, due time and completion state, with no artificial payment. Editing a task updates the same derived reminder instead of duplicating it. Tasks can be due before an event. To do shows these deadlines alongside documented demo cancellation cutoffs, links to the relevant item, and marks completion. Email and push delivery remain unconnected.

## Blueprint alignment

Trips, Days Out and Events reuse the blueprint's plan items, participation, approval revisions and ledger. Exact-cent splitting, the original CAD 125.76 receipt, CAD 255 replacement total, CAD 105 required now and CAD 122.50 cancellation loss remain checked by the financial invariant suite. Preference votes do not authorize payments; pending refunds do not fund new payments; booking, payment and refund states remain distinct. Searches, map pins, free activities and preparation tasks create no financial events.

The blueprint describes the intended full product. Personal plans now support independently authenticated membership and approvals. This beta does not yet provide private member budgets, natural-language itinerary generation, live supplier inventory and booking authority, general non-fixture recovery, configurable lead-time notification delivery, or automated installment collection. These are separate future capabilities, not implied by an edit link or a place-search result. The existing sandbox and manual-review boundaries still apply. Real venue bookings and spending remain outside PlanRecover until reviewed receipts are entered.

## Development

The project uses pnpm. Preserve the checked-in lockfile.

```sh
pnpm install
pnpm exec tsc --noEmit
node --experimental-strip-types tests/invariants.mjs
node --experimental-strip-types tests/city-discovery.mjs
node --experimental-strip-types tests/trip-deletion.mjs
node --experimental-strip-types tests/trip-sharing.mjs
node --experimental-strip-types tests/itinerary-map.mjs
node --experimental-strip-types tests/plan-types.mjs
node --experimental-strip-types tests/blueprint-alignment.mjs
node --experimental-strip-types tests/place-search.mjs
node --experimental-strip-types tests/schedule-search.mjs
node --experimental-strip-types tests/people.mjs
pnpm db:generate
pnpm build
pnpm dev
```

D1 and R2 are declared in `.openai/hosting.json`. Apply generated migrations for local development as described in the starter's README. The managed environment uses `sites-preview start` rather than a separately started development server. Local HTTP requests on `terminal.local`, `localhost` and `127.0.0.1` use a local test owner. Hosted API routes reject missing platform identity.

## Official sources used

- https://paypalaihackathon.devpost.com/resources
- https://developer.paypal.com/sdk/js/set-up
- https://developer.paypal.com/sdk/js/reference
- https://developer.paypal.com/api/orders/v2/orders-create
- https://developer.paypal.com/api/orders/v2/orders-capture
- https://developer.paypal.com/api/payments/v2/captures-refund
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/invoicing/use-cases
- https://github.com/paypal/AI-Toolkit
- https://developers.openai.com/api/docs/guides/structured-outputs

The hackathon directory was checked during the build. Sponsor trials (including optional scheduler trials) are not needed for this beta. A complete judged submission still needs a demonstrated actual sandbox transaction, connected AI, a public source repository, and the final demo assets; this owner-private prototype is the development starting point.

## Next milestones

Real group membership and invitations; natural-language plan drafting; live supplier discovery; actual-capture recovery across non-fixture bookings; invoice issuance and reconciliation; item-specific discount/tax corrections; configurable reminders and opt-in delivery.

MIT License; see LICENSE.
