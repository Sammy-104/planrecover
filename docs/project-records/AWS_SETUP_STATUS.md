# PlanRecover AWS setup status

Updated October 15, 2026 (America/Toronto).

## October 15 retry: blocked by AWS quota

- The current private Site is version `11`, commit `0082bda0b265952fe361a8e960aefa4012a11b2a`, deployment `appgdep_6ad025ad19548191a57e353fb4faa879`. Sites confirms the deployment succeeded using environment revision `4`; owner-only access is intact. No rollback or new deployment was performed for this retry.
- All four existing Bedrock server settings remain present as secrets in environment revision `4`. Their values were not retrieved or copied.
- **Cost check COMPLETE at approximately 21:55 UTC October 15, 2026.** The owner signed back into AWS. Billing > Free Tier again explicitly states "Your free plan account does not get charged" and shows `$100.00` remaining. Expanded details show `183 days` of free access remaining. Credits shows the active AWS Free Tier credit with `$100.00` remaining, `$0.00` used, and Amazon Bedrock in its applicable-products list. Console Home > Cost and usage explicitly shows `183 days (Apr 14, 2027)`. Credit expiration is October 15, 2027; the shorter Free plan access period governs Free plan availability. [Current Free plan proof](outputs/aws-free-plan-retry-verified.jpg), [access end date proof](outputs/aws-free-plan-expiry-retry.jpg).
- After two hosted attempts failed without model output (Chat fallback, then the draft route's sanitized unavailable error), one diagnostic console request was made using the root session, Nova Lite 1.0, the actual `PlanRecoverCanada` application profile, a synthetic JSON-only prompt, and a maximum output of `64` tokens. **The console also failed: `ValidationException: Operation not allowed`.** No output or token usage was displayed. This shows a failure independent of the private Site key; the precise AWS restriction is not yet established. No new keys, IAM changes, or profile changes were made. Read `BEDROCK_RETRY_STATUS.md` for the hosted attempts.
- The earlier verification response below is the previous direct bearer-key result. A configured secret or successful Site deployment does not establish that the AWS verification blocker has cleared; the new console test is also unsuccessful.
- Follow-up console diagnosis shows Nova Lite **Geo cross-region** at **TPM 0 / RPM 0** in Canada Central. These are the relevant cross-region quotas for the Canada profile; direct on-demand inference is separately marked unsupported in this region. Service Quotas independently confirms **Cross-region model inference tokens per minute for Amazon Nova Lite**, quota `L-7C42E72A`, has applied account value `0` and AWS default `400000`. The request form requires a value at least `400000`, so a smaller numeric request cannot be submitted through this form. RPM requests are disabled in the Bedrock quota UI. At approximately 21:59 UTC, the default `400000` TPM quota request was submitted via Service Quotas. The request history confirms **Pending**, requested value `400000`, request date October 15, 2026, and no AWS Support Center case number (`-`). This requests a ceiling, not provisioned capacity. No paid upgrade was selected. [Zero-quota proof](outputs/bedrock-nova-lite-zero-quota.jpg), [pending request proof](outputs/bedrock-quota-request-pending.jpg).
- Testing is stopped after **three provider attempts across the two chats**: two hosted failures and one console failure. No model output was returned, and actual provider token usage/credit consumption was not established by those failed calls. Do not repeat live calls until there is a concrete AWS access/quota state change. No support email or freeform support case message was sent.
- Next step: read the existing request at [Canada Central quota request history](https://ca-central-1.console.aws.amazon.com/servicequotas/home/requests). After AWS changes the relevant cross-region quotas from zero and resolves access, recheck the Free plan/credits/access period and perform one bounded hosted test using the existing Site key. If the request is denied or remains blocked, prepare an account-and-billing support request and obtain the user's authorization before sending it. Keep the Free plan and Canada-only routing; do not buy services, upgrade plans, or broaden IAM to work around account restrictions.
- Final post-request Billing > Free Tier check still explicitly states "Your free plan account does not get charged" and now shows **`$120.00` credits remaining** (increased from the earlier `$100.00`; the credit award source was not inspected). This is the latest displayed credit balance, not proof of exact token usage. [Final cost proof](outputs/aws-free-plan-after-quota-request.jpg).
- No temporary cloud resources, credential files, or local test processes have been created in this retry.

## Configured and deployed

- AWS account: PlanRecover Hackathon. The console initially confirmed the Free plan, $100.00 USD credits, $0.00 credit use, and free-plan access ending April 14, 2027 or at credit exhaustion. Applicable credit products included Amazon Bedrock.
- Bedrock region: `ca-central-1` (Canada Central).
- Model source: `ca.amazon.nova-lite-v1:0`, with Canada Central and Canada West routing destinations verified in the console.
- Application profile: `PlanRecoverCanada`, active, tagged `Project=PlanRecover`.
- Application profile ARN: `arn:aws:bedrock:ca-central-1:485726107957:application-inference-profile/whja42lml5cu`.
- Dedicated IAM identity: `PlanRecoverBedrockCanada`, with console access disabled and no general AWS access keys. Its inline `PlanRecoverCanadaInvokeOnly` policy permits bearer use in Canada Central and inference through the selected application profile and Canadian models. The reviewable policy is [outputs/planrecover-bedrock-canada-policy.json](outputs/planrecover-bedrock-canada-policy.json).
- One Amazon Bedrock service API key was generated for the restricted identity. It expires November 23, 2026 at 7:34 p.m. America/Toronto. The key value is stored only as a private Site server secret; it is not included here.
- Private Site: https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site
- Runtime settings: `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, and `BEDROCK_REQUIRE_APPLICATION_PROFILE`, all stored as secrets.
- Environment revision: `4`. Saved Site version `7` was redeployed successfully, retaining owner-only access.
- Deployment ID: `appgdep_6ad02102ee4481919e3ccb01b4a7e239`.
- The deployed Settings screen reports receipt extraction as connected. This checks configuration presence, not successful model inference.
- After setup, Billing > Free Tier again explicitly confirmed: "Your free plan account does not get charged," with $100.00 remaining. The [saved account screenshot](outputs/aws-free-plan-verified.jpg) records this state. No plan upgrade was performed.

## Live verification blocker

A bounded synthetic Converse request using the restricted key and actual application profile reached AWS and returned HTTP 403: the account is currently being verified. AWS's response says verification normally takes less than two hours and suggests contacting `aws-verification@amazon.com` if it still fails after more than two hours. No message was sent to that address.

No model output or token usage was returned. Live inference and hosted receipt extraction are **not yet verified**. Do not interpret a configured secret, active profile, or connected label as proof that IAM permissions and model invocation have passed end to end. After AWS finishes verification, recheck the Free plan and credits, then make one small synthetic validation request; do not enable repeated polling or automatic retries.

CloudShell separately refused to create an environment while account verification was pending, with a notice that new-account verification can take up to two days. The failed CloudShell tab was closed. No CloudShell commands ran.

## Cost controls and cleanup

The owner requires [zero spend and teardown after testing](AWS_TESTING_POLICY.md). No paid upgrade, provisioned throughput, model hosting, EC2 instance, NAT gateway, database, vector store, or paid monitoring was created during this setup. Inference is configured on demand. AWS documents no additional charge for inference-profile cost attribution; requests consume model usage credits.

The application profile and restricted identity/key are retained as the requested application configuration. They are not continuously running compute. Temporary local validation and handoff processes ended; the waiting validation process was explicitly stopped. Unused local receiver connections were closed. Clipboard and temporary key material were cleared. The proposed local `.dev.vars.bedrock` credential file was blocked before creation and was verified absent. The final approved credential handoff used an encrypted in-memory payload and created no local credential file.

The final process inventory found **zero** remaining processes owned by the temporary validation and handoff tests. Site environment revision 4 was read back with all four Bedrock settings marked secret and their values withheld.

Automatic approval review rejected one-click key generation because it would first attach broader AWS-managed permissions. The final key was instead generated directly for the already-restricted IAM identity. Review also required explicit approval for the intermediate credential handoff; the owner approved a memory-only handoff.

Future testing instructions were added to `planrecover-sandbox-site/AGENTS.md` and `planrecover-backend/AGENTS.md`. Synced files under `sources/` and the synced root `AGENTS.md` were not modified.

References: [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/), [inference profile cost attribution](https://aws.amazon.com/blogs/architecture/track-generative-ai-costs-with-amazon-bedrock-inference-profiles/), [hackathon resources](https://amazonappdev2026.devpost.com/resources).
