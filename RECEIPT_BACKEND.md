# Saved receipt drafts and extraction

Implemented October 14, 2026 in the canonical `planrecover-sandbox-site` checkout.

Receipt uploads now create a plan-scoped `receipt_drafts` record and save their R2 source before inference. Drafts survive refresh, an inference outage and a failed extraction. Source amounts remain nullable in `sourceFacts`; the legacy numerical receipt projection is a draft requiring review, never confirmed evidence. The editor leaves unclear fields blank and requires explicit entries/currency review before source confirmation.

## Configuration

The receipt service prefers Amazon Bedrock when its server configuration is present. Configure `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_REGION` and `BEDROCK_MODEL_ID` as server settings; the key must remain a secret. The selected Converse model/profile must support images. Optional `BEDROCK_TIMEOUT_MS` and `BEDROCK_MAX_TOKENS` follow the adapter limits documented in `BEDROCK_SETUP.md`. No AWS account setting or live invocation was performed by this implementation.

When Bedrock settings are entirely absent, the existing `OPENAI_API_KEY` and optional `OPENAI_MODEL` support the prior Responses extraction flow. A partial or failing Bedrock configuration produces a saved manual-review draft; it does not silently invoke another configured provider. A provider inference lease allows one active extraction per member and limits each member to 20 receipt AI requests per hour. PDFs, missing AI configuration, and Bedrock images larger than 3.5 MB remain available for manual review without consuming that inference quota.

Apply migration `0007_receipt_drafts.sql` and the shared AI usage migration `0009_ai_usage_limits.sql` before running these routes. `DB` and `BUCKET` remain required; development and hosting use separate storage.

## API and review boundary

- `POST /api/receipt` accepts multipart `file` and optional `tripId`. The response retains the existing `receipt` and `note`, adding `draft` and `reviewFields`.
- `GET /api/receipt?tripId=...` lists the latest 50 uploads for the selected plan.
- `GET /api/receipt?draftId=...` or `?draftFileKey=...` reopens a saved upload, its raw nullable source facts, warnings and review projection.
- `GET /api/receipt?key=...` preserves protected attachment download.
- `PATCH /api/receipt?tripId=...` accepts `{draftId, version, receipt, resolvedFields, currency}`. Every required source field must be explicitly resolved; the server validates the full existing receipt contract, payer, source key, currency, exact total and claimed allocation. A stale draft version fails. Review alone changes no financial record.

Members can read their plan's drafts; owner/editor access is required to upload and review. Cross-account/plan access, viewer writes and receipts using a different saved source are rejected. An extraction interrupted for more than one minute can be completed manually. The later workspace or per-plan receipt action must match the saved reviewed draft; edited values require another draft review. Earlier receipts without a stored upload draft retain their existing review flow.

Saving for group review and each affected member's approval remain distinct steps. Only the existing explicit receipt approval flow records a manually confirmed expense. AI never confirms a payment, booking, invoice or refund. A source currency mismatch stays visible and no conversion is performed automatically.

## Verification

`node scripts/test.mjs backend-receipts` runs ten actual-route integration checks against migrated SQLite and an in-memory R2 fixture. They verify authorization, persistence before inference, nullable evidence, exact review totals, stale/cross-source edits, both mutation routes, safe provider/limit failures, PDF/manual behavior, currency mismatch, viewer access and stale-extraction recovery. Provider calls are injected fixtures; live inference and payments are disabled.

TypeScript checking passed with the new receipt route and editor. Remaining receipt work includes provider-assisted PDF extraction, extraction retry/version history, richer quantity/discount allocation, attachment retention/orphan cleanup jobs and hosted end-to-end extraction with configured AWS access.
