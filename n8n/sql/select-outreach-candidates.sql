-- CH-04: who is due a drafted message?
--
-- Two halves, unioned:
--
--   Step 1 (opener)   qualified leads with an email on file that have never
--                      had a step-1 draft written.
--
--   Follow-ups       the next step after the latest SENT message (2, then 3), whose
--                      wait_days have passed, which have not replied or
--                      bounced, and which have no step-2 draft yet.
--
-- A business with no email is not selected at all - there is nothing to
-- draft, and creating a permanent "needs_review: no email" row for every
-- no-website lead (which is most of them, by design) would drown the queue in
-- noise. When Stage F later finds an email, the next CH-04 run picks it up
-- naturally, because absence here is not a decision, just nothing to do yet.
--
-- Already-suppressed addresses are excluded outright, not flagged for review.
-- A suppression entry means "do not contact" with no human override implied -
-- reversing it is a data change (delete the suppression row), not a draft
-- decision.
--
-- website_url, name_norm and city are selected for the address check in
-- render-outreach-draft.js: an email must carry the business's name, or sit on
-- its own named site, before a draft is left un-held.
--
-- site_corroborated: how we know the business's site is THEIRS - its phone
-- or street address on the page ('phone' / 'address'), or the Maps listing
-- itself linking it ('listing'). A name match alone is 'none', and
-- render-outreach-draft.js holds those for a human: same-named companies in
-- other countries were being drafted (a same-named company in Slovakia).
--
-- Template choice: WEAK_WEBSITE leads get the 'weak_website' slug, not
-- 'default'. The default opener says "you don't seem to have your own
-- website yet" - true for a NO_WEBSITE lead, false for one that has a site
-- and just needs a better one. See db/010_weak_website_template.sql. A
-- follow-up reuses whichever slug its own step-1 message used, so a
-- sequence never switches pitch mid-conversation.

WITH latest_score AS (
  SELECT DISTINCT ON (business_id) business_id, qualified, needs_review
  FROM lead_scores
  ORDER BY business_id, scored_at DESC
),

opener AS (
  SELECT
    b.id, b.name, b.email, b.country, b.country_code, b.social_profiles,
    b.permanently_closed, b.website_status, b.website_url, b.name_norm, b.city,
    COALESCE(
      (SELECT wc.evidence ->> 'corroborated' FROM website_checks wc
        WHERE wc.business_id = b.id AND wc.stage = 'probe' AND wc.outcome = 'found'
          AND wc.evidence ? 'corroborated'
        ORDER BY wc.checked_at DESC LIMIT 1),
      (SELECT 'listing' FROM website_checks wc
        WHERE wc.business_id = b.id AND wc.stage = 'source'
          AND wc.evidence ->> 'claim' = 'real' LIMIT 1),
      'none') AS site_corroborated,
    b.raw ->> 'email_source' AS email_source,
    (SELECT c.rule FROM consent_required_countries c WHERE c.country_code = lower(b.country_code)) AS consent_rule,
    b.niche, b.category_primary,
    (SELECT (wc.evidence ->> 'performance')::numeric FROM website_checks wc
      WHERE wc.business_id = b.id AND wc.method = 'pagespeed.mobile' AND wc.outcome = 'found'
        AND wc.evidence ? 'performance'
      ORDER BY wc.checked_at DESC LIMIT 1) AS psi_performance,
    t.id AS template_id, t.sequence_step, t.subject AS template_subject, t.body AS template_body,
    NULL::text AS first_subject
  FROM businesses b
  JOIN latest_score s ON s.business_id = b.id AND s.qualified AND NOT s.needs_review
  JOIN outreach_templates t
    ON t.slug = (CASE WHEN b.website_status = 'WEAK_WEBSITE' THEN 'weak_website'
                      -- The listing's "website" is a Google business.site page, all of
                      -- which Google shut down in 2024: the one true, specific thing
                      -- we can tell them, so it gets its own pitch.
                      WHEN b.raw ->> 'website' ~* '(^|[/.])business[.]site' THEN 'dead_google_site'
                      ELSE 'default' END)
   AND t.sequence_step = 1 AND t.active
  WHERE b.email IS NOT NULL AND b.email <> ''
    AND b.name !~* '(sameie|borettslag|parkering|parking|mosque|masjid|embassy|consulate|ministry|government|municipality|kommune|forening|association|residence|townhouse|bed ?space|partition|hostel|accommodation|labou?r camp)'   -- not small-business prospects; see insert-open-data-leads.sql
    AND b.permanently_closed = false
    AND NOT EXISTS (
      SELECT 1 FROM outreach o WHERE o.business_id = b.id AND o.sequence_step = 1)
    -- Several listings can carry one shared gmail; one opener per address.
    AND NOT EXISTS (
      SELECT 1 FROM outreach o WHERE lower(o.to_email) = lower(b.email))
    AND NOT EXISTS (
      SELECT 1 FROM suppression sup
      WHERE (sup.kind = 'email' AND lower(sup.value) = lower(b.email))
         OR (sup.kind = 'place_id' AND sup.value = b.google_place_id))
),

