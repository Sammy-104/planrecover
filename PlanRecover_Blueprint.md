# PlanRecover: product and build blueprint

**Current specification:** [docs/CURRENT_SCOPE.md](docs/CURRENT_SCOPE.md) records the implemented architecture, boundaries and deliberate extensions. Historical proposals below are not a requirement to migrate hosting or activate every adapter.

Prepared 7 October 2026 (UTC). Updated to include all additional group features and personalized suggestions. Recommendations are design proposals; API facts and hackathon dates were checked against the official sources listed below.

> Plan together, pay your share, and recover together when plans change.

## 1. Product definition

PlanRecover connects a personal or group goal to the schedule, purchases, receipt items, payment deadlines, and people involved. When something changes, it recomputes the schedule and each person's financial position.

The first audience should be small groups of friends planning a weekend trip. This gives receipt splitting, shared bookings, upfront costs, and cancellations a natural place in one workflow. The underlying model also supports a shared apartment move, a dinner, a club outing, or an event. Individual plans use the same system with one member.

The product promise is a usable plan and understandable obligations. Financing is an optional checkout choice, governed by the payment provider. Users enter spending and cash limits themselves; do not infer balances from a connected PayPal identity.

Receipt scanning and item assignment are already offered by Splitwise Pro. The proposed distinction is attaching those items and shares to commitments that can be changed, cancelled, replaced, or refunded, then explaining what changes for each person. This is a positioning hypothesis, not a claim of an uncontested market.

## 2. The connected user journey

### Create and agree on a plan

A user enters: "Plan a hiking weekend for four friends, under CAD 300 each."

Ask for dates, starting point, priorities, participant availability, total budget, and optional cash available now. Each member can keep their cash limit private while the app shows whether a proposed action is affordable. Financing eligibility and detailed credit information remain private.

The AI drafts an itinerary from a supported catalog and proposes dependencies. A user confirms that the shuttle serves the hike, that the lodging is useful for alternative activities, and that the group shares booking costs equally. Show the source and timestamp for prices and policies.

Members can accept different shares. One person can join the dinner but skip the hike. Sharing a plan does not imply sharing every expense.

### Discover things to add to the plan

A "Suggested for this plan" panel appears beside the timeline. It offers activities, meals, local events, free stops, practical errands, and preparation tasks that fit the existing commitments.

Use the user's chosen location, interests, pace, dates, available time, transport mode, budget, and participant preferences. Location can be entered manually. Calculate the impact on the complete plan, including travel and setup time, added transport costs, and each selected member's share.

Each suggestion explains why it fits, shows whether its cost is an estimate or a current merchant quote, and previews the revised timeline and budget. Let users save it, propose it to the group, or add it as a draft. Adding a draft is separate from confirming a booking or making a payment.

For example: "There is a 100-minute gap before dinner. This free viewpoint takes 45 minutes, with 20 minutes of travel and a 15-minute buffer." The first demo uses clearly identified synthetic data. A live suggestion needs source-backed place details and availability.

Suggestions can also resolve missing parts of a plan: a meal near the next activity, groceries before a picnic, packing supplies before a move, or an indoor alternative for a weather-sensitive activity. Recompute suggestions when the schedule, approved spending, or group changes.

### Purchase and track commitments

Offer two distinct ways to fund a supported merchant booking:

1. **Each member pays their share directly.** The merchant agrees to accept separate orders or invoices toward the shared booking. The application links them and confirms the booking only when the merchant's funding conditions are met.
2. **One member pays for the group.** The app records their contribution and creates reimbursement balances against the agreed cost shares.

Separate checkout orders are separate transactions, not one PayPal payment automatically split among friends. A live supplier must support this collection and reservation model. For the hackathon, use a fictional marketplace merchant with explicit terms.

A merchant service invoice can support a deposit and remaining balance. Record the provider-agreed schedule in the timeline. PayPal invoice partial payments do not, on their own, enforce an arbitrary installment calendar or automatically charge a buyer.

