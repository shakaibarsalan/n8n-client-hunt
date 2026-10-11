# POC results

**Status: first real run done, 13 September 2026. Hand-labelling still
outstanding.**

One Apify run, 30 beauty salons in Oslo, `website: "withoutWebsite"`.
The numbers below are measured. The precision gate is NOT yet answered -
that needs the hand-labelled sample, which is the remaining work.

> In this public copy the businesses are anonymised - "Salon A", "Clinic B"
> and so on, with placeholder domains. The method and every number are
> unchanged.

---

## What the first 30 businesses established

### The `withoutWebsite` filter works, and costs more than documented

| | |
|---|---|
| Places requested | 30 |
| Places returned | 30 |
| Returned with a website field | **0** |
| Run cost | **$0.21** |
| **Effective cost per place** | **$0.007** |

The documented base rate is $0.004-0.005 per place. The real figure is
**$0.007**, because the run is also billed for the actor start and for the
filter applied per place. `apify_cost_per_place` in CH-01's Config was
corrected from 0.005 to 0.007; the previous value under-estimated spend by 40%
and would have let a run start with less credit than it needed to finish.

The open question from the research - whether the filter bills for places it
REJECTS - is answered no, at least not visibly: 30 requested, 30 returned, and
the total is consistent with paying only for what came back.

### Stage B earns its place: 5 false positives in 30

The cross-check against Overture caught **5 of 30 (17%)** businesses whose
Maps listing said "no website" and which an open dataset holds a website for:

| Business | What the dataset held |
|---|---|
| Salon A | `salon-a.example` |
| Clinic B | `clinic-b.example` |
| Salon C | `clinic-c.example` (the clinic she works in) |
| Clinic D | `clinic-d.example` |
| Salon E | `flickr.com/photos/<album>/` |

Four are genuine websites. **The fifth is a Flickr album**, and it is the most
instructive result of the run: taken at face value it would have classified a
one-person beauty business as `HAS_WEBSITE` and dropped it - when a business
whose entire web presence is a photo album is close to the ideal prospect here.

The platform filter existed but was only applied to Google's answer, not to the
dataset's. Fixed, with `flickr.com` and 32 other hosts added
(`db/006_more_platform_domains.sql`), and pinned by
`tests/stage-b-platform-filter.test.js`.

So on this sample Stage B's real yield is **4 caught, 1 rescued** - it prevented
four wasted approaches and, once corrected, saved one good lead from being
thrown away.

### The match rate is the thing to watch

| | |
|---|---|
| Found in the open datasets at all | 9 of 30 (30%) |
| by phone number (rank 1, strongest) | 8 |
| by name + city (rank 3, weakest) | 1 |
| Not found | 21 (70%) |

70% were not in Overture at all. These are very small businesses - half have no
reviews whatsoever - so this is not surprising, but it has a direct consequence:
**a business Stage B cannot find earns only 0.05 confidence**, so most leads
will cap at `NO_WEBSITE_LIKELY` rather than `CONFIRMED` unless Stage C and D
both run.

That makes the Serper key more important than the research assumed. Without it,
the pipeline is honest but produces few confirmed leads.

### What the data is actually like

| | |
|---|---|
| Have any reviews | 15 of 30 |
| Have a phone number | 30 of 30 |
| Have coordinates | 30 of 30 |
| Carry a social profile in the listing | **0 of 30** |

Two findings worth acting on:

- **No socials at all.** `scrapeContacts: false` is why. Turning it on costs
  $0.002 per place (+29%) and returns emails and social links. Contactability
  is 20 of the 100 lead-score points and email is 6 of them, so this is a real
  trade to make deliberately rather than by default.
- **Half have no reviews**, so a viability score leaning on review count scores
  half the list at zero. The log scaling already limits the damage, but the
  weights should be revisited against this once outreach data exists.

Real names in the sample include somebody's test listing and an Instagram
handle used as a business name. Both normalise to usable keys; neither is a
real lead. Some manual junk-filtering is
going to be needed.

### Running the whole verification: before and after three fixes

Stages A to E over the same 30, with a live search key. The first run is what
found the defects; the second is the same 30 after fixing them.

