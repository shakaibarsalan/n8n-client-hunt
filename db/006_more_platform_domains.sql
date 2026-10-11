-- ===========================================================================
--  More platform domains, and the reason they were missing
--
--  Found in the first 30 real businesses.
--
--  Overture holds a "website" for a salon in Oslo. The value is:
--
--      http://www.flickr.com/photos/<the-salon's-album>/
--
--  That is a photo-sharing profile. Stage B would have read it as proof of a
--  website, classified the business HAS_WEBSITE, and dropped a genuine
--  prospect - a one-person beauty business whose entire web presence is a
--  Flickr album is about as good a lead as this project can hope to find.
--
--  The list built from reasoning covered social networks, directories and
--  booking platforms. It did not cover PORTFOLIO and PHOTO hosting, because
--  nobody sitting down to imagine "places a business might put a link"
--  thinks of Flickr. Real data did.
-- ===========================================================================

BEGIN;

INSERT INTO platform_domains (domain, kind, counts_as_social, note) VALUES
  -- --- Photo and portfolio hosting. Found in live Overture data. ----------
  ('flickr.com',        'social', true,
     'Found as the "website" for an Oslo salon. A photo album is not a site.'),
  ('behance.net',       'social', true,  'Portfolio hosting'),
  ('dribbble.com',      'social', true,  NULL),
  ('pinterest.com',     'social', true,  'Common for salons and interiors'),
  ('issuu.com',         'social', false, 'Published PDFs, not a site'),
  ('500px.com',         'social', true,  NULL),
  ('smugmug.com',       'social', true,  NULL),
  ('imgur.com',         'social', false, NULL),

  -- --- Documents and forms standing in for a website ----------------------
  ('docs.google.com',   'builder_subdomain', false, 'A Google Doc is not a website'),
  ('drive.google.com',  'builder_subdomain', false, NULL),
  ('forms.gle',         'builder_subdomain', false, NULL),
  ('notion.site',       'builder_subdomain', false, 'Published Notion page'),
  ('notion.so',         'builder_subdomain', false, NULL),
  ('canva.site',        'builder_subdomain', false, NULL),
  ('framer.website',    'builder_subdomain', false, NULL),
  ('super.site',        'builder_subdomain', false, NULL),
  ('mailchi.mp',        'builder_subdomain', false, 'Mailchimp landing page'),
  ('campaign-archive.com', 'builder_subdomain', false, NULL),

  -- --- More booking platforms, which dominate the salon niche -------------
  ('simplybook.it',     'marketplace', false, NULL),
  ('setmore.com',       'marketplace', false, NULL),
  ('square.site',       'marketplace', false, NULL),
  ('squareup.com',      'marketplace', false, NULL),
  ('timma.no',          'marketplace', false, 'Norwegian salon booking - heavy in Oslo'),
  ('timma.fi',          'marketplace', false, NULL),
  ('bestilletime.no',   'marketplace', false, 'Norwegian booking'),
  ('easypractice.net',  'marketplace', false, NULL),
  ('planway.com',       'marketplace', false, NULL),
  ('bokadirekt.se',     'marketplace', false, 'Swedish salon booking'),

  -- --- Messaging and maps shorteners --------------------------------------
  ('m.me',              'social', true,  'Messenger click-to-chat'),
  ('snapchat.com',      'social', true,  NULL),
  ('threads.net',       'social', true,  NULL),
  ('g.page',            'review', false, 'Google Business Profile short link'),
  ('business.google.com', 'review', false, NULL)
ON CONFLICT (domain) DO UPDATE
  SET kind = EXCLUDED.kind,
      counts_as_social = EXCLUDED.counts_as_social,
      note = EXCLUDED.note;

INSERT INTO schema_migrations (version) VALUES ('006_more_platform_domains')
ON CONFLICT (version) DO NOTHING;

COMMIT;