Eligible Pay Later appears through PayPal's own checkout controls. The borrowing member remains responsible for their financing agreement even when other friends reimburse them. Do not assume the app can read their complete financing schedule, change the loan, or cancel installments on receipt of a merchant refund.

### Add real-world spending through the receipt splitter

A member photographs a restaurant or grocery receipt and selects the plan:

1. Extract merchant, currency, receipt date, items, quantities, prices, discounts, tax, tip, and total into structured fields.
2. Show the image beside editable extracted values.
3. Flag unreadable fields and any difference between item totals and receipt totals.
4. Let people claim items; assign shared items to selected members or custom percentages.
5. Apply the agreed tax, discount, and tip allocation rule.
6. Show the exact share for each member and request their review.
7. Record who actually paid and how much. A receipt alone is not proof that a payment completed.
8. Add the confirmed expense to the plan and offer reimbursement instructions.

Use receipt tax amounts, not an invented local tax rule. When item-level tax treatment is unknown, offer a disclosed proportional allocation and let users correct it. Tips can be split equally or proportionally by agreement. Discounts associated with a specific item follow that item; group discounts need an explicit rule.

Compute in integer minor units. Allocate rounding remainders deterministically so the final shares exactly equal the receipt total. Do not silently distribute an extraction mismatch as a rounding error.

For friends' outside expenses, provide the recipient's approved PayPal.Me link with amount and currency, or record another payment method. This is a user-operated handoff; opening the link or returning to the app does not prove payment. Keep "reported paid" and "recipient confirmed" separate from API-verified settlement.

### Recover when the plan changes

Triggers include a participating merchant cancellation, a confirmed delivery delay, or a user reporting that a friend cannot attend. A weather alert can prompt review but does not prove that a provider cancelled.

For each trigger:

1. Identify directly and indirectly affected commitments.
2. Preserve useful commitments, such as lodging that can serve another activity.
3. Read documented policies and supported replacement inventory.
4. Calculate several feasible options with ordinary application code.
5. Show per-member final cost, new money required now, expected refunds, deadlines, and changed obligations.
6. Ask the affected members to approve the current option and their payments.
7. Execute permitted actions and track each to completion.
8. Append refund and settlement adjustments to the ledger; retain the previous history.

Suggestions such as "Refund pending: CAD 90; replacement needs CAD 105 now; final extra cost: CAD 15" explain both affordability and eventual cost.

## 3. Example receipt

Four friends share fries but choose separate meals. Sam pays the entire CAD 125.76 bill.

| Member | Meal | Share of fries | Pre-tax allocation | Tax allocation | Tip allocation | Final share |
|---|---:|---:|---:|---:|---:|---:|
| Sam | 24.00 | 3.00 | 27.00 | 3.51 | 4.86 | 35.37 |
| Alex | 20.00 | 3.00 | 23.00 | 2.99 | 4.14 | 30.13 |
| Maya | 18.00 | 3.00 | 21.00 | 2.73 | 3.78 | 27.51 |
| Chris | 22.00 | 3.00 | 25.00 | 3.25 | 4.50 | 32.75 |
| Total | 84.00 | 12.00 | 96.00 | 12.48 | 17.28 | 125.76 |

These are fictional receipt figures. The tax and tip amounts are present on the fixture; no tax calculation service is implied.

Before reimbursements, Alex owes Sam CAD 30.13, Maya owes CAD 27.51, and Chris owes CAD 32.75. Sam's own consumption is CAD 35.37; paying CAD 125.76 does not mean their personal trip cost increased by that full amount.

## 4. Example recovery

Four members originally each paid the participating merchant their own share. Amounts are final prices in CAD.

| Commitment | Group price | Per member | Documented demo terms |
|---|---:|---:|---|
| Hike | 360.00 | 90.00 | Full refund if provider cancels |
| Lodging | 480.00 | 120.00 | Non-refundable |
| Shuttle | 120.00 | 30.00 | Refund less CAD 10 group cancellation fee |
| Original total | 960.00 | 240.00 | |