| Verdict | before | after |
|---|---:|---:|
| `NO_WEBSITE_CONFIRMED` | **0** | **4** |
| `NO_WEBSITE_LIKELY` | 5 | 14 |
| `WEAK_WEBSITE` | 4 | 4 |
| `HAS_WEBSITE` | 2 | 1 |
| `WEBSITE_UNCERTAIN` | **19** | 7 |

**5 actionable leads became 22** (18 with no website, 4 with a weak one).

The three defects, none of which was visible without live data:

1. **The classifier only credited a search that came back empty.** Stage C
   found a plausible candidate for 22 of 30 and Stage D refused 16 of them -
   and all 16 scored as though no search had run. "We searched, found the most
   plausible site on the internet, fetched it, and it is somebody else's" is
   stronger evidence than finding nothing, and was scoring zero. This alone
   accounts for most of the 19 uncertains.

2. **Stage C accepted any four-letter token, anywhere in a result.**
   `Salon F` matched `1881.no` (the Norwegian phone book) on "frisor";
   `Salon G` matched an aggregator on "beauty". Those are exactly the
   words a directory in the niche is full of. Now: a distinctive token, in the
   title or host, never the snippet.

3. **A directory was accepted as a business's own website.** `Salon H`, a
   lash-and-foot-spa salon, was matched to `neglesalonger.com` - Norwegian for "nail
   salons" - because a page listing many salons contains "lash" and
   "extensions". After the fix that business is `NO_WEBSITE_LIKELY` and the
   prover also rejected `norgeguide.com` on the same rule.

The third is the expensive kind of error: a false `HAS_WEBSITE` deletes a real
prospect from the list permanently, and nothing downstream ever revisits it.

58 junk hosts were added to `platform_domains`, every one observed as an actual
top search result for one of these 30 businesses.

### What the four confirmed leads look like

`Salon I`, `Salon J`, `Salon K` and `Salon E` all reached confidence 1.00 - all four checks ran and
all four came back empty.

The last of those is the business whose Overture record holds a Flickr album.
It is now correctly a no-website lead rather than a discarded `HAS_WEBSITE`,
which is the whole point of the Stage B platform filter.

### Hand-labelling: 8 checked independently, 8 correct

Checked by searching for each business by name and city, looking at what
actually exists, and ignoring what the pipeline said. This is a different
route to the answer than the pipeline takes - it uses a different search
engine and a human reading the results - which is what makes it a check rather
than a repetition.

**All four `NO_WEBSITE_CONFIRMED` are correct:**

| Business | What actually exists | Verdict |
|---|---|---|
| Salon I | Instagram + Facebook only | correct |
| Salon J | Instagram + Facebook only | correct |
| Salon K | Facebook + directory listings | correct |
| Salon E | Facebook + company register + a salon guide | correct |

**Precision on `NO_WEBSITE_CONFIRMED`: 4/4 = 100%.**

That clears the 90% gate, but on **n=4**, which is far too small to be
confident in. Four out of four is consistent with anything above roughly 40%
true precision. The gate is met but not yet *established*, and the honest
reading is that nothing so far contradicts the approach.

**Three `NO_WEBSITE_LIKELY` spot-checked, all correct:** Salon G,
Salon L and Clinic M have no site of their own - only
Facebook, Instagram, or Norwegian directory entries such as 180.no and io.no.

Notably these are indistinguishable in quality from the confirmed four. They
scored lower only because Overture does not list them, not because anything
suggested they might have a site. That points at the threshold rather than at
the classifier: `LIKELY` here is not a weaker lead, it is a lead about which
one free check happened to be unavailable.

**One `WEAK_WEBSITE` checked, and it is a genuinely borderline case.**
`Salon C` was matched to `clinic-c.example`, and that is right in
the narrow sense - the clinic's site has a staff page for her. But she has
no site of her *own*; she appears
on an employer's. Whether that is a prospect is a sales judgement rather than a
data one, and the pipeline currently answers it "no". Worth revisiting: a
practitioner listed on somebody else's site may be exactly the person who wants
their own.

### What this says about the threshold

The four confirmed and the fourteen likely look the same on inspection. The
only thing separating them is whether Overture happened to hold a record, and
Overture holds a record for just 30% of these businesses.

