-- ===========================================================================
--  platform_domains — hosts that are NOT an official website
--
--  A Maps listing whose website field points at one of these is still a
--  prospect. In several cases it is a BETTER prospect than an empty field,
--  because the owner has demonstrably tried to have a web presence and ended
--  up with something that does not work.
--
--  counts_as_social = true means "this is a real marketing channel they are
--  actively using" -> raises the lead score. false means it is a directory
--  listing somebody else created, or a dead link -> no score credit.
--
--  This is a table and not a constant in a Code node because the list changes.
--  business.site was a real website in 2023 and a dead link by June 2024.
-- ===========================================================================

BEGIN;

INSERT INTO platform_domains (domain, kind, counts_as_social, note) VALUES
  -- --- Social. Real channels; strong qualification signal. ---------------
  ('facebook.com',        'social', true,  'Very common as the only web presence for salons'),
  ('fb.com',              'social', true,  NULL),
  ('m.facebook.com',      'social', true,  NULL),
  ('instagram.com',       'social', true,  'Dominant for beauty/salon niches'),
  ('linkedin.com',        'social', true,  'Common for real-estate agencies'),
  ('twitter.com',         'social', true,  NULL),
  ('x.com',               'social', true,  NULL),
  ('tiktok.com',          'social', true,  NULL),
  ('youtube.com',         'social', true,  NULL),
  ('wa.me',               'social', true,  'WhatsApp click-to-chat, very common in the Gulf'),
  ('api.whatsapp.com',    'social', true,  NULL),
  ('t.me',                'social', true,  NULL),

  -- --- Link-in-bio. A page of links is not a website. --------------------
  ('linktr.ee',           'shortener', true,  'Link-in-bio; they have content but nowhere to host it'),
  ('linkin.bio',          'shortener', true,  NULL),
  ('beacons.ai',          'shortener', true,  NULL),
  ('bio.link',            'shortener', true,  NULL),
  ('bit.ly',              'shortener', false, 'Opaque; cannot be judged without following it'),

  -- --- Dead. Worse than nothing: the listing links somewhere broken. -----
  ('business.site',       'dead', false,
     'Google Business Profile websites switched off March 2024; redirect stopped June 2024'),
  ('negocio.site',        'dead', false, 'Spanish-language equivalent, same shutdown'),

  -- --- Free builder subdomains. A real site, but not their own domain. ---
  --     Still a lead: no custom domain, usually a template, often abandoned.
  ('wixsite.com',         'builder_subdomain', false, NULL),
  ('editorx.io',          'builder_subdomain', false, NULL),
  ('weebly.com',          'builder_subdomain', false, NULL),
  ('blogspot.com',        'builder_subdomain', false, NULL),
  ('wordpress.com',       'builder_subdomain', false, 'Free tier, not self-hosted'),
  ('sites.google.com',    'builder_subdomain', false, NULL),
  ('godaddysites.com',    'builder_subdomain', false, NULL),
  ('squarespace.com',     'builder_subdomain', false, 'Only the *.squarespace.com subdomain'),
  ('myshopify.com',       'builder_subdomain', false, NULL),
  ('webnode.com',         'builder_subdomain', false, NULL),
  ('jimdosite.com',       'builder_subdomain', false, NULL),
  ('mystrikingly.com',    'builder_subdomain', false, NULL),
  ('carrd.co',            'builder_subdomain', false, NULL),
  ('webflow.io',          'builder_subdomain', false, 'Unpublished/staging Webflow'),
  ('netlify.app',         'builder_subdomain', false, NULL),
  ('vercel.app',          'builder_subdomain', false, NULL),
  ('github.io',           'builder_subdomain', false, NULL),

  -- --- Directories. Somebody else made these. No credit at all. ---------
  ('yelp.com',            'directory', false, NULL),
  ('yellowpages.com',     'directory', false, NULL),
  ('yellowpages.ca',      'directory', false, 'Canada'),
  ('pagesjaunes.ca',      'directory', false, 'Canada, French'),
  ('justdial.com',        'directory', false, NULL),
  ('foursquare.com',      'directory', false, NULL),
  ('bbb.org',             'directory', false, NULL),
  ('paginegialle.it',     'directory', false, 'Italy'),
  ('paginasamarillas.es', 'directory', false, 'Spain'),
  ('gulesider.no',        'directory', false, 'Norway'),
  ('proff.no',            'directory', false, 'Norway, company register'),
  ('hitta.se',            'directory', false, 'Sweden'),
  ('eniro.se',            'directory', false, 'Sweden'),
  ('krak.dk',             'directory', false, 'Denmark'),
  ('yellowpages.ae',      'directory', false, 'UAE'),
  ('connect.ae',          'directory', false, 'UAE'),
  ('dubizzle.com',        'marketplace', false, 'Gulf classifieds; heavy in real estate'),
  ('bayut.com',           'marketplace', false, 'UAE property portal'),
  ('propertyfinder.ae',   'marketplace', false, 'UAE property portal'),
  ('idealista.com',       'marketplace', false, 'Spain/Italy/Portugal property portal'),
  ('idealista.it',        'marketplace', false, NULL),
  ('idealista.pt',        'marketplace', false, NULL),
  ('finn.no',             'marketplace', false, 'Norway; nearly all NO property listings'),
  ('hemnet.se',           'marketplace', false, 'Sweden property portal'),
  ('boliga.dk',           'marketplace', false, 'Denmark property portal'),
  ('realtor.ca',          'marketplace', false, 'Canada MLS'),
  ('zillow.com',          'marketplace', false, NULL),
  ('booksy.com',          'marketplace', false, 'Salon booking platform; very common as the only link'),
  ('fresha.com',          'marketplace', false, 'Salon booking platform'),
  ('treatwell.com',       'marketplace', false, 'Salon booking platform, EU'),
  ('vagaro.com',          'marketplace', false, 'Salon booking platform'),

  -- --- Review sites ------------------------------------------------------
  ('tripadvisor.com',     'review', false, NULL),
  ('trustpilot.com',      'review', false, NULL),
  ('google.com',          'review', false, 'A link back to their own Maps listing'),
  ('goo.gl',              'review', false, NULL),
  ('maps.app.goo.gl',     'review', false, NULL)
ON CONFLICT (domain) DO UPDATE
  SET kind = EXCLUDED.kind,
      counts_as_social = EXCLUDED.counts_as_social,
      note = EXCLUDED.note;

INSERT INTO schema_migrations (version) VALUES ('002_platform_domains')
ON CONFLICT (version) DO NOTHING;

COMMIT;
