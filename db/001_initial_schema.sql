-- ===========================================================================
--  n8n Client Hunt — initial schema
--
--  Conventions, carried over from the LinkedIn project's migration because
--  each one was arrived at the hard way:
--
--    * Status columns are TEXT + CHECK rather than native ENUMs. Adding a
--      value to a CHECK is a one-line ALTER; adding one to an ENUM inside a
--      transaction is restricted and is a common migration foot-gun.
--    * TIMESTAMPTZ everywhere. This project spans Oslo, Dubai, Barcelona and
--      Toronto from a machine in Lahore; a naive timestamp is a bug waiting
--      for the first daylight-saving change.
--    * Every statement is idempotent. Running this file twice must be a
--      no-op, because it will be run twice.
--    * The UNIQUE indexes are the structural guarantee behind "never scrape
--      or contact the same business twice". They hold even when the workflow
--      code is wrong, which it will eventually be.
--
--  Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_initial_schema.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
--  Migration bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
--  updated_at trigger, applied in a loop further down
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;


-- ===========================================================================
--  1. search_targets — THE configuration surface
--
--  This table is the answer to "the niche must not be hardcoded anywhere".
--  Adding "Dental Clinics + Dubai" is one INSERT. No node is edited, no
--  workflow is re-deployed, no code is written.
--
--  The LinkedIn project built an equivalent table (search_profiles), exposed
--  it over an API, and then bypassed it with three hardcoded URLs pasted into
--  an n8n Set node. Building both and using neither was that repo's clearest
--  waste. CH-01 reads this table and nothing else.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS search_targets (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  niche               TEXT NOT NULL,         -- human label: 'Beauty Salons'
  niche_query         TEXT NOT NULL,         -- what Maps is actually asked:
                                             -- 'beauty salon' — the label and
                                             -- the query are different things
                                             -- and conflating them produces
                                             -- bad searches for good labels
  category_filter     TEXT[],                -- optional Maps category narrowing

  country             TEXT NOT NULL,
  -- Lowercase ISO 3166-1 alpha-2. The scraper's countryCode input is an ENUM
  -- of these and rejects country names outright; a target without one would
  -- search globally.
  --
  -- It lives HERE rather than in a later migration because 003 seeds rows that
  -- use it. Added by 005 as well, for databases created before this column
  -- existed - on a fresh database 001 creates it and 005's ADD COLUMN IF NOT
  -- EXISTS is a no-op. A column the seed data needs cannot be introduced after
  -- the seed data runs.
  country_code        TEXT,
  state               TEXT,
  city                TEXT,
  postal_code         TEXT,
  custom_geolocation  JSONB,                 -- Point/Polygon, overrides the above
  cctlds              TEXT[] NOT NULL DEFAULT '{}',
                                             -- domain guesses to try for this
                                             -- country, e.g. {.no,.com}

  -- Filters. Every one of these is read at runtime; none is hardcoded.
  max_results         INTEGER NOT NULL DEFAULT 100,
  min_lead_score      INTEGER NOT NULL DEFAULT 60,
  daily_lead_limit    INTEGER NOT NULL DEFAULT 50,
  include_social_only    BOOLEAN NOT NULL DEFAULT true,
  include_weak_website   BOOLEAN NOT NULL DEFAULT true,
  min_review_count    INTEGER NOT NULL DEFAULT 0,
  min_rating          NUMERIC(2,1),

  -- Scheduling. cooldown_hours is why a daily run returns NEW businesses
  -- rather than re-scraping Oslo every morning and paying for it.
  enabled             BOOLEAN NOT NULL DEFAULT false,
  cooldown_hours      INTEGER NOT NULL DEFAULT 168,
  last_run_at         TIMESTAMPTZ,
  last_run_found      INTEGER,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per niche per place. COALESCE so that a country-wide target and a
-- city target for the same niche can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_niche_place
  ON search_targets (lower(niche), lower(country), lower(COALESCE(city, '')));

CREATE INDEX IF NOT EXISTS ix_targets_due
  ON search_targets (enabled, last_run_at) WHERE enabled;


-- ===========================================================================
--  2. businesses — the canonical entity
-- ===========================================================================
CREATE TABLE IF NOT EXISTS businesses (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  google_place_id     TEXT NOT NULL,         -- primary dedup key
  search_target_id    BIGINT REFERENCES search_targets(id) ON DELETE SET NULL,
  niche               TEXT NOT NULL,         -- denormalised on purpose: a lead
                                             -- must keep its niche even if the
                                             -- target row is later deleted

  name                TEXT NOT NULL,
  name_norm           TEXT NOT NULL,         -- lowercased, punctuation and
                                             -- legal suffixes stripped
  category_primary    TEXT,
  categories          TEXT[],

  address             TEXT,
  street              TEXT,
  city                TEXT,
  state               TEXT,
  country             TEXT,
  country_code        TEXT,
  postal_code         TEXT,
  lat                 DOUBLE PRECISION,
  lon                 DOUBLE PRECISION,
  geohash7            TEXT,                  -- ~150m cell, for the name+geo key

  phone_raw           TEXT,
  phone_e164          TEXT,
  email               TEXT,
  listing_url         TEXT,
  social_profiles     JSONB NOT NULL DEFAULT '{}',

  rating              NUMERIC(2,1),
  review_count        INTEGER,
  price_level         TEXT,
  permanently_closed  BOOLEAN NOT NULL DEFAULT false,
  temporarily_closed  BOOLEAN NOT NULL DEFAULT false,

  -- Website verdict. PENDING is the only state CH-01 may write; everything
  -- else is CH-02's to set.
  website_url         TEXT,
  website_status      TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (website_status IN (
      'PENDING', 'HAS_WEBSITE', 'WEAK_WEBSITE',
      'NO_WEBSITE_CONFIRMED', 'NO_WEBSITE_LIKELY',
      'WEBSITE_UNCERTAIN', 'INVALID')),
  website_confidence  NUMERIC(3,2) CHECK (website_confidence BETWEEN 0 AND 1),
  website_checked_at  TIMESTAMPTZ,
  website_evidence    TEXT,                  -- one human sentence: why

  -- The whole scraper record, kept so fields can be re-mapped later without
  -- re-scraping and re-paying. Actor field names drift between versions.
  raw                 JSONB NOT NULL DEFAULT '{}',
  source              TEXT NOT NULL DEFAULT 'apify:google-maps-extractor',

  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- The three dedup layers, in descending order of confidence -------------
--
-- A business reached by two different niche searches, or by two different
-- cities whose radii overlap, must insert exactly once. These indexes are the
-- guarantee; the workflow's ON CONFLICT clauses are merely how it cooperates.

CREATE UNIQUE INDEX IF NOT EXISTS ux_biz_place_id
  ON businesses (google_place_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_biz_phone
  ON businesses (phone_e164)
  WHERE phone_e164 IS NOT NULL AND phone_e164 <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_biz_name_geo
  ON businesses (name_norm, geohash7)
  WHERE geohash7 IS NOT NULL AND geohash7 <> '';

-- Work for CH-02 is DERIVED from this index rather than held in a queue, so
-- an interrupted run resumes correctly and nothing is verified twice.
CREATE INDEX IF NOT EXISTS ix_biz_pending
  ON businesses (first_seen_at) WHERE website_status = 'PENDING';

CREATE INDEX IF NOT EXISTS ix_biz_status   ON businesses (website_status);
CREATE INDEX IF NOT EXISTS ix_biz_target   ON businesses (search_target_id);
CREATE INDEX IF NOT EXISTS ix_biz_city     ON businesses (lower(country), lower(city));


-- ===========================================================================
--  3. website_checks — append-only evidence trail
--
--  Every stage writes what it saw. This is what makes a classification
--  auditable and re-derivable without re-scraping: if the thresholds change,
--  the old evidence can be re-scored offline.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS website_checks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id    BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stage          TEXT NOT NULL
    CHECK (stage IN ('source', 'dataset', 'search', 'probe', 'quality')),
  method         TEXT NOT NULL,              -- 'overture.phone', 'probe.stem+.no'
  candidate_url  TEXT,
  outcome        TEXT NOT NULL
    CHECK (outcome IN ('found', 'not_found', 'unreachable', 'rejected', 'skipped')),
  evidence       JSONB NOT NULL DEFAULT '{}',
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_checks_business
  ON website_checks (business_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS ix_checks_outcome ON website_checks (stage, outcome);


-- ===========================================================================
--  4. lead_scores — versioned, so weights can be refitted
--
--  Kept out of businesses so that re-scoring every lead under a new model is
--  an INSERT rather than a destructive UPDATE, and so the score that decided
--  an outreach decision is still readable after the model changes.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lead_scores (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id     BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scoring_version TEXT NOT NULL,
  total           INTEGER NOT NULL CHECK (total BETWEEN 0 AND 100),
  components      JSONB NOT NULL DEFAULT '{}',
  qualified       BOOLEAN NOT NULL DEFAULT false,
  needs_review    BOOLEAN NOT NULL DEFAULT false,
  review_reason   TEXT,
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, scoring_version)
);

CREATE INDEX IF NOT EXISTS ix_scores_total
  ON lead_scores (scoring_version, total DESC);
CREATE INDEX IF NOT EXISTS ix_scores_qualified
  ON lead_scores (scored_at DESC) WHERE qualified;


-- ===========================================================================
--  5. scoring_weights — the model, as data
--
--  Niche and location weights live here rather than in a Code node so that
--  "real estate in Dubai is worth more than a salon in Barcelona" is a fact
--  you can edit, not a constant somebody has to find.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS scoring_weights (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('niche', 'country', 'city')),
  key        TEXT NOT NULL,
  weight     NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  rationale  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_weights_kind_key
  ON scoring_weights (kind, lower(key));


-- ===========================================================================
--  6. Reference datasets — the free verification oracle
--
--  Loaded by tools/load_overture.py and tools/load_fsq.py, bbox-filtered to
--  the cities actually being hunted. These are queried thousands of times and
--  never cost anything, which is the entire point.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ref_overture_places (
  gers_id          TEXT PRIMARY KEY,
  name             TEXT,
  name_norm        TEXT,
  phone_e164       TEXT,
  websites         TEXT[],
  socials          TEXT[],
  emails           TEXT[],
  categories       TEXT[],
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  geohash7         TEXT,
  confidence       NUMERIC(4,3),
  operating_status TEXT,
  country          TEXT,
  city             TEXT,
  loaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ovt_phone ON ref_overture_places (phone_e164)
  WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ovt_namegeo ON ref_overture_places (name_norm, geohash7);
CREATE INDEX IF NOT EXISTS ix_ovt_namecity
  ON ref_overture_places (name_norm, lower(city));

CREATE TABLE IF NOT EXISTS ref_fsq_places (
  fsq_place_id  TEXT PRIMARY KEY,
  name          TEXT,
  name_norm     TEXT,
  tel_e164      TEXT,
  website       TEXT,
  email         TEXT,
  facebook_id   TEXT,
  instagram     TEXT,
  twitter       TEXT,
  categories    TEXT[],
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  geohash7      TEXT,
  country       TEXT,
  locality      TEXT,
  date_closed   TEXT,
  loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fsq_phone ON ref_fsq_places (tel_e164)
  WHERE tel_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fsq_namegeo ON ref_fsq_places (name_norm, geohash7);
CREATE INDEX IF NOT EXISTS ix_fsq_namecity
  ON ref_fsq_places (name_norm, lower(locality));


-- ===========================================================================
--  7. platform_domains — "that is not a website"
--
--  A table rather than a constant in a node, because this list changes
--  (business.site died in 2024) and changing it should not mean editing and
--  re-importing a workflow.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS platform_domains (
  domain     TEXT PRIMARY KEY,
  kind       TEXT NOT NULL
    CHECK (kind IN ('social', 'directory', 'marketplace',
                    'builder_subdomain', 'review', 'dead', 'shortener')),
  counts_as_social BOOLEAN NOT NULL DEFAULT false,
  active     BOOLEAN NOT NULL DEFAULT true,
  note       TEXT
);


-- ===========================================================================
--  8. suppression — built before there is any outreach to need it
--
--  The job-hunt repo has no opt-out mechanism anywhere, and its own review
--  named that as the most significant gap for a lead-gen pipeline. Canada's
--  CASL and the GDPR both apply to the target markets here. A suppression
--  list added after the first complaint is added too late.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS suppression (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('email', 'domain', 'phone', 'place_id')),
  value     TEXT NOT NULL,
  reason    TEXT NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppression_kind_value
  ON suppression (kind, lower(value));


-- ===========================================================================
--  9. events — append-only audit
-- ===========================================================================
CREATE TABLE IF NOT EXISTS events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow    TEXT,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  level       TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug', 'info', 'warn', 'error', 'critical')),
  event_type  TEXT NOT NULL,
  message     TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_events_recent ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_events_level
  ON events (level, created_at DESC) WHERE level IN ('warn', 'error', 'critical');


-- ===========================================================================
-- 10. app_state — cursors, spend counters, breaker state
--
--  The Apify spend counter lives here. It is the brake, and per the LinkedIn
--  post-mortem the brake goes in before the first live request, not after the
--  fourth bug.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS app_state (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ===========================================================================
--  updated_at triggers
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['search_targets', 'businesses', 'app_state'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;


-- ===========================================================================
--  Convenience view: what CH-04 reports on
-- ===========================================================================
CREATE OR REPLACE VIEW v_qualified_leads AS
SELECT
  b.id, b.google_place_id, b.niche, b.name, b.category_primary,
  b.address, b.city, b.country, b.phone_e164, b.email,
  b.listing_url, b.social_profiles,
  b.rating, b.review_count,
  b.website_status, b.website_confidence, b.website_evidence, b.website_url,
  s.total AS lead_score, s.components, s.scoring_version,
  s.qualified, s.needs_review, s.review_reason,
  b.first_seen_at, s.scored_at
FROM businesses b
JOIN lead_scores s ON s.business_id = b.id
WHERE b.permanently_closed = false;


INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
