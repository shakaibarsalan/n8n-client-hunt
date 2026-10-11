-- CH-07: what the pipeline did in the last 12 hours, for the twice-daily
-- Telegram digest. One row; the lists come back as JSON arrays.
--
-- This replaced a Telegram message per send, per draft batch and per
-- verification run, which buried the messages that matter. Only a reply
-- (CH-06) and a stopped sender (CH-05's alarm) still message on their own.

WITH win AS (SELECT now() - interval '12 hours' AS since),

sent AS (
  SELECT o.sequence_step, b.city, coalesce(b.category_primary, b.niche) AS kind
  FROM outreach o
  JOIN businesses b ON b.id = o.business_id
  CROSS JOIN win
  WHERE o.sent_at >= win.since
)

SELECT
  (SELECT count(*) FROM sent)                              AS sent,
  (SELECT count(*) FROM sent WHERE sequence_step > 1)      AS followups,
  (SELECT coalesce(json_agg(x ORDER BY x.n DESC), '[]'::json)
     FROM (SELECT coalesce(city, '?') AS city, count(*) AS n FROM sent GROUP BY 1) x)  AS by_city,
  (SELECT coalesce(json_agg(x ORDER BY x.n DESC), '[]'::json)
     FROM (SELECT coalesce(kind, '?') AS kind, count(*) AS n FROM sent GROUP BY 1) x)  AS by_kind,
  (SELECT count(*) FROM outreach o, win
     WHERE o.status = 'bounced' AND coalesce(o.reply_at, o.sent_at) >= win.since)     AS bounced,
  (SELECT coalesce(json_agg(x), '[]'::json) FROM (
     SELECT b.name, b.city, left(o.reply_excerpt, 160) AS excerpt
     FROM outreach o JOIN businesses b ON b.id = o.business_id, win
     WHERE o.status = 'replied' AND o.reply_at >= win.since) x)                       AS replies,
  (SELECT count(*) FROM outreach WHERE status IN ('sent', 'replied', 'bounced'))      AS sent_total,
  (SELECT count(*) FROM outreach WHERE status = 'replied')                            AS replies_total,
  (SELECT count(*) FROM outreach WHERE status = 'approved')                           AS queued,
  (SELECT count(*) FROM outreach o, win
     WHERE o.status = 'needs_review' AND o.created_at >= win.since)                   AS held,
  (SELECT count(*) FROM businesses b, win WHERE b.first_seen_at >= win.since)         AS new_leads,
  (SELECT count(*) FROM businesses b, win WHERE b.website_checked_at >= win.since)    AS verified,
  (SELECT count(*) FROM businesses b, win
     WHERE b.website_checked_at >= win.since
       AND b.website_status IN ('NO_WEBSITE_LIKELY', 'NO_WEBSITE_CONFIRMED'))         AS verified_no_site,
  (SELECT count(*) FROM businesses WHERE website_status = 'PENDING')                  AS pending,
  -- Watchdog: the pipeline stopped for two weeks once and nobody knew. These
  -- let the digest say so instead of reporting zeros as if they were normal.
  (SELECT max(checked_at) FROM website_checks)                                        AS last_check_at,
  (SELECT max(sent_at) FROM outreach)                                                 AS last_sent_at,
  (SELECT count(*) FROM website_checks wc, win
     WHERE wc.stage = 'search' AND wc.checked_at >= win.since
       AND wc.evidence ? 'error')                                                     AS search_errors,
  (SELECT count(*) FROM website_checks wc, win
     WHERE wc.stage = 'search' AND wc.checked_at >= win.since)                        AS searches,
  (SELECT count(*) FROM businesses WHERE phone_listed_at IS NOT NULL)                 AS whatsapp_listed,
  -- CH-05's bounce brake, restated: its own alarm speaks only right after a
  -- bounce, so the digest is what says "still stopped" twice a day.
  (SELECT count(*) FROM outreach WHERE status = 'bounced'
     AND coalesce(reply_at, sent_at) >= now() - interval '7 days')                    AS bounced_7d,
  (SELECT count(*) FROM outreach WHERE status IN ('sent', 'replied', 'bounced')
     AND sent_at >= now() - interval '7 days')                                        AS sent_7d,
  (SELECT min(coalesce(reply_at, sent_at)) + interval '7 days' FROM outreach
     WHERE status = 'bounced'
       AND coalesce(reply_at, sent_at) >= now() - interval '7 days')                  AS brake_eases_at;
