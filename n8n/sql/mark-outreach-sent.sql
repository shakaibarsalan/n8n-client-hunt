-- CH-05: record that the send actually happened.
--
-- The WHERE clause repeats status = 'approved' on purpose. If this workflow
-- were somehow triggered twice at once - two manual clicks, or a schedule
-- added later without updating this guard - both executions would pick the
-- same "next approved message", but only the first UPDATE would find a
-- matching row; the second finds it already 'sent' and updates nothing. That
-- is the same idempotency guarantee CH-02's write-verdict.sql uses.

UPDATE outreach SET
  status  = 'sent',
  sent_at = now(),
  message_id = NULLIF($2, ''),
  -- What the mailbox check said ($3), so every send carries its proof.
  guard_flags = guard_flags || jsonb_build_object('mailbox_check', NULLIF($3::text, ''), 'mailbox_checked_at', now())
WHERE id = $1::bigint
  AND status = 'approved'
RETURNING id, sent_at;