The provider cancels the hike. A replacement compatible with the existing shuttle costs CAD 420.

| Option | Final group cost or loss | Per member | New cash required before refunds |
|---|---:|---:|---:|
| Replace hike; keep lodging and shuttle | Trip cost 1,020.00 | Trip cost 255.00 | 105.00 each / 420.00 group |
| Cancel all three commitments | Loss 490.00 after refunds of 470.00 | Loss 122.50 | No replacement payment |

Replacing adds CAD 15 per person to the final trip cost, but requires CAD 105 each while the original CAD 90 refunds are pending. Previously incurred dinner spending is excluded from this comparison and remains in the plan ledger under either option.

With four original captures of CAD 90, refund each capture to its original buyer. If Sam instead paid the whole hike and already collected reimbursements, the merchant refund returns to Sam; the application then records Sam's obligations to return the other members' shares. An internal ledger allocation does not move that money.

## 5. Financial views that must remain distinct

| View | Meaning |
|---|---|
| My cost | My agreed share of consumed or retained goods and services, net of confirmed cost adjustments |
| My contribution | What I actually paid toward those costs |
| Friend balances | What I owe or am owed after confirmed expenses and reimbursements |
| Merchant balance due | Unpaid supplier invoices or deposits, linked to a due date |
| Expected refund | A policy-based estimate or requested refund that has not completed |
| Confirmed refund | A provider-confirmed refund state, tracked separately from actual availability of funds |
| Cash required now | New payments that must be funded now; excludes pending refunds and another person's money |
| Financing obligations | Borrower's separately sourced repayment commitments; no implied lender modification |

Maintain separate currency balances. The first demo uses CAD only. A later display conversion should preserve original amounts and a dated FX quote; do not silently net debts in different currencies.

Friend repayments are transfers, not new group expenses. An installment does not create the purchase expense again. A replacement is a new expense, and a refund is a linked negative adjustment. These rules prevent double counting.

A refund may be pending or completed at PayPal while actual funding availability differs. The UI should not imply a verified bank balance.

## 6. Product screens

1. **Plans home:** trips and everyday plans, upcoming decisions, and due dates.
2. **Plan workspace:** timeline, participating members, commitments, cost summary, and suggestions that fit the current plan.
3. **Receipt review:** source image, editable item list, claim controls, and total reconciliation.
4. **Group money:** each person's share, contributions, debts, settlement evidence, and refund status.
5. **Recovery comparison:** options, timeline changes, per-person costs, and approval status.
6. **Action progress:** payment, replacement booking, cancellation, and refund states with retry or review controls.
7. **Demo merchant panel:** clearly marked simulated inventory, policy data, and cancellation controls.
8. **Discover:** activities, meals, free stops, errands, and preparation tasks with an insertion preview.
9. **Decisions and reminders:** pending approvals, member changes, and upcoming cancellation or payment deadlines.

The primary workspace should be compact: timeline at the center, money summary beside it, and a visible "Add receipt" action. Never hide the total cost behind financing messaging.

## 7. PayPal integration design

Use PayPal JavaScript SDK v6 for browser checkout, Orders v2 for creating and capturing orders, Payments v2 for captured-payment refunds, Invoicing v2 for merchant service invoices, and webhooks for verified state changes.

The documented TypeScript Server SDK can handle supported order/payment methods. Its published repository does not list Invoicing as a controller, so use authenticated server-side REST requests for invoice operations and verify coverage at implementation time.

| Flow | Integration | Scope |
|---|---|---|
| Pay for a booking/share | JavaScript SDK v6 + Orders v2 | Participating merchant; approved buyer checkout |
| Deposit/service bill | Invoicing v2 | Merchant creates invoice; buyer uses hosted payment flow |
| Replace cancelled purchase | New Orders v2 checkout | New payment; supplier availability verified separately |
| Refund original booking | Payments v2 capture refund | Original merchant or permitted platform credentials |
| Receipt reimbursement | PayPal.Me handoff | Recipient-approved link; manual confirmation unless supported API evidence exists |
| Business disbursement | Payouts, optional later | Funded business account; production access required |
| Flexible checkout | Eligible Pay Later | Provider controls eligibility, approval, and terms |

