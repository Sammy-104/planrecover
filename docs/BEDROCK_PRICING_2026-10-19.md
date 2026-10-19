# Bedrock model pricing — October 19, 2026

The private sandbox uses Amazon Nova Lite 1.0 through its existing Canadian application inference profile, with `ca-central-1` as the request source region and geographic Canadian routing. The application now has a reviewed pricing preset for this exact configuration. It neither changes the model nor creates a new AWS resource.

## Verified public rates

| Item | Value |
| --- | --- |
| Preset | `aws-nova-lite-ca-standard-2026-10-19` |
| Model | Amazon Nova Lite 1.0, `ca.amazon.nova-lite-v1:0` |
| Request source | Canada Central, `ca-central-1` |
| Inference | Standard, on-demand, geographic cross-region |
| Currency | USD |
| Uncached input | **US$0.064 per million tokens** |
| Output | **US$0.256 per million tokens** |
| Checked | October 19, 2026 |
| Next review required | November 18, 2026 |
| AWS dataset publication | October 16, 2026 at 21:08:06 UTC |

These rates were read from the [official AWS Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) and the [public AWS USD rate dataset used by that page](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrock/USD/current/bedrock.json), rather than inferred from US-region prices. The page's **Geo Cross-region inference and in-region / Standard Tier** table maps the Amazon Nova Lite input and output cells to the following dataset keys, each multiplied by 1,000 to convert the dataset's per-1,000-token price to the displayed per-million-token price:

| Token type | Public price-table key | Canada (Central) dataset price | Per million |
| --- | --- | --- | --- |
| Input | `jqpXyMWar6dZCgJ4nRTHic6D040daCa-N81Kh52Jlac` | `0.0000640000` | `0.064` |
| Output | `urNDBArH5pV5njuTwm41YJmDyeIrg_gD9kCMIHcQdLI` | `0.0002560000` | `0.256` |

Dataset manifest: `serviceId=bedrock`, `currencyCode=USD`, `esIndex=plc-bedrock-usd-20261016210806`. Its Canada West entry does not contain these two rate keys; the application does not invent a Canada West rate. AWS documents that [cross-region inference is priced using the request's source region, with no additional routing cost](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html). The [Nova Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html) confirms Canadian geographic inference and Canada Central/Canada West destinations.

## Runtime configuration and binding

Set the following server settings, after verifying the existing profile's underlying model:

```text
BEDROCK_PRICING_PRESET=aws-nova-lite-ca-standard-2026-10-19
BEDROCK_PRICING_MODEL_SHA256=<SHA-256 of the exact current runtime region/profile identity>
```

`bedrockPricingModelHash(settings)` computes the binding from the UTF-8 bytes of `JSON.stringify({version:1,region:config.region,modelId:config.modelId})`. The model ID must be the existing exact private runtime profile ID, not the public family name substituted for that profile. This digest and the raw profile are not returned by service readiness or written to the pricing ledger. Credentials do not form part of the price binding, so rotating an API key does not change the price basis. The separate inference evidence fingerprint still changes when the key or actual model connection changes.

The preset supplies its immutable rates, source, currency, model family, source region, tier and review dates. Duplicating the two older manual rate settings is unnecessary. If supplied with the preset, they must match it exactly. Paired manual numbers without a reviewed preset/binding do not qualify for estimates. Malformed explicit settings are rejected. A missing/mismatched binding or expired review window makes pricing unavailable while ordinary model inference remains available.

## Accounting behavior

Migration `0024_bedrock_pricing.sql` adds a nullable `pricing_basis` column. Each newly priced invocation retains its original public price basis alongside its estimate. Estimates apply only to trustworthy reported input/output counts. This application requests no prompt-cache checkpoints; unexpected nonzero or malformed cache token counters retain the trustworthy primary counts but leave cost unpriced. Unknown usage remains unknown.

Pricing-only changes preserve the prior unpriced connection fingerprint, so existing saved-result evidence and known usage stay visible. Older calls without a recorded price are **not** silently revalued. The owner panel shows a priced-call subtotal and the number of calls with known counts but no verified price. It withholds a complete estimate if any included call is unpriced or has unknown usage. Disabling pricing does not erase previously recorded price bases or cost subtotals. A changed preset must carry a new reviewed identity; old invocations retain their original basis.

These are model list-price estimates in US dollars, not CAD, invoices, exact spending caps, credit balances or after-credit charges. They exclude taxes, other AWS products and other infrastructure charges. AWS billing remains authoritative. Pricing needs review at the stated date or whenever the profile, source region, tier, routing, cache behavior or AWS rates change.

Offline validation covers source/rate provenance, exact profile binding, review expiry, malformed settings, price-only fingerprint compatibility, mixed historical/new calls, retained basis, unpriced cached calls, missing usage and prior unattributed costs. All test traffic is intercepted; release verification records any separate bounded hosted provider probe.
