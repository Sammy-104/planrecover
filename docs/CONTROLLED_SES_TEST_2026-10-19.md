# One controlled SES reminder test

This workflow sends at most one email copy of one existing due in-app reminder to the signed-in owner's own confirmed address. It is separate from normal email reminder delivery. `AWS_SES_ENABLED` stays `false`; email opt-ins, push, the background schedule and the original in-app reminder are unchanged. Opening the page, previewing details and refreshing saved status never sends email.

## Prepare the exact test

Use the existing verified SES sender and dedicated restricted credentials in private server settings. In the SES sandbox, the recipient must also satisfy AWS recipient verification. The signed-in gateway email must match the owner's saved, confirmed email destination. No client-supplied destination is accepted.

On `/flows`, select the personal plan. The owner-only **Send one reminder email test** panel lists the signed-in owner's due in-app reminders. Select one, then expand **Reminder test details** to read the exact plan ID, reminder job ID, current plan version and in-app status. Preparing a test does not require running background jobs or consuming the in-app reminder.

Configure only the following additional private runtime setting:

```text
AWS_SES_CONTROLLED_TEST=
```

Its value is strict JSON containing the exact `planId`, exact `reminderJobId`, and ISO `expiresAt`; an optional `grantId` is allowed. The expiry must be in the future and no more than one hour away. Keep actual values outside the repository and delivery reports. For example, the shape is:

```json
{"planId":"<selected-plan-id>","reminderJobId":"<selected-due-in-app-job-id>","expiresAt":"<ISO-instant-with-offset>","grantId":"<optional-short-label>"}
```

Refresh the test details after private runtime configuration is applied. The preview displays the confirmed recipient, reminder text, original due time, grant expiry, and current plan/preferences/destination versions. It must match the selected reminder. A stale or unavailable preview cannot enable the send button.

## Explicit consent and saved evidence

Click **Send one test email to my confirmed address** only after reviewing the visible copy. This is the only UI action that submits a send. The POST contains the exact reminder job ID, the three displayed/current versions and `confirm:true`. The server independently rechecks owner membership, trusted account email, confirmed destination, due source, plan/preferences/destination versions, suppression and grant expiry. It checks again immediately before the signed SES request.

A durable `aws-ses` / `controlled-self-test` attempt is reserved before provider contact. Its identity is stable for this owner, member, plan and reminder job; changing a grant label or expiry does not create another send opportunity. Migration `0025_controlled_reminder_email.sql` adds a unique source scope and immutable/retained-attempt protections. Concurrent/replayed requests read the same attempt. Accepted, pending, uncertain, rejected and not-sent attempts are never automatically retried. The UI disables another send after an attempt, including when the browser cannot confirm the result. Refreshing reads saved status only.

SES acceptance means AWS accepted the request; it does not establish inbox delivery, reading, or signed delivery-event processing. Check the inbox separately. An uncertain response remains uncertain, and a rejected request is not promoted to success. Do not delete attempt rows or reset their status to manufacture a retry. Remove the private grant after the authorized test, or allow it to expire.

The private endpoints are `GET` and `POST /api/plans/:planId/reminders/test-email`. They reject anonymous users, invitation context and non-owners. Without the exact unexpired grant, GET can return `available:false` with the actor/plan-scoped last saved attempt; it exposes only coarse outcome, timestamp and provider reference, with no recipient, message body, raw request or grant. The UI preserves that inspectable result after grant cleanup and keeps sending disabled. POST always requires an active grant and normal `AWS_SES_ENABLED` explicitly equal to `false`. Ordinary reminder inspection exposes only the current caller's jobs. No recipient address, reminder body, credentials or signed authorization header is written into the controlled attempt's request metadata.

## Backup and acceptance limits

The current Sites-managed host does not expose the full database export, complete private-object export and isolated hosted restore controls needed for a hosted backup/restore rehearsal. Existing object download routes and source ZIPs cannot substitute for that complete export. No hosted backup completion, restored private runtime, retention schedule, RPO or RTO is claimed. See [backup operations](BACKUP_OPERATIONS.md) for the existing offline capture/verification/rehearsal tools and their provider-export prerequisites.

Offline service tests and UI review checks do not send email or prove live delivery. A publication report must record the actual controlled request's saved outcome and any separately observed inbox result. General SES sending and unattended reminders remain disabled unless independently authorized and configured.
