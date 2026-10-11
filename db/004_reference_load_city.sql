-- ===========================================================================
--  Separate "the city we asked for" from "the city the dataset calls it"
--
--  Found by looking at a real load rather than by reasoning about it.
--
--  Asking the loader for Dubai and then querying what landed gives:
--
--      city        places   with_website
--      ----------  ------   ------------
--      دبي          70734         47985
--      Dubai        12607         11941
--      الشارقة      11073          5839
--      عجمان         2791          1409
--
--  Overture stores the locality as the upstream provider wrote it, which in
--  the Gulf is usually Arabic. Two consequences, both silent:
--
--   1. Stage B's third match strategy is `name_norm + same locality`. Google
--      Maps says "Dubai"; Overture says "دبي". That comparison can never be
--      true, so the fallback match quietly stopped existing for the entire
--      Gulf. Phone and geohash matching still work, so nothing looks broken -
--      the match rate is simply lower than it should be, which is
--      indistinguishable from thin data.
--
--   2. The loader deletes a city's rows before reloading, scoped by `city`.
--      Scoped that way it only ever removed the 12,607 rows that happened to
--      be spelled "Dubai", leaving the other 84,000 to accumulate.
--
--  A generous bounding box also pulls in neighbours - Sharjah and Ajman here,
--  Sandvika and Lysaker around Oslo. That is wanted: a business on the edge of
--  the metro area is still worth cross-checking. But it means the row's own
--  locality is the wrong thing to key cleanup on.
--
--  So: keep the dataset's own spelling in `city`, and record separately which
--  load put the row there.
-- ===========================================================================

BEGIN;

ALTER TABLE ref_overture_places ADD COLUMN IF NOT EXISTS load_city TEXT;
ALTER TABLE ref_fsq_places      ADD COLUMN IF NOT EXISTS load_city TEXT;

-- Backfill what is already loaded, so the first run after this migration does
-- not have to re-download two cities' worth of parquet.
--
-- Norway and the UAE are the only countries loaded so far; the bounding boxes
-- that produced these rows were the Oslo and Dubai ones.
UPDATE ref_overture_places SET load_city = 'Oslo'
 WHERE load_city IS NULL AND country IN ('NO', 'Norway');
UPDATE ref_overture_places SET load_city = 'Dubai'
 WHERE load_city IS NULL AND country IN ('AE', 'United Arab Emirates');
UPDATE ref_overture_places SET load_city = city
 WHERE load_city IS NULL;

UPDATE ref_fsq_places SET load_city = locality WHERE load_city IS NULL;

CREATE INDEX IF NOT EXISTS ix_ovt_loadcity ON ref_overture_places (lower(load_city));
CREATE INDEX IF NOT EXISTS ix_fsq_loadcity ON ref_fsq_places (lower(load_city));

-- The name+city fallback now compares against load_city, which is the term we
-- searched Google with and therefore the term Google will hand back.
CREATE INDEX IF NOT EXISTS ix_ovt_name_loadcity
  ON ref_overture_places (name_norm, lower(load_city));
CREATE INDEX IF NOT EXISTS ix_fsq_name_loadcity
  ON ref_fsq_places (name_norm, lower(load_city));

INSERT INTO schema_migrations (version) VALUES ('004_reference_load_city')
ON CONFLICT (version) DO NOTHING;

COMMIT;
