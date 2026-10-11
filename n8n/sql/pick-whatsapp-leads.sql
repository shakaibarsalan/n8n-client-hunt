-- CH-07: hand the owner the next WhatsApp leads, and record that they were.
--
-- The best qualified leads with no email: no website (verified), a UAE mobile
-- number (+9715..., the ones on WhatsApp), never listed before, never
-- emailed. Best score first. UAE only: Norway's consent rule covers SMS and
-- WhatsApp to a sole trader exactly as it covers email - Oslo leads are for
-- calling, and stay on the call list.
--
-- The UPDATE marks them listed, so each digest brings new ones.

WITH latest_score AS (
  SELECT DISTINCT ON (business_id) business_id, total, qualified, needs_review
  FROM lead_scores
  ORDER BY business_id, scored_at DESC
),

pick AS (
  SELECT b.id
  FROM businesses b
  JOIN latest_score s ON s.business_id = b.id AND s.qualified AND NOT s.needs_review
  WHERE b.website_status IN ('NO_WEBSITE_CONFIRMED', 'NO_WEBSITE_LIKELY')
    AND (b.email IS NULL OR b.email = '')
    AND upper(b.country_code) = 'AE'
    AND b.phone_e164 LIKE '+9715%'
    AND b.phone_listed_at IS NULL
    AND NOT b.permanently_closed
    AND NOT EXISTS (SELECT 1 FROM outreach o WHERE o.business_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM suppression sup
                    WHERE sup.kind = 'phone' AND sup.value = b.phone_e164)
  ORDER BY s.total DESC, b.id
  LIMIT $1::int
)

UPDATE businesses b
   SET phone_listed_at = now()
  FROM pick
 WHERE b.id = pick.id
RETURNING b.id, b.name, b.city, b.phone_e164, b.category_primary, b.niche,
          b.google_place_id;
