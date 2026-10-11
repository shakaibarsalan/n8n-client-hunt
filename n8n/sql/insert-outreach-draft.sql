-- CH-04: store the drafted message.
--
-- ON CONFLICT DO NOTHING, not DO UPDATE. The unique index on
-- (business_id, sequence_step) means a re-run of CH-04 cannot draft the same
-- step twice - but if it already exists, a human may have since moved it to
-- 'approved' or 'needs_review' with their own notes, and this must never
-- overwrite that. A re-drafted message replacing one a human already acted on
-- is the outreach equivalent of the job-hunt project's "Flow 02 mapped
-- Status: 'queued' and reset rows already marked sent."
--
-- Auto-approval (the tenth parameter, CH-04's Config auto_approve): a draft
-- that passed EVERY guard in render-outreach-draft.js goes straight to
-- 'approved', which is what CH-05 sends from. Anything a guard held stays
-- 'needs_review' whatever this flag says - a natural person in a consent
-- country, an address that may belong to someone else, an unfilled
-- placeholder. Switching auto_approve off returns to drafting for a human.

INSERT INTO outreach
  (business_id, template_id, sequence_step, to_email, subject, body, status,
   review_reason, guard_flags, approved_at, approved_by)
VALUES
  ($1, $2, $3, $4, $5, $6,
   CASE WHEN $7 = 'draft' AND $10::boolean THEN 'approved' ELSE $7 END,
   $8, $9::jsonb,
   CASE WHEN $7 = 'draft' AND $10::boolean THEN now() END,
   CASE WHEN $7 = 'draft' AND $10::boolean THEN 'auto: passed every CH-04 guard' END)
ON CONFLICT (business_id, sequence_step) DO NOTHING
RETURNING id, status;
