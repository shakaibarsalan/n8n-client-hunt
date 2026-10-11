-- CH-03: which verified businesses have not been scored under this model
-- version yet?
--
-- "Not yet scored under THIS version" rather than "never scored at all" -
-- bumping SCORING_VERSION in score-lead.js after a calibration is meant to
-- re-score everything under the new model, and lead_scores is unique on
-- (business_id, scoring_version) precisely so the old and new scores can
-- coexist and be compared. $1 is that version string; tests/score-lead-
-- version.test.js pins it to the literal inside score-lead.js so the two
-- cannot silently drift apart.
--
-- Two facts score-lead.js needs are not columns on `businesses` - they only
-- ever existed as in-memory values partway through CH-02's own pipeline. Both
-- are derived here from `website_checks`, the append-only evidence trail,
-- rather than given new columns purely to carry transient state:
--
--   probe_was_unreachable  - did Stage D's domain probe fail to complete?
--                            Absence of a website was never demonstrated,
--                            so this forces a review regardless of score.
--   psi_performance        - the last PageSpeed mobile score Stage E found,
--                            or NULL if it was never measured (a shared free
--                            quota, so this is common and not an error).

SELECT
  b.id, b.website_status, b.website_confidence, b.permanently_closed,
  b.phone_e164, b.address, b.review_count, b.rating, b.city, b.social_profiles,
  b.niche, b.country, b.email,
  COALESCE(t.min_lead_score, 60) AS min_lead_score,

  -- Stage D probes several candidate domains per business (up to 8), and
  -- ANY SINGLE ONE of those guesses can time out - a bogus domain guess
  -- failing to connect happens constantly and says nothing about the
  -- others. The hold belongs only when NONE of the attempts ever reached a
  -- conclusive outcome: no page was ever actually fetched and judged
  -- ('found'/'rejected'), and no domain was cleanly absent ('not_found').
  --
  -- The first version flagged this whenever ANY attempt was 'unreachable',
  -- which held EVERY business with a wide candidate list almost by
  -- accident - measured on real data, a one-person salon ("Salon E" in
  -- docs/POC-RESULTS.md) was fully classified NO_WEBSITE_CONFIRMED at 1.00 confidence
  -- (six domains cleanly rejected or not-found) and still got flagged,
  -- because one of eight guessed domains happened to time out. 68 of 90
  -- real businesses were wrongly held by this before it was measured
  -- against actual probe evidence and fixed.
  (
    EXISTS (SELECT 1 FROM website_checks wc
             WHERE wc.business_id = b.id AND wc.stage = 'probe')
    AND NOT EXISTS (SELECT 1 FROM website_checks wc
             WHERE wc.business_id = b.id AND wc.stage = 'probe'
               AND wc.outcome IN ('found', 'rejected', 'not_found'))
  ) AS probe_was_unreachable,

  (
    SELECT (wc.evidence ->> 'performance')::numeric
    FROM website_checks wc
    WHERE wc.business_id = b.id
      -- Stage F (email discovery) also writes stage='quality' rows, tagged
      -- with a different method - 'email.<url>' rather than
      -- 'pagespeed.mobile' - so this has to match on method, not just stage,
      -- or an email-lookup row could be mistaken for a performance score.
      AND wc.stage = 'quality' AND wc.method = 'pagespeed.mobile'
      AND wc.outcome = 'found' AND wc.evidence ? 'performance'
    ORDER BY wc.checked_at DESC LIMIT 1
  ) AS psi_performance

FROM businesses b
LEFT JOIN search_targets t ON t.id = b.search_target_id
WHERE b.website_status <> 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM lead_scores s
    WHERE s.business_id = b.id AND s.scoring_version = $1)
ORDER BY b.website_confidence DESC NULLS LAST, b.first_seen_at ASC
LIMIT $2;