That suggests treating `NO_WEBSITE_LIKELY` as actionable rather than as a lesser
class - which would make the yield 18 of 30 rather than 4 - but that should be
decided by labelling more of the LIKELY bucket, not by argument. It is the
obvious next measurement.

### Hand-labelling completed: 15 of 30, 14 correct

| Bucket | checked | correct |
|---|---:|---:|
| `NO_WEBSITE_CONFIRMED` | 4 | **4** |
| `NO_WEBSITE_LIKELY` | 11 | 10 |
| **Total** | **15** | **14 (93%)** |

**Precision on `NO_WEBSITE_CONFIRMED`: 4/4.** The gate is met. On n=4 it is met
rather than established - four out of four is consistent with anything above
roughly 40% true precision - but nothing so far contradicts the approach, and
the wider 14/15 across both buckets is the more useful number.

The single miss is arguable rather than wrong. `Salon N` is a franchise of
a tanning chain that has its own parent site. The
business has no site of its own, which is what the pipeline said; whether a
franchisee can buy one is a sales judgement the data cannot make.

A second borderline case runs the other way: `Salon C` was classed
`WEAK_WEBSITE` because `clinic-c.example` has a page for her. She has no site
of her own - she appears on an employer's - so she may be a better prospect
than the pipeline thinks.

### Scoring, calibrated against the labelled leads

Running the scorer over the thirty exposed a real modelling error.
`business_viability` scored **zero** whenever a business had no Google
reviews, which treats "no reviews" as "might not be trading". It is not: a
listing with a phone, a street address and a category is a business that
exists and is open. Reviews say how busy it is.

Half of these businesses have no reviews, and hand-checking found them to be
perfectly ordinary one-person salons - so six *verified* no-website leads, the
exact thing this project exists to find, sat at 51 against a threshold of 60
because they had no stars. There is now a 6-point baseline for being
demonstrably operating.

The ranking was never the problem. After the fix:

| Score | Verdict | Business | hand-checked |
|---:|---|---|---|
| 85 | CONFIRMED | Salon I | correct |
| 80 | CONFIRMED | Salon J | correct |
| 77 | CONFIRMED | Salon K | correct |
| 77 | CONFIRMED | Salon E | correct |
| 67 | WEAK | Salon A | correct |
| 64 | LIKELY | Salon G | correct |
| 63 | LIKELY | Salon O | correct |
| 62 | LIKELY | Salon L | correct |
| 60 | LIKELY | Salon P | correct |
| 60 | LIKELY | Shop Q | correct |

The four hand-verified confirmed leads are the top four, and the junk sorts
itself out: a business literally called `OSLO` scores 40, the test listing
27, the Instagram-handle listing 30 - all below any usable threshold and most flagged
for review as well.

`min_lead_score` moved 60 -> 50 for these two targets, which qualifies 16 of
30. 60 was a guess written before any data existed; 50 is where the measured
distribution sits. It stays per-target, because real estate - where every
agency has reviews - will want a different number.

### Live settings

| | |
|---|---|
| Targets | Beauty Salons / Oslo and Dubai |
| Places per run | 60 each (was 150) |
| Threshold | 50 (was 60) |
| Cooldown | 7 days |
| Monthly cap | 650 places, about $4.55 at the measured rate |
| Schedule | CH-01 daily 06:00, CH-02 every 30 min |
| Status | **ACTIVE** since 13 September 2026 |

---

## Still outstanding: the gate

Everything above is mechanism. The gate below is the product question, and it
is not yet answered.

---

## The question

> Can we reliably tell that a business genuinely has no website?

Not "does the pipeline run". It runs. The question is whether its answers are
true, and the only way to find that out is to check some of them by hand.

## The gate

**Precision on `NO_WEBSITE_CONFIRMED` must be at least 90%.**

Precision, not recall, because the two errors are not symmetric:

- A **false positive** — we say no website, they have one — produces an email
  opening *"I noticed you don't have a website"* to somebody who does. That is
  worse than no email. It is the one failure that damages the pitch itself.
- A **false negative** — we drop a business that had no website — costs one
  lead out of hundreds, and the next city has more.

So the pipeline is built to be reluctant, and this measures whether the
reluctance is calibrated or merely expensive.

