-- CH-05: what has the sender already done today, and how healthy is it?
--
-- Read BEFORE picking a message to send, so the brake can refuse before it
-- ever looks at a candidate - the same ordering as CH-01's spend check.

SELECT
  (SELECT count(*) FROM outreach
     -- Every message that LEFT today counts, whatever happened to it after:
     -- a bounce or a reply changes its status, not the fact that it was sent.
     -- Counting only status 'sent' let two bounces through a 20-a-day cap.
     WHERE status IN ('sent', 'replied', 'bounced')
       AND sent_at >= date_trunc('day', now()))                              AS sent_today,
  (SELECT count(*) FROM outreach WHERE status = 'sent')                    AS sent_total,
  (SELECT count(*) FROM outreach WHERE status = 'bounced')                 AS bounced_total,
  (SELECT count(*) FROM outreach WHERE status = 'bounced'
     AND coalesce(reply_at, sent_at) >= now() - interval '7 days')         AS bounced_7d,
  (SELECT count(*) FROM outreach WHERE status IN ('sent', 'replied', 'bounced')
     AND sent_at >= now() - interval '7 days')                            AS sent_7d,
  -- When the latest bounce came in: the brake's alarm speaks only right after
  -- a bounce, not every hour for the week a tripped brake stays tripped.
  (SELECT max(coalesce(reply_at, sent_at)) FROM outreach
     WHERE status = 'bounced')                                           AS last_bounced_at,
  (SELECT max(sent_at) FROM outreach WHERE sent_at IS NOT NULL)          AS last_sent_at,
  (SELECT min(sent_at) FROM outreach WHERE sent_at IS NOT NULL)          AS first_sent_at;
