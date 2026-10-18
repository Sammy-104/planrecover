# Amazon Bedrock server configuration

The Bedrock adapter calls the official regional HTTPS Converse endpoint with a server-side bearer API key. It uses browser-independent Web APIs that run in Cloudflare Workers; no AWS SDK or added package is required. AWS documents bearer keys and Converse examples in [API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) and the [Converse API reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html).

Configure these values in the hosting secret/environment settings or the ignored local development secrets file. Never place the key in a browser variable, source file, receipt, model prompt or chat message.

| Server setting | Purpose |
| --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK` | An authorized Bedrock API key. Prefer short-term keys or production credential management for ongoing use. |
| `BEDROCK_REGION` | Commercial AWS region where the selected model is available. `AWS_REGION` is accepted as a fallback. |
| `BEDROCK_MODEL_ID` | Explicit Converse-compatible model or inference profile ID/ARN; the adapter does not guess a model. |
| `BEDROCK_TIMEOUT_MS` | Optional overall request deadline, 100–45000 ms; default 20000 ms. |
| `BEDROCK_MAX_TOKENS` | Optional generated-output cap, 128–4096 tokens; default 2048. |

The configured IAM identity must allow model inference and bearer-token usage. Model availability, regional access and API key expiry must be checked in the user's AWS account. Long-term keys are intended for exploration; short-term keys expire and need refreshing. See [AWS key permissions and expiry guidance](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html).

`bedrockConfig(env)` returns `null` when Bedrock settings are absent, and throws a sanitized configuration error when partially configured. `converseJson(config, {system, prompt, images, validate}, {fetch})` returns only validated application JSON, model identity and token usage. The caller provides a strict field validator and treats the model result as a suggestion requiring user review. The separate bounded agent path may expose validated review-only tools; neither transport grants transaction approval authority.

Requests accept bounded text and one PNG, JPEG or WebP image up to 3500000 bytes. Existing uploads larger than this can remain saved for manual review. The current extraction adapter also supports bounded PDF document input when the selected model supports it; unavailable extraction retains manual source review. Model selection must support image content for receipt extraction. In direct HTTP requests, image bytes are base64 encoded as required by [AWS ImageSource](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageSource.html).

The adapter bounds the response stream, validates assistant text/JSON/usage, rejects blocked or truncated generation and tool calls, and wraps provider/validation errors without returning raw model text, request data or credentials. Retryable failures are classified for the application; it makes one potentially billed request and performs no automatic retries. Receipt and plan validators remain responsible for correct currencies, source evidence, item IDs, and human approval.

Run the offline adapter suite using the project's test runner:

```text
node scripts/test.mjs tests/backend-bedrock.mjs
```

The suite injects fixture HTTP responses and disables live fetch. It tests authorization/quota error handling, request and response caps, image encoding, deadlines for stuck fetch/body streams, malicious model JSON, and schema rejection. Passing these tests confirms adapter behavior; an authenticated, deliberately authorized AWS call is still required to verify live access.

## Selected deployment: Canada + application inference profiles

The owner selected a Canadian region and application inference profiles. The private Site sets `BEDROCK_REGION=ca-central-1` and `BEDROCK_REQUIRE_APPLICATION_PROFILE=true`. In this mode the adapter rejects direct model IDs, system profile IDs and application profile ARNs from another source region. `BEDROCK_MODEL_ID` must be the actual application profile ARN returned by AWS, and `AWS_BEARER_TOKEN_BEDROCK` must be stored as a server secret. The supplied deployment records show both settings configured at runtime revision4; values remain private/redacted. Live invocation is still blocked/unverified in the latest provider evidence, so do not create duplicate profiles or keys merely because this guide is old.

AWS documents Nova Lite as a text/image Converse option with the Canada system profile `ca.amazon.nova-lite-v1:0`; its listed inference destinations are Canada Central and Canada West. Direct in-region Nova Lite inference in Canada Central is unavailable. A profile's source endpoint region does not by itself determine routing: an application profile inherits its copied source's destinations. Inspect the returned profile before activation. Sources: [Nova Lite Canada model profile](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html), [application profile creation and routing](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html), [supported profile regions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html).

In an authenticated AWS CloudShell or CLI session:

```text
aws bedrock get-inference-profile --region ca-central-1 --inference-profile-identifier ca.amazon.nova-lite-v1:0
```

Confirm `ACTIVE` and Canadian `models[].modelArn` destinations. Copy the actual returned `inferenceProfileArn`. Use it in this command, replacing the placeholder without inventing an account ARN:

```text
aws bedrock create-inference-profile --region ca-central-1 --inference-profile-name PlanRecoverCanada --model-source copyFrom=<RETURNED-SYSTEM-PROFILE-ARN>
```

Inspect the created application ARN using `get-inference-profile`, then store that exact ARN as `BEDROCK_MODEL_ID`. Grant the profile and all underlying destination-model inference permissions, plus bearer-token use. Generate the key in Canada Central and save it privately as `AWS_BEARER_TOKEN_BEDROCK`. [AWS CLI creation reference](https://docs.aws.amazon.com/cli/latest/reference/bedrock/create-inference-profile.html), [profile invocation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-use.html), [API key permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-modify.html).

An application profile records attribution/cost use; it does not move the whole PlanRecover backend or its database to AWS Canada. No AWS resources or live inference have been created by the offline tests.
