# Fresh public venue data

This pass uses public venue data, as selected by the owner. It does not configure a booking supplier or convert community map charges into current quotes.

## Implemented behavior

- Venue details resolve an exact saved OpenStreetMap node, way or relation. Wikipedia-derived places can also resolve their saved Wikidata identity near the already-known public venue coordinate; multiple or distant matches stay unknown. Both saved public-source URL fields are considered, so a booking link does not hide a map identity. Public requests contain only these public identifiers/coordinates, with no itinerary dates, member names, needs, payment data or plan IDs. Mixed item/suggestion selectors are rejected.
- Normal detail reads share a one-hour process cache. An explicit venue or day-check refresh bypasses it and coalesces concurrent reads for the same venue. The two existing public Overpass instances share a ten-second deadline, manual redirect handling and a 64 KB response limit.
- Successful snapshots show retrieval time, a maximum 24-hour refresh deadline, community provenance and unverified inventory. When provided by Overpass, map-record last-edit and mirror data-as-of times are retained separately. Record-edit time does not mean the venue confirmed its hours. A lagging mirror cannot gain fresh evidence by being read again.
- New snapshots remove source tags that disappeared, including old hours and charge hints. Failed explicit refreshes clear the current hints rather than presenting old hours as refreshed.
- Saved Wikidata identities also have a fixed-endpoint, bounded read-only fallback fetched alongside map lookup. It reports the exact entity's current community record, retrieval/expiry/edit timestamps and a unique nondeprecated official website when present. Ambiguous websites and unknown hours remain empty. This fallback is labeled Wikidata, and clears old OSM hours/charge hints instead of mixing sources. A prior website-only timestamp cannot suppress the first complete snapshot read.
- Day checks treat expired, future-dated and unsupported hours as unknown. Simple weekly hours can be compared to visit times as a community hint, including closed-hour warnings. They never enter the owner-confirmed planning-evidence store automatically.
- Weather retains its public Open-Meteo attribution and now exposes a 15-minute expiry. Cached metadata is checked independently of cache TTL. Explicit refresh bypasses cache; failure leaves forecast unavailable. The public request contains coordinates and forecast time zone, without plan or member identity.

These reads do not change itinerary terms, approvals, budgets, payments, bookings or cancellations. Current price, ticket capacity, accessibility/dietary promises and supplier booking confirmation remain unknown unless independently confirmed through the existing evidence/review workflow.

## Verified provider documentation

The [OpenStreetMap Overpass API documentation](https://wiki.openstreetmap.org/wiki/Overpass_API) describes a read-only map API, source database timestamp and current policies for the two existing instances, Private.coffee and VK Maps. Both are currently listed for use in projects without an API key; small cached on-demand queries remain appropriate for this private sandbox. Public service availability is not guaranteed. The [Wikibase entity API](https://www.wikidata.org/w/api.php?action=help&modules=wbgetentities) supports the exact-entity public fallback; website statements remain community claims.

[Open-Meteo's documentation](https://open-meteo.com/en/docs) describes forecast fields and the 16-day range. The [free-service terms](https://open-meteo.com/en/terms) restrict the free endpoint to noncommercial use; the current private hackathon sandbox uses the existing endpoint. A commercial launch needs an eligible service plan or self-hosted source.

## Validation

`tests/supplier-source-freshness.mjs` uses injected providers and blocks live network access. It checks identity isolation, cache bypass/coalescing, removed tags after JSON round-trip, malformed/oversize/partial/wrong-identity replies, mirror lag, expiry/future timestamps, weekly-hour uncertainty, weather cache validation and failed-refresh behavior. Existing planner, place search and precise place detail suites remain applicable. A separate bounded live public lookup is recorded in delivery evidence; it is an observation of map data, not a supplier confirmation.
