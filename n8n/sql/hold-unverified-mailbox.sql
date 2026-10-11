-- CH-05: the mailbox check said this one must not go.
--
-- $1 outreach id, $2 verdict ('hold' | 'drop'), $3 reason, $4 Reoon status.
-- 'hold' parks it for a human; 'drop' skips it and suppresses the address,
-- the same as a bounce would have - without the bounce. Any other verdict
-- (an 'error' - the check itself failed) changes nothing: the message stays
-- approved and is checked again next run.
-- status = 'approved' is repeated for the same reason mark-outreach-sent.sql
-- repeats it.

WITH changed AS (
  UPDATE outreach SET
    status        = CASE WHEN $2::text = 'drop' THEN 'skipped' ELSE 'needs_review' END,
    review_reason = $3::text,
    guard_flags   = guard_flags || jsonb_build_object('mailbox_check', $4::text, 'mailbox_checked_at', now())
  WHERE id = $1::bigint
    AND status = 'approved'
    AND $2::text IN ('hold', 'drop')
  RETURNING id, to_email, status
),

suppressed AS (
  INSERT INTO suppression (kind, value, reason)
  SELECT 'email', lower(to_email), 'mailbox check: ' || $4::text || ' on ' || to_char(now(), 'YYYY-MM-DD')
  FROM changed
  WHERE status = 'skipped'
  ON CONFLICT (kind, lower(value)) DO NOTHING
  RETURNING id
)

SELECT (SELECT count(*) FROM changed) AS changed, (SELECT count(*) FROM suppressed) AS suppressed;
