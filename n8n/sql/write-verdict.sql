-- CH-02: record the verdict and the evidence that produced it.
--
-- Two writes in one statement, deliberately atomic:
--
--   1. website_checks gets every check that ran, append-only. This is what
--      makes a classification auditable and, more usefully, RE-DERIVABLE: if
--      the confidence thresholds change, old rows can be re-scored offline
--      without re-scraping or re-paying for anything.
--
--   2. businesses gets the verdict itself.
--
-- The WHERE clause on the UPDATE is a guard, not decoration. A verdict is
-- only written over PENDING. If two CH-02 executions overlap - which a
-- 30-minute schedule and a slow probe batch make entirely possible - the
-- second one finds the row already decided and leaves it alone rather than
-- overwriting a verdict with a staler one.

WITH ins AS (
  INSERT INTO website_checks (business_id, stage, method, candidate_url, outcome, evidence)
  SELECT
    $1::bigint,
    c ->> 'stage',
    c ->> 'method',
    NULLIF(c ->> 'candidate_url', ''),
    c ->> 'outcome',
    COALESCE(c -> 'evidence', '{}'::jsonb)
  FROM jsonb_array_elements($2::jsonb) AS c
  RETURNING 1
)
UPDATE businesses SET
  website_status     = $3,
  website_confidence = $4,
  website_url        = NULLIF($5, ''),
  website_evidence   = $6,
  website_checked_at = now(),
  -- $7 is Stage F's finding, if it ran. COALESCE onto the existing value so a
  -- re-verify never erases an email a human or an earlier run already found.
  email               = COALESCE(NULLIF($7, ''), businesses.email)
WHERE id = $1::bigint
  AND website_status = 'PENDING'
RETURNING id, website_status, website_confidence;
-- The count of inserted checks is deliberately NOT returned. Referencing a
-- data-modifying CTE from the outer RETURNING is subtle enough to be worth
-- avoiding for a number nothing reads; the CTE still runs either way, because
-- Postgres always executes a data-modifying CTE whether or not it is
-- referenced.