Do not use commercial invoices to disguise personal reimbursements. Payouts are funded business disbursements; they do not authorize arbitrary personal-account debits. A PayPal buyer login does not grant refund rights over unrelated sellers or access to every transaction.

For the hackathon, one fictional marketplace merchant can sell the simulated products through one sandbox business account. Each friend is a sandbox buyer. Supplier names are catalog fixtures, not separately onboarded sellers. A live multi-merchant platform would need merchant onboarding, delegated permissions, and appropriate platform access.

Booking confirmation is separate from payment confirmation. An invoice recording an outside payment is a recordkeeping operation, not a funds transfer.

## 8. AI and deterministic logic

Use one vision-capable AI provider first. It extracts receipts, converts natural-language goals into a draft plan, suggests dependencies, and explains computed options.

Require structured output with a schema. Include unknown fields, evidence references, and review flags. AI confidence values are review hints, not calibrated proof. Receipts and uploaded policies are untrusted inputs; their text cannot authorize financial actions.

Application code validates totals, allocates shares, checks deadlines, evaluates budgets, and calculates candidate recovery costs. A human confirms changes that alter obligations. Payment requests derive amounts from approved server-side data, never a browser-supplied total or free-form model response.

Only present replacement availability and refund terms from a supported source. Store quoted price, cancellation policy, fetched time, and expiration. Users confirm inferred relationships.

## 9. Chosen architecture

- React, TypeScript, Tailwind and shadcn components, served by Vinext/Vite in a Cloudflare Worker.
- D1 for durable plans, memberships, immutable financial facts and recovery workflows; private R2 for receipt sources.
- Trusted Sites identity and the existing private publication/source workflow. GitHub is a source mirror, not an automatic deployment.
- PayPal server adapters pinned to CAD sandbox; each member pays their own approved share.
- Optional Canadian Bedrock application profile for validated review-only output; manual review and saved-plan fallback remain usable.
- Database-backed durable recovery with explicit affected-member approvals. External supplier operations require a selected supported provider/bridge.
- Existing timeline/map components. No Supabase, Render or paid scheduler migration is required by this implementation.

Keep a recovery action record per step. Different providers cannot share one database transaction. If payment succeeds but booking fails, record the condition and run the explicit refund/review path. Use stable idempotency keys for retries. Reusing an idempotency key must represent the same operation and payload.

Verify PayPal webhook signatures and deduplicate event IDs. Validate merchant, currency, transaction reference, and amount before updating the ledger. Do not mark checkout paid solely because the browser reports success. A successful verified server capture can update state; webhooks reconcile asynchronous outcomes.

## 10. Proposed data model

| Entity | Main purpose |
|---|---|
| profiles | User identity and explicitly approved reimbursement link |
| plans / plan_members | Goal, currency, members, roles, and approved preferences |
| commitments | Supplier item, schedule, beneficiaries, price quote, policy, and booking state |
| dependencies | Confirmed directional relation and supporting evidence |
| receipts / receipt_items | Private file reference, extraction revision, and source totals |
| share_allocations | Item or commitment shares; immutable approved revision |
| financial_events | Captures, expenses, refunds, and settlement confirmations |
| invoices | Provider ID, amount due, state, and merchant payment terms |
| disruptions | Trigger and affected commitments |
| recovery_options | Approved inputs, computed outcome, cost, and expiration |
| recovery_actions | Execution step, idempotency key, provider IDs, and retry state |
| webhook_events | Unique provider event ID, verification result, and processing status |

Implement membership access rules for every plan-owned row and receipt object. Keep members' private liquidity preferences separately scoped. Administrative keys stay on the server.

