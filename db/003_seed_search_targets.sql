-- ===========================================================================
--  Seed: search targets and scoring weights
--
--  THIS FILE IS THE ONLY PLACE A NICHE OR A CITY IS NAMED.
--
--  To hunt a new market, add a row. To stop hunting one, set enabled = false.
--  Nothing in n8n/ contains the word "salon" or the word "Oslo".
--
--    INSERT INTO search_targets (niche, niche_query, country, city, cctlds, enabled)
--    VALUES ('Dental Clinics', 'dental clinic', 'United Arab Emirates', 'ae', 'Dubai',
--            ARRAY['.ae','.com'], true);
--
--  Everything here ships with enabled = false EXCEPT the two POC rows. An
--  enabled target costs money the next time the schedule fires, so the safe
--  default is off.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
--  POC targets — the two that are actually enabled.
--
--  Oslo and Dubai were chosen to contrast dense open data with sparse. That
--  turned out to be wrong: measured on 12 September 2026, Dubai has 98,815
--  Overture places (69.4% holding a website) against Oslo's 35,792 (87.5%).
--  Both are dense.
--
--  Kept as the POC pair anyway - two countries, two alphabets and two phone
--  formats is still a better test than one city twice - but the sparse-data
--  case remains untested. See docs/RESEARCH.md.
-- ---------------------------------------------------------------------------
-- country_code is set HERE, not left to 005 to backfill.
--
-- 005 adds a CHECK that an enabled target must carry a country code. A CHECK
-- violation is raised immediately and is NOT suppressed by ON CONFLICT DO
-- NOTHING - that clause only catches unique and exclusion violations. So
-- re-running this file after 005 existed failed outright, which meant every
-- deploy after the first failed. Seed data has to be valid on its own rather
-- than valid only because a later migration tidies up after it.
INSERT INTO search_targets
  (niche, niche_query, country, country_code, city, cctlds, max_results,
   enabled, cooldown_hours, notes)
VALUES
  ('Beauty Salons', 'beauty salon', 'Norway', 'no', 'Oslo',
   ARRAY['.no', '.com'], 150, true, 168,
   'POC A. Dense Overture coverage: 35,792 places, 87.5% holding a website.'),

  ('Beauty Salons', 'beauty salon', 'United Arab Emirates', 'ae', 'Dubai',
   ARRAY['.ae', '.com'], 150, true, 168,
   'POC B. Also dense, contrary to the original guess: 98,815 places, 69.4% holding a website.')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
--  Ready to enable. Written now so that scaling is a one-word UPDATE rather
--  than a schema question at the point where you want to move fast.
-- ---------------------------------------------------------------------------
INSERT INTO search_targets
  (niche, niche_query, country, country_code, city, cctlds, max_results, enabled, notes)
VALUES
  -- Scandinavia
  ('Real Estate', 'real estate agency', 'Norway', 'no',  'Oslo',      ARRAY['.no', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'Sweden', 'se',  'Stockholm', ARRAY['.se', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Sweden', 'se',  'Stockholm', ARRAY['.se', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'Denmark', 'dk', 'Copenhagen',ARRAY['.dk', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Denmark', 'dk', 'Copenhagen',ARRAY['.dk', '.com'], 150, false, NULL),

  -- Gulf
  ('Real Estate', 'real estate agency', 'United Arab Emirates', 'ae', 'Dubai',     ARRAY['.ae', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'United Arab Emirates', 'ae', 'Abu Dhabi', ARRAY['.ae', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Qatar', 'qa',                'Doha',      ARRAY['.qa', '.com'], 150, false, NULL),

  -- Southern Europe
  ('Real Estate', 'real estate agency', 'Spain', 'es',    'Barcelona', ARRAY['.es', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Spain', 'es',    'Barcelona', ARRAY['.es', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'Spain', 'es',    'Madrid',    ARRAY['.es', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'Portugal', 'pt', 'Lisbon',    ARRAY['.pt', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Portugal', 'pt', 'Lisbon',    ARRAY['.pt', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'Italy', 'it',    'Milan',     ARRAY['.it', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Italy', 'it',    'Milan',     ARRAY['.it', '.com'], 150, false, NULL),

  -- Canada
  ('Real Estate', 'real estate agency', 'Canada', 'ca', 'Toronto',   ARRAY['.ca', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Canada', 'ca', 'Toronto',   ARRAY['.ca', '.com'], 150, false, NULL),
  ('Real Estate', 'real estate agency', 'Canada', 'ca', 'Vancouver', ARRAY['.ca', '.com'], 150, false, NULL),
  ('Beauty Salons', 'beauty salon', 'Canada', 'ca', 'Vancouver', ARRAY['.ca', '.com'], 150, false, NULL)
ON CONFLICT DO NOTHING;


-- ===========================================================================
--  Scoring weights — the opinionated part of the model, kept as data.
--
--  These are a STARTING HYPOTHESIS, not a finding. They multiply the Spend
--  Potential component only (max 15 points), so getting them wrong moves a
--  lead by a few points rather than deciding its fate.
--
--  After ~50 outreach attempts, refit these against actual reply rate and
--  bump scoring_version. Until then they are a guess, and labelling them as
--  such is the difference between a model and a number somebody made up.
-- ===========================================================================
INSERT INTO scoring_weights (kind, key, weight, rationale) VALUES
  ('niche',   'Real Estate',   1.00,
     'High ticket, commission-driven, a website directly drives listings enquiries'),
  ('niche',   'Beauty Salons', 0.80,
     'Lower budget, but very high volume and often Instagram-only — easy sell, smaller project'),

  ('country', 'United Arab Emirates', 1.00, 'Highest willingness to pay; competitive market'),
  ('country', 'Qatar',                1.00, NULL),
  ('country', 'Norway',               0.95, 'High purchasing power; high web-maturity so fewer prospects'),
  ('country', 'Denmark',              0.95, NULL),
  ('country', 'Sweden',               0.95, NULL),
  ('country', 'Canada',               0.90, 'Large market; CASL makes email outreach legally strict'),
  ('country', 'Spain',                0.75, 'Lower budgets, but many more businesses without sites'),
  ('country', 'Italy',                0.75, NULL),
  ('country', 'Portugal',             0.70, NULL)
ON CONFLICT (kind, lower(key)) DO UPDATE
  SET weight = EXCLUDED.weight, rationale = EXCLUDED.rationale;


-- ===========================================================================
--  app_state defaults — the spend brake, in before the first live request.
-- ===========================================================================
INSERT INTO app_state (key, value) VALUES
  ('apify_spend', jsonb_build_object(
      'month', to_char(now(), 'YYYY-MM'),
      'places_scraped', 0,
      'runs_started', 0,
      'monthly_place_cap', 650,
      'note', 'Free plan is $5/month, no rollover, runs blocked at zero. MEASURED cost is $0.007 per place, not the documented $0.005 - the run is also billed for the actor start and for the filter applied per place. 650 places is about $4.55, leaving headroom. CH-01 also checks Apify live credit and takes whichever limit is lower.')),
  ('ch01_last_summary', '{}'::jsonb),
  ('ch02_last_summary', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('003_seed_search_targets')
ON CONFLICT (version) DO NOTHING;

COMMIT;
