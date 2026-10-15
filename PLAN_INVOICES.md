# Plan-linked sandbox invoices

The existing `/api/invoice` equipment-rental example remains compatible. The new plan endpoints invoice one current member's approved share of one fictional merchant item in CAD. An invoice is a payment request, not an installment debit authorization or a booking confirmation.

## Workflow

1. The owner and required participants approve the item revision. Its merchant quote must remain valid and unpaid.
2. The owner creates a draft with `POST /api/plans/{planId}/invoices`. Supply `version`, a stable UUID `requestId`, `itemId`, `revision`, `memberId`, `email`, `due` (`YYYY-MM-DD`), `dueAt` (an exact timestamp with offset), `allowPartial`, and integer CAD cents `minimum`. The server derives the invoice amount from the approved member share. `dueAt` must fall on `due` in the plan's time zone. Full-payment invoices require `minimum` equal to the approved share.
3. Creation stores the immutable terms and saves the provider invoice ID before fetching its details. It creates an unpaid PayPal draft and does not notify the buyer. Retry with the same request ID and terms after a timeout; altered terms require a new approved revision and request.
4. The billed member reviews the recipient email, deadline and partial-payment minimum, then posts `{version, invoiceVersion, action: "approve", confirm: true}` to `/api/plans/{planId}/invoices/{invoiceId}`.
5. The owner explicitly posts the same envelope with `action: "send"`. This is the only invoice action that requests a buyer notification. The returned `paymentUrl` is the server-verified sandbox invoice page. Buyer-initiated payments remain under PayPal's control.
6. The recipient or owner posts `action: "reconcile"` with current plan/invoice versions, or the private recovery scheduler checks the saved provider ID. This reads the canonical invoice and records each verified PayPal payment exactly once.

GET endpoints return saved invoices without provider effects. Owners can read every invoice in their plan. Other members can read only their own invoice, including their private email and payment URL. Viewers can read their own invoice but cannot approve, create, send, reconcile or cancel it. Other plans and unrelated accounts receive no invoice details.

## Money and recovery

Canonical verification checks the invoice ID, deterministic reference, invoice number, CAD total, exact item, recipient, due date, partial-payment minimum, payment transaction IDs, paid total and outstanding amount. External or manually marked payments do not count as server-verified PayPal money. Tips, refunds, changed totals and unsupported provider states require review.

Each verified partial payment records equal incremental cost and contribution for the billed member. Payment facts, the member's paid amount and invoice balance commit together with immutable financial history. The planned remainder decreases by the verified amount. A fully paid unchanged item share is marked paid; late payments on changed or deleted plans still enter financial history without approving a new booking.

A funding claim prevents a checkout order and an invoice from collecting the same approved share. Unknown provider outcomes retain their original invoice request and provider ID. Recovery reads existing invoices only; it cannot create or send one automatically. Leases fence concurrent actions, and repeated provider payment IDs cannot increment the ledger twice.

The owner can explicitly cancel an unpaid draft or sent invoice. An invoice with recorded payments needs a reviewed refund rather than cancellation. Editing the approved item revision invalidates sending the old invoice. Changing invoice terms requires cancelling the unpaid invoice and approving a new item revision; terms are never edited in place.

## Verification

`pnpm test` includes `tests/backend-invoices.mjs`, which uses the real SQLite migrations, authenticated route handlers and a fake provider. Its 16 checks cover draft-only creation, privacy, explicit approval/send, provider-ID recovery, partial/full payments, tampered and external payment evidence, stale revisions, notification races, funding conflicts, sandbox payment URLs, late deleted-plan payments, atomic rollback and recovery after an interrupted status update. No live PayPal request or notification is sent by these tests.

For a live sandbox check, use a joined test member and fictional merchant quote, create and approve a draft, explicitly send it, open its verified sandbox URL as the test buyer, make a partial payment, then reconcile. Check that `paid + outstanding = amount`, the money ledger contains one effect for each actual provider payment, and a repeated reconciliation changes no money. The test buyer can then pay the remainder. Existing sandbox merchant credentials must have invoicing access. Actual provider invoicing and payment notifications still need this live verification.

Provider contract references: [PayPal invoice object](https://developer.paypal.com/invoicing/object/), [payment transaction schema](https://developer.paypal.com/api/invoicing/v2/definitions/payments), [invoice endpoint reference](https://developer.paypal.com/invoicing/reference/) and [idempotency](https://developer.paypal.com/invoicing/core-concepts/).
