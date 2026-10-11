-- ===========================================================================
--  Outreach: templates, the send queue, and the consent guard.
--
--  Nothing in this migration causes a single email to go out. There is no
--  scheduled trigger anywhere in the workflow that uses this schema (see
--  n8n/templates/CH-04-send-approved.json) - sending an email requires a
--  human to click a manual trigger, after a human has marked the row
--  'approved'. That is deliberate, for two independent reasons:
--
--    1. Zero of the 30 leads discovered so far have an email address at all.
--       Discovering one is Stage F's job, not this migration's.
--
--    2. Roughly 40% of a small-salon list trades under a person's own name
--       (a Norwegian enkeltpersonforetak, commonly). Norway's Marketing
--       Control Act section 15 requires PRIOR CONSENT to email a natural
--       person - a different rule than emailing a company mailbox. Nothing
--       here can know whether consent exists, so the safe default is to flag
--       and hold, never to send.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
--  1. outreach_templates - the message, as data
--
--  Kept out of any Code node on purpose, for the same reason niche and city
--  are rows and not constants: changing the pitch must not mean editing and
--  reimporting a workflow. sequence_step orders a short drip (1 = opener,
--  2 = follow-up) and wait_days sets the gap CH-03 uses to decide when the
--  next step in the sequence is due.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_templates (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT NOT NULL,
  sequence_step INT NOT NULL DEFAULT 1,
  wait_days     INT NOT NULL DEFAULT 0,   -- days after the PREVIOUS step
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,            -- {{placeholders}}, see render-outreach-draft.js
  active        BOOLEAN NOT NULL DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_templates_slug_step
  ON outreach_templates (slug, sequence_step);

-- ---------------------------------------------------------------------------
--  2. outreach - one row per drafted or sent message
--
--  Status is the state machine CH-03/CH-04/CH-05 move a row through:
--
--    draft        CH-03 wrote it. Nobody has looked at it yet.
--    needs_review CH-03 flagged something - a natural person, no email found
--                 for the earlier step, or a guard check failed.
--    approved     a HUMAN set this. The only status CH-04 will ever send.
--    sent         CH-04 sent it.
--    bounced      CH-05 (IMAP) saw a bounce for this address.
--    replied      CH-05 saw a reply.
--    skipped      superseded - e.g. step 2 was queued but step 1 got a reply.
--
--  The unique index on (business_id, sequence_step) is what makes "have we
--  already drafted step 2 for this business" a plain lookup, and what stops
--  a re-run of CH-03 from drafting the same step twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id       BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_id       BIGINT REFERENCES outreach_templates(id),
  sequence_step     INT NOT NULL DEFAULT 1,

  to_email          TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,

  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'needs_review', 'approved', 'sent',
                      'bounced', 'replied', 'skipped')),
  review_reason     TEXT,        -- why it needs a human, when it does

  -- guard_flags is the audit trail for render-outreach-draft.js: which
  -- checks ran and what each one found, so a rejection can be explained
  -- without re-deriving it.
  guard_flags       JSONB NOT NULL DEFAULT '{}',

  send_not_before   TIMESTAMPTZ,  -- per-recipient-region window, set at draft time
  message_id        TEXT,         -- the RFC Message-ID, for matching replies

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  approved_by       TEXT,
  sent_at           TIMESTAMPTZ,
  reply_at          TIMESTAMPTZ,
  reply_excerpt     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_outreach_business_step
  ON outreach (business_id, sequence_step);
CREATE INDEX IF NOT EXISTS ix_outreach_status ON outreach (status);
-- What CH-04 selects from: approved rows whose window has opened.
CREATE INDEX IF NOT EXISTS ix_outreach_ready
  ON outreach (send_not_before) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS ix_outreach_email ON outreach (lower(to_email));

-- ---------------------------------------------------------------------------
--  3. Natural-person detection, on the business itself
--
--  Computed once by Stage F / CH-03's guard and cached here, rather than
--  recomputed inline in a query, so the reasoning is inspectable on the
--  business row itself and does not have to be re-derived to explain a hold.
-- ---------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_natural_person BOOLEAN;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS natural_person_reason TEXT;

COMMENT ON COLUMN businesses.is_natural_person IS
  'True when the business name appears to embed a real person''s name rather than a trading name - e.g. "Nail IT! Kari Marie Nordmann". NULL means not yet evaluated. Drives the consent hold in consent_required_countries.';

