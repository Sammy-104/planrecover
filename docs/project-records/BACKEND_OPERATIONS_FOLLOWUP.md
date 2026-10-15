# Backend operations follow-up

October 15, 2026, America/Toronto.

The user asked to begin the remaining work, then explicitly requested that the PayPal webhook relay stay local and be ready to move online later. No public receiver was created, no hosting account was connected and no PayPal registration was changed.

## Completed locally

The independent `planrecover-paypal-relay` project contains a hardened sandbox receiver, disabled local configuration, pinned development-tool version, online configuration preparation, tests and a cutover/rollback guide. It is separate from the private application's release being finalized in **Find remaining backend work**.

Notable implementation fixes: wrap the Worker runtime entry point so its execution context is not mistaken for an HTTP client; require the rate-limit binding; preserve signed bytes; bound both body size and reading time; restrict certificates to the private sandbox verifier's accepted policy; strip visitor credentials; require an explicit processed-inbox acknowledgment; and fail closed without the configured runtime secret. The included application relay scaffold's entry-point defect was reported to its publishing chat for correction.

Verification completed:

- 15 offline relay checks passed.
- Integration with the actual migrated private webhook inbox passed: an injected invalid signature is rejected before storage; repeated verified fixture deliveries are processed once. No genuine PayPal verification or financial actions were performed.
- Worker JavaScript syntax check passed.
- Wrangler 4.92.0 dry-run packaging passed with the required limiter and disabled configuration. No deployment occurred.
- The generated Worker bundle's actual default entry point returned 503 without enabling configuration, as intended.
- No credentials were written to source/configuration, no live provider calls were made, and no temporary server remains running.

See [relay README](planrecover-paypal-relay/README.md) for local commands and the exact future online setup. The existing minimal scaffold in the application's source is not the authoritative hardened standalone package.

## Existing hourly schedule

Site: `appgprj_6acda78092f88191983f45ead7f29505`.

Existing task: **PlanRecover payment checks and reminders**, ID `Automation_01635d3924948191971a67a2cb856d4c`, hourly in `America/Toronto`.

The Sites readback during this session reports `is_enabled:false`. The existing private runner has passed hosted manual checks in the publishing chat, but that does not prove an unattended scheduled run.

The task-controls page redirected to ChatGPT sign-in. The user reported: “We ran into an issue while signing you in, please take a break and try again soon.” Further sign-in attempts were stopped and the temporary tab was closed. Available Sites controls can create a new schedule but cannot update this existing one; no duplicate or replacement schedule was created.

Once account access works, resume this exact task through its supported controls, confirm Sites reports it enabled, and verify a fresh scheduled `background_job_runs` record. Preserve the Site's private audience and its existing service-access instructions in `planrecover-completion-site/AUTOMATION.md`. Do not substitute a successful manual invocation for scheduled verification.

## Still open

Relay publication/registration and genuine signed delivery are deliberately deferred by the user's local-only instruction. Scheduler resumption is blocked by account sign-in. AWS quota, real provider accounts, hosted multi-account journeys and genuine invoice deposit/balance verification remain separate external checks. This local work neither provisions AWS resources nor establishes an Alexa+ service/device connection.
