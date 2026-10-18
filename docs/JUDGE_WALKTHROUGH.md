# Judge walkthrough and clean startup

This guide describes a reproducible synthetic demonstration. It is not evidence of a genuine payment, model invocation, supplier booking or refund.

## Local startup

Use Node24 and pnpm11.25.0. From the project directory:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate:local
pnpm start
```

Use the loopback URL printed by the server. Local migrations/storage stay separate from the hosted Site. `pnpm dev` supplies the starter's loopback-only test identity. Private provider settings are optional for manual receipt review and saved-plan answers; absent settings must remain visibly unavailable.

Do not deploy the exported Worker publicly without a verified identity gateway. It trusts Site-supplied identity headers. GitHub Pages cannot run this backend. See `HOSTING.md` before a hosting move.

## Review sequence

1. Create a synthetic shared CAD plan; add a free task and a priced activity. Show each member's private budget and separate approval status.
2. Add and confirm a prerequisite chain. Show how changing a relationship resets affected approvals and blocks recovery until review is complete.
3. Open a payment review. Explain exact share, current quote and individual buyer consent. Only perform a genuine sandbox checkout with a configured authorized sandbox buyer.
4. Add a synthetic receipt; select its planned purchase; choose line claim/allocation rules. Approve the exact shares and show the planned estimate reconciles once.
5. Prepare a disruption recovery. Display retained cost, expected refund and cash required now. Expected refunds do not fund the new payment.
6. Inspect the exact cancellation/refund policy and allocations before approval. Demonstrate saved progress after reload and separate booking/payment states.
7. If invoicing is retained, inspect recipient, due instant, minimum and revision before approval. A genuine deposit/balance/refund must have its own recorded provider evidence.
8. Open To do, inspect persisted reminders and mark a notification read. Show the owner service panel and explain schedule/provider configuration status.
9. Open the simulated assistant. A saved-plan answer works without model access. Label any genuine model-produced preview separately; an unavailable-provider fallback is not an AI integration success.

## Access and reset

The existing hosted Site remains owner-private. Choose authorized judge access or this local route before submission, then rehearse with a fresh outsider session. No access was broadened by a source change.

Use fictional people/receipts only. Create a new synthetic plan for each rehearsal. Do not use a reset operation on real payment history; the app's soft deletion preserves original financial identities and revokes invitations.
