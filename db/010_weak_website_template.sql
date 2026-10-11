-- ===========================================================================
--  A second opener for WEAK_WEBSITE leads - the 'default' template's claim
--  does not fit them
--
--  Found while drafting the first real batch of outreach: the only step-1
--  template says "noticed you don't seem to have your own website yet",
--  which select-outreach-candidates.sql was handing to WEAK_WEBSITE leads
--  too (they can qualify from the same lead_scores row as a confirmed gap).
--  A WEAK_WEBSITE business does have a site - telling them otherwise is a
--  factual error in the first sentence a prospect reads, which is exactly
--  the kind of mistake this project's own guard rails exist to prevent
--  elsewhere (see render-outreach-draft.js's guard comments). The pitch for
--  a weak site is "yours could work harder for you", not "you have none".
--
--  Kept as data, same as the original - changing which businesses get which
--  pitch is a row change, not a code change.
-- ===========================================================================

BEGIN;

INSERT INTO outreach_templates (slug, sequence_step, wait_days, subject, body, notes) VALUES
(
  'weak_website', 1, 0,
  'Question about the {{business_name}} website',
  'Hi{{greeting_name}},

We came across {{business_name}} while looking at {{business_type_plural}}{{in_city}} and had a look at your website. {{weak_reason}}

We''re a small web design team, and we rebuild sites like this so they''re fast and easy to use on a phone. If it helps, we can send you a short list of what is slowing it down and what we would change - at no cost.

Would that be useful?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'Opener for WEAK_WEBSITE leads. {{weak_reason}} states the MEASURED weakness (PageSpeed score, free-builder address), never a generic claim.'
),
(
  'weak_website', 2, 4,
  '{{business_name}} website - following up',
  'Hi{{greeting_name}},

Just following up on our note last week about the {{business_name}} website. We''re still happy to send over that short list of improvements if it would help - and if now isn''t the right time, no problem at all.

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'Follow-up for WEAK_WEBSITE leads, same cadence and reply-gate as the default sequence.'
),
(
  'weak_website', 3, 7,
  '{{business_name}} website',
  'Hi{{greeting_name}},

We haven''t heard back, so we''ll assume the website isn''t a priority right now - no problem at all, and this is the last you''ll hear from us.

If you''d like that short list of improvements for the {{business_name}} website later on, just reply "show me".

All the best with the business.

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'Step 3 for WEAK_WEBSITE leads, 7 days after step 2.'
)
ON CONFLICT (slug, sequence_step) DO UPDATE
  SET subject = EXCLUDED.subject, body = EXCLUDED.body, notes = EXCLUDED.notes;

INSERT INTO schema_migrations (version) VALUES ('010_weak_website_template')
ON CONFLICT (version) DO NOTHING;

COMMIT;
