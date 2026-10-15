# AWS testing cost rules

User instructions recorded October 14, 2026 for PlanRecover and future testing in this project.

- Spend no money. Keep the AWS account on the Free plan. Do not upgrade to Paid, activate features that force a paid upgrade, buy subscriptions, or purchase provisioned capacity.
- Before each live test session, verify the current account plan, available applicable credits, and free-plan end date in AWS. Stop if those cannot be verified or the test requires a paid plan. Credits are consumed by live requests even when no money is charged.
- Use offline fixtures for routine development. Make only the small number of bounded live calls needed to verify the integration. Use synthetic data and no automatic retries.
- Prefer on-demand Bedrock inference without continuously running compute. Do not add EC2 instances, NAT gateways, databases, vector stores, provisioned throughput, or paid monitoring just to test Bedrock.
- Record IDs, regions, purpose, and ownership of every temporary cloud resource created for a test. Tear down those exact resources after success, failure, or interruption, and verify that cleanup succeeded before reporting completion.
- Stop temporary jobs and remove test endpoints, compute, storage, logs, snapshots, and other chargeable leftovers where created for that test. Report anything that cannot be cleaned up.
- Preserve user data and the persistent resources required by the requested application. Do not delete unrelated or production resources. Review any retained resource for idle charges; application configuration and invocation-based services are different from running test compute.
- Close temporary CloudShell sessions and terminate temporary local test processes. Keep credentials out of source control, chat, logs, screenshots, and test artifacts. Revoke credentials created solely for a finished test.
- Report actual usage separately from credit consumption and money charged. Billing/credit displays can lag; a $0 display alone is not a spending cap. A budget alert alone is not a hard spending cap.

## Verified account state before Bedrock setup

The AWS console showed the Free plan, $100.00 USD credit balance, $0.00 used credit, and a free-plan end date of April 14, 2027. The account's applicable-credit service list included Amazon Bedrock. Recheck these facts before future live testing.

The hackathon resources page says promotional credit codes ran out October 7, 2026. Do not rely on the older FAQ's $150 offer being available.

References: [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/), [hackathon resources](https://amazonappdev2026.devpost.com/resources), and [hackathon testing guidance](https://amazonappdev2026.devpost.com/details/faqs).
