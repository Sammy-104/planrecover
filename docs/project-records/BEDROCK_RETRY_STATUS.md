# Bedrock retry — October 15, 2026

The hosted Site retains all four secret Bedrock settings at environment revision 4. Private Site version 11 remains selected. The connected read-only MCP still works.

Offline checks passed: 10 Bedrock transport checks, 7 assistant checks and 18 AI-route checks. No live AWS request was made during this retry because the required current Free plan / credits verification is blocked by AWS sign-in in the separate Set up AWS Bedrock chat.

The website browser session expired. The subsequent ChatGPT login failed on auth.openai.com with token_exchange_failed before PlanRecover could receive an authenticated session. Diagnostics: request_id 19a97bfe-7859-4563-9b22-696848d1fdca, occurred_at 2026-10-15T21:52:07Z. This does not establish whether live Bedrock is available.

Started one fresh sign-in flow from the Site root using the platform-owned Continue with ChatGPT link. The browser is now at the normal OpenAI sign-in screen, awaiting the user. No authentication implementation, credential, access policy, Site source, or AWS resources were changed.
## Signed-in hosted retry

October 15: Site sign-in restored. The AWS chat verified the current Free plan, $100 remaining applicable credits, and April 14, 2027 access end date before live use. I then made two bounded hosted requests using the synthetic MCP connection verification plan: Chat returned its saved-plan fallback; the draft route returned BEDROCK_UNAVAILABLE (Amazon Bedrock is temporarily unavailable). No model output was returned, no draft was added, and no expense, approval, payment or refund was created. The existing adapter made no automatic retries. The AWS chat is checking the same profile in the console to isolate the upstream failure. Provider token usage / credit consumption have not been established by these failed requests.

## Confirmed external blocker

The AWS setup chat tested the same application profile in the AWS console, with synthetic input and 64 output tokens maximum. That independent request failed with ValidationException: Operation not allowed. The console and Service Quotas confirm the geographic cross-region Nova Lite quota in ca-central-1 is zero tokens/minute and zero requests/minute; the token quota is L-7C42E72A. This is the applicable cross-region quota, not only the direct in-region quota. A quota request for the required AWS default 400,000 TPM was submitted by the AWS setup chat; approval is not confirmed. Read AWS_SETUP_STATUS.md for the exact request outcome. The current Free plan and $100 remaining credits were reverified before testing. No Paid upgrade, provisioned capacity, new keys, IAM/profile changes, test infrastructure, or automatic retries were performed. The precise relationship between the zero quota and the generic hosted transport error remains unproven, but independent console inference is also unavailable. Live integration must not be reported successful. Hosted test proof is outputs/bedrock-live-retry-blocked.jpg.
