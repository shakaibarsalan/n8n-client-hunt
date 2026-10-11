// score-lead.js was written and documented in an earlier pass but never
// actually wired to a workflow, and never tested - CH-03 is its first real
// caller. Every case here is either the numbers of a real business from the
// first 30 leads (anonymised) or one of the two mechanical holds the model
// cannot be configured around.

const { compile, ok, eq, done } = require('./helpers');

const score = compile('CH-03-score-leads.json', 'Score the lead', { $input: null, $: null });

const WEIGHTS = [
  { kind: 'niche', key: 'Beauty Salons', weight: 0.80 },
  { kind: 'niche', key: 'Real Estate', weight: 1.00 },
  { kind: 'country', key: 'Norway', weight: 0.95 },
  { kind: 'country', key: 'United Arab Emirates', weight: 1.00 },
];
const CFG = { default_min_lead_score: 60 };

const $ = (n) => ({
  first: () => ({ json: n === 'Config' ? CFG : {} }),
  all: () => (n === 'Load scoring weights' ? WEIGHTS : []).map((json) => ({ json })),
});

const run = async (businesses) =>
  (await score({ $input: { all: () => businesses.map((json) => ({ json })) }, $ }));

// "Salon I" in docs/POC-RESULTS.md, with its real numbers (the phone and
// address are placeholders): confirmed no website, 13 reviews, rated 4.6,
// phone + address + a found social profile, no email.
const LEAD = {
  id: 1, website_status: 'NO_WEBSITE_CONFIRMED', website_confidence: 1.0,
  permanently_closed: false, phone_e164: '+4740000001', address: 'Some street 1',
  review_count: 13, rating: 4.6, city: 'Oslo', social_profiles: { instagram: 'x' },
  niche: 'Beauty Salons', country: 'Norway', email: '',
  probe_was_unreachable: false, psi_performance: null,
};

