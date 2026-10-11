-- CH-02: what still needs verifying?
--
-- The work queue is DERIVED FROM THE DATA rather than held in a queue table.
-- An interrupted run therefore resumes correctly, a business is never
-- verified twice, and there is no queue to drift out of sync with reality.
--
-- The cctlds come from the search target, so a Norwegian salon gets .no
-- probed before .com and a Spanish one gets .es. Without this join the domain
-- prover would burn its probe budget on the wrong guesses in every country
-- except the United States.

SELECT
  b.id,
  b.google_place_id,
  b.niche,
  b.name,
  b.name_norm,
  b.city,
  b.country,
  b.phone_e164,
  b.email,
  b.geohash7,
  b.lat,
  b.lon,
  b.rating,
  b.review_count,
  b.address,
  b.social_profiles,
  b.permanently_closed,
  b.raw ->> 'website'            AS source_website_raw,
  -- A search recorded by hand (stage-c-search.js uses it instead of Serper).
  b.raw -> 'hand_search'         AS hand_search,
  COALESCE(t.cctlds, ARRAY['.com'])  AS cctlds,
  COALESCE(t.min_lead_score, 60)     AS min_lead_score,
  t.niche_query
FROM businesses b
LEFT JOIN search_targets t ON t.id = b.search_target_id
WHERE b.website_status = 'PENDING'
  AND b.permanently_closed = false
  -- Verify on demand. Every lead costs a Serper search, and CH-02 used to
  -- verify ~1,400 a day for a sender that sends 30: the 2,500 free credits
  -- on a fresh key were gone in twelve hours (5-6 Oct 2026) while 943
  -- verified leads and 183 approved messages sat unused. Now nothing is
  -- verified while the approved queue holds $2 or more messages.
  AND ((SELECT count(*) FROM outreach WHERE status = 'approved') < $2::int
       -- Searched by hand on purpose: verify now, whatever the queue.
       OR b.raw ? 'hand_search')
ORDER BY
  -- Hand-searched first, and a batch of them never calls Serper at all, so
  -- they get through even while the key is refused.
  (b.raw ? 'hand_search') DESC,
  -- A lead with an email can be written to; one without only reaches the
  -- WhatsApp list, which has hundreds verified already.
  (coalesce(b.email, '') <> '') DESC,
  -- Businesses with more reviews are more likely to be worth the verification
  -- spend, so they go first when the batch limit bites.
  b.review_count DESC NULLS LAST,
  b.first_seen_at ASC
LIMIT $1::int;
