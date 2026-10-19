# Bedrock operations and workflow integration — October 19, 2026

The application now accounts for Bedrock calls made by chat, the bounded agent, itinerary drafting, image/PDF receipt extraction and the explicit connection probe. The previously connected Canadian application profile remains the model connection. No new provider, credential, public endpoint or delivery channel is required for this change.

## Shared admission and accounting

Migration `0023_bedrock_operations.sql` adds metadata-only operation, invocation and scoped-evidence tables. Every provider HTTP invocation, including each agent round, obtains one atomic shared reservation before contacting AWS. The existing per-member/hour limits remain in force. Reservations span all members and profiles in the same application database, so selecting another plan or profile cannot bypass the shared limits.

Defaults match the observed account quota: 20 provider requests and 400,000 estimated tokens per rolling minute. Input reservations use bounded text/media estimates plus the maximum requested output. Actual reported input/output/total counts replace estimates when valid counts are available, including when the response later fails application validation. Unknown usage remains unknown and retains its reservation; it is never treated as proof of zero billing. Media token estimates and late provider completion can differ from actual billed usage. These controls do not constitute an exact monetary spending cap or replace AWS quotas.

The agent remains bounded to three model rounds and four tool calls, with an overall deadline. Requests that time out, reach a limit or fail accounting are not automatically retried. A storage failure before admission prevents the model request. Interrupted or abandoned attempts remain inspectable.

Stored metadata includes feature, owner/member/plan scope, configuration fingerprint, start/completion/latency, allowlisted outcome/diagnostic fields, known token counts and an optional cost estimate. The operations tables do not store prompts, model replies, receipt images, supplier text, raw provider errors, API keys or raw model/profile identifiers. Existing authenticated transcripts and receipt sources retain their own independent access rules.

## Optional server settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `BEDROCK_SHARED_REQUESTS_PER_MINUTE` | `20` | Rolling shared provider request admission |
| `BEDROCK_SHARED_TOKENS_PER_MINUTE` | `400000` | Rolling estimated-token admission |
| `BEDROCK_DAILY_TOKEN_LIMIT` | Unset | Optional shared token allowance, resetting at midnight UTC |
| `BEDROCK_INPUT_USD_PER_MILLION_TOKENS` | Unset | Explicit verified input-token price for this exact model/profile |
| `BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS` | Unset | Explicit verified output-token price; configure with input price |

No price is guessed. Without both explicit prices, estimated cost is unavailable. Missing counts also prevent a complete cost estimate. Estimates cover recorded model tokens only, not other AWS charges. Runtime settings are not changed by adding support for these settings.

## Owner status and evidence

The owner-only service panel shows current-configuration activity for the selected plan over the last 24 hours: validated responses, failures/interrupted attempts, known tokens, unknown-usage calls and an optional cost estimate. Its bounded query reports truncation rather than implying complete totals. It highlights recent account/model access and request-limit issues without exposing provider text or another owner's activity.

The panel separately records five server-observed scopes:

- A Bedrock reply restored through the authenticated saved-conversation endpoint.
- A saved agent proposal read back through the authenticated repository.
- An itinerary preview constructed after current membership, plan version, private preference and source checks.
- Saved image extraction read back after its durable receipt revision was written.
- Saved PDF extraction read back after its durable receipt revision was written.

Evidence must match a succeeded operation, successful invocation, current configuration, matching actor/plan and current non-legacy membership. Proof references are hashed and duplicate observations do not inflate counts. No client endpoint can mark a feature passed. Changes to the connection/settings require new scoped observations. A validated response alone cannot create saved-result evidence, and these limited observations do not certify accuracy, review, approval, later application or production readiness.

## Proposal integration corrections

Before saving an action preview, the agent now runs the authoritative edit validation against an isolated copy of the current plan. Invented item/member IDs and invalid task actions cannot become saved previews. This validation makes no persistent plan or financial change.

The assistant's concurrent-change check recognizes only its exact new recovery/departure review, with matching creator, unchanged terms and no approvals. Competing decisions or edits still invalidate the reply. A successful preparation no longer rejects itself merely because its own saved review became a new pending decision. Durable checkpoints and request replay continue preventing duplicate previews and inference.

Proposals prepared from invitation views belong to the signed-in caller's account. Review links resolve the authenticated member's proposal identity and recheck current plan membership, including for older invitation-created action previews. Other members and removed members cannot read them. Legacy new-plan previews tied to another account must be prepared again before creation; they cannot create a plan under the wrong workspace. The review API returns only the required preview fields rather than internal owner identifiers.

## Validation and acceptance scope

Private version 25 passed a live agent action preparation with a real saved review link, a simple CAD 5.00 PDF, and a two-line CAD 19.95 PDF containing a receipt discount, added tax and tip. The PDF results were saved as Bedrock revisions without source/payment confirmation or expense approval. Browser acceptance exposed two frontend integration gaps: proposal links initially selected the first listed plan, and receipt links were ignored. The follow-up binds reviews to their authenticated target/version, displays exact proposal fields, and opens receipt links only after selecting the authorized plan with the correct caller. Successful PDF extraction also has accurate status wording. The publication report records final live verification of these corrections.

Offline tests cover shared admission across members/agent rounds, usage and failure recording, replay, private readback evidence, exact IDs, competing edits and receipt validation using migrated SQLite and intercepted provider responses. The release report records the final suite/build and publication result.

The prior private release already passed connection, saved chat, itinerary preview and one simple synthetic image receipt check. Live acceptance for the new controls, proposal review screens and PDF fixtures is recorded separately in the release verification report; fixture success is not live provider evidence. Real supplier data, payments/refunds, email/push delivery and unattended scheduling retain their separate acceptance requirements.