followup AS (
  SELECT
    b.id, b.name, b.email, b.country, b.country_code, b.social_profiles,
    b.permanently_closed, b.website_status, b.website_url, b.name_norm, b.city,
    COALESCE(
      (SELECT wc.evidence ->> 'corroborated' FROM website_checks wc
        WHERE wc.business_id = b.id AND wc.stage = 'probe' AND wc.outcome = 'found'
          AND wc.evidence ? 'corroborated'
        ORDER BY wc.checked_at DESC LIMIT 1),
      (SELECT 'listing' FROM website_checks wc
        WHERE wc.business_id = b.id AND wc.stage = 'source'
          AND wc.evidence ->> 'claim' = 'real' LIMIT 1),
      'none') AS site_corroborated,
    b.raw ->> 'email_source' AS email_source,
    (SELECT c.rule FROM consent_required_countries c WHERE c.country_code = lower(b.country_code)) AS consent_rule,
    b.niche, b.category_primary,
    (SELECT (wc.evidence ->> 'performance')::numeric FROM website_checks wc
      WHERE wc.business_id = b.id AND wc.method = 'pagespeed.mobile' AND wc.outcome = 'found'
        AND wc.evidence ? 'performance'
      ORDER BY wc.checked_at DESC LIMIT 1) AS psi_performance,
    t.id AS template_id, t.sequence_step, t.subject AS template_subject, t.body AS template_body,
    -- The subject step 1 actually went out with (after rendering), so a
    -- follow-up can be 'Re: <that>' and land in the same conversation.
    (SELECT o1.subject FROM outreach o1
      WHERE o1.business_id = b.id AND o1.sequence_step = 1 AND o1.sent_at IS NOT NULL
      ORDER BY o1.sent_at LIMIT 1) AS first_subject
  FROM businesses b
  -- The NEXT step after the latest one sent, whichever it is: step 2 after a
  -- sent step 1, step 3 after a sent step 2. wait_days counts from the
  -- previous message. Same slug throughout, so a sequence never switches
  -- pitch mid-conversation.
  JOIN outreach prev ON prev.business_id = b.id AND prev.status = 'sent'
  JOIN outreach_templates prev_t ON prev_t.id = prev.template_id
  JOIN outreach_templates t ON t.slug = prev_t.slug
                          AND t.sequence_step = prev.sequence_step + 1 AND t.active
  WHERE prev.sent_at <= now() - make_interval(days => t.wait_days)
    AND b.permanently_closed = false
    AND NOT EXISTS (
      SELECT 1 FROM outreach o WHERE o.business_id = b.id AND o.sequence_step = t.sequence_step)
    -- Anyone who replied to or bounced ANY message in the sequence is done.
    AND NOT EXISTS (
      SELECT 1 FROM outreach o WHERE o.business_id = b.id AND o.status IN ('replied', 'bounced'))
    AND NOT EXISTS (
      SELECT 1 FROM suppression sup
      WHERE (sup.kind = 'email' AND lower(sup.value) = lower(b.email))
         OR (sup.kind = 'place_id' AND sup.value = b.google_place_id))
)

SELECT * FROM opener
UNION ALL
SELECT * FROM followup
LIMIT $1;
