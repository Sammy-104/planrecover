# External operational alerts

`dispatchOwnerHealthAlerts` runs after bounded owner job phases. It defaults to no external activity. Configure an approved dedicated HTTPS receiver only in private settings:

```text
OPS_ALERT_ENABLED=false
OPS_ALERT_ORIGIN=
OPS_ALERT_TOKEN=
```

The receiver implements `POST /alerts`, validates Bearer authorization and durably deduplicates `Idempotency-Key`/`requestId`. Payloads contain only version, opaque hashed alert ID, issue/recovery event, stable coarse code and timestamp. No owner email/account ID, plan text, financial/provider IDs or receipt bytes enter the body. The token is absent from database records and diagnostics. Origin validation requires a public HTTPS origin without arbitrary path/query/port; redirects fail closed.

Success: HTTP2xx JSON `{"accepted":true,"requestId":"<same ID>"}`. Known429: `{"accepted":false,"requestId":"<same ID>","retryable":true}`. Other explicit4xx rejections need review. Responses are bounded to4KiB and5seconds. Receiver acceptance does not prove an on-call person was notified.

Durable episodes/alerts cover missing/overdue/retrying/stalled background checks and unresolved provider/reminder operations. One issue has one opened alert until recovery; recurrence increments its episode. Recovery is emitted only after an opened attempt, avoiding meaningless recovery for an unsent cancelled alert. Default3attempts per call, hard maximum5.

Only a matched known429 retries after at least60seconds with exponential delay and a3-attempt ceiling. Timeout, malformed/mismatched acknowledgment,5xx, expired sending lease or lost acceptance storage is uncertain and never automatically resent. The receiver must still deduplicate; no network boundary provides exactly-once delivery. Changed receiver/token cancels pending old-configuration alerts rather than exporting an old incident to a new destination. A still-open cancelled incident requires manual review; rotation is not permission to create a second delivery.

Readiness GET never dispatches alerts. It displays configuration/activation and stored acceptance separately. This implementation deploys no receiver, sets no alert token and resumes no schedule. Observe a real issue and its recovery before claiming operational external monitoring.
