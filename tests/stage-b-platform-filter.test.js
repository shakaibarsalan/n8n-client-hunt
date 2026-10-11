// Stage B must be as sceptical about the open datasets as Stage A is about
// Google.
//
// Every case here comes from the first 30 real businesses (the business name
// and its URLs are fictional stand-ins). The Flickr one is the reason this
// file exists: Overture genuinely holds
//
//     http://www.flickr.com/photos/<the-salon's-album>/
//
// as the website of a one-person beauty business in Oslo. Believing it meant
// classifying that business HAS_WEBSITE and dropping it - and a business whose
// entire web presence is a photo album is about the best prospect this project
// can find. The filter existed; it was only being applied to one of the two
// sources.

const { compile, ok, eq, done } = require('./helpers');

const merge = compile('CH-02-verify.json', 'Stage B: what do the free datasets say?', {
  $input: null, $: null,
});

// A slice of the real platform_domains table.
const PLATFORMS = [
  { domain: 'flickr.com', kind: 'social', counts_as_social: true, active: true },
  { domain: 'facebook.com', kind: 'social', counts_as_social: true, active: true },
  { domain: 'timma.no', kind: 'marketplace', counts_as_social: false, active: true },
  { domain: 'wixsite.com', kind: 'builder_subdomain', counts_as_social: false, active: true },
  { domain: 'business.site', kind: 'dead', counts_as_social: false, active: true },
  { domain: 'retired.example', kind: 'social', counts_as_social: true, active: false },
];

const biz = (over) => ({
  google_place_id: 'p1', name: 'Glow beauty', name_norm: 'glow beauty',
  city: 'Oslo', social_profiles: {}, website_checks: [],
  stage_a_claim: 'absent', stage_a_social_only: false, ...over,
});

const answer = (over) => ({
  place_id: 'p1', matched: true, best_match_rank: 1,
  website: '', socials: [], looks_closed: false,
  min_confidence: 0.9, sources: ['overture'], ...over,
});

const run = async (b, a) => {
  const out = await merge({
    $input: { all: () => (a ? [{ json: a }] : []) },
    $: (name) => ({
      all: () => (name === 'Load platform domains'
        ? PLATFORMS.map((json) => ({ json }))
        : [{ json: b }]),
    }),
  });
  return out[0].json;
};

(async () => {
  console.log('stage B: platform filter on the dataset answer\n');

  // --- THE case ------------------------------------------------------------
  {
    const r = await run(biz(), answer({ website: 'http://www.flickr.com/photos/glowbeauty-sample/' }));
    eq('a Flickr album is not a website', r.stage_b_website, '');
    ok('and it becomes a social signal instead',
      Object.values(r.social_profiles).some((v) => /flickr/.test(v)),
      JSON.stringify(r.social_profiles));
    ok('which marks them as publishing somewhere', r.stage_a_social_only === true);
    const c = r.website_checks.find((x) => x.stage === 'dataset');
    eq('the check records it as rejected, not absent', c.outcome, 'rejected');
    eq('and says what it was', c.evidence.rejected_as, 'social');
    ok('and keeps the url for the audit trail',
      c.evidence.rejected_url === 'http://www.flickr.com/photos/glowbeauty-sample/');
  }

  // --- a real website still counts ----------------------------------------
  {
    const r = await run(biz(), answer({ website: 'http://www.studio-a.test/' }));
    eq('a real domain is accepted', r.stage_b_website, 'http://www.studio-a.test/');
    const c = r.website_checks.find((x) => x.stage === 'dataset');
    eq('and recorded as found', c.outcome, 'found');
  }

  // --- booking platforms are not websites, and not social either ----------
  {
    const r = await run(biz(), answer({ website: 'https://timma.no/salon/glow-sample' }));
    eq('a booking platform is not a website', r.stage_b_website, '');
    eq('and earns no social credit either',
      Object.keys(r.social_profiles).length, 0);
  }

  // --- subdomains of a platform are caught --------------------------------
  {
    const r = await run(biz(), answer({ website: 'https://glowbeauty-sample.wixsite.com/home' }));
    eq('a builder subdomain is not their own site', r.stage_b_website, '');
  }

  // --- a dead business.site link ------------------------------------------
  {
    const r = await run(biz(), answer({ website: 'http://glowbeauty-sample.business.site' }));
    eq('a dead Google-built site is not a website', r.stage_b_website, '');
  }

  // --- an inactive row in the table is ignored ----------------------------
  {
    const r = await run(biz(), answer({ website: 'https://retired.example/x' }));
    eq('a deactivated platform row no longer filters',
      r.stage_b_website, 'https://retired.example/x');
  }

  // --- garbage does not throw ---------------------------------------------
  {
    const r = await run(biz(), answer({ website: 'not a url at all' }));
    ok('an unparseable value is passed through rather than crashing the batch',
      typeof r.stage_b_website === 'string');
  }

  // --- no answer row is "did not check", never "no website" ---------------
  {
    const r = await run(biz(), null);
    eq('a missing cross-check row is not evidence', r.stage_b_checked, false);
    eq('and not a match either', r.stage_b_matched, false);
    const c = r.website_checks.find((x) => x.stage === 'dataset');
    eq('recorded as skipped', c.outcome, 'skipped');
  }

  // --- matched with nothing held is the strong negative -------------------
  {
    const r = await run(biz(), answer({ website: '', matched: true }));
    eq('matched and no website held is a real negative', r.stage_b_matched, true);
    const c = r.website_checks.find((x) => x.stage === 'dataset');
    eq('recorded as not_found', c.outcome, 'not_found');
    eq('matched by phone, the strongest link', c.evidence.match_rank, 1);
  }

  done('stage B: platform filter on the dataset answer');
})();
