# How to find businesses without websites

Research behind every architectural choice in this repo. Written before the
first workflow, so that a later reader can tell which decisions were measured
and which were assumed.

Researched September 2026. Prices and API terms drift; the dates matter.

---

## The question this project has to answer first

> Can we reliably tell that a business genuinely has no website?

Everything else — scoring, storage, outreach — is ordinary engineering. This
one thing is not, and if the answer is no, the project has no product.

The naive version fails immediately:

> **A missing website field is not evidence of no website.**

The job-hunt repo already measured this class of error from the other side:
not one of 170 job listings across RemoteOK, Jobicy and Himalayas carried the
employer's own website. The absence of a field said nothing whatsoever about
the existence of a site. A Google Maps listing with an empty website field is
the same shape of non-evidence — the owner may simply never have filled it in.

So "no website" is treated here as a **positive claim requiring positive
evidence**, and the pipeline is built around gathering that evidence cheaply.

---

## Four findings that shaped the architecture

### 1. Google Places API forbids storing the data

The Places API policy states you must not pre-fetch, cache, or store Places API
content beyond the allowed exceptions. The **place ID is the only field that may
be kept indefinitely**. A permanent lead database of names, phones and addresses
sourced from the Places API is a terms violation, not a grey area.

This alone disqualifies it as the primary source, because a lead database that
cannot retain leads is not a lead database.

It is also the most expensive option per useful record:

- `places.websiteUri` — the single field this project exists to read —
  **triggers the Enterprise SKU, $35 per 1,000 calls**. Requesting it upgrades
  the whole request.
- Text Search returns a maximum of 60 results across all pages, 20 per page.
- There is **no filter for whether a place has a website**. You buy the whole
  haystack and discard most of it.

At roughly 27% of small businesses lacking a website, that works out to about
**$8.75 per 1,000 qualified leads** — and you are not allowed to keep them.

### 2. Apify's Maps extractor can filter for "no website" server-side

`compass/google-maps-extractor` accepts `website: "withoutWebsite"` alongside
`allPlaces` and `withWebsite`. It is the only source found that lets you *ask
for* the businesses you want rather than filter them out afterwards. Apify's own
pay-per-event documentation notes that they will not charge additional fees for
places that do not have websites.

Pay-per-event rates (per place, plan-dependent):

| Event | Rate |
|---|---|
| Actor start | $0.007 per run |
| Place scraped | $0.004 (Free plan $0.005) |
| Filter applied | $0.001 per filter per place |
| Additional place details | $0.002 per place |
| Contact details enrichment | $0.002 per place |

**Unverified, to be measured in the POC:** whether the `filter applied` event
bills for places the filter *rejects*. The documentation is ambiguous. The POC
run will show the actual charge against the actual returned row count, and the
answer goes in `POC-RESULTS.md`.

### 3. Free open datasets are a zero-cost verification oracle

Two openly licensed global place datasets carry the field we need:

| | Overture Maps Places | Foursquare OS Places |
|---|---|---|
| Size | 64M+ places | 100M+ POIs |
| Licence | Open (CDLA-family) | Apache 2.0 |
| Cadence | Monthly | Monthly |
| Web fields | `websites[]`, `socials[]`, `emails[]`, `phones[]` | `website`, `email`, `tel`, `facebook_id`, `instagram`, `twitter` |
| Quality field | `confidence` (0–1, existence), `operating_status` | `unresolved_flags`, `date_closed` |
| Stable id | GERS id | `fsq_place_id` |
| Access | S3/Azure parquet, DuckDB | HuggingFace / Source Cooperative parquet |

Their value here is **not discovery**. It is catching false positives. Loaded
once into Postgres, they can be queried an unlimited number of times at zero
marginal cost. If Google Maps says "no website" and Overture holds a website for
the same business, that is a false positive caught for $0 — no API call, no rate
limit, no per-query decision about whether the check is worth making.

That last point is the real argument. A verification step that costs money is a
verification step somebody eventually turns down to save budget.

### Coverage, measured rather than assumed

The plan predicted "strong in Scandinavia, thinner in the Gulf". That was a
guess, and it was wrong. Loaded on 12 September 2026, Overture release
2026-08-19.0:

| Load | Places | Hold a website | Hold a phone | Distinct localities |
|---|---:|---:|---:|---:|
| Oslo | 35,792 | 31,320 (87.5%) | 30,255 | 176 |
| Dubai | 98,815 | 68,599 (69.4%) | 83,053 | 326 |

Dubai has nearly three times as many places as Oslo. The cross-check layer is
therefore strong in BOTH poc cities, which is good news for coverage and bad
news for the experiment as originally designed: the POC was meant to contrast
a dense-data city with a sparse one, and these two are both dense.

A genuinely sparse market still needs to be tested before the pipeline is
trusted outside Europe and the Gulf. Nothing here says what happens in a
secondary city.

Two practical notes that only surfaced on loading real data:

- **Localities are in the local language.** Overture stores what the upstream
  provider wrote, so a Dubai load returns `دبي`, `الشارقة` and `عجمان`
  alongside `Dubai`. A cross-check keyed on that field can never match
  Google's "Dubai". See `db/004_reference_load_city.sql`.
- **A generous bounding box pulls in neighbours** - 326 distinct localities
  for one "Dubai" load, including Sharjah and Ajman. That is wanted: a
  business on the edge of the metro area is still worth cross-checking.

### 4. Apify's terms prohibit multiple accounts

Apify General Terms and Conditions, section 4.3, states that unless otherwise
authorized, you shall not create or use multiple Personal Accounts, either
directly or through third parties, even if registered with different email
addresses.

The original plan was to rotate three free accounts. The architecture does not
do that. It does not need to: the free plan carries **$5 of usage credit per
month** (reset monthly, no rollover, runs blocked at zero), which is roughly
1,250 places at the free-plan rate, and the POC needs about 600.

When the free credit is outgrown, the honest path is Apify Starter at $39/month.
Nothing in this repo depends on key rotation, and no code reads a key pool.

---

## Data source comparison

| Source | Coverage | Finds "no website"? | Cost / 1k useful | Storable | n8n fit | Verdict |
|---|---|---|---|---|---|---|
| **Apify `compass/google-maps-extractor`** | Best global, incl. Gulf | **Yes — server-side filter** | $3–5 / 1k returned | Yes | HTTP Request | **Primary discovery** |
| **Overture Maps Places** | 64M; strong EU/CA | Indirectly (`websites[]`) | $0 | Yes | DuckDB to Postgres | **Cross-check oracle** |
| **Foursquare OS Places** | 100M; Apache-2.0 | Indirectly (`website`) | $0 | Yes | DuckDB to Postgres | **Cross-check oracle** |
| Google Places API (New) | Excellent | No filter; Enterprise SKU; 60-result cap | ~$8.75 / 1k qualified | **No** | Native HTTP | **Rejected** |
| Serper.dev | Google SERP | Verification only | ~$0.30–1 / 1k | Yes | HTTP Request | **Stage C primary** |
| Brave Search API | Independent index | Verification only | $5 / 1k, $5/mo free | Yes | HTTP Request | Stage C fallback |
| SerpApi | Google SERP | Verification only | $9–25 / 1k | Yes | HTTP Request | Too expensive |
| OpenStreetMap / Overpass | Volunteer; good EU | Weak — absent tag proves nothing | $0 | Yes | HTTP Request | Tertiary signal |
| Yelp Fusion | US/CA only | Partial | Free tier | Yes | HTTP Request | Optional, Canada |
| **PageSpeed Insights API** | Any public URL | Measures *weak* sites | **$0, 25k/day** | Yes | HTTP Request | **Weak-site scoring** |
| Apify MCP server | — | — | Per-actor | — | — | **Rejected** |

### Why not MCP

The Apify MCP server works and is free to use (you pay per actor run either
way). MCP is a protocol for letting an LLM agent *discover and call tools
mid-conversation*. This pipeline is a deterministic scheduled workflow with two
known endpoints and no agent in the loop.

Adding MCP would introduce a second auth path, a runtime dependency and
non-determinism, in exchange for nothing an HTTP Request node does not already
do. It earns a place only if an interactive "research this one lead" step is
added later — not in the daily pipeline.

### Why not the Places API as a secondary check