## 11. First functional demo

Use four fixture members and one fictional merchant. Demonstrate at least one live sandbox buyer approval; fixture history can represent prior payments but must be labeled.

1. Create the CAD weekend plan, review suggestions, add a free activity and preparation task, and confirm the dependencies.
2. Demonstrate an individual member's share checkout.
3. Demonstrate a merchant invoice with partial-payment settings in a separate service example.
4. Upload a synthetic restaurant receipt, claim items, and approve the exact split.
5. Trigger the simulated hike cancellation from the merchant panel.
6. Compare replacement versus cancellation using the figures above.
7. Select the replacement and execute an approved sandbox refund and new buyer checkout.
8. Update financial and booking states independently; show remaining group approvals.
9. Show a personal receipt settlement handoff without sending real money.

Record fewer than three minutes of video. Provide a working hosted app or complete run instructions, a public source repository, and a license. Clearly distinguish simulated supplier data, seeded historical transactions, manual confirmations, and actual sandbox actions.

## 12. Build order and acceptance checks

**First milestone:** authentication, a seeded plan, per-item participation, private budgets, group approval revisions, a share allocation engine, one sandbox checkout/capture, and stored provider IDs.

**Second:** receipt upload, extraction, manual correction, exact-cent splitting, approved ledger entries, and seeded suggestions with schedule and budget previews.

**Third:** member departure proposals, dependency traversal, deterministic recovery options, refund execution, replacement checkout, and resumable action states.

**Fourth:** merchant invoices, cancellation and payment reminders, the complete financial summary, final presentation, and hosted demo resilience. Live discovery enrichment follows the same interface when configured.

Meaningful checks: shares sum exactly to the expense; an already settled expense followed by a refund creates the correct new balances; pending refunds never fund a replacement in the calculator; repeated webhooks do not duplicate money; refunds cannot exceed the remaining refundable capture amount; stale approvals cannot authorize a changed price; a payment-completed/booking-failed state remains visible.

## 13. Longer-term expansion

Everyday plans can reuse the same entities: a moving van before furniture transport, a workshop with transport and equipment, or a community outing with deposits and meal receipts. Begin with one complete trip before adding these templates.

Later additions include supported live supplier inventory, calendar export, opt-in email ingestion, weather review prompts, currencies, notification delivery, and merchant onboarding. The hardest long-term requirement is reliable access to supplier bookings and cancellation actions.

Avoid storing group funds in an app wallet during the first build. Prefer buyers paying supported merchants directly. Consider a business disbursement model only after its funding, recipient, permission, and product requirements are established.

## 14. Hackathon dates and tool lifecycle

Historical planning record: the original draft listed November12,2026 and a December judging period. Verify current official organizer dates, track and submission requirements before relying on them; they are not revalidated by this source change.

The listed Bryntum offer is a 45-day trial. Starting it now can leave a December judge without licensed access. Verify an extension or suitable redistribution license, or retain a working timeline without that dependency.

Current hosting is the existing private Site/Worker with D1/R2. Judge access or a reproducible local walkthrough must be deliberately prepared and verified. Historical sponsor offers do not determine the current architecture.

## 15. Official sources

- Hackathon overview and requirements: https://paypalaihackathon.devpost.com/
- Official rules: https://paypalaihackathon.devpost.com/rules
- Resource directory: https://paypalaihackathon.devpost.com/resources
- Receipt itemization competitor: https://www.splitwise.com/pro
- PayPal JS SDK v6: https://developer.paypal.com/sdk/js/set-up
- Orders v2: https://developer.paypal.com/api/orders/v2
- Refund captured payment: https://developer.paypal.com/api/payments/v2/captures-refund
- Merchant invoicing examples: https://developer.paypal.com/invoicing/use-cases
- Pay Later eligibility: https://developer.paypal.com/pay-later/overview
- Personal payment links: https://www.paypal.com/ca/cshelp/article/what-is-paypalme-help432
- Payouts prerequisites: https://developer.paypal.com/payouts/use-payouts/overview
- TypeScript SDK: https://github.com/paypal/PayPal-TypeScript-Server-SDK
- PayPal developer toolkit: https://github.com/paypal/AI-Toolkit
- Next.js installation: https://nextjs.org/docs/app/getting-started/installation
- Supabase Next.js setup: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- OpenAI vision: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI structured output: https://developers.openai.com/api/docs/guides/structured-outputs
- Render deployment: https://render.com/docs/deploy-nextjs-app
- Render sponsor offer: https://paypalaihackathon.devpost.com/details/render
- Render free hosting limits: https://render.com/docs/free
- Bryntum sponsor resources: https://paypalaihackathon.devpost.com/details/bryntum


