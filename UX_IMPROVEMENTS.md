# Payment and everyday usability update

October 15, 2026. Based on the complete backend release `8bd3ed44d97fea2948234eccaa1f4f4ca2f909ab`.

- Money opens with the caller's actionable payments. Invoice-funded shares link to their invoice; partial invoices show the remaining balance once, rather than also offering the full share through checkout. Pending refunds, outside bookings and unapproved items do not inflate that payment total.
- Checkout first shows the item, exact share, currency, payer and test-funds label. PayPal setup happens before the Continue click so the actual session starts directly from the buyer's gesture. Only the approval callback may request server capture.
- Confirmation, cancellation, connection failures and uncertain outcomes remain visible. Duplicate clicks/callbacks cannot repeat an attempt. Uncertain confirmation offers a status check, not an automatic second payment. Technical SDK authentication errors have plain-language guidance.
- Home/Plan have quick actions for the schedule, payments, receipt scanning and plan changes. To do directly links to saved reviews. Invoice links retain the selected plan and open the invoice section. Review pages have loading, retry and no-plans states. Navigation resets scroll and moves keyboard focus to the main content.
- Plan GET responses include the authenticated member ID, so review controls use explicit caller identity. Server authorization and payment amount validation remain authoritative.
- Settings explains background checks. The existing hourly task remains paused; the update does not enable, replace or duplicate it. Checks never initiate capture, invoice sending or refunds, and checkout does not depend on the task.

Validation: full TypeScript checking, production build and all 48 regression suites passed. New checks cover the buyer-gesture session start, duplicate callbacks, cancellation/late approvals, uncertain capture, partial-invoice totals and cross-account/plan filtering. Existing checkout/invoice route checks still pass.

Browser checks used an isolated local database with one approved fictional CAD16 share and intentionally fake PayPal credentials. The review amount, friendly failure/back path, invoice navigation, mobile sidebar and schedule explanation were verified. At 390px width, the payment button was 44px high and the page had no horizontal overflow. No capture, invoice send or refund was submitted; no AWS inference was used. The temporary server/tab and fake local credentials were removed after QA.

The broader application remains a CAD sandbox. This update does not claim a new successful live provider transaction or a physical Alexa+ connection.
