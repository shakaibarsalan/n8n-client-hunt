// Stage D, against saved pages instead of the live web.
//
// Every page below is a real shape the prover will meet: a genuine business
// site, a parked domain, a builder placeholder, an unrelated company that
// happens to share a word, and a host that simply does not answer.
//
// Testing against fixtures rather than the internet is not only about speed.
// From the LinkedIn post-mortem, on why that project got a warning:
//
//     "One live page load produces a fixture that supports a hundred
//      iterations. This alone would have removed roughly 90% of the traffic."
//
// The pages here are written rather than downloaded, so the repo carries no
// scraped third-party content. Businesses, addresses and phone numbers are
// fictional, and every domain uses the reserved .test TLD - the prover takes
// its TLDs from the target's cctlds, so cctlds: ['.test'] exercises exactly
// the code a ['.no'] target does.

const { compile, ok, eq, done } = require('./helpers');

const prove = compile('CH-02-verify.json', 'Stage D: prove the domain', {
  $json: null,
  $: null,
});

const CONFIG = [{
  user_agent: 'test',
  probe_timeout_ms: 1000,
  max_probes_per_business: 8,
}];

const page = (title, body) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}` +
  'x'.repeat(600) + '</body></html>';

// --- the saved pages -------------------------------------------------------
const WEB = {
  // A real one: the business is named in the title.
  'https://salongeksempel.test': page('Salong Eksempel - frisor i Oslo',
    '<h1>Salong Eksempel</h1><p>Velkommen til Salong Eksempel i Oslo.</p>'),

  // A parked domain. Answers 200 and proves nothing.
  'https://glimtvikstudio.test': page('glimtvikstudio.test',
    'This domain may be for sale. Buy this domain at godaddy.com/domain'),

  // A placeholder whose title is just the domain.
  'https://nordlysvikhud.test': page('nordlysvikhud.test', 'Coming soon'),

  // An unrelated company that shares ONE word with the business name. This is
  // the "captain.com" case: it does say the word, and it is not them.
  'https://eksempel.test': page('Eksempel Energi AS - strom til hjemmet',
    '<h1>Eksempel Energi</h1><p>Vi leverer strom over hele landet.</p>'),

  // A site that names the business only in the body, twice.
  'https://testbyenshudpleie.test': page('Velkommen',
    '<p>Testbyens Hudpleie tilbyr behandlinger. Kontakt Testbyens Hudpleie i dag.</p>'),

  // A NEIGHBOUR's site, held by the open dataset because the two businesses
  // share a phone number. Shaped on the real case: a salon was given the
  // site of the skin clinic next door, and Stage F then took that clinic's
  // address for her draft.
  // Same name, different company, different country - the real case.
  'https://sampletrading.test': page('Fuel storage and distribution - SAMPLE TRADING, a.s.',
    '<h1>Sample Trading</h1><p>Hlavna 1, 000 00 Example Town, Slovakia. Tel +421 2 0000 0000</p>'),
  'https://phonematch.test': page('Phonematch Frisor - Oslo',
    '<footer>Ring oss: 400 00 077</footer>'),
  'https://addressmatch.test': page('Addressmatch Hudpleie',
    '<footer>Eksempel Testesens gate 36, Testbyen</footer>'),
  'https://nabo-klinikk.test': page('Nabo Klinikk - hudpleie og fotpleie i Oslo',
    '<h1>Nabo Klinikk</h1><p>Ansiktsbehandling, fotpleie og voksing.</p>'),
};

const httpRequest = async ({ url }) => {
  if (url in WEB) return WEB[url];
  if (url.includes('timeout')) {
    const e = new Error('ETIMEDOUT connect');
    throw e;
  }
  const e = new Error('getaddrinfo ENOTFOUND ' + url);
  throw e;
};

const THIS = { helpers: { httpRequest } };

const biz = (over) => ({
  name: 'Salong Eksempel',
  name_norm: 'salong eksempel',
  cctlds: ['.test'],
  website_checks: [],
  ...over,
});

const run = async (b) => (await prove({ $json: b, $: () => ({ first: () => ({ json: CONFIG[0] }) }) }, THIS)).json;

(async () => {
  console.log('stage D: prove the domain\n');

  // --- finds a real site ---------------------------------------------------
  {
    const r = await run(biz());
    eq('a page that names them in the title is accepted', r.probe_result, 'found');
    eq('and the right domain is returned', r.probe_domain, 'salongeksempel.test');
  }

  // --- rejects the traps ---------------------------------------------------
  {
    const r = await run(biz({ name: 'Glimtvik Studio', name_norm: 'glimtvik studio' }));
    // "studio" is in the generic list, so the only proof token is "glimtvik".
    eq('a parked domain is not a website', r.probe_result, 'not_found');
    ok('and the rejection says why',
      r.website_checks.some((c) => c.evidence && c.evidence.why === 'parked domain'),
      JSON.stringify(r.website_checks.map((c) => c.evidence && c.evidence.why)));
  }

  {
    const r = await run(biz({ name: 'Nordlysvik Hud', name_norm: 'nordlysvik hud' }));
    eq('a placeholder title is not a website', r.probe_result, 'not_found');
    ok('and the rejection says why',
      r.website_checks.some((c) => c.evidence && c.evidence.why === 'placeholder title'));
  }

  // --- THE one that matters: evidence must scale with the guess ------------
  //
  // "Salong Eksempel" -> distinctive token "eksempel" -> eksempel.test exists
  // and says "Eksempel" everywhere. It is an energy company. Accepting it
  // would mark a real prospect as HAS_WEBSITE and drop them from the list
  // forever.
  {
    const r = await run(biz({
      name: 'Salong Eksempel Hudpleie',
      name_norm: 'salong eksempel hudpleie',
      cctlds: ['.test'],
      // force the one-word guess to be reached first
      search_candidate_domain: 'eksempel.test',
    }));
    ok('a one-word domain whose title does not name them is refused',
      r.probe_domain !== 'eksempel.test', `accepted ${r.probe_domain}`);
  }

  // --- accepts weaker but sufficient evidence -----------------------------
  {
    const r = await run(biz({ name: 'Testbyens Hudpleie', name_norm: 'testbyens hudpleie' }));
    eq('named twice in the body is enough', r.probe_result, 'found');
    eq('for the right domain', r.probe_domain, 'testbyenshudpleie.test');
  }

  // --- refuses to guess from a name with nothing distinctive --------------
  {
    const r = await run(biz({ name: 'Beauty Salon', name_norm: 'beauty salon' }));
    eq('a wholly generic name is refused, not guessed', r.probe_result, 'refused');
    eq('and nothing was fetched', r.probe_candidates_tried, 0);
  }

  // --- unknown is not a pass ----------------------------------------------
  //
  // The single most important assertion in this file. Every probe timed out.
  // That is not evidence of absence, and the result must say so.
  {
    const r = await run(biz({ name: 'Timeout Salon', name_norm: 'timeout salon', cctlds: ['.test'] }));
    eq('a host that never answers is unreachable, not absent', r.probe_result, 'unreachable');
    eq('and we did not "look"', r.probe_looked, false);
  }

  // --- a DNS miss IS evidence ---------------------------------------------
  {
    const r = await run(biz({ name: 'Velvet Mirror', name_norm: 'velvet mirror', cctlds: ['.test'] }));
    eq('a domain that does not resolve counts as having looked', r.probe_result, 'not_found');
    eq('so absence is supported here', r.probe_looked, true);
  }

  // --- skips work already done --------------------------------------------
  {
    const r = await run(biz({ stage_a_claim: 'real', stage_a_url: 'https://salongeksempel.test' }));
    eq('a site the Maps listing itself names is not probed again', r.probe_result, 'skipped');
    eq('and costs no fetches', r.probe_candidates_tried, 0);
  }

  // --- an open dataset's site has to be proved like any other --------------
  {
    const r = await run(biz({ stage_b_website: 'http://www.salongeksempel.test/' }));
    eq('a dataset site that names them is proved', r.probe_result, 'found');
    eq('it is the dataset site that is returned', r.probe_domain, 'salongeksempel.test');
    eq('with a single fetch', r.probe_candidates_tried, 1);
    eq('and the dataset site still stands', r.stage_b_website, 'http://www.salongeksempel.test/');
    ok('the evidence row says where the candidate came from',
      r.website_checks.some((c) => c.evidence && c.evidence.source === 'open dataset'));
  }
  {
    const r = await run(biz({
      name: 'Fjordlys Frisor og Skjonnhetssalong',
      name_norm: 'fjordlys frisor og skjonnhetssalong',
      stage_b_website: 'http://www.nabo-klinikk.test',
    }));
    ok('a NEIGHBOUR\'s site the dataset held is not accepted',
      r.probe_domain !== 'nabo-klinikk.test', `accepted ${r.probe_domain}`);
    eq('it stops counting as their website', r.stage_b_website, '');
    eq('and is recorded as disproved, not silently dropped',
      r.stage_b_disproved, 'http://www.nabo-klinikk.test');
    ok('with the reason', Boolean(r.stage_b_disproved_why), r.stage_b_disproved_why);
    ok('the usual name guesses are still tried afterwards',
      r.probe_candidates_tried > 1, String(r.probe_candidates_tried));
  }
  {
    const r = await run(biz({ stage_b_website: 'https://timeout-salong.test' }));
    eq('a dataset site that never answers is neither proved nor refuted', r.probe_result, 'skipped');
    eq('so it stays believed, as before', r.stage_b_website, 'https://timeout-salong.test');
    eq('but flagged as never proved', r.stage_b_unverified, true);
    eq('and no further guesses are spent on it', r.probe_candidates_tried, 1);
  }
  {
    const r = await run(biz({
      name: 'Xy eiendom', name_norm: 'xy eiendom', stage_b_website: 'http://www.megler-f.test',
    }));
    eq('a name with nothing distinctive cannot prove a dataset site', r.probe_result, 'skipped');
    eq('so the dataset site is kept but flagged unproved', r.stage_b_unverified, true);
    eq('without a fetch', r.probe_candidates_tried, 0);
  }
  {
    const r = await run(biz({ stage_b_website: 'http://salong-eksempel-gone.test' }));
    eq('a dataset site whose domain no longer resolves is disproved',
      r.stage_b_disproved, 'http://salong-eksempel-gone.test');
    eq('with that reason', r.stage_b_disproved_why, 'domain does not resolve');
  }

  // --- the evidence trail is complete -------------------------------------
  {
    const r = await run(biz({ name: 'Velvet Mirror', name_norm: 'velvet mirror', cctlds: ['.test', '.example'] }));
    ok('every candidate tried leaves a check row',
      r.website_checks.length === r.probe_candidates_tried,
      `${r.website_checks.length} rows for ${r.probe_candidates_tried} probes`);
    ok('and each names a stage and an outcome',
      r.website_checks.every((c) => c.stage === 'probe' && c.outcome));
  }

  // --- found by name is not the same as theirs ----------------------------
  {
    const r = await run(biz({ name: 'Sample Trading AS', name_norm: 'sample trading as',
      phone_e164: '+4740000070', address: 'Eksempelgata 47, 0265 Oslo, Norway',
      search_candidate_domain: 'sampletrading.test', cctlds: ['.test'] }));
    eq('the same-named company abroad is still found by name', r.probe_domain, 'sampletrading.test');
    eq('but nothing on it is theirs', r.probe_corroborated, 'none');
    ok('and the evidence row says so', r.website_checks.some((c) => c.evidence && c.evidence.corroborated === 'none'));
  }
  {
    const r = await run(biz({ name: 'Phonematch Frisor', name_norm: 'phonematch frisor',
      phone_e164: '+4740000077', address: 'Eksempelgata 1, 0150 Oslo' }));
    eq('their phone number on the page, in any formatting, corroborates it', r.probe_corroborated, 'phone');
  }
  {
    const r = await run(biz({ name: 'Addressmatch Hudpleie', name_norm: 'addressmatch hudpleie',
      phone_e164: '+4740000099', address: 'Eksempel Testesens gate 36, 0555 Oslo, Norway' }));
    eq('their street address on the page corroborates it', r.probe_corroborated, 'address');
  }

  done('stage D: prove the domain');
})();
