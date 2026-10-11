-- CH-02 Stage B: cross-check a candidate against the free open datasets.
--
-- This is the highest-leverage query in the project and it costs nothing to
-- run. Google Maps says this business has no website; Overture and Foursquare
-- are independent of Google and may well hold one. If they do, Stage A was
-- wrong and we have caught a false positive for zero marginal cost.
--
-- Three match strategies, in descending order of confidence. The strongest
-- one that hits wins.
--
--   1. phone in E.164     - two listings sharing a phone number are the same
--                           business, whatever they call themselves
--   2. name + geohash7    - same normalised name inside the same ~150m cell
--   3. name + load_city   - weakest. Used only to establish PRESENCE in the
--                           dataset, never on its own to assert a website,
--                           because two salons with the same name in one city
--                           is entirely plausible.
--
--  Strategy 3 compares against load_city - the city WE searched for - not the
--  dataset's own locality field. Overture stores the locality as the upstream
--  provider wrote it, which for Dubai is Arabic. Comparing Google's "Dubai"
--  against that can never match, so this fallback silently ceased to exist for
--  the whole Gulf until it was noticed in the loaded data.
--
-- match_rank is returned so the caller can tell how much to trust the answer
-- rather than treating all three as equivalent.

WITH candidate AS (
  SELECT
    $1::text AS place_id,
    $2::text AS name_norm,
    $3::text AS phone_e164,
    $4::text AS geohash7,
    $5::text AS city
),

overture AS (
  SELECT
    'overture'::text AS src,
    o.gers_id        AS ref_id,
    o.websites,
    o.socials,
    o.confidence,
    o.operating_status,
    CASE
      WHEN c.phone_e164 <> '' AND o.phone_e164 = c.phone_e164        THEN 1
      WHEN c.geohash7   <> '' AND o.geohash7   = c.geohash7
                              AND o.name_norm  = c.name_norm          THEN 2
      WHEN lower(o.load_city) = lower(c.city) AND o.name_norm = c.name_norm THEN 3
    END AS match_rank
  FROM ref_overture_places o
  CROSS JOIN candidate c
  -- A business CH-00 found IN Overture would otherwise match its own record
  -- and earn "an open dataset holds no website for them" - the dataset
  -- vouching for itself. Its own row is excluded; any OTHER record still counts.
  WHERE ('ovt:' || o.gers_id) <> c.place_id
    AND ((c.phone_e164 <> '' AND o.phone_e164 = c.phone_e164)
     OR (c.geohash7   <> '' AND o.geohash7   = c.geohash7 AND o.name_norm = c.name_norm)
     OR (lower(o.load_city) = lower(c.city) AND o.name_norm = c.name_norm))
),

fsq AS (
  SELECT
    'fsq'::text       AS src,
    f.fsq_place_id    AS ref_id,
    CASE WHEN COALESCE(f.website, '') <> '' THEN ARRAY[f.website] ELSE '{}'::text[] END AS websites,
    ARRAY_REMOVE(ARRAY[f.facebook_id, f.instagram, f.twitter], NULL) AS socials,
    NULL::numeric     AS confidence,
    CASE WHEN f.date_closed IS NOT NULL THEN 'closed' ELSE NULL END AS operating_status,
    CASE
      WHEN c.phone_e164 <> '' AND f.tel_e164 = c.phone_e164          THEN 1
      WHEN c.geohash7   <> '' AND f.geohash7 = c.geohash7
                              AND f.name_norm = c.name_norm           THEN 2
      WHEN lower(f.load_city) = lower(c.city) AND f.name_norm = c.name_norm THEN 3
    END AS match_rank
  FROM ref_fsq_places f
  CROSS JOIN candidate c
  WHERE (c.phone_e164 <> '' AND f.tel_e164 = c.phone_e164)
     OR (c.geohash7   <> '' AND f.geohash7 = c.geohash7 AND f.name_norm = c.name_norm)
     OR (lower(f.load_city) = lower(c.city) AND f.name_norm = c.name_norm)
),

matches AS (
  SELECT * FROM overture
  UNION ALL
  SELECT * FROM fsq
)

SELECT
  (SELECT place_id FROM candidate)                       AS place_id,
  COUNT(*) > 0                                           AS matched,
  MIN(match_rank)                                        AS best_match_rank,
  -- A website only counts when the match that produced it was rank 1 or 2.
  -- A name-and-city match is not strong enough to attach somebody else's
  -- website to this business, and doing so would turn a real prospect into a
  -- discarded HAS_WEBSITE.
  COALESCE(
    (SELECT w
     FROM matches m, unnest(m.websites) AS w
     WHERE m.match_rank <= 2 AND COALESCE(w, '') <> ''
     LIMIT 1),
    ''
  )                                                      AS website,
  COALESCE(
    (SELECT array_agg(DISTINCT s)
     FROM matches m, unnest(m.socials) AS s
     WHERE COALESCE(s, '') <> ''),
    '{}'::text[]
  )                                                      AS socials,
  BOOL_OR(operating_status = 'closed')                   AS looks_closed,
  MIN(confidence)                                        AS min_confidence,
  COALESCE(array_agg(DISTINCT src), '{}'::text[])        AS sources
FROM matches;
