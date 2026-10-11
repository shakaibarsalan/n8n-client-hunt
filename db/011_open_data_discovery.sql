-- ===========================================================================
--  Open-data discovery: finding leads in the Overture places we already hold.
--
--  Apify's free credit runs out each month long before the month does, and
--  the reference tables already hold 134,607 places for Oslo and Dubai -
--  tens of thousands of them with a phone and no website. This migration
--  gives those rows what discovery needs:
--
--    * address    - for the street-address corroboration Stage D does, and
--                   for a human reading the lead.
--    * categories - were always in the schema and never loaded; the loader
--                   now fills them from categories.primary/alternate.
--    * niche_categories - which Overture categories count as which niche.
--                   Data, not code, for the same reason niche and city are:
--                   adding a niche must not mean editing a workflow.
-- ===========================================================================

BEGIN;

ALTER TABLE ref_overture_places ADD COLUMN IF NOT EXISTS address TEXT;

CREATE INDEX IF NOT EXISTS ix_ovt_categories ON ref_overture_places USING gin (categories);

CREATE TABLE IF NOT EXISTS niche_categories (
  niche     TEXT NOT NULL,     -- matches search_targets.niche exactly
  category  TEXT NOT NULL,     -- an Overture categories.primary/alternate value
  PRIMARY KEY (niche, category)
);

-- Chosen from the categories actually present in the Oslo and Dubai loads
-- (counted 5 Oct 2026). Left out on purpose: shops that SELL beauty supplies,
-- schools, medical spas, mortgage brokers and serviced apartments - real
-- businesses, but not the ones a "salon" or "estate agent" pitch is for.
INSERT INTO niche_categories (niche, category) VALUES
  ('Beauty Salons', 'beauty_salon'),
  ('Beauty Salons', 'beauty_and_spa'),
  ('Beauty Salons', 'hair_salon'),
  ('Beauty Salons', 'barber'),
  ('Beauty Salons', 'nail_salon'),
  ('Beauty Salons', 'day_spa'),
  ('Beauty Salons', 'health_spa'),
  ('Beauty Salons', 'skin_care'),
  ('Beauty Salons', 'tanning_salon'),
  ('Beauty Salons', 'makeup_artist'),
  ('Beauty Salons', 'hair_removal'),
  ('Beauty Salons', 'laser_hair_removal'),
  ('Beauty Salons', 'waxing'),
  ('Beauty Salons', 'hair_extensions'),
  ('Beauty Salons', 'massage'),
  ('Beauty Salons', 'massage_therapy'),
  ('Real Estate', 'real_estate'),
  ('Real Estate', 'real_estate_agent'),
  ('Real Estate', 'real_estate_service'),
  ('Real Estate', 'property_management'),
  ('Real Estate', 'real_estate_investment'),
  ('Real Estate', 'commercial_real_estate')
ON CONFLICT DO NOTHING;

-- Any small business, not just the two POC niches - the owner asked for
-- "any business". Chosen from the categories that most often have an email
-- on the listing but no website (counted in the Dubai and Oslo loads). The
-- outreach templates are niche-neutral, so no new copy is needed.
INSERT INTO niche_categories (niche, category)
SELECT 'Small Businesses', c FROM unnest(ARRAY[
  'restaurant', 'cafe', 'bakery', 'automotive_repair', 'car_dealer', 'car_rental_agency',
  'auto_detailing', 'professional_services', 'travel_services', 'party_and_event_planning',
  'event_planning', 'gym', 'fitness_trainer', 'yoga_studio', 'dentist', 'medical_center',
  'doctor', 'physical_therapy', 'furniture_store', 'jewelry_store', 'clothing_store',
  'womens_clothing_store', 'tailor', 'photographer', 'interior_design', 'contractor',
  'cleaning_service', 'plumbing', 'electrician', 'printing_services', 'florist',
  'pet_groomer', 'veterinarian', 'education', 'tutoring_center', 'language_school',
  'driving_school', 'accountant', 'lawyer', 'beauty_salon', 'hair_salon', 'barber',
  'nail_salon', 'spas', 'real_estate_service', 'real_estate_agent'
]) AS c
ON CONFLICT DO NOTHING;

-- Open-data targets must never make CH-01 spend Apify credit on them.
ALTER TABLE search_targets ADD COLUMN IF NOT EXISTS apify_enabled BOOLEAN NOT NULL DEFAULT true;

-- Seeded DISABLED, like every other seed: turning a market on is a decision
-- taken on the live database, not a side effect of a migration (and CI
-- asserts the seeded enabled count).
INSERT INTO search_targets
  (niche, niche_query, country, country_code, city, cctlds, enabled, apify_enabled, notes)
VALUES
  ('Small Businesses', 'small business', 'United Arab Emirates', 'ae', 'Dubai',
   ARRAY['.ae', '.com'], false, false, 'Open data only (CH-00). Never sent to Apify.'),
  ('Small Businesses', 'small business', 'Norway', 'no', 'Oslo',
   ARRAY['.no', '.com'], false, false, 'Open data only (CH-00). Never sent to Apify.')
ON CONFLICT DO NOTHING;

-- Consent rules get a kind. 'consent' (the default, and every country seeded
-- in 009) holds a lead whose name reads as a person's: prior consent is
-- required to email a natural person there. 'opt_out' sends, because every
-- message carries a working opt-out (reply "no").
--
-- The UAE is seeded opt_out on the owner's instruction to send at volume
-- there: the PDPL gives a data subject the right to object to direct
-- marketing, and no general prior-consent rule for business email was
-- identified. This is a judgment recorded as data, NOT legal advice -
-- set it back to 'consent' to hold UAE sole traders again. An unlisted
-- country is still held, exactly as before.
ALTER TABLE consent_required_countries ADD COLUMN IF NOT EXISTS rule TEXT NOT NULL DEFAULT 'consent'
  CHECK (rule IN ('consent', 'opt_out'));

INSERT INTO consent_required_countries (country_code, law, note, rule) VALUES
  ('ae', 'Federal Decree-Law 45/2021 (PDPL) - right to object to direct marketing',
   'Opt-out: every message carries one. Owner''s decision, 5 Oct 2026; not legal advice.', 'opt_out')
ON CONFLICT (country_code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('011_open_data_discovery')
ON CONFLICT (version) DO NOTHING;

COMMIT;
