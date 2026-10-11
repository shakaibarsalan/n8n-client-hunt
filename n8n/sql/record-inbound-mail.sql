-- CH-06: record a reply or a bounce against the message it answers.
--
-- Parameters, in order: kind ('reply' | 'bounce'), the sender's address, the
-- Message-IDs the mail refers to (space-separated, without angle brackets),
-- an excerpt, and - for a bounce - every address quoted in the report.
--
-- A row is matched three ways, any one of which is enough:
--   * by Message-ID: In-Reply-To / References name the exact message we sent.
--     This is the one that catches an owner replying from a different
--     address than the one we wrote to.
--   * a reply FROM the address we wrote to.
--   * a bounce whose report quotes the address we wrote to.
--
-- Only rows with status 'sent' are ever touched. That makes this safe to run
-- on any mail at all - a newsletter, a test, the same reply seen twice - since
-- anything that does not answer a message we actually sent matches nothing,
-- and a row already marked replied is not 'sent' any more.
--
-- A reply or a bounce ends the sequence: a later step still waiting as a
-- draft, held, or even approved is skipped, so nobody who has answered gets
-- "I'll make this my last message" four days later. A bounced address is
-- also suppressed, so no future draft can reuse it.

WITH mail AS (
  SELECT
    $1::text                                          AS kind,
    lower(NULLIF($2::text, ''))                       AS from_address,
    string_to_array(lower(NULLIF($3::text, '')), ' ') AS message_ids,
    NULLIF($4::text, '')                              AS excerpt,
    string_to_array(lower(NULLIF($5::text, '')), ' ') AS bounce_addresses
),

matched AS (
  SELECT o.id
  FROM outreach o, mail m
  WHERE o.status = 'sent'
    AND (
         (o.message_id IS NOT NULL
            AND lower(trim(both '<>' from o.message_id)) = ANY (m.message_ids))
      OR (m.kind = 'reply'  AND lower(o.to_email) = m.from_address)
      OR (m.kind = 'bounce' AND lower(o.to_email) = ANY (m.bounce_addresses))
    )
),

marked AS (
  UPDATE outreach o SET
    status        = CASE WHEN m.kind = 'bounce' THEN 'bounced' ELSE 'replied' END,
    reply_at      = now(),
    reply_excerpt = left(m.excerpt, 1000)
  FROM mail m
  WHERE o.id IN (SELECT id FROM matched)
  RETURNING o.id, o.business_id, o.to_email, o.status, o.sequence_step, o.reply_excerpt,
            o.subject, o.template_id
),

stopped AS (
  UPDATE outreach o SET
    status        = 'skipped',
    review_reason = 'sequence stopped: an earlier message to this business got a '
                    || (SELECT CASE WHEN kind = 'bounce' THEN 'bounce' ELSE 'reply' END FROM mail)
  WHERE o.business_id IN (SELECT business_id FROM marked)
    AND o.status IN ('draft', 'needs_review', 'approved')
  RETURNING o.id
),

suppressed AS (
  INSERT INTO suppression (kind, value, reason)
  SELECT 'email', lower(mk.to_email), 'bounced on ' || to_char(now(), 'YYYY-MM-DD')
  FROM marked mk
  WHERE mk.status = 'bounced'
  ON CONFLICT (kind, lower(value)) DO NOTHING
  RETURNING id
)

SELECT
  mk.id AS outreach_id, mk.status, mk.to_email, mk.sequence_step, mk.reply_excerpt,
  b.name AS business_name, b.city,
  -- What the suggested answer needs (ch06-draft-reply.js): what kind of
  -- business, which pitch they answered, and the id /concept takes.
  mk.business_id, b.category_primary, b.niche, mk.subject,
  (SELECT t.slug FROM outreach_templates t WHERE t.id = mk.template_id) AS pitch,
  (SELECT count(*) FROM stopped)    AS later_steps_stopped,
  (SELECT count(*) FROM suppressed) AS newly_suppressed
FROM marked mk
JOIN businesses b ON b.id = mk.business_id
-- Only replies come back for an instant Telegram message - a person answered,
-- and that must not wait. Bounces are recorded and suppressed above either
-- way, and reported in CH-07's twice-daily digest.
WHERE mk.status = 'replied';
