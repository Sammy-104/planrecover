# Amazon SES reminder email

The SES v2 adapter sends opted-in reminder jobs as plain-text emails. It stays disabled until the owner sets `AWS_SES_ENABLED=true`. No setup/readiness endpoint sends email. Existing in-app reminders continue independently. Native Web Push and signed SES outcomes/suppression are documented in [notification delivery setup](NOTIFICATION_DELIVERY_SETUP.md).

An independent [controlled self-email test](CONTROLLED_SES_TEST_2026-10-19.md) can send one explicitly reviewed copy of one due in-app reminder using a short-lived private grant while normal email remains disabled. Preview/readiness never sends it; the owner must click the dedicated send button. Its attempt has no automatic retry, including provider throttling. SES acceptance and inbox delivery remain separate observations.

## Private runtime configuration

The tracked placeholder list is `config/server.env.example`. Set actual values only in private server settings:

| Setting | Value |
| --- | --- |
| `AWS_SES_ENABLED` | `false` until configuration and acceptance testing are authorized; then `true` |
| `AWS_SES_REGION` | Region of the verified SES sender, normally `ca-central-1` |
| `AWS_SES_FROM_EMAIL` | Verified sender email, without a display name |
| `AWS_SES_ACCESS_KEY_ID` | Dedicated restricted IAM access key |
| `AWS_SES_SECRET_ACCESS_KEY` | Matching secret; never a Bedrock bearer token or SMTP password |
| `AWS_SES_SESSION_TOKEN` | Required when using temporary `ASIA...` credentials; otherwise optional |
| `AWS_SES_CONFIGURATION_SET` | Optional existing regional configuration set for operational events |

The implementation derives a fixed HTTPS endpoint such as `email.ca-central-1.amazonaws.com`, uses `/v2/email/outbound-emails`, and signs with WebCrypto SigV4 for service `ses`. It accepts only the commercial regions explicitly listed in the adapter; it has no arbitrary URL override. See [AWS SES endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html), [SendEmail v2](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html), and [AWS signature construction](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html).

Use a dedicated principal with only `ses:SendEmail`, restricted to the verified sender identity and region. Adapt this example with the actual account and identity; omit the configuration-set resource if none is used:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ses:SendEmail",
    "Resource": [
      "arn:aws:ses:ca-central-1:123456789012:identity/example.com",
      "arn:aws:ses:ca-central-1:123456789012:configuration-set/reminder-events"
    ],
    "Condition": {"StringEquals": {
      "ses:FromAddress": "reminders@example.com",
      "aws:RequestedRegion": "ca-central-1"
    }}
  }]
}
```

The adapter does not create identities, request production access, change IAM, or provision configuration sets. See the [SES v2 authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html).

## Recipient consent and account preparation

Verify the sender in the selected region. In the SES sandbox, recipients must also be verified; AWS applies regional sandbox sending limits. Production access changes recipient eligibility but still requires a verified sender. This implementation has not requested or verified production access. See [SES sandbox requirements](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

The owner-selected Canada Central email identity is Verified. Authorized follow-up setup created a dedicated credential restricted to the selected sender/recipient and region, stored in private runtime settings revision5. Application sending remains disabled and controlled delivery is unverified. A consumer Gmail address does not grant domain authentication control; SES warns DMARC can quarantine/reject mail. Prefer an owned authenticated domain for broader use. See [SES DMARC guidance](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html).

Each plan participant must opt into email reminders in private planning preferences and confirm their signed-in account email. Saving an arbitrary third-party email is rejected. Every send rechecks current membership, plan/source revisions, opt-in, destination version and the active job lease, including a final check after signing.

An enabled adapter can send due jobs through the existing authorized background runner. Set `AWS_SES_ENABLED=false` before configuring credentials if sending is not yet authorized. The runner processes at most five external jobs per owner by default, with a hard limit of ten per call; this is a workload bound, not an AWS quota or price guarantee.

## Durable attempts and operator review

SES `SendEmail` has no request idempotency token. Before each POST, `adapter_operations` stores a unique `aws-ses` / `send-email` attempt. Requests store hashes and scope identifiers, not credentials, email addresses, message bodies or authorization headers. A successful response persists the SES `MessageId`; repeating the same reminder reuses that evidence without resending.

Timeouts, lost responses, unknown errors, malformed acknowledgments and interrupted acceptance storage leave an uncertain attempt. A known returned `MessageId` is retained if a fallback evidence write succeeds. Expired leases never authorize another SES POST, and disabling SES cannot route a pending SES attempt through the generic email adapter. Existing generic email attempts also require manual review before switching that reminder to SES. SES attempts appear in the owner's operations review queue; prior-provider transitions are identified in the reminder's saved error. Operators should inspect SES event evidence using the `PlanRecoverAttempt` email tag; never delete attempt rows or reset them to make a presumed resend safe. No resend or uncertain-outcome override button is provided in this batch.

Only a parsed, documented `429 TooManyRequestsException` can automatically retry: at least one minute later, with a separate durable record, up to three attempts for the same reminder. Other definite rejections require configuration or content review. Credential rotation, opt-out, plan deletion or destination changes never erase past acceptance evidence.

SES acceptance does not prove inbox delivery. Signed SNS event ingestion, dedupe and recipient suppression are now implemented with disabled defaults; topic/configuration-set wiring, private ingress and genuine signed delivery/bounce/complaint evidence remain activation steps. No receiver GET auto-confirms SNS or sends email. Follow [notification delivery setup](NOTIFICATION_DELIVERY_SETUP.md) and [SES event notifications](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html).

## Verification

Run `node scripts/test.mjs backend-ses-email backend-adapters backend-reminders backend-expansion-routes` and `npm run typecheck`. Tests use real migrated SQLite and injected fixture HTTP, including independent SigV4 calculation, concurrent and expired leases, accepted replay, ambiguous results, storage interruptions, recipient ownership and opt-out/deletion fences.

Sender verification and restricted private credentials are complete; sending stays false. Regional sandbox eligibility, controlled recipient acceptance, event ingress and unattended-run evidence remain deployment work. Fixture tests call no AWS and send no email. Follow-up setup is configuration evidence, not delivery evidence.