## 16. Required additional features

All six features below are now part of the product specification. External data enrichment can be phased in while the same user flows work with the seeded demo catalog.

### Individual participation and flexible shares

Membership is defined per plan item. Users can select "everyone", a subset, or themselves. Selected participants can have equal shares, fixed amounts, percentages, or agreed weights; receipt item claims provide another allocation input.

When a user skips an activity, remove their proposed share from that activity only. Preserve their shares of retained bookings and previously consumed expenses. Show who is paying, who is benefiting, and which share revision they accepted.

Acceptance: adding a dinner for Sam and Alex creates no dinner obligation for Maya or Chris. All approved cost shares reconcile to the accepted amount.

### Handling a member leaving or changing availability

A member departure starts a change proposal. Inspect accommodation occupancy, minimum group sizes, transport capacity, reservation rules, and affected activities. Compare proceeding, modifying the booking, replacing it, or cancelling according to documented terms.

Show the departing person's remaining obligations, possible refund, and any proposed redistribution. Previously agreed non-refundable costs remain visible. Changing membership alone cannot authorize charges against the remaining members or silently rewrite an old settlement.

Example: four friends shared CAD 480 accommodation. If one leaves and the remaining three agree to take over the full cost, show the proposed increase from CAD 120 to CAD 160 each. If no new allocation is approved, retain the existing allocation and show the unresolved decision.

Acceptance: a departure never changes approved money records until the new revision is accepted; previous settlements are corrected through explicit adjustments.

### Individual affordability and exposure checks

Let each person enter a total budget, an optional cash limit for immediate spending, and a desired reserve. Keep these preferences private by default.

For each proposed activity or recovery option, calculate the estimated or quoted personal total, confirmed spending, planned remaining costs, new payment required now, upcoming merchant balances, and known refund exposure. Count existing retained commitments even if already paid.

An expected refund cannot cover a payment due now. Another member's contribution is available only through a separately approved and confirmed arrangement. Financing eligibility is not inferred.

The group view can show "approval pending" without revealing a person's private limit. The member can choose to disclose a budget conflict.

Acceptance: a replacement with CAD 15 additional final cost but CAD 105 due now fails a CAD 100 immediate-spending limit while preserving the correct final-cost calculation.

### Cancellation and payment reminders

Create reminders from provider-sourced cancellation cutoffs, invoice due dates, expiring quotes, pending share payments, and approved preparation tasks. Store the provider timezone and show dates in the user's selected timezone.

Allow configurable lead times, such as the previous day and a few hours before a cutoff. A reminder links to the relevant plan item and decision. It shows the documented consequence of missing the deadline.

Use in-app reminders first. Email or push delivery can be connected later with user opt-in. Deduplicate reminders and update them after rescheduling or cancellation.

Acceptance: rescheduling replaces outdated reminders; the interface shows when a cutoff is unknown rather than inventing one.

### Group proposals, votes, and approvals

Let participants propose an item and indicate interest. Casual preference votes help select an option. Financial approval belongs to every member whose obligation changes; each payer approves their own checkout.

Freeze an approval snapshot containing participants, amounts, currency, dates, supplier terms, and quote expiry. A changed price or share allocation requires approval of a new version. Booking confirmation waits for both the merchant's requirements and the required member approvals.