## The method

1. Run CH-01 for both POC targets (`db/003` enables exactly these two):
   - Beauty Salons / Oslo — dense open data, the control
   - Beauty Salons / Dubai — thin open data, the hard case
   - ~150 businesses each, `max_results: 150`
2. Load reference data for both cities **first**, and record what
   `--dry-run` reported about website coverage per city.
3. Run CH-02 until nothing is `PENDING`.
4. Take a **random 60** — 30 per city, stratified across the verdicts, not
   cherry-picked:

```sql
SELECT id, name, city, website_status, website_confidence, website_evidence
FROM businesses
WHERE website_status <> 'PENDING'
ORDER BY md5(id::text || 'poc-seed')
LIMIT 60;
```

5. For each one, **look it up by hand**. Search the name and the city, check
   the Maps listing, check Facebook and Instagram for a link in the bio.
   Record the truth, not the pipeline's opinion.
6. Fill in the tables below.

A seeded random order rather than `ORDER BY random()` so the same sample can
be re-pulled after a tuning change and the two runs compared.

---

## Results

### Sample

| | Oslo | Dubai |
|---|---|---|
| Discovered by CH-01 | | |
| Verified by CH-02 | | |
| Hand-labelled | | |
| Apify places actually charged | | |

### Confusion matrix for `NO_WEBSITE_CONFIRMED`

| | truly has no website | truly has one |
|---|---|---|
| **we said CONFIRMED** | TP = | **FP =** |
| **we said anything else** | FN = | TN = |

```
Precision = TP / (TP + FP) =        <- the gate, must be >= 0.90
Recall    = TP / (TP + FN) =
```

Per city, because the whole point of running two is that they may differ:

| | Precision | Recall | n |
|---|---|---|---|
| Oslo | | | |
| Dubai | | | |

### What each stage was worth

The number that decides whether the architecture was the right one. If Stage B
caught nothing, the free datasets are not earning their place and the design
should be simplified. If it caught a lot, it is the reason the list is worth
anything.

| Stage | False positives caught | Notes |
|---|---:|---|
| A — listing claim (platform/social/dead) | | |
| B — open datasets | | |
| C — search | | |
| D — domain probe | | |

Per city, since coverage differs:

| | Stage B catches | Stage B match rate |
|---|---:|---:|
| Oslo | | |
| Dubai | | |

### Where the uncertainty went

| Outcome | Count | Acceptable? |
|---|---:|---|
| `WEBSITE_UNCERTAIN` | | |
| probe `unreachable` | | |
| probe `refused` (no distinctive name) | | |

A large `refused` count in Dubai would be expected and is not a fault —
generic English trade names are common there. A large `unreachable` count is a
network or timeout problem, not a data problem, and is worth fixing.

---

## Costs actually incurred

| | Expected | Actual |
|---|---|---|
| Apify places charged | ~300 | |
| Apify $ | ~$1.50 | |
| **Did the `website` filter bill for rejected places?** | unknown | |
| Serper queries | | |
| PageSpeed calls | | |

That middle row is the one open question from the research. Apify's docs are
ambiguous about whether the `filter applied` event charges for places the
filter rejects. Compare the run's charge against the returned row count and
settle it here.

---

## Verdict

- [ ] Precision >= 90% — proceed to CH-03 and CH-04
- [ ] Precision below 90% — tune, re-run this sample, do not build further

### If it fails, the things to try in order

1. **Raise the bar for CONFIRMED.** Currently 0.85. If the false positives are
   clustered just above it, this is a one-number fix.
2. **Look at which stage was wrong.** The `website_checks` table holds the
   evidence for every verdict, so a failure can be diagnosed without
   re-scraping anything:
   ```sql
   SELECT b.name, c.stage, c.method, c.outcome, c.evidence
   FROM website_checks c JOIN businesses b ON b.id = c.business_id
   WHERE b.id = ANY($1) ORDER BY b.id, c.checked_at;
   ```
3. **Widen the cctld list** for the country if Stage D is missing real sites.
4. **Turn Stage C on** if it was skipped for want of a key — it is the
   cheapest remaining source of confidence.

### Notes

_What surprised you. Anything the numbers do not capture._
