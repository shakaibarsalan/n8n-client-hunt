// CH-02, node: "Stage B: what do the free datasets say?"
// Mode: Run Once for All Items
//
// Re-attaches the cross-check answers to the businesses they belong to.
//
// Pairing is BY PLACE ID, not by position. The Postgres node returns one row
// per input item in order, so zipping by index looks like it works - and then
// one day a query returns no row for one input, every subsequent answer is
// attached to the wrong business, and a salon inherits a neighbouring shop's
// website. Nothing about that failure looks like a bug; it looks like bad
// data. The cross-check query returns place_id for exactly this reason.

const answers = new Map();
for (const item of $input.all()) {
  const a = item.json;
  if (a && a.place_id) answers.set(String(a.place_id), a);
}

// --- the open datasets need the same scepticism as the Maps listing --------
//
// Stage A already discounts a "website" that is really a Facebook page. Stage B
// did not, and an open dataset is no more discriminating than Google about what
// counts as a website.
//
// Caught on the first 30 real businesses: Overture holds
//   http://www.flickr.com/photos/<the-salon's-album>/
// as the website for an Oslo salon. Taken at face value that business becomes
// HAS_WEBSITE and is dropped - when a one-person beauty business whose entire
// web presence is a Flickr album is close to the ideal prospect for this
// project.
//
// So the platform list is applied to BOTH sources. A dataset URL on a platform
// host is treated exactly as Stage A treats it: not a website, and a social
// signal if it is somewhere they actually publish.
const platforms = new Map();
for (const p of $('Load platform domains').all().map((i) => i.json)) {
  if (p.active !== false) platforms.set(String(p.domain).toLowerCase(), p);
}

// An empty platform list is not a harmless edge case, it is the quiet version
// of the worst bug this stage can have: every booking page, dead
// business.site and Linktree the open datasets hold gets accepted as a real
// website, and the business - a perfect prospect, since a booking page is not
// a website - is discarded as HAS_WEBSITE and never contacted again.
//
// Found for real: one Dubai salon was classified HAS_WEBSITE at 0.85 against
// a fresha.com booking URL, and another against a <name>.business.site URL -
// both hosts ARE in platform_domains and
// both were accepted anyway. The code below is correct when handed the real
// 163 rows (verified directly), so the list was not reaching it at runtime.
// Failing loudly here turns a silent lead-losing bug into a visible one.
if (platforms.size === 0) {
  throw new Error(
    'Stage B has an EMPTY platform list. "Load platform domains" returned no usable ' +
    'rows, so every dataset URL would be believed - including booking pages and dead ' +
    'website builders, which would discard real prospects as HAS_WEBSITE. Refusing to ' +
    'classify rather than classify wrongly.');
}

// How the host was extracted, recorded in the evidence below. See hostOf.
let lastParsedBy = 'none';

// Host extraction that does NOT depend on the sandbox providing a global URL
// constructor. The previous version called `new URL(...)` inside a try/catch
// whose catch returned null - and null here means "not a platform", so ANY
// parse failure silently became "this is a real website" and the lead was
// discarded as HAS_WEBSITE. That is the most expensive direction to fail in,
// and it is invisible: the same code returns the right answer in plain Node,
// which is why every local test of it passed while production kept accepting
// fresha.com and business.site URLs.
//
// The regex path needs no globals at all, so it works regardless of what the
// Code node sandbox exposes.
const hostOf = (url) => {
  const s = String(url || '').trim();
  if (!s) { lastParsedBy = 'empty'; return ''; }
  try {
    if (typeof URL === 'function') {
      const h = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s)
        .hostname.toLowerCase().replace(/^www\./, '');
      if (h) { lastParsedBy = 'URL'; return h; }
    }
  } catch (e) { /* fall through - the regex below needs no globals */ }
  lastParsedBy = 'regex';
  return s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
          .split(/[/?#]/)[0]
          .split('@').pop()
          .split(':')[0]
          .toLowerCase()
          .replace(/^www\./, '');
};

const platformHit = (url) => {
  const host = hostOf(url);
  if (!host) return null;
  if (platforms.has(host)) return platforms.get(host);
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join('.');
    if (platforms.has(suffix)) return platforms.get(suffix);
  }
  return null;
};

