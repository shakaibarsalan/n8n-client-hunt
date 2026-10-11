-- ===========================================================================
--  Phone/WhatsApp outreach list, and Abu Dhabi.
--
--  233 qualified, no-website leads had a phone and no email - the best leads
--  in the database, reached by nothing. CH-07's digest now hands the owner a
--  few of them each time, as tap-to-message WhatsApp links. phone_listed_at
--  records that a lead was handed over, so the next digest gives new ones
--  rather than the same ten again.
--
--  Abu Dhabi: same market as Dubai (English, opt-out), free open data.
-- ===========================================================================

BEGIN;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone_listed_at TIMESTAMPTZ;

-- Abu Dhabi targets, open data only (never Apify). Seeded disabled, like
-- every seed; turned on on the live database.
INSERT INTO search_targets
  (niche, niche_query, country, country_code, city, cctlds, enabled, apify_enabled, notes)
VALUES
  ('Beauty Salons', 'beauty salon', 'United Arab Emirates', 'ae', 'Abu Dhabi',
   ARRAY['.ae', '.com'], false, false, 'Open data only (CH-00). Never sent to Apify.'),
  ('Small Businesses', 'small business', 'United Arab Emirates', 'ae', 'Abu Dhabi',
   ARRAY['.ae', '.com'], false, false, 'Open data only (CH-00). Never sent to Apify.')
ON CONFLICT DO NOTHING;

-- The Abu Dhabi real-estate target was seeded in 003 for Apify. Kept on
-- open data here so enabling it can never spend credit.
UPDATE search_targets SET apify_enabled = false
 WHERE niche = 'Real Estate' AND lower(city) = 'abu dhabi';

INSERT INTO schema_migrations (version) VALUES ('012_phone_outreach_and_abu_dhabi')
ON CONFLICT (version) DO NOTHING;

COMMIT;
