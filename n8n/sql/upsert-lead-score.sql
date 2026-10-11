-- CH-03: store the score.
--
-- ON CONFLICT DO UPDATE here, unlike CH-04's insert-outreach-draft.sql which
-- deliberately does DO NOTHING. The difference is deliberate, not an
-- inconsistency: an outreach draft can carry a human's own edits and
-- decisions (status, review notes) that a re-run must never clobber, but a
-- score has no human-owned state at all - qualified and needs_review are
-- fully derived from the model, so refreshing it on every run is correct.
-- Re-scoring the same (business_id, scoring_version) pair happens when a
-- business is re-verified (rating changed, a review came in) without the
-- scoring model itself changing.

INSERT INTO lead_scores
  (business_id, scoring_version, total, qualified, needs_review, review_reason, components)
VALUES
  ($1, $2, $3, $4, $5, $6, $7::jsonb)
ON CONFLICT (business_id, scoring_version) DO UPDATE SET
  total         = EXCLUDED.total,
  qualified     = EXCLUDED.qualified,
  needs_review  = EXCLUDED.needs_review,
  review_reason = EXCLUDED.review_reason,
  components    = EXCLUDED.components,
  scored_at     = now()
RETURNING id, business_id, total, qualified;
