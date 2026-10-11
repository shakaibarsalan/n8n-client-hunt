-- ===========================================================================
--  A pitch for businesses whose listed "website" is a Google business.site
--  page
--
--  Google shut down every Business Profile website in 2024; a business.site
--  link now ends on an error page. The open data still lists them for about
--  300 businesses in the target niches with an email, and CH-00 now takes
--  them in (insert-open-data-leads.sql). For these the first line can be a
--  fact the reader can check in ten seconds, instead of a general claim.
--  The page's address is not written out: a domain in the text becomes a
--  link, and this outreach carries none.
--
--  Re-runnable: deploy.sh applies every migration on every deploy.
-- ===========================================================================

BEGIN;

INSERT INTO outreach_templates (slug, sequence_step, wait_days, subject, body, notes) VALUES
(
  'dead_google_site', 1, 0,
  '{{business_name}} website',
  'Hi{{greeting_name}},

We came across {{business_name}} while looking at {{business_type_plural}}{{in_city}}. The website listed for you online is one of Google''s free business websites - and Google shut all of those down in 2024, so anyone who clicks it now lands on an error page.

We''d be happy to put together a quick concept for a proper website for {{business_name}}, so you can see how it could look before you decide anything.

Would you like us to send it over?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'For leads whose listed website is a business.site page (shut down by Google in 2024).'
),
(
  'dead_google_site', 2, 4,
  'Re: {{first_subject}}',
  'Hi{{greeting_name}},

Just bringing this back to the top of your inbox. People who find {{business_name}} online and tap the old website link still land on an error page - the concept would show you what could be there instead, no call or meeting needed.

Would you like us to send it over?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  NULL
),
(
  'dead_google_site', 3, 7,
  'Re: {{first_subject}}',
  'Hi{{greeting_name}},

We''ll make this our last message so we don''t fill up your inbox.

If replacing the old Google website for {{business_name}} is something you''re considering, we''d be happy to show you what we can create. If it''s not something you need right now, no worries at all.

If you''d like to see a concept, just reply "show me".

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  NULL
)
ON CONFLICT (slug, sequence_step) DO UPDATE SET
  wait_days = EXCLUDED.wait_days, subject = EXCLUDED.subject, body = EXCLUDED.body,
  notes = EXCLUDED.notes, updated_at = now();

INSERT INTO schema_migrations (version) VALUES ('014_dead_google_site_template')
ON CONFLICT (version) DO NOTHING;

COMMIT;