A simple group status reads "3 of 4 approved; 2 of 4 shares paid". Users can choose who participates in an optional item before approving its costs.

Acceptance: majority interest never authorizes a payment for someone who has not approved their obligation.

### Complete financial summary

The money panel shows separately:

- Actual personal cost and projected total including planned items.
- Amount personally contributed toward shared costs.
- Confirmed friend balances and reported settlements awaiting confirmation.
- Merchant balances due and their dates.
- Requested or expected refunds, provider-confirmed refunds, and availability that remains unverified.
- New cash required for the selected action.
- Known financing obligations when provided by the member or a supported source.

Provide expandable evidence for every amount: receipt, capture, invoice, refund, approved allocation, or manual confirmation. Editing a settled receipt creates a reviewed adjustment, preserving history.

Acceptance: a new installment, friend repayment, or refund status notification does not duplicate the underlying purchase cost.

## 17. Personalized suggestions and things to do

### Purpose and entry points

Suggestions help users make a more complete, practical plan. The main workspace includes a "Suggested for this plan" panel, and a Discover view offers fuller browsing.

Offer requests such as "Fill this free hour", "Find something under CAD 20 each", "Suggest dinner near our next stop", "Find an indoor alternative", and "What are we missing?"

Show a small number of strong matches at a time. Include free options and keep planned rest time available. A user can dismiss an item, mute a category, or set a relaxed, balanced, or busy pace.

### Suggestion categories

| Category | Travel examples | Everyday examples |
|---|---|---|
| Activities and experiences | Guided hike, museum, workshop, local event | Weekend outing, community event, class |
| Meals and shared food | Dinner near lodging, picnic groceries | Group dinner, groceries for a gathering |
| Free stops | Public viewpoint, park, self-guided walk | Local walk, free community activity |
| Practical stops | Supplies pickup, transit connection, luggage storage | Packing supplies, equipment collection, repair appointment |
| Preparation tasks | Pack equipment, check arrival instructions | Label boxes, confirm building access, assign setup duties |
| Backup options | Indoor activity, compatible replacement booking | Alternate delivery time, replacement service provider |

These are category examples, not claims about a current venue, event, price, or opening time.

### Context and preferences

Rank suggestions using the selected destination and date, schedule gaps, surrounding locations, available transport, party size, interested participants, stated interests, dietary preferences, mobility needs, pace, and remaining budget.

Use source-supported opening hours and relevant weather when available. Unknown accessibility details, dietary accommodation, price, or forecast remain unknown. A forecast can influence recommendations within its supported time range; it does not establish a cancellation or refund entitlement.

Keep personal cash limits and credit information out of shared recommendations unless the member explicitly shares them.

### How candidates are evaluated

1. Retrieve candidate places, events, supplier offerings, or appropriate task templates.
2. Normalize only data that the source and its terms permit the app to retain.
3. Check date, opening hours, participant constraints, and compatibility with existing commitments.
4. Calculate inbound and outbound travel, the activity duration, and a reasonable user-adjustable buffer.
5. Compute per-person budget effects for the selected participants, including known fees, supplies, and extra transport.
6. Mark cost estimates, missing facts, stale data, and actions requiring outside booking.
7. Rank feasible candidates by goal fit, stated interests, travel burden, total cost, flexibility, and group interest.
8. Explain the leading candidates using their actual supporting data.

Hard constraints are evaluated before ranking. A popular activity that does not fit the schedule or approved budget cannot appear as a confirmed fit. A candidate with missing required facts can remain a draft awaiting verification.

The model can interpret preferences and explain choices. Application code calculates schedule feasibility and exact costs. Provider price levels are not exact admission or meal quotes.

### The suggestion card

Each card contains:

- Name, category, source, and freshness.
- Why it fits this particular plan.
- Proposed time, duration, travel time, and buffer.
- Selected participants and the resulting cost shares.
- Cost status: free, estimate, or current merchant quote.
- Updated projected total and any amount required to book now.
- Relevant conditions, cancellation terms, and unresolved information.
- Action: save, propose, add draft, or continue to a supported booking.

