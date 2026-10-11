-- ===========================================================================
--  search_targets.country_code — the ISO-2 code the scraper actually wants
--
--  Found by reading the actor's input schema rather than by running it.
--
--  `countryCode` is an ENUM of lowercase ISO 3166-1 alpha-2 codes:
--      ['', 'us', 'af', 'al', ..., 'no', ..., 'ae', ...]
--
--  CH-01 was passing search_targets.country, which holds "Norway". That is not
--  in the enum. The run would have been rejected or, worse, silently ignored
--  the country and searched the wrong place - and "beauty salon" with no
--  country is a global search that would have burned the month's credit on
--  results from anywhere.
--
--  Storing the code as data rather than mapping names in JavaScript keeps the
--  rule this project is built on: adding a market is one INSERT, and it has to
--  carry everything the scraper needs.
-- ===========================================================================

BEGIN;

-- IF NOT EXISTS because 001 now defines this column for fresh databases. This
-- migration exists for databases created before it did, and for the backfill
-- and CHECK below, which 001 cannot express.
ALTER TABLE search_targets ADD COLUMN IF NOT EXISTS country_code TEXT;

COMMENT ON COLUMN search_targets.country_code IS
  'Lowercase ISO 3166-1 alpha-2. Required by the Apify actor, which rejects country names.';

UPDATE search_targets SET country_code = CASE lower(country)
    WHEN 'norway'               THEN 'no'
    WHEN 'sweden'               THEN 'se'
    WHEN 'denmark'              THEN 'dk'
    WHEN 'finland'              THEN 'fi'
    WHEN 'united arab emirates' THEN 'ae'
    WHEN 'qatar'                THEN 'qa'
    WHEN 'saudi arabia'         THEN 'sa'
    WHEN 'spain'                THEN 'es'
    WHEN 'portugal'             THEN 'pt'
    WHEN 'italy'                THEN 'it'
    WHEN 'greece'               THEN 'gr'
    WHEN 'canada'               THEN 'ca'
    WHEN 'united states'        THEN 'us'
    WHEN 'united kingdom'       THEN 'gb'
    WHEN 'pakistan'             THEN 'pk'
  END
WHERE country_code IS NULL;

-- A target that is enabled but has no country code would search globally, so
-- it must not be possible to enable one. A CHECK rather than a NOT NULL,
-- because a disabled draft row with no code yet is perfectly reasonable.
ALTER TABLE search_targets DROP CONSTRAINT IF EXISTS ck_targets_enabled_needs_cc;
ALTER TABLE search_targets ADD CONSTRAINT ck_targets_enabled_needs_cc
  CHECK (NOT enabled OR country_code IS NOT NULL OR custom_geolocation IS NOT NULL);

INSERT INTO schema_migrations (version) VALUES ('005_target_country_code')
ON CONFLICT (version) DO NOTHING;

COMMIT;