Tempting, and rejected on the same grounds as above: results could not be
stored, so the check would have to be repeated on every run rather than cached,
and it would be billed at Enterprise rates each time. Overture and FSQ do the
same job offline, for free, permanently.

---

## Website detection: the five stages

Stage order is deliberate — cheapest and most decisive first, so the expensive
stages run on the smallest possible set. This is the job-hunt filter discipline:
cheap, deterministic, and it runs before any paid call, so only survivors cost
anything.

### Stage A — Source claim (free)

Apify returns the business with an empty Maps website field. That makes it a
**candidate**, not a finding.

Stage A also rejects populated fields that are not really websites.
Commercially these businesses have the same problem and are the same prospect:

- social profiles — `facebook.com`, `instagram.com`, `linktr.ee`, `wa.me`
- **`*.business.site`** — Google switched these off in March 2024 and stopped
  the redirect in June 2024. Any Maps listing still pointing at one is a **dead
  link**, which is strictly worse for the business than having no link at all.
- free builder subdomains — `*.wixsite.com`, `*.blogspot.com`,
  `sites.google.com`, `*.godaddysites.com`
- directories and review sites — Yelp, TripAdvisor, Justdial, Yellow Pages

Held in the `platform_domains` table, not hardcoded in a node, because this list
will change and changing it should not mean editing a workflow.

### Stage B — Cross-check the free datasets (free, offline)

Match against `ref_overture_places` and `ref_fsq_places`, in descending order of
confidence:

1. phone in E.164 — exact match, strongest
2. normalised name + within ~150 m of the Maps coordinates
3. normalised name + same locality — weakest, requires a second agreeing field

A website in either dataset means Stage A was wrong. Classify `HAS_WEBSITE` and
stop. This is the highest-leverage stage in the pipeline and the one a naive
design omits entirely.

### Stage C — Targeted search (free tier)

Only for candidates that survived A and B — typically well under a third.

```
"<name>" <city>
"<name>" <city> <niche>
"<name>" site:<cctld>        .no .se .dk .fi .ae .es .it .pt .ca
```

Results on platform or directory domains are discarded. Whatever remains is a
**candidate domain for Stage D** — never accepted on a search hit alone, because
a search result proves that a page mentions the name, not that the business owns
the site.

### Stage D — Prove the domain (free)

Ported from `job-hunt-automation/n8n/workflows/05-find-companies.json`, node
"Find and prove their website", which already encodes the failures that make a
naive version dangerous:

- **parked domains** answer 200 and prove nothing
- **placeholder pages** whose title is just the domain
- **evidence must scale with the size of the guess** — a domain built from one
  word out of four needs the *title* to name the business, not merely contain
  the word. From the original: "Anchor QX chemical industries" became
  anchor.com, and anchor.com does say "anchor" somewhere.
- **refuse rather than guess** when a name has no distinctive token. An earlier
  version treated "nothing to check" as "check passed", and matched "Zed
  Example Solutions" to zed.com, an unrelated agency.

Added here:

- **Unknown is not a pass.** A fetch that times out is `unreachable`, never
  "no website". The same repo records why: a large company survived its first
  run because a timed-out fetch was being read as "no ATS found".
- **Social presence is recorded, not counted as a website.** A salon running an
  active Instagram is a *better* prospect, not a worse one — they already market
  online and have nowhere to send people. It raises the lead score; it does not
  change the classification.

### Stage E — Classify

| Class | Requires | Confidence |
|---|---|---|
| `NO_WEBSITE_CONFIRMED` | Maps absent, both datasets absent-or-unmatched, search found nothing, enough domain guesses probed and refused | 0.85–1.00 |
| `NO_WEBSITE_LIKELY` | Maps absent, nothing contradicts it, but at least one check was inconclusive | 0.60–0.84 |
| `WEBSITE_UNCERTAIN` | conflicting signals, or a probe that could not complete | 0.30–0.59 |
| `WEAK_WEBSITE` | site proved, but fails PageSpeed / HTTPS / mobile / freshness | site-specific |
| `HAS_WEBSITE` | a domain proved to belong to this business | 0.80+ |
| `INVALID` | permanently closed, duplicate, or dataset confidence below 0.5 | — |