For a fixture example: "Free viewpoint: 45 minutes at the stop, 20 minutes of travel, 15-minute buffer. Fits the 100-minute gap before dinner and adds CAD 0." These values are illustrative, not live route or venue data.

### Adding a suggestion

Selecting "Add to plan" opens a preview with participants, slot, route effects, budget changes, and prerequisite tasks. Saving it creates a draft plan item. Group approval schedules the agreed item; merchant confirmation establishes a booking when needed.

A paid draft contributes to projected spending while remaining separate from actual expense records. A linked capture, invoice payment, or receipt reconciles against the same purchase so it is counted once.

An outside restaurant or event can be scheduled with an external booking link. Only an integrated participating merchant can offer the app's PayPal checkout. A discovery API result does not grant booking, cancellation, or refund authority.

### Recovery-aware suggestions

When an activity fails, prioritize alternatives that preserve useful lodging, transport, supplies, and the group's original goal. Show whether a suggestion is a replacement or an optional extra.

For replacement options, compare the whole plan: retained costs, cancellation fees, new costs, refunds, schedule changes, and per-person funding needs. Reuse the same approval and recovery machinery.

For optional extras, retain the original plan and show their added cost. Suggestions should never quietly replace an accepted activity.

### Everyday plans and readiness

Use task suggestions to close gaps: collect boxes before packing, confirm an access window before movers arrive, pick up shared groceries before a dinner, or assign equipment return after a workshop.

Tasks can have an owner, deadline, completion state, and dependency without any payment. Purchased services can create related preparation tasks. Suggest rest and travel buffers as editable blocks, not spending opportunities.

### Small-group decisions

Friends can save options to a shortlist and indicate "interested", "skip", or "need another time". The app compares alternatives for the interested subset and previews their shares. Financial approvals follow the rules in Section 16.

A lack of votes is pending input, not consent. If a group decision stalls, show a smaller compatible option or let the organiser keep it as a draft.

## 18. Implementation additions for the expanded plan

Add the following entities to the proposed model:

| Entity | Purpose |
|---|---|
| plan_items | Shared parent for paid commitments, free activities, preparation tasks, and buffers |
| item_participants | Participation and approved allocation version for each item |
| member_preferences | Private budget, interests, availability, dietary or mobility preferences |
| suggestions | Source reference, permitted data, evaluation inputs, estimate or quote status, and proposed slot |
| suggestion_feedback | Saved, dismissed, interested, or skipped by member |
| approval_revisions | Exact participants, dates, terms, amounts, and required approvals |
| reminders | Deadline, timezone, owner, delivery preference, and deduplication key |
| tasks | Assigned owner, due time, completion, and dependencies |

Keep financial commitments as children of plan_items. A free activity or a task has no artificial payment record.

Proposed application routes include retrieving suggestions for a plan, previewing an insertion, proposing a revised item, approving a revision, reporting a membership change, and viewing outstanding reminders. All writes require appropriate plan membership.

For the prototype, seed 8–12 useful suggestions across free activities, meals, a bookable activity, and preparation tasks. Include a fit, a time conflict, an over-budget item, and an unknown-price item. Use the same provider interface for later live sources.

Additional acceptance scenarios:

- A free activity can be scheduled with zero financial events.
- Required inbound travel, outbound travel, and buffer all fit between locked items.
- A suggestion after a locked plan item respects the next item's location and start time.
- Unknown prices and availability are never rendered as confirmed quotes.
- A departing member's unresolved shares remain visible until an approved adjustment.
- Changing participants, dates, price, or terms invalidates stale financial approval.
- A receipt linked to an already recorded purchase does not create a duplicate expense.
- In-app reminders use provider deadlines, survive refresh, and deduplicate.
- Live source access can be disabled without breaking the synthetic demo.