-- ---------------------------------------------------------------------------
--  4. Which countries require prior consent to email a natural person
--
--  Table, not a hardcoded list in JavaScript, for the reason every other
--  jurisdiction-dependent fact in this project is a table: the set of
--  countries and the citation should be editable without touching a node.
--
--  Norway is seeded because it is a live target and the rule is confirmed
--  (Marketing Control Act s.15, prior consent for electronic marketing to a
--  natural person). Absence from this table is NOT legal advice that a
--  country is safe - it means nobody has checked it yet, and CH-03 treats an
--  unlisted country as requiring a hold too (see render-outreach-draft.js),
--  which is the fail-closed direction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consent_required_countries (
  country_code TEXT PRIMARY KEY,   -- lowercase ISO-2, matches search_targets.country_code
  law          TEXT NOT NULL,
  note         TEXT
);

INSERT INTO consent_required_countries (country_code, law, note) VALUES
  ('no', 'Marketing Control Act s.15',
   'Prior consent required for electronic marketing to a natural person. A business mailbox reached as a legal person is treated differently, but a sole-proprietor listing usually IS the natural person.'),
  ('se', 'Marketing Act (Marknadsforingslagen)',
   'Same shape as Norway - opt-in for natural persons, softer for B2B.'),
  ('dk', 'Marketing Practices Act s.10', 'Opt-in for natural persons.'),
  ('ca', 'CASL',
   'Implied consent from an existing business relationship is not available to a cold approach. Strict - identification and working unsubscribe required regardless of recipient type.')
ON CONFLICT (country_code) DO UPDATE SET law = EXCLUDED.law, note = EXCLUDED.note;

-- ---------------------------------------------------------------------------
--  5. Seed the two templates you supplied, lightly restructured.
--
--  What changed and why:
--
--  * Your text ("Last message from me...") is a FOLLOW-UP - it refers to
--    prior messages ("so I don't fill up your inbox"). There was no opener
--    to follow up ON, so it is seeded as step 2, and a step-1 opener is
--    added ahead of it. A sequence that starts with "last message" reads as
--    a mistake to the very first person who receives it.
--  * "[Business Name]" and "[First Name]" become {{business_name}} and
--    {{first_name}} - the placeholder syntax render-outreach-draft.js
--    actually substitutes, matching {{ }} used everywhere else in this
--    project (n8n expressions, the SQL templates).
--  * first_name is frequently unknown for a Maps listing (most of these
--    businesses have no named contact at all) - the template is written to
--    read naturally with a generic "Hi there," fallback, and
--    render-outreach-draft.js is the thing that decides which to use.
-- ---------------------------------------------------------------------------
INSERT INTO outreach_templates (slug, sequence_step, wait_days, subject, body, notes) VALUES
(
  'default', 1, 0,
  'A quick idea for {{business_name}}',
  'Hi{{greeting_name}},

We came across {{business_name}} while looking at {{business_type_plural}}{{in_city}}{{social_note}}, but we couldn''t find a website for you - so we had a quick idea.

You''re already doing the hard part - running the business. A simple, modern website would let new customers:

- see what you offer
- find your location and contact details
- get in touch or book with you directly

We''d love to put together a quick website concept for {{business_name}}, so you can see how it could look before you decide anything.

Would you like us to send you a quick example?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'Opener for NO_WEBSITE leads. Merged 5 Oct 2026: the owner''s template (the "quick idea" subject, "you''re already doing the hard part", the benefits list) with the deliverability rules - plain text, no links, no "free" / "no obligation" / "no commitment", an opt-out line, signed by the company as "we".'
),
(
  'default', 2, 4,
  '{{business_name}} - following up',
  'Hi{{greeting_name}},

Just following up on our email last week.

We had another look at {{business_name}}, and we genuinely think there''s an opportunity to give it a much stronger online presence.

We can create a quick visual concept for {{business_name}} so you can see exactly what we have in mind - before you decide whether you want to do anything.

Would you like us to send it over?

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'Follow-up, 4 days after step 1, from the owner''s template. No "Re:" - this is a new message, not a reply, and a fake reply prefix is a spam signal.'
),
(
  'default', 3, 7,
  'Last message from us',
  'Hi{{greeting_name}},

We''ll make this our last message so we don''t fill up your inbox.

If improving {{business_name}}''s online presence is something you''re considering, we''d be happy to show you what we can create.

If it''s not something you need right now, no worries at all.

If you''d like to see a concept, just reply "show me".

Either way, thanks for your time.

Best regards,
The Example Web Studio team

If you''d rather not hear from us, just reply "no" and we won''t contact you again.',
  'The owner''s original "last message", 7 days after step 2, without "free". "Reply show me" makes answering a one-word effort.'
)
ON CONFLICT (slug, sequence_step) DO UPDATE
  SET subject = EXCLUDED.subject, body = EXCLUDED.body, notes = EXCLUDED.notes;

INSERT INTO schema_migrations (version) VALUES ('009_outreach_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