Confidence is **computed from which checks actually completed**, not assigned by
a model. Every check appends a row to `website_checks` with its evidence, so any
classification can be re-derived and audited without re-scraping anything.

### No LLM in the detection path

Deliberate. The classification is deterministic, reproducible and unit-testable,
and it gates a real spend of money and attention. The job-hunt repo learned this
the expensive way when scoring ran at temperature 0.2: the same role scored 82
on one run and 48 on a re-run minutes later, with nothing changed — either side
of the threshold that decided whether to act.

A model may be useful later for writing outreach copy. It has no business
deciding whether a website exists.

---

## Cost model

| Scale | Apify | Search | PageSpeed | DB | **Total / month** |
|---|---|---|---|---|---|
| **POC** (~600 places) | $0 — ~$2.40 of the free $5 | $0 — Serper free credits | $0 | $0 Supabase free | **$0** |
| 1,000 qualified leads | $4–5, fits free credit | ~$3 | $0 | $0 | **$0–5** |
| 10,000 qualified leads | Starter $39 (~9.7k places) | ~$30 | $0 | $0–25 | **$70–95** |
| 50,000+ | Scale $199 + overage | ~$150 | $0 (25k/day cap) | $25 | **$375–450** |

These numbers are low because of the `withoutWebsite` filter plus free
verification. The naive Places-API design costs ~$8.75 per 1,000 qualified leads
*and* forbids keeping them.

PageSpeed's 25,000/day free quota is shared globally across all users, so it is
a soft limit rather than a guarantee. It only ever runs on businesses that
already have a proved site, which is a minority of rows.

---

## Risks and limitations

| Risk | Reality | Mitigation |
|---|---|---|
| **False positives** — we say no website, they have one | The main failure mode. The owner simply never added it to their listing. | Stages B–D exist for this. Measured in the POC; this is the gate. |
| **False negatives** — we drop a real prospect | A site exists but is a dead Wix or `business.site` page | `platform_domains` + PageSpeed produce `WEAK_WEBSITE`, still a lead |
| ~~Gulf coverage in free datasets~~ **measured, and the concern was wrong** | Dubai: 98,815 Overture places, 69% with a website - nearly 3x Oslo's volume | Both POC cities are dense. The untested case is now a *secondary* city, not the Gulf |
| Apify actor field drift | Actors rename fields between versions | Defensive `pick()` mapper, `raw` JSONB retained, fixture tests |
| Apify credit exhaustion | $5 resets monthly, no rollover, runs blocked at zero | `app_state` spend counter and hard `max_results`; **not** more accounts (section 4.3) |
| Duplicate businesses | One salon listed under two categories | Three-layer dedup: `place_id`, then `phone_e164`, then `name_norm + geohash7` |
| Search rate limits | Free SERP credits are finite | Stage C runs only on survivors of A and B |
| Shared n8n instance | Other projects' workflows - at least one **active and sending** email - run on the same instance | `CH-` prefix; never PUT an existing workflow; re-read `active` after any write |
| Outreach compliance | GDPR in Scandinavia and Southern Europe; **CASL in Canada is strict** — consent, identification, working unsubscribe | `suppression` table exists from day one; business role addresses only; outreach deliberately not built yet |
| Google Maps terms | This is Apify scraping public listings, not the Places API | No Places API content is stored anywhere in this repo |
| Over-engineering | The LinkedIn project built six-job CI, auto-rollback and zero-impact verification for a system that submitted **zero** applications | POC first. No Docker, no CI, no outreach until the accuracy number exists. |

---

## What the POC has to produce

Not workflows. A number.

- 2 cities — **Oslo** (strong open-data coverage) and **Dubai** (weak) — times 2
  niches, about 150 businesses each
- a random **60 hand-labelled** by actually searching for each business
- a confusion matrix for `NO_WEBSITE_CONFIRMED`, plus per-stage contribution:
  *how many false positives did Stage B catch that Stage A alone would have
  shipped?*

**Gate: precision at or above 90% on `NO_WEBSITE_CONFIRMED`.** Below that, tune
before building anything else. A list of 10,000 poorly verified businesses is
worth less than 500 verified ones, and an outreach email that opens "I noticed
you don't have a website" to someone who does is worse than no email at all.
