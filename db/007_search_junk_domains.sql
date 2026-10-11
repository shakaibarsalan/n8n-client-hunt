-- ===========================================================================
--  Hosts a web search offers that are not the business's website
--
--  Every domain here was actually returned by Serper as the top non-social
--  result for one of the first 30 Oslo salons, and was accepted by Stage C as
--  a candidate worth probing:
--
--      Salon I                         -> yandex.ru
--      Salon J                         -> arounddeal.com
--      Salon K                         -> io.no
--      OSLO                            -> en.wikipedia.org
--      Salon F                         -> 1881.no
--      Salon G                         -> cybo.com
--
--  (Salons labelled as in docs/POC-RESULTS.md; the real names are not kept.)
--
--  None of these cost a wrong verdict on their own - Stage D probed each one
--  and refused it - but every one burned up to eight HTTP fetches proving
--  something the domain name already said. The probe budget is the scarce
--  resource in verification, and spending it on Wikipedia is waste.
--
--  The original list was built by imagining where a business might put a link.
--  This one is built from where a SEARCH ENGINE actually points when a small
--  business has no site: aggregators, phone books and data brokers, because
--  that is all there is to find.
-- ===========================================================================

BEGIN;

INSERT INTO platform_domains (domain, kind, counts_as_social, note) VALUES
  -- --- Search engines and encyclopedias ----------------------------------
  ('yandex.ru',        'directory', false, 'Returned as a top result for an Oslo salon'),
  ('yandex.com',       'directory', false, NULL),
  ('bing.com',         'directory', false, NULL),
  ('duckduckgo.com',   'directory', false, NULL),
  ('wikipedia.org',    'directory', false, 'Matched a business literally named "OSLO"'),
  ('wikidata.org',     'directory', false, NULL),

  -- --- Data brokers and lead resellers -----------------------------------
  ('arounddeal.com',   'directory', false, 'Contact-data broker'),
  ('rocketreach.co',   'directory', false, NULL),
  ('zoominfo.com',     'directory', false, NULL),
  ('apollo.io',        'directory', false, NULL),
  ('lusha.com',        'directory', false, NULL),
  ('signalhire.com',   'directory', false, NULL),
  ('leadiq.com',       'directory', false, NULL),

  -- --- Global business aggregators, the largest source of noise ----------
  ('cybo.com',         'directory', false, 'Auto-generated listing pages, worldwide'),
  ('cylex.net',        'directory', false, NULL),
  ('cylex.no',         'directory', false, NULL),
  ('tuugo.net',        'directory', false, NULL),
  ('opendi.no',        'directory', false, NULL),
  ('opendi.com',       'directory', false, NULL),
  ('hotfrog.com',      'directory', false, NULL),
  ('brownbook.net',    'directory', false, NULL),
  ('yably.no',         'directory', false, NULL),
  ('nicelocal.com',    'directory', false, NULL),
  ('bizify.co.uk',     'directory', false, NULL),
  ('company-list.org', 'directory', false, NULL),
  ('infobel.com',      'directory', false, NULL),
  ('wanderlog.com',    'directory', false, NULL),
  ('trustpilot.no',    'review',    false, NULL),

  -- --- Nordic phone books and registries ---------------------------------
  ('1881.no',          'directory', false, 'Norwegian phone book - the dominant noise result'),
  ('180.no',           'directory', false, NULL),
  ('gulesider.dk',     'directory', false, NULL),
  ('digitalarkivet.no','directory', false, NULL),
  ('brreg.no',         'directory', false, 'Norwegian company register'),
  ('purehelp.no',      'directory', false, NULL),
  ('regnskapstall.no', 'directory', false, NULL),
  ('bizweb.no',        'directory', false, NULL),
  ('enhetsregisteret.no', 'directory', false, NULL),
  ('allabolag.se',     'directory', false, 'Swedish company register'),
  ('ratsit.se',        'directory', false, NULL),
  ('degulesider.dk',   'directory', false, NULL),
  ('proff.se',         'directory', false, NULL),
  ('proff.dk',         'directory', false, NULL),

  -- --- Niche aggregators. These are the dangerous ones: a directory OF
  --     salons contains exactly the words a salon's own site would.
  ('neglesalonger.com','directory', false,
     'Norwegian for "nail salons". A directory of salons naturally contains the same words a salon site does, which is why Stage D accepted it for a lash-and-foot-spa salon.'),
  ('frisorer.no',      'directory', false, NULL),
  ('salonger.no',      'directory', false, NULL),
  ('skjonnhet.no',     'directory', false, NULL),
  ('behandling.no',    'directory', false, NULL),
  ('salonfinder.no',   'directory', false, NULL),

  -- --- Gulf and Southern European equivalents, added now rather than after
  --     they cost a run.
  ('yellowpages-uae.com', 'directory', false, NULL),
  ('uaecontact.com',   'directory', false, NULL),
  ('dubaiyellowpages.com','directory', false, NULL),
  ('paginebianche.it', 'directory', false, NULL),
  ('11880.com',        'directory', false, NULL),
  ('einforma.com',     'directory', false, NULL),
  ('axesor.es',        'directory', false, NULL),
  ('racius.com',       'directory', false, 'Portuguese company register'),
  ('canada411.ca',     'directory', false, NULL),
  ('opencorporates.com','directory', false, NULL)
ON CONFLICT (domain) DO UPDATE
  SET kind = EXCLUDED.kind,
      counts_as_social = EXCLUDED.counts_as_social,
      note = EXCLUDED.note;

INSERT INTO schema_migrations (version) VALUES ('007_search_junk_domains')
ON CONFLICT (version) DO NOTHING;

COMMIT;
