# Recovery deployment and live PayPal sandbox verification

October 14, 2026 — America/Toronto.

## Deployment completed

- Private Site: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site
- Recovery verification page: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site/recovery-sandbox
- Recovery source: `dd4555437b484b44dab3a719a1b9ac887b884be0`, retained in `recovery-deployment/`.
- Saved version: 8, `appgprj_6acda78092f88191983f45ead7f29505~appgver_d9f0c9fab084819185f53f8c835d51df`.
- Successful deployment: `appgdep_6ad02397bd0c819180f8cb50adc0d8c0`, environment revision 4.
- Migration `0014_recovery_execution.sql` was included in the supported deployment archive; Sites applies hosted migrations before publishing the Worker. The deployment succeeded.
- The following chat/receipt release, version 9 (`3abf68e3ee5ad758105c1bde4a02206b7fc91d44`), also deployed successfully. Its recovery service, migration 0014 and verification page have identical Git blobs to version 8. Both sets of changes are retained.
- Access remains custom/owner-only: one allowed account, no allowed groups. Secrets and audience were preserved.

The isolated recovery release passed all 38 suites, including 30 recovery checks, plus TypeScript checking and production build. Its source excludes unfinished receipt/chat edits. The subsequent combined chat/receipt release records 40 passing suites in `CHAT_RECEIPT_TEST_REPORT.md`.

## Live checks completed

- Merchant authentication against `api-m.sandbox.paypal.com` succeeded using the existing local sandbox credentials, without copying or printing them.
- Canonical lookup confirmed the earlier capture `45Y272409N4413455` is `COMPLETED`, CAD 16.00. That historical local capture was not refunded or reassigned to the hosted test.
- The deployed signed-in owner created a separate personal test plan, exact fictional merchant quote and immutable item approval using the normal authenticated endpoints.
- The deployed checkout endpoint created a genuine PayPal sandbox order. Connected OAuth MCP reads confirmed the new plan and unpaid obligation; they did not initiate a payment or refund.

| Saved test record | Value |
| --- | --- |
| Plan | `68569aec-1f57-45f7-9f55-0757cec89368` |
| Name | Recovery sandbox verification 2026-10-16 |
| Item | `65b4bd50-6905-4e0b-aa93-7527eb16489c` |
| Approved amount | CAD 16.00, one signed-in participant |
| Sandbox order | `2L003868TR387890G` |
| Intended partial-refund terms | 80%, no fee: CAD 12.80 refund and CAD 3.20 retained |
| New verified capture | `1R729678FE943924U`, `COMPLETED`, CAD 16.00 |
| Saved recovery proposal | `99fe2966-9da1-44b3-959e-28fe501fed52`, version 1, fully approved |
| Verified partial refund | `2D573359UJ196931X`, `COMPLETED`, CAD 12.80, linked to capture `1R729678FE943924U` |
| Remaining test cost | CAD 3.20; no merchant amount due |

## Buyer approval and owner execution

The user explicitly approved PayPal's published sandbox test card and fictional buyer details. Those details were filled into the sandbox guest checkout, with account creation disabled. Automatic approval review then rejected the agent's final **Pay Now** click, requiring the human user to perform that action even in sandbox. The user clicked it, and PayPal returned: “We weren’t able to add this card.” No capture was recorded.

A replacement Visa was generated through PayPal's official sandbox card generator, which explicitly supports PayPal Checkout. The user approved its exact test details, and the replacement was filled. PayPal recognized its currency and displayed CAD 16.00 after selecting CAD. The user performed **Pay Now** and **Verify and capture approved order**. Independent canonical reads confirmed both the order and capture are `COMPLETED`, with exactly CAD 16.00. The hosted ledger contains exactly one matching expense. MCP reports cost/contribution of 1,600 units, no remaining merchant due and no refund yet. The lingering PayPal processing page was closed after canonical completion was verified.

The fictional 80% policy was registered, and proposal `99fe2966-9da1-44b3-959e-28fe501fed52` snapshots 1,280 CAD units against the exact canonical capture. The signed-in owner's approval was recorded; the proposal was fully approved and had no dependencies. The user performed **Execute approved sandbox refund** and reported completion. The agent did not perform the final refund action or bypass the handoff with an equivalent indirect request.

## Completed live recovery verification

- Independent PayPal sandbox reads confirmed order `2L003868TR387890G` is `COMPLETED`, capture `1R729678FE943924U` is `PARTIALLY_REFUNDED` for the original CAD 16.00, and refund `2D573359UJ196931X` is `COMPLETED` for CAD 12.80 against that capture. Verification made no provider mutation requests.
- The hosted plan contains exactly one confirmed CAD 16.00 expense and exactly one confirmed CAD -12.80 refund. Their participant shares and contributions match those amounts. Both events remain in financial history.
- Reservation `f57b2ff0-ce40-4787-b285-c4184979f5a2` is `confirmed` for 1,280 units and references the same refund. The recovery proposal is `completed`, the selected test item is `cancelled`, and plan version is 6.
- Connected read-only MCP reports cost and contribution of 320 units, confirmed refund of 1,280 units, expected refund of zero, merchant due of zero and friend balance of zero. There are no remaining decisions for this plan.
- Repeating **Verify the same execution again** after completion returned `completed`. A before/after comparison found identical full financial history events, refunds, reservations and plan version, still with one expense and one refund. The completed service path returns before acquiring a lease or invoking PayPal.
- The provider's partial-refund state and the single confirmed reservation show the live refund was applied once. The internal capacity table was not directly queried during this hosted check; its atomic transition and limits were covered by the 30 offline recovery checks.
- Screenshot: `outputs/planrecover-recovery-completed.jpg`.

The requested deployment and live sandbox capture/partial-refund workflow are verified. Signed provider webhook delivery remains a separate unverified integration. Bank availability is not established by sandbox refund completion.

The test plan, completed sandbox capture, refund and recovery are retained as financial verification data. The recovery page remains open; temporary PayPal checkout and card-generator tabs were closed. No temporary AWS resources, paid services, new persistent credentials, invoice notifications or real supplier bookings were created. No local preview server was started. No real card or real funds were used.