(async () => {
  console.log('score-lead.js, against the shape of a real POC lead\n');

  // --- the real case that motivated the viability baseline ----------------
  {
    const [r] = await run([{ ...LEAD, review_count: 0, rating: 0 }]);
    ok('a verified no-website business with zero reviews still scores ' +
       'meaningfully - the original bug this baseline exists to fix',
      r.json.total >= 50, r.json.total);
    ok('and the viability component explains why',
      /operating/.test(r.json.components.business_viability.why),
      r.json.components.business_viability.why);
  }

  // --- the actual Salon I numbers ---------------------------------------------
  {
    const [r] = await run([LEAD]);
    eq('qualifies at the default threshold', r.json.qualified, true);
    eq('and needs no review', r.json.needs_review, false);
    ok('total is in a sane range for a strong confirmed lead',
      r.json.total >= 70 && r.json.total <= 100, r.json.total);
  }

  // --- the two holds that config cannot switch off -------------------------
  {
    const [r] = await run([{ ...LEAD, website_confidence: 0.5 }]);
    eq('confidence below 0.6 on a NO_WEBSITE status holds it, whatever the score',
      r.json.needs_review, true);
    eq('and it never qualifies, even if the raw total clears the bar',
      r.json.qualified, false);
  }
  {
    const [r] = await run([{ ...LEAD, probe_was_unreachable: true }]);
    eq('an unreachable probe holds it - absence was never demonstrated',
      r.json.needs_review, true);
  }
  {
    const [r] = await run([{ ...LEAD, website_status: 'WEBSITE_UNCERTAIN', website_confidence: 0.4 }]);
    eq('WEBSITE_UNCERTAIN always holds', r.json.needs_review, true);
  }

  // --- website opportunity scales with confidence, not just status --------
  {
    const [strong] = await run([{ ...LEAD, website_confidence: 1.0 }]);
    const [weak] = await run([{ ...LEAD, website_confidence: 0.65 }]);
    ok('a 1.0-confidence CONFIRMED scores above a 0.65-confidence one',
      strong.json.components.website_opportunity.points >
      weak.json.components.website_opportunity.points,
      `${strong.json.components.website_opportunity.points} vs ${weak.json.components.website_opportunity.points}`);
  }
  {
    const [has] = await run([{ ...LEAD, website_status: 'HAS_WEBSITE', website_confidence: 0.95 }]);
    eq('a business with a working site earns zero opportunity points',
      has.json.components.website_opportunity.points, 0);
  }

  // --- weak sites: measured performance changes the score ------------------
  //
  // A WORSE measured score means MORE opportunity points, not fewer: a
  // genuinely slow site is concrete evidence of a real problem to pitch on,
  // closer to a confirmed gap than a site nobody has actually measured.
  // Unmeasured defaults to perf=100 (the best possible score) precisely so
  // it scores at the BOTTOM of the weak-site range - absence of evidence is
  // not evidence of a bad site, and must not be treated as one.
  {
    const [slow] = await run([{ ...LEAD, website_status: 'WEAK_WEBSITE', psi_performance: 15 }]);
    const [unmeasured] = await run([{ ...LEAD, website_status: 'WEAK_WEBSITE', psi_performance: null }]);
    ok('a measured slow site scores ABOVE an unmeasured one - concrete ' +
       'evidence of a problem is worth more than none',
      slow.json.components.website_opportunity.points >
      unmeasured.json.components.website_opportunity.points,
      `${slow.json.components.website_opportunity.points} vs ${unmeasured.json.components.website_opportunity.points}`);
    eq('the unmeasured case lands at the bottom of the WEAK_WEBSITE range',
      unmeasured.json.components.website_opportunity.points, 18);
  }

  // --- contactability --------------------------------------------------
  {
    const [full] = await run([LEAD]);
    const [bare] = await run([{ ...LEAD, phone_e164: '', address: '', social_profiles: {} }]);
    eq('no contact route at all scores zero', bare.json.components.contactability.points, 0);
    ok('phone + address + social scores above that',
      full.json.components.contactability.points > 0);
  }

  // --- spend potential: niche and country weights apply ---------------------
  {
    const [salon] = await run([LEAD]);
    const [realEstate] = await run([{ ...LEAD, niche: 'Real Estate' }]);
    ok('Real Estate (weight 1.0) outscores Beauty Salons (weight 0.8) on spend potential',
      realEstate.json.components.spend_potential.points >
      salon.json.components.spend_potential.points,
      `${realEstate.json.components.spend_potential.points} vs ${salon.json.components.spend_potential.points}`);
  }
  {
    const [r] = await run([{ ...LEAD, niche: 'Something Unweighted', country: 'Nowhere' }]);
    ok('an unweighted niche/country defaults to 1.0x rather than erroring',
      r.json.components.spend_potential.points > 0, r.json.components.spend_potential.points);
  }

  // --- versioning: the score is tagged, and total is always 0-100 ---------
  {
    const [r] = await run([LEAD]);
    ok('scoring_version is stamped on the row', typeof r.json.scoring_version === 'string');
    ok('total never exceeds 100', r.json.total <= 100);
    ok('total never goes negative', r.json.total >= 0);
  }

  // --- the empty-batch sentinel --------------------------------------------
  {
    const [r] = await run([]);
    eq('nothing to score returns the sentinel, not an empty crash',
      r.json._nothing_to_score, true);
  }

  // --- the real bug: alwaysOutputData sends one blank item, not zero -------
  // "Pick what needs scoring" has alwaysOutputData set, so a zero-row query
  // arrives here as ONE blank {} item, not an empty array. Found running for
  // real: that blank item was scored as if it were a business (business_id:
  // undefined) and crashed "Store the score" on a NOT NULL violation, on
  // every 30-minute tick once the backlog was actually empty.
  {
    const [r] = await run([{}]);
    eq('a blank alwaysOutputData placeholder is treated as nothing to score, not a business',
      r.json._nothing_to_score, true);
  }
  {
    const [r] = await run([{ id: null }]);
    eq('an id-less row is the same case, whatever shape the blank arrives in',
      r.json._nothing_to_score, true);
  }

  // --- a per-target threshold overrides the Config default -----------------
  {
    const [strict] = await run([{ ...LEAD, min_lead_score: 95 }]);
    eq('a strict per-target threshold can hold back an otherwise-qualifying lead',
      strict.json.qualified, false);
  }

  done('score-lead.js');
})();
