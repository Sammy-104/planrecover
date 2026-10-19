# Bedrock connection follow-up — October 19, 2026

## Account evidence

The signed-in Canada Central console now reports an applied cross-region Amazon Nova Lite quota of 400,000 tokens/minute and 20 requests/minute. The existing `PlanRecoverCanada` application inference profile is Active and routes within Canada.

Before live testing, Billing confirmed the Free plan, $120.00 remaining credits, Bedrock in the applicable-products list, and April 14, 2027 access end date. Billing displays can lag; these values do not establish the exact credit cost of a request.

One synthetic console request through the existing application profile returned `{"ok":true}`: 17 input tokens, 6 output tokens, displayed latency 301 ms, output capped at 64 tokens. This confirms account/model availability; it does not verify the hosted bearer credential.

## Connection bug and correction

The earlier hosted synthetic check reported unavailable without model output. The deployed Worker runtime rejects `redirect: 'error'` before making an outbound request. A real local Miniflare/Worker reproduction demonstrated the exception and the compatible manual mode with injected provider traffic, without contacting AWS.

Affected authenticated outbound adapters use `redirect: 'manual'` and retain explicit unsuccessful-status rejection. Redirects cannot silently forward credentials or become successful provider results. No IAM, key, inference-profile or account-plan change is part of this correction.

Bedrock owner diagnostics now retain only a fixed failure stage, bounded HTTP status, exact allowlisted AWS exception, fixed network name/code and fixed validation/stop categories. Raw provider messages, response bodies, URLs, keys and headers are not retained. Existing saved results remain readable and request IDs still prevent repeated inference.

The corrected hosted connection reached HTTP 200 and a real saved chat response. Nova's observed leading explanatory wrapper is now removed before saving a new final answer; complete leading wrappers and a single whole-payload JSON fence can be normalized without searching arbitrary text for JSON. Malformed, nested or misplaced wrappers remain rejected. Structured calls request deterministic final JSON, and all application schema, participant, money and source checks remain authoritative. Console/connection success does not establish that every generated itinerary passes those checks.

## Verification boundary

Offline tests cover both Converse paths, safe diagnostic persistence/replay, redirect rejection and the other affected service adapters. A real Worker regression checks native redirect behavior. The hosted Service readiness result is stored separately in the owner's plan and must be inspected after publication.

A successful tiny hosted check does not certify saved chat, itinerary drafts, tool proposals or receipt extraction. Each needs its own bounded acceptance test. Source-based planner drafts are separate from Bedrock drafts. SES sending, browser push, public callback ingress and the existing schedule remain subject to their independent activation and acceptance gates.
