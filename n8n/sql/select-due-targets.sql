-- CH-01: which markets are due a run?
--
-- The whole configurability requirement lives in this query. n8n asks the
-- database what to hunt; it does not know the answer itself. Changing
-- "Beauty Salons in Oslo" to "Dental Clinics in Dubai" is an INSERT into
-- search_targets, not an edit to any node.
--
-- cooldown_hours is what makes a DAILY schedule return NEW businesses rather
-- than re-scraping the same city every morning and paying for it again.
--
-- LIMIT is deliberate. One target per run keeps a bad target from consuming
-- the whole monthly Apify credit before anyone notices.

SELECT
  t.id,
  t.niche,
  t.niche_query,
  t.category_filter,
  t.country,
  -- Lowercase ISO-2. The scraper's countryCode is an enum of these and
  -- rejects country names; without it a search is not restricted at all.
  t.country_code,
  t.state,
  t.city,
  t.postal_code,
  t.custom_geolocation,
  t.cctlds,
  t.max_results,
  t.min_lead_score,
  t.daily_lead_limit,
  t.include_social_only,
  t.include_weak_website,
  t.min_review_count,
  t.min_rating,
  -- The spend brake travels with the target so the node that starts the run
  -- can refuse without a second query.
  --
  -- Scalar subqueries rather than a join to app_state. A CROSS JOIN here
  -- means that if the apify_spend row is ever missing, this query returns NO
  -- ROWS AT ALL - and the brake node reads that as "no target is due", which
  -- it reports as the schedule working normally. A missing brake row would
  -- silently look like a healthy idle pipeline. COALESCE to a cap of 0
  -- instead, which fails closed: no row, no spending.
  COALESCE((SELECT (value ->> 'places_scraped')::int
              FROM app_state WHERE key = 'apify_spend'), 0) AS spend_places_scraped,
  COALESCE((SELECT (value ->> 'monthly_place_cap')::int
              FROM app_state WHERE key = 'apify_spend'), 0) AS spend_monthly_cap,
  (SELECT value ->> 'month' FROM app_state WHERE key = 'apify_spend') AS spend_month,
  to_char(now(), 'YYYY-MM')                AS current_month
FROM search_targets t
WHERE t.enabled
  -- Open-data-only targets (CH-00) never reach Apify. See db/011.
  AND t.apify_enabled
  AND (
    t.last_run_at IS NULL
    OR t.last_run_at < now() - make_interval(hours => t.cooldown_hours)
  )
ORDER BY
  t.last_run_at ASC NULLS FIRST,   -- never-run targets go first
  t.id ASC
LIMIT 1;
