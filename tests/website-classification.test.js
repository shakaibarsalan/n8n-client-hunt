// The most important test in the repo.
//
// It pins the one behaviour the whole project depends on:
//
//     "we checked and found nothing" and "we could not check"
//     must never produce the same answer.
//
// Every case below is a real situation the pipeline will meet in Oslo or
// Dubai within the first hundred businesses. The ones that matter most are
// the ones where the honest answer is "we do not know", because those are the
// rows that, if they leaked through as CONFIRMED, would produce an email
// opening "I noticed you don't have a website" to a business that has one.

const { compile, ok, eq, done } = require('./helpers');

const classify = compile('CH-02-verify.json', 'Classify and score confidence', {
  $json: null,
});

const run = async (fields) => (await classify({ $json: fields })).json;

// A candidate that has been through every stage successfully, with no
// evidence of a website anywhere. This is the shape a real confirmed lead has.
const FULLY_CHECKED = {
  name: 'Salong Eksempel',
  stage_a_claim: 'absent',
  stage_b_checked: true,
  stage_b_matched: true,
  stage_b_website: '',
  stage_c_ran: true,
  stage_c_candidate: '',
  probe_result: 'not_found',
  probe_looked: true,
  probe_candidates_tried: 6,
};

(async () => {
  console.log('website classification\n');

  // --- the happy path ------------------------------------------------------
  {
    const r = await run(FULLY_CHECKED);
    eq('all four checks completed -> CONFIRMED', r.website_status, 'NO_WEBSITE_CONFIRMED');
    ok('confidence is high', r.website_confidence >= 0.85, String(r.website_confidence));
  }

  // --- the false positive Stage B exists to catch --------------------------
  {
    const r = await run({
      ...FULLY_CHECKED,
      stage_b_website: 'https://salongeksempel.test',
    });
    eq('open dataset holds a website -> HAS_WEBSITE', r.website_status, 'HAS_WEBSITE');
    ok('the url is carried through', r.website_url === 'https://salongeksempel.test', r.website_url);
  }

  // --- a dataset site Stage D tried and could not prove -------------------
  {
    const r = await run({
      ...FULLY_CHECKED,
      stage_b_website: 'http://www.megler-f.test',
      stage_b_unverified: true,
      probe_result: 'skipped',
      probe_why: 'the name has no distinctive word to prove it with',
    });
    eq('an unproved dataset site is still treated as a site', r.website_status, 'HAS_WEBSITE');
    ok('but with lower confidence than a listed one', r.website_confidence < 0.85,
      String(r.website_confidence));
    ok('and the evidence says it was never proved', /never proved/.test(r.website_evidence),
      r.website_evidence);
  }

  // --- the dataset matched a NEIGHBOUR ----------------------------------------
  //
  // Stage D fetched the site the dataset held for its match and it belonged to
  // another business. The match was wrong, so it is evidence of nothing - and
  // above all not of "the dataset holds no website for them", which is what
  // this used to be credited as.
  {
    const r = await run({
      ...FULLY_CHECKED,
      stage_b_website: '',
      stage_b_disproved: 'http://www.nabo-klinikk.test',
    });
    ok('a disproved dataset match earns no "no website" credit',
      r.website_status !== 'NO_WEBSITE_CONFIRMED', `${r.website_status} ${r.website_confidence}`);
    ok('and the evidence names the wrong match',
      /another business/.test(r.website_evidence), r.website_evidence);
    ok('it is not given a website it does not have', r.website_url === null, r.website_url);
  }
  {
    const r = await run({
      ...FULLY_CHECKED,
      stage_b_website: '',
      stage_b_disproved: 'http://www.nabo-klinikk.test',
      stage_c_ran: false,
    });
    // Stage C never runs when a dataset site exists, so this is the real shape.
    eq('with the search skipped too, the honest answer is UNCERTAIN',
      r.website_status, 'WEBSITE_UNCERTAIN');
  }

  // --- the probe could not complete ---------------------------------------
  //
  // THE central safeguard. Maps said nothing, the datasets agreed, the search
  // found nothing - but every domain probe timed out. Three checks passed and
  // one could not run, and that must not round up to certainty.
  {
    const r = await run({
      ...FULLY_CHECKED,
      probe_result: 'unreachable',
      probe_looked: false,
      probe_candidates_tried: 5,
    });
    ok('an unreachable probe cannot produce CONFIRMED',
      r.website_status !== 'NO_WEBSITE_CONFIRMED', r.website_status);
    ok('and it is visible in the evidence',
      /proves nothing|not established/i.test(r.website_evidence), r.website_evidence);
  }

  // --- a name that cannot be proved either way -----------------------------
  {
    const r = await run({
      ...FULLY_CHECKED,
      name: 'Beauty Salon',
      probe_result: 'refused',
      probe_looked: true,
      probe_candidates_tried: 0,
    });
    ok('refusing to guess does not count as evidence of absence',
      r.website_status !== 'NO_WEBSITE_CONFIRMED', r.website_status);
  }

  // --- the Dubai case: thin reference data ---------------------------------
  //
  // The business is simply not in Overture or Foursquare. That is not
  // evidence either way, and a region with sparse open data must not quietly
  // produce the same confidence as one with dense coverage. This single
  // assertion is why the POC runs Oslo AND Dubai rather than one city twice.
  {
    const r = await run({
      ...FULLY_CHECKED,
      stage_b_checked: true,
      stage_b_matched: false,
    });
    eq('absent from the datasets -> LIKELY, not CONFIRMED', r.website_status, 'NO_WEBSITE_LIKELY');
    ok('confidence is visibly lower', r.website_confidence < 0.85, String(r.website_confidence));
  }

  // --- no search key configured -------------------------------------------
  {
    const r = await run({ ...FULLY_CHECKED, stage_c_ran: false, stage_c_candidate: '' });
    ok('a search that never ran earns no credit',
      r.website_status !== 'NO_WEBSITE_CONFIRMED', r.website_status);
    ok('and the report says so',
      /no web search was run/i.test(r.website_evidence), r.website_evidence);
  }

  // --- social-only is a lead, not a website -------------------------------
  {
    const r = await run({
      ...FULLY_CHECKED,
      stage_a_claim: 'platform',
      stage_a_social_only: true,
    });
    ok('a Facebook page in the website field is still a no-website lead',
      r.website_status.startsWith('NO_WEBSITE'), r.website_status);
    ok('and the social signal is recorded as a buying signal',
      /social media/i.test(r.website_evidence), r.website_evidence);
  }

  // --- a proved site ------------------------------------------------------
  {
    const r = await run({
      ...FULLY_CHECKED,
      probe_result: 'found',
      probe_domain: 'salongeksempel.test',
      probe_why: 'named in the page title',
    });
    eq('a proved domain -> HAS_WEBSITE', r.website_status, 'HAS_WEBSITE');
    ok('a proved site outranks a merely listed one', r.website_confidence >= 0.9,
      String(r.website_confidence));
  }

  // --- weak sites are a different, often better, lead ---------------------
  {
    const r = await run({
      ...FULLY_CHECKED,
      probe_result: 'found',
      probe_domain: 'salongeksempel.test',
      probe_why: 'named in the page title',
      psi: { performance: 18, https: false, mobile_friendly: false, measured: true },
    });
    eq('a slow, insecure, non-mobile site -> WEAK_WEBSITE', r.website_status, 'WEAK_WEBSITE');
    ok('and the reasons are spelled out',
      /performance/i.test(r.website_evidence) && /HTTPS/i.test(r.website_evidence),
      r.website_evidence);
  }

  // --- an unmeasured site is not a failing site ---------------------------
  //
  // PageSpeed shares a global quota, so it will sometimes simply not answer.
  // A missing performance number must not be read as a bad one.
  {
    const r = await run({
      ...FULLY_CHECKED,
      probe_result: 'found',
      probe_domain: 'salongeksempel.test',
      probe_why: 'named in the page title',
      psi: { performance: 0, https: true, mobile_friendly: null, measured: false },
    });
    eq('an unmeasured site stays HAS_WEBSITE', r.website_status, 'HAS_WEBSITE');
  }

  // --- closed businesses are not leads ------------------------------------
  {
    const r = await run({ ...FULLY_CHECKED, permanently_closed: true });
    eq('a closed business is INVALID whatever else is true', r.website_status, 'INVALID');
  }

  // --- a candidate found and then refuted IS evidence ----------------------
  //
  // The biggest single reason nothing reached CONFIRMED on the first 30 real
  // businesses. Stage C found a plausible domain for 22 of 30; Stage D fetched
  // and refused 16 of those. All 16 scored as though no search had run.
  //
  // "We searched, found the most plausible site on the internet, fetched it,
  // and it is somebody else's" is STRONGER than "we searched and found
  // nothing", and it must not score lower.
  {
    const refuted = await run({
      ...FULLY_CHECKED,
      stage_c_ran: true,
      stage_c_candidate: '1881.no',
      probe_result: 'not_found',
      probe_looked: true,
      probe_candidates_tried: 6,
    });
    const nothing = await run(FULLY_CHECKED);
    ok('a refuted search candidate scores the same as an empty search',
      refuted.website_confidence === nothing.website_confidence,
      `${refuted.website_confidence} vs ${nothing.website_confidence}`);
    eq('and still reaches CONFIRMED', refuted.website_status, 'NO_WEBSITE_CONFIRMED');
    ok('the evidence names what was checked and rejected',
      /1881\.no/.test(refuted.website_evidence), refuted.website_evidence);
  }

  // A candidate that could NOT be checked is a different thing again, and must
  // not earn the same credit.
  {
    const unresolved = await run({
      ...FULLY_CHECKED,
      stage_c_ran: true,
      stage_c_candidate: 'somewhere.no',
      probe_result: 'unreachable',
      probe_looked: false,
    });
    ok('an unresolved candidate does not reach CONFIRMED',
      unresolved.website_status !== 'NO_WEBSITE_CONFIRMED', unresolved.website_status);
    ok('and says it could not be checked',
      /could not be checked/i.test(unresolved.website_evidence), unresolved.website_evidence);
  }

  // --- determinism --------------------------------------------------------
  //
  // The classification gates money and a real email, so it has to give the
  // same answer twice. There is no model in this path precisely so that this
  // assertion can exist at all.
  {
    const a = await run(FULLY_CHECKED);
    const b = await run(FULLY_CHECKED);
    ok('same input, same verdict',
      a.website_status === b.website_status && a.website_confidence === b.website_confidence);
  }

  // --- confidence is ordered ----------------------------------------------
  {
    const strong = await run(FULLY_CHECKED);
    const medium = await run({ ...FULLY_CHECKED, stage_b_matched: false });
    const weak = await run({
      ...FULLY_CHECKED, stage_b_checked: false, stage_c_ran: false,
      probe_result: 'unreachable', probe_looked: false,
    });
    ok('more checks completed always means more confidence',
      strong.website_confidence > medium.website_confidence &&
      medium.website_confidence > weak.website_confidence,
      `${strong.website_confidence} > ${medium.website_confidence} > ${weak.website_confidence}`);
  }

  done('website classification');
})();