const out = [];

for (const item of $('Stage A: what did the source actually claim?').all()) {
  const b = item.json;
  const a = answers.get(String(b.google_place_id));

  const checks = [...(b.website_checks || [])];

  if (!a) {
    // No row came back at all. That is not "no website" - it is "the check
    // did not run", and the two must not collapse into each other.
    checks.push({
      stage: 'dataset', method: 'crosscheck', candidate_url: null,
      outcome: 'skipped', evidence: { why: 'no cross-check row returned for this place id' },
    });
    out.push({ json: { ...b, stage_b_checked: false, stage_b_matched: false,
                       stage_b_website: '', website_checks: checks } });
    continue;
  }

  const matched = Boolean(a.matched);
  const rank = a.best_match_rank == null ? null : Number(a.best_match_rank);

  // Filter the dataset's answer through the platform list before believing it.
  const rawWebsite = String(a.website || '');
  const hit = rawWebsite ? platformHit(rawWebsite) : null;
  const website = hit ? '' : rawWebsite;
  const datasetPlatformUrl = hit ? rawWebsite : '';

  checks.push({
    stage: 'dataset',
    method: 'crosscheck.' + (rank === 1 ? 'phone' : rank === 2 ? 'name+geo' : rank === 3 ? 'name+city' : 'none'),
    candidate_url: rawWebsite || null,
    outcome: website ? 'found' : hit ? 'rejected' : matched ? 'not_found' : 'skipped',
    evidence: {
      matched,
      match_rank: rank,
      sources: a.sources || [],
      socials_found: (a.socials || []).length,
      dataset_confidence: a.min_confidence,
      // Recorded so a wrong verdict can be traced to the list that produced
      // it, rather than re-argued from the code months later.
      platform_list_size: platforms.size,
      host_parsed_by: lastParsedBy,
      // Recorded rather than discarded, so the audit trail shows the dataset
      // DID hold a URL and why it was not accepted as a website.
      ...(hit ? { rejected_as: hit.kind, rejected_url: rawWebsite } : {}),
    },
  });

  // Open-data socials are worth keeping even when no website turns up: they
  // feed the lead score and they are often the only contact route for a
  // business that has nothing else.
  const socials = { ...(b.social_profiles || {}) };
  // A platform URL the dataset called a "website" is a social signal, not a
  // website - and a strong one: they publish somewhere, they just have nowhere
  // of their own to send people.
  if (datasetPlatformUrl && hit && hit.counts_as_social) {
    const key = String(hit.domain).split('.')[0];
    if (!socials[key]) socials[key] = datasetPlatformUrl;
  }
  for (const s of a.socials || []) {
    if (!s) continue;
    const key = /facebook/i.test(s) ? 'facebook'
      : /instagram/i.test(s) ? 'instagram'
      : /twitter|x\.com/i.test(s) ? 'twitter'
      : /linkedin/i.test(s) ? 'linkedin' : 'other';
    if (!socials[key]) socials[key] = s;
  }

  out.push({
    json: {
      ...b,
      social_profiles: socials,
      stage_a_social_only: b.stage_a_social_only || Object.keys(socials).length > 0,
      stage_b_checked: true,
      stage_b_matched: matched,
      stage_b_match_rank: rank,
      stage_b_website: website,
      // An open dataset saying the place has closed is worth acting on even
      // when Google still lists it as open - Google is slow to retire a
      // listing nobody has corrected.
      stage_b_looks_closed: Boolean(a.looks_closed),
      website_checks: checks,
    },
  });
}

if (!out.length) {
  throw new Error(
    'Stage B produced no items. Stage A returned ' +
    $('Stage A: what did the source actually claim?').all().length +
    ' businesses and the cross-check returned ' + answers.size + ' answers. ' +
    'If the second number is 0, the reference tables are probably empty - ' +
    'run tools/load_overture.py and tools/load_fsq.py.'
  );
}

return out;
