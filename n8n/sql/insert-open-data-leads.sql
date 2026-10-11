-- CH-00: take new leads from the Overture places already loaded - free.
--
-- For every enabled search target whose city has reference data, picks up to
-- the first parameter's worth of places that:
--   * fall in one of the niche's Overture categories (niche_categories - data,
--     so a new niche is an INSERT, not a code change)
--   * have a phone number (every channel this project uses needs one)
--   * hold no website in Overture - or only links that are not a site of
--     their own: a social page, a delivery app, a directory, or a Google
--     business.site page (all shut down in 2024). Which hosts count is the
--     platform_domains TABLE, the same list Stage A judges them by.
--   * are not closed
--   * are not already a business here - by place id, phone, or name + location
-- most confident first, and stores them PENDING so CH-02 verifies them like
-- any other lead. Nothing here decides "no website": the dataset's empty
-- website field is Stage A's starting claim, nothing more, and Stage B is
-- kept from matching a lead against its own Overture record.
--
-- google_place_id is 'ovt:' + the Overture id. It is the dedup key every
-- other query uses, and the prefix keeps it from ever colliding with a real
-- Google place id.

WITH targets AS (
  SELECT t.id, t.niche, t.city, t.country, upper(t.country_code) AS country_code,
         (SELECT array_agg(nc.category) FROM niche_categories nc WHERE nc.niche = t.niche) AS cats
  FROM search_targets t
  WHERE t.enabled
    AND EXISTS (SELECT 1 FROM ref_overture_places o WHERE lower(o.load_city) = lower(t.city))
    -- Nothing new while CH-02 already has $2 or more waiting: it verifies on
    -- demand now (select-pending.sql), so a growing PENDING pile is only
    -- leads that will go stale before anyone looks at them.
    AND (SELECT count(*) FROM businesses WHERE website_status = 'PENDING') < $2::int
),

picked AS (
  SELECT DISTINCT ON (o.gers_id)
    t.id AS target_id, t.niche, t.city, t.country, t.country_code,
    o.gers_id, o.name, o.name_norm, o.categories, o.address, o.lat, o.lon,
    o.geohash7, o.phone_e164, o.socials, o.confidence, o.email, o.listed_site
  FROM targets t
  CROSS JOIN LATERAL (
    SELECT o.*,
      -- The listing's own email, when it carries a usable one. A data broker's
      -- address (bisnode) is the broker, not the business.
      (SELECT lower(e) FROM unnest(o.emails) AS e
        WHERE e ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$'
          AND e !~* '@(bisnode|example|sentry|wixpress)[.]'
        LIMIT 1) AS email,
      -- The link the listing holds instead of a website, dead business.site
      -- first: Stage A reads it from raw.website, and CH-04 picks its pitch
      -- from it.
      (SELECT s FROM unnest(o.websites) AS s
        ORDER BY (s ~* '(^|[/.])business[.]site') DESC LIMIT 1) AS listed_site
    FROM ref_overture_places o
    WHERE lower(o.load_city) = lower(t.city)
      AND t.cats IS NOT NULL
      AND o.categories && t.cats
      AND o.phone_e164 IS NOT NULL AND o.phone_e164 <> ''
      AND NOT EXISTS (
        SELECT 1 FROM unnest(o.websites) AS s
        CROSS JOIN LATERAL (SELECT lower(substring(s FROM '^(?:[a-z]+://)?(?:www[.])?([^/:?#]+)')) AS host) h
        WHERE NOT EXISTS (
          SELECT 1 FROM platform_domains pd
          WHERE pd.active AND (h.host = pd.domain OR right(h.host, length(pd.domain) + 1) = '.' || pd.domain)))
      AND coalesce(o.operating_status, 'open') NOT IN ('closed', 'permanently_closed')
      AND coalesce(o.name_norm, '') <> ''
      -- Not prospects for a small-business website, whatever their category:
      -- housing co-ops (sameie, borettslag), car parks, places of worship,
      -- official bodies, associations. Found in the first batch's queue.
      AND o.name !~* '(sameie|borettslag|parkering|parking|mosque|masjid|embassy|consulate|ministry|government|municipality|kommune|forening|association|residence|townhouse|bed ?space|partition|hostel|accommodation|labou?r camp)'
      -- A name that is only a street address ("Eksempelgata 7") is a property
      -- advert, not a business - they came in with finn.no links.
      AND o.name !~* '^[^0-9]*(gate|gata|veien|vei|vegen|street|road) [0-9]+[a-z]?$'
      AND NOT EXISTS (
        SELECT 1 FROM businesses b
        WHERE b.google_place_id = 'ovt:' || o.gers_id
           OR b.phone_e164 = o.phone_e164
           OR (b.name_norm = o.name_norm AND b.geohash7 = o.geohash7))
    -- Places whose listing carries an email first: without one, the only
    -- channel is the phone, and that is what the call list is for.
    -- A dead Google site next: the strongest true thing we can tell them.
    ORDER BY (cardinality(o.emails) > 0) DESC, coalesce((SELECT bool_or(s ~* '(^|[/.])business[.]site') FROM unnest(o.websites) AS s), false) DESC,
             o.confidence DESC NULLS LAST, o.gers_id
    LIMIT $1::int
  ) o
  ORDER BY o.gers_id
),

stored AS (
  INSERT INTO businesses (
    google_place_id, search_target_id, niche, name, name_norm,
    category_primary, categories, address, city, country, country_code,
    lat, lon, geohash7, phone_raw, phone_e164, email, social_profiles, raw, source)
  SELECT
    'ovt:' || p.gers_id, p.target_id, p.niche, p.name, p.name_norm,
    p.categories[1], p.categories, p.address, p.city, p.country, p.country_code,
    p.lat, p.lon, p.geohash7, p.phone_e164, p.phone_e164, p.email,
    coalesce((
      SELECT jsonb_object_agg(k, s) FROM (
        SELECT DISTINCT ON (k) s,
          CASE WHEN s ~* 'facebook' THEN 'facebook'
               WHEN s ~* 'instagram' THEN 'instagram'
               WHEN s ~* 'linkedin' THEN 'linkedin'
               ELSE 'other' END AS k
        FROM unnest(p.socials) AS s WHERE coalesce(s, '') <> '') x), '{}'::jsonb),
    jsonb_build_object('source', 'overture', 'gers_id', p.gers_id, 'website', coalesce(p.listed_site, ''),
                       'overture_confidence', p.confidence,
                       'email_source', CASE WHEN p.email IS NOT NULL THEN 'listing' END),
    'overture'
  FROM picked p
  ON CONFLICT DO NOTHING
  RETURNING search_target_id
)

SELECT t.id AS target_id, t.niche, t.city,
       (SELECT count(*) FROM stored s WHERE s.search_target_id = t.id) AS added
FROM targets t
ORDER BY t.id;
