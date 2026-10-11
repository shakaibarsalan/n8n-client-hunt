-- CH-08: the numbers behind /stats. One row; lists come back as JSON arrays.
--
-- "Today" is date_trunc('day', now()) in the database's time zone - the same
-- day CH-05's daily cap counts (select-send-stats.sql), so the two agree.

SELECT
  (SELECT count(*) FROM outreach
     WHERE status IN ('sent', 'replied', 'bounced') AND sent_at >= date_trunc('day', now()))  AS sent_today,
  (SELECT count(*) FROM outreach
     WHERE status IN ('sent', 'replied', 'bounced') AND sent_at >= date_trunc('day', now())
       AND sequence_step > 1)                                                                  AS followups_today,
  (SELECT count(*) FROM outreach WHERE sent_at IS NOT NULL)                                    AS sent_total,
  (SELECT count(*) FROM outreach WHERE status = 'replied')                                     AS replies_total,
  (SELECT count(*) FROM outreach
     WHERE status = 'replied' AND reply_at >= date_trunc('day', now()))                        AS replies_today,
  (SELECT count(*) FROM outreach WHERE status = 'bounced')                                     AS bounced_total,
  (SELECT count(*) FROM outreach WHERE status = 'bounced'
     AND coalesce(reply_at, sent_at) >= now() - interval '7 days')                             AS bounced_7d,
  (SELECT count(*) FROM outreach WHERE status IN ('sent', 'replied', 'bounced')
     AND sent_at >= now() - interval '7 days')                                                 AS sent_7d,
  (SELECT count(*) FROM outreach WHERE status = 'approved')                                    AS queued,
  (SELECT count(*) FROM outreach WHERE status = 'needs_review')                                AS held,
  (SELECT count(*) FROM outreach
     WHERE guard_flags ->> 'mailbox_check' IN ('invalid', 'disabled', 'spamtrap', 'disposable')) AS dead_mailboxes_caught,
  (SELECT max(sent_at) FROM outreach)                                                          AS last_sent_at,
  (SELECT min(sent_at) FROM outreach WHERE sent_at IS NOT NULL)                                AS first_sent_at,
  (SELECT count(*) FROM businesses)                                                            AS leads_total,
  (SELECT count(*) FROM businesses WHERE website_status = 'PENDING')                           AS pending,
  (SELECT coalesce(json_agg(x ORDER BY x.n DESC), '[]'::json) FROM (
     SELECT coalesce(b.city, '?') AS city, count(*) AS n
     FROM outreach o JOIN businesses b ON b.id = o.business_id
     WHERE o.sent_at >= date_trunc('day', now())
     GROUP BY 1) x)                                                                            AS today_by_city,
  (SELECT coalesce(json_agg(x), '[]'::json) FROM (
     SELECT b.name, b.city, o.reply_at, left(o.reply_excerpt, 140) AS excerpt
     FROM outreach o JOIN businesses b ON b.id = o.business_id
     WHERE o.status = 'replied'
     ORDER BY o.reply_at DESC
     LIMIT 3) x)                                                                               AS recent_replies;
