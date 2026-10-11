-- ===========================================================================
--  A shorter opener, subjects that are not questions, and follow-ups that
--  arrive in the same thread
--
--  From the 6 Oct 2026 review of published cold-email data:
--  * Openers under about 80 words get more replies; the bullet list made the
--    default opener read like a brochure (Instantly 2026 benchmark).
--  * Short subjects carrying the business name, not phrased as a question
--    (Hunter, State of Cold Email).
--  * A follow-up that reads as a reply in the same conversation does better
--    than a new email (Instantly). Subject 'Re: ' + the subject the first
--    message ACTUALLY went out with - {{first_subject}}, filled from the
--    sent step-1 row, so the follow-up quotes exactly what was sent.
--
--  The owner's own wording and offer (a free website concept, "reply no")
--  are kept; what changed is length and the subject line.
--
--  Re-runnable: deploy.sh applies every migration on every deploy, and these
--  UPDATEs set the same values each time.
-- ===========================================================================

BEGIN;

UPDATE outreach_templates SET
  subject = 'A quick idea for {{business_name}}',
  body = 'Hi{{greeting_name}},

We came across {{business_name}} while looking at {{business_type_plural}}{{in_city}}{{social_note}}, but we couldn''t find a website for you.

Most customers look a business up on their phone first, and a simple site with what you offer and where to find you helps them choose you.

We''d be happy to put together a quick website concept for {{business_name}}, so you can see how it could look before you decide anything.

Would you like us to send it over?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  notes = 'Shortened 6 Oct 2026: bullet list removed, subjects no longer questions.',
  updated_at = now()
WHERE slug = 'default' AND sequence_step = 1;

UPDATE outreach_templates SET
  subject = 'Re: {{first_subject}}',
  body = 'Hi{{greeting_name}},

Just bringing this back to the top of your inbox. The website concept for {{business_name}} would take you a minute to look at - no call or meeting needed.

Would you like us to send it over?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  notes = 'Shortened 6 Oct 2026; sent as a reply in the first message''s thread.',
  updated_at = now()
WHERE slug = 'default' AND sequence_step = 2;

UPDATE outreach_templates SET
  subject = 'Re: {{first_subject}}',
  updated_at = now()
WHERE (slug = 'default' AND sequence_step = 3)
   OR (slug = 'weak_website' AND sequence_step IN (2, 3));

UPDATE outreach_templates SET
  subject = '{{business_name}} website',
  updated_at = now()
WHERE slug = 'weak_website' AND sequence_step = 1;

INSERT INTO schema_migrations (version) VALUES ('013_shorter_opener_threaded_followups')
ON CONFLICT (version) DO NOTHING;

COMMIT;
