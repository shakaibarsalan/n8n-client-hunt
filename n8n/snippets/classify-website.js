// CH-02, node: "Classify and score confidence"
// Mode: Run Once for Each Item
//
// The verdict. Takes the evidence gathered by Stages A-D and produces a
// website_status plus a confidence number.
//
// The governing rule of this project:
//
//     A missing website field is not evidence of no website.
//     "No website" is a positive claim and needs positive evidence.
//
// So confidence is COMPUTED FROM WHICH CHECKS ACTUALLY COMPLETED, never
// asserted. A business we could not look up, could not search for and could
// not probe scores low no matter how empty its Maps listing was.
//
// There is deliberately no model in this path. The classification gates real
// money and a real email to a real business, so it has to give the same
// answer twice.

const b = $json;

// --- inputs from the earlier stages ----------------------------------------
// Stage A: what the Maps listing said, after platform domains were discounted
const sourceClaim = b.stage_a_claim || 'absent';   // 'absent' | 'platform' | 'real'
const sourceUrl = b.stage_a_url || '';
const isSocialOnly = Boolean(b.stage_a_social_only);

// Stage B: the free datasets
const datasetChecked = Boolean(b.stage_b_checked);   // did we find the business at all
const datasetWebsite = b.stage_b_website || '';      // a site they hold for it
const datasetMatched = Boolean(b.stage_b_matched);

// Stage C: search
const searchRan = Boolean(b.stage_c_ran);
const searchFound = b.stage_c_candidate || '';

// Stage D: the probe
const probeResult = b.probe_result || 'skipped';     // found|not_found|unreachable|refused
const probeLooked = Boolean(b.probe_looked);
const probeTried = Number(b.probe_candidates_tried || 0);
const probeDomain = b.probe_domain || '';

// Stage E-quality: PageSpeed, only run when a site was proved
const psi = b.psi || null;

let status = 'WEBSITE_UNCERTAIN';
let confidence = 0.4;
let evidence = '';

// ---------------------------------------------------------------------------
//  1. A proved site ends the question.
// ---------------------------------------------------------------------------
if (probeResult === 'found' || sourceClaim === 'real' || datasetWebsite) {
  const url = probeDomain ? 'https://' + probeDomain : (sourceUrl || datasetWebsite);

  // Weak counts as a different, often better, lead: the owner has already
  // decided a website matters, which is the hardest part of the sale, and has
  // something that does not work.
  const weak = [];
  if (psi) {
    if (Number(psi.performance) > 0 && Number(psi.performance) < 50) {
      weak.push(`mobile performance ${Math.round(psi.performance)}/100`);
    }
    if (psi.https === false) weak.push('no HTTPS');
    if (psi.mobile_friendly === false) weak.push('not mobile friendly');
  }
  if (/wixsite\.com|blogspot\.com|godaddysites\.com|webnode|jimdosite/.test(url)) {
    weak.push('free builder subdomain, no custom domain');
  }

  if (weak.length) {
    status = 'WEAK_WEBSITE';
    confidence = 0.85;
    evidence = `Has a site (${url}) but it is weak: ${weak.join('; ')}.`;
  } else {
    status = 'HAS_WEBSITE';
    // A site proved by probe is better evidence than one merely listed in a
    // dataset we never fetched - and a dataset site Stage D tried and could
    // not prove (it did not answer, or the name had nothing distinctive to
    // check) is weaker still, because the dataset match itself may be a
    // neighbour that shares their phone number.
    confidence = probeResult === 'found' ? 0.95 : b.stage_b_unverified ? 0.7 : 0.85;
    evidence = probeResult === 'found'
      ? `Website proved: ${url} - ${b.probe_why}.`
      : b.stage_b_unverified
        ? `Website listed by an open dataset but never proved to be theirs: ${url} (${b.probe_why}).`
        : `Website listed by ${sourceClaim === 'real' ? 'the Maps listing' : 'an open dataset'}: ${url}.`;
  }
}

