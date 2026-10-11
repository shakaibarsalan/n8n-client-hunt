-- ===========================================================================
--  One person writing to one business
--
--  6 Oct 2026, the owner: the mail should read as one person writing to one
--  person, signed by a named person at the company rather than by the team.
--  A cold email signed by a team reads like a campaign; one signed by a
--  person, in the first person, reads like a message. So every step is now
--  "I", signed "<first name> / <company>" - "Alex / Example Web Studio" in
--  this public copy; put your own here and in CH-05's from_name. "We" stays only where it means the company's
--  work ("what we can create").
--
--  Runs after 013 and 014, which set the earlier wording on every deploy;
--  this sets the current wording last. Re-runnable.
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE v (slug text, step int, subject text, body text) ON COMMIT DROP;

INSERT INTO v VALUES
('default', 1,
 'Idea for {{business_name}}',
 'Hi{{greeting_name}},

I came across {{business_name}} while looking at {{business_type_plural}}{{in_city}}{{social_note}}, but I couldn''t find a website for you.

Most customers look a business up on their phone first, and a simple site with what you offer and where to find you helps them choose you.

I''d be happy to put together a quick website concept for {{business_name}}, so you can see how it could look before you decide anything.

Would you like me to send it over?'),
('default', 2,
 'Re: {{first_subject}}',
 'Hi{{greeting_name}},

Just bringing this back to the top of your inbox. The website concept for {{business_name}} would take you a minute to look at - no call or meeting needed.

Would you like me to send it over?'),
('default', 3,
 'Re: {{first_subject}}',
 'Hi{{greeting_name}},

I''ll make this my last message so I don''t fill up your inbox.

If improving {{business_name}}''s online presence is something you''re considering, I''d be happy to show you what we can create. If it''s not something you need right now, no worries at all.

If you''d like to see a concept, just reply "show me".

Thanks for your time.'),
('weak_website', 1,
 '{{business_name}} website',
 'Hi{{greeting_name}},

I came across {{business_name}} while looking at {{business_type_plural}}{{in_city}} and had a look at your website. {{weak_reason}}

I work with a small web design team, and we rebuild sites like this so they''re fast and easy to use on a phone. If it helps, I can send you a short list of what is slowing it down and what I would change - at no cost.

Would that be useful?'),
('weak_website', 2,
 'Re: {{first_subject}}',
 'Hi{{greeting_name}},

Just following up on my note last week about the {{business_name}} website. I''m still happy to send over that short list of improvements if it would help - and if now isn''t the right time, no problem at all.'),
('weak_website', 3,
 'Re: {{first_subject}}',
 'Hi{{greeting_name}},

I haven''t heard back, so I''ll assume the website isn''t a priority right now - no problem at all, and this is the last you''ll hear from me.

If you''d like that short list of improvements for the {{business_name}} website later on, just reply "show me".

All the best with the business.'),
('dead_google_site', 1,
 '{{business_name}} website',
 'Hi{{greeting_name}},

I came across {{business_name}} while looking at {{business_type_plural}}{{in_city}}. The website listed for you online is one of Google''s free business websites - and Google shut all of those down in 2024, so anyone who clicks it now lands on an error page.

I''d be happy to put together a quick concept for a proper website for {{business_name}}, so you can see how it could look before you decide anything.

Would you like me to send it over?'),
('dead_google_site', 2,
 'Re: {{first_subject}}',
 'Hi{{greeting_name}},

Just bringing this back to the top of your inbox. People who find {{business_name}} online and tap the old website link still land on an error page - the concept would show you what could be there instead, no call or meeting needed.

Would you like me to send it over?'),
('dead_google_site', 3,
 'Re: {{first_subject}}',
 'Hi{{greeting_name}},

I''ll make this my last message so I don''t fill up your inbox.

If replacing the old Google website for {{business_name}} is something you''re considering, I''d be happy to show you what we can create. If it''s not something you need right now, no worries at all.

If you''d like to see a concept, just reply "show me".

Thanks for your time.');

UPDATE outreach_templates t SET
  subject = v.subject,
  body = v.body || '

Best regards,
Alex
Example Web Studio

If you''d rather not hear from me, just reply "no" and I won''t contact you again.',
  notes = 'First person, signed by one named sender (owner''s choice, 6 Oct 2026).',
  updated_at = now()
FROM v
WHERE t.slug = v.slug AND t.sequence_step = v.step;

INSERT INTO schema_migrations (version) VALUES ('015_one_to_one_voice')
ON CONFLICT (version) DO NOTHING;

COMMIT;
