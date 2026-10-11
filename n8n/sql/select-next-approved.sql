-- CH-05: the next message a human has approved to send.
--
-- Re-checks suppression and closure AT SEND TIME, not just at draft time -
-- the two can be minutes or weeks apart, and a suppression added after a
-- draft was approved must still stop the send. Restating every precondition
-- at the point of sending is deliberate, from the job-hunt project's own
-- brake: "it belongs here rather than only upstream: this is the last place
-- before an email leaves, so a mistake anywhere earlier still cannot produce
-- a second copy."

SELECT
  o.id, o.business_id, o.to_email, o.subject, o.body, o.sequence_step,
  b.name AS business_name, b.country_code, b.is_natural_person, b.permanently_closed,
  -- Where the address came from: the mailbox check trusts a catch-all domain
  -- only for an address printed on the business's own website.
  b.raw ->> 'email_source' AS email_source,
  EXISTS (
    SELECT 1 FROM suppression sup
    WHERE (sup.kind = 'email' AND lower(sup.value) = lower(o.to_email))
       OR (sup.kind = 'place_id' AND sup.value = b.google_place_id)
  ) AS now_suppressed
FROM outreach o
JOIN businesses b ON b.id = o.business_id
WHERE o.status = 'approved'
-- Best leads first: with a daily cap, the order decides who hears from us
-- at all. Highest current lead score, then the longest-waiting.
ORDER BY (SELECT s.total FROM lead_scores s WHERE s.business_id = o.business_id
          ORDER BY s.scored_at DESC LIMIT 1) DESC NULLS LAST,
         o.approved_at ASC
LIMIT 25;
