-- ===========================================================================
--  Calibrate the two live targets from the first run's measurements
--
--  Two changes, both from data rather than from argument.
--
--  1. max_results 150 -> 60
--
--     Measured cost is $0.007 per place. Two targets at 150 is 300 places,
--     about $2.10 - nearly half of a $5 monthly credit in a single morning,
--     and the schedule fires daily. At 60 each a day costs about $0.84 and the
--     month's budget lasts.
--
--     This is a budget decision, not a quality one: 30 places was enough to
--     find four separate defects, so a smaller daily run is not a smaller
--     experiment.
--
--  2. min_lead_score 60 -> 50
--
--     Scoring the first 30 leads and hand-checking fifteen of them found six
--     verified no-website businesses sitting at 51 - just under the default
--     threshold. Four of them - a foot-therapy service and three salons, two
--     trading under the owner's own name - are all real one-person businesses
--     with no site of their own, which is precisely what this project exists
--     to find.
--
--     They scored low for having no Google reviews, not for being poor
--     prospects. Half the businesses in this niche have no reviews at all.
--
--     60 was a guess written before any data existed. 50 is what the measured
--     distribution supports: it qualifies 16 of 30, and every one that was
--     hand-checked was genuinely without a website.
--
--     The threshold is per-target on purpose. A different niche - real estate,
--     where every agency has reviews - will want a different number, and this
--     migration should not be read as a new global default.
-- ===========================================================================

BEGIN;

UPDATE search_targets
   SET max_results    = 60,
       min_lead_score = 50,
       notes = notes || ' | Calibrated 13 Sep 2026 from the first 30: '
                     || 'max_results 150->60 at the measured $0.007/place, '
                     || 'min_lead_score 60->50 because verified no-website '
                     || 'leads with no reviews scored 51.'
 WHERE enabled
   AND max_results = 150;

-- The spend cap follows the same measured rate. 650 places is about $4.55 of a
-- $5 credit; at two targets x 60 places a day that is roughly five days of
-- running, which is the honest shape of a free plan rather than a month of it.
UPDATE app_state
   SET value = jsonb_set(value, '{monthly_place_cap}', '650')
 WHERE key = 'apify_spend';

INSERT INTO schema_migrations (version) VALUES ('008_calibrate_poc_targets')
ON CONFLICT (version) DO NOTHING;

COMMIT;