// ---------------------------------------------------------------------------
//  2. No site found. How hard did we actually look?
//
//  Four independent checks can support a "no website" claim:
//     A  the listing itself carried nothing usable
//     B  neither open dataset holds a site for them
//     C  a search turned up no candidate
//     D  domain guesses were probed and refused
//
//  Each one that COMPLETED adds confidence. Each one that could not run
//  leaves it lower, which is the point - it is the difference between
//  "we checked and found nothing" and "we could not check".
// ---------------------------------------------------------------------------
else {
  let score = 0;
  const had = [];
  const missing = [];

  // A - always available, so worth the least on its own.
  if (sourceClaim === 'absent' || sourceClaim === 'platform') {
    score += 0.25;
    had.push(sourceClaim === 'platform'
      ? 'the Maps listing points at a social or directory page, not a site'
      : 'the Maps listing has no website');
  }

  // B - the strongest single check, because it is independent of Google.
  //
  // Except when Stage D fetched the site the dataset held for its match and
  // found it belongs to somebody else. Then the match was to the wrong place -
  // usually a neighbour sharing the phone number - and it is evidence of
  // nothing about THIS business, in either direction. Crediting it as "the
  // dataset holds no website for them" would turn a wrong match into a
  // confident no-website pitch.
  if (b.stage_b_disproved) {
    missing.push(`the open-dataset match turned out to be another business ` +
      `(its site ${b.stage_b_disproved} is not theirs), so it says nothing either way`);
  } else if (datasetChecked && datasetMatched && !datasetWebsite) {
    score += 0.30;
    had.push('matched in an open dataset, which also holds no website for them');
  } else if (datasetChecked && !datasetMatched) {
    // Not finding the business at all is weak evidence either way. In Dubai
    // this will be the common case, and pretending otherwise is how a
    // region with thin data quietly gets a confident wrong answer.
    score += 0.05;
    missing.push('not present in the open datasets, so they could not confirm or deny');
  } else {
    missing.push('open datasets not consulted');
  }

  // C
  //
  // A search that found a candidate which Stage D then REFUTED is stronger
  // evidence than a search that found nothing at all: we looked, we found the
  // most plausible thing on the internet, we fetched it, and it was somebody
  // else's. The first version credited only the empty-handed case, so the
  // better outcome scored zero.
  //
  // On the first 30 real businesses this was the single biggest reason nothing
  // reached CONFIRMED: Stage C found a candidate for 22 of them and Stage D
  // refused 16, and all 16 were treated as though no search had happened.
  if (searchRan && !searchFound) {
    score += 0.20;
    had.push('a web search for them returned no site of their own');
  } else if (searchRan && searchFound && probeResult === 'not_found' && probeLooked) {
    score += 0.20;
    had.push(`a web search suggested ${searchFound}, which was fetched and is not theirs`);
  } else if (searchRan && searchFound) {
    // Found something and could not resolve it. Genuinely unknown.
    missing.push(`a web search suggested ${searchFound}, which could not be checked`);
  } else if (!searchRan) {
    missing.push('no web search was run');
  }

  // D - refusing to guess is honest, but it is not evidence of absence.
  if (probeResult === 'not_found' && probeLooked && probeTried >= 4) {
    score += 0.25;
    had.push(`${probeTried} likely domains were checked and none belongs to them`);
  } else if (probeResult === 'not_found' && probeLooked) {
    score += 0.12;
    had.push(`${probeTried} likely domain(s) were checked and none belongs to them`);
  } else if (probeResult === 'unreachable') {
    missing.push('domain probes could not complete, which proves nothing either way');
  } else if (probeResult === 'refused') {
    missing.push('the name has no distinctive word, so no domain could be tested');
  }

  confidence = Math.min(1, Number(score.toFixed(2)));

  if (confidence >= 0.85) {
    status = 'NO_WEBSITE_CONFIRMED';
  } else if (confidence >= 0.60) {
    status = 'NO_WEBSITE_LIKELY';
  } else {
    status = 'WEBSITE_UNCERTAIN';
  }

  const parts = [];
  if (had.length) parts.push('Checked: ' + had.join('; ') + '.');
  if (missing.length) parts.push('Not established: ' + missing.join('; ') + '.');
  if (isSocialOnly) {
    parts.push('They are active on social media with nowhere to send people - a strong sign they want a web presence.');
  }
  evidence = parts.join(' ');
}

// ---------------------------------------------------------------------------
//  3. Overrides that no amount of confidence can talk its way past.
// ---------------------------------------------------------------------------
if (b.permanently_closed) {
  status = 'INVALID';
  confidence = 1.0;
  evidence = 'Permanently closed.';
}

return {
  json: {
    ...b,
    website_status: status,
    website_confidence: confidence,
    website_url: probeDomain ? 'https://' + probeDomain : (sourceUrl || datasetWebsite || null),
    website_evidence: evidence,
    website_checked_at: new Date().toISOString(),
  },
};
