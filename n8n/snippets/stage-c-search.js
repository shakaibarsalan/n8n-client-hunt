// CH-02, node: "Stage C: search for them"
// Mode: Run Once for Each Item
//
// Asks a search engine whether this business has a site anywhere, and keeps
// the best candidate domain for Stage D to prove.
//
// A search HIT IS NOT A VERDICT. A result proves only that some page mentions
// the name. The domain it points at still has to survive Stage D, which
// fetches it and checks the page actually names this business. Accepting a
// search result directly is how you decide a salon owns a competitor's site
// because a directory page listed them both.
//
// The fetch happens inside this Code node rather than in an HTTP node, for
// the reason the job-hunt repo documented: a two-HTTP-node shape produced an
// item-pairing bug where one business's response was read for all of them.
// Here the request and its response never leave the item that owns them.

const b = $json;
const CFG = $('Config').first().json;

// Skip conditions. Stage C is the first stage that costs money, so anything
// already settled must not reach the API.
if (b.stage_a_claim === 'real' || b.stage_b_website) {
  return { json: { ...b, stage_c_ran: false, stage_c_candidate: '',
                   stage_c_skipped: 'already resolved by an earlier stage' } };
}

const platforms = $('Load platform domains').all().map((i) => String(i.json.domain).toLowerCase());
const isPlatform = (host) => {
  const h = host.replace(/^www\./, '');
  return platforms.some((p) => h === p || h.endsWith('.' + p));
};

// A search done by hand. When the Serper credits are gone, Claude can search
// for a batch of leads in a working session and record what it found in
// businesses.raw.hand_search ({candidate, results, why, by, searched_at});
// select-pending.sql brings those leads up first. It stands in for exactly
// this stage - Stage D still has to PROVE any candidate - so a hand search
// earns the same credit as an API search, no more.
const hand = b.hand_search && typeof b.hand_search === 'object' ? b.hand_search : null;
if (hand) {
  const handHost = String(hand.candidate || '').toLowerCase().replace(/^www\./, '').trim();
  const usable = handHost && !isPlatform(handHost) ? handHost : '';
  return { json: { ...b, stage_c_ran: true, stage_c_candidate: usable, search_candidate_domain: usable,
    website_checks: [...(b.website_checks || []), {
      stage: 'search', method: String(hand.by || 'by hand').slice(0, 40),
      candidate_url: usable || null, outcome: usable ? 'found' : 'not_found',
      evidence: { query: String(hand.query || `"${b.name}" ${b.city || ''}`).slice(0, 200),
                  results: Number(hand.results) || 0, why: String(hand.why || '').slice(0, 200),
                  searched_at: hand.searched_at || null },
    }] } };
}

const key = CFG.serper_api_key || '';
if (!key) {
  // No key is a configuration state, not a finding. Saying so explicitly
  // keeps the classifier from crediting a search that never happened.
  return { json: { ...b, stage_c_ran: false, stage_c_candidate: '',
                   stage_c_skipped: 'no search key configured' } };
}

const city = b.city || '';
// One query, not two. The second (name + city + niche) only ever ran when
// the first found nothing - which for a business with no website is nearly
// always - so it doubled the cost of exactly the leads this project wants,
// and the free search credits ran out at half the leads.
const queries = [
  `"${b.name}" ${city}`,
];

const checks = [...(b.website_checks || [])];
let candidate = '';
let why = '';
let ran = false;

for (const q of queries) {
  if (candidate) break;
  let res;
  try {
    res = await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: { q, num: 10, gl: CFG.search_country || undefined },
      json: true,
      timeout: Number(CFG.search_timeout_ms || 15000),
    });
    ran = true;
  } catch (e) {
    const msg = String(e && e.message || e);
    // Serper refusing the KEY (400/401/402/403 - in practice "not enough
    // credits") is not one failed search, it is every search from now on.
    // Carrying on verified leads half-blind: on 5 Oct 2026, 252 of 314
    // leads checked after the credits ran out came out WEBSITE_UNCERTAIN and
    // were never emailed. Failing the run instead leaves the batch PENDING,
    // to be verified properly once the key works again. A 429 (rate limit)
    // or a timeout is transient and is still just recorded below.
    if (/status code 40[0-3]\b/.test(msg)) {
      throw new Error('Search (Serper) refused the key - probably out of credits: ' + msg +
        '. Stopping this run so leads stay PENDING instead of being verified without a ' +
        'search. Top up the Serper account or set a new SERPER_API_KEY, then re-import the workflows.');
    }
    // A failed search is NOT evidence of absence. ran stays false unless at
    // least one query actually came back, and the classifier gives credit for
    // Stage C only when ran is true.
    checks.push({
      stage: 'search', method: 'serper', candidate_url: null, outcome: 'unreachable',
      evidence: { query: q, error: String(e && e.message || e).slice(0, 200) },
    });
    continue;
  }

  const organic = Array.isArray(res && res.organic) ? res.organic : [];
  for (const r of organic) {
    // The sandbox does not expose a working URL constructor (proven in
    // production - see merge-stage-b.js). The old line here was
    // `try { host = new URL(r.link).hostname } catch { continue; }`, so the
    // catch fired on EVERY result and `continue` skipped all of them: Stage C
    // has never contributed a single candidate domain, silently, while
    // reporting itself as having run. The regex below needs no globals.
    const raw = String(r.link || '').trim();
    const host = raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .split(/[/?#]/)[0]
      .split('@').pop()
      .split(':')[0]
      .toLowerCase();
    if (!host) continue;
    if (isPlatform(host)) continue;              // a directory is not their site
    if (/^(www\.)?google\./.test(host)) continue;

    // The name has to appear in the result, and it has to be a DISTINCTIVE
    // part of the name.
    //
    // The first version accepted any token of four characters or more,
    // anywhere in the title or snippet. Against real results that meant
    // "<Name> Frisor" matched 1881.no - the Norwegian phone book - on the word
    // "frisor", and "<Name> Beauty" matched a global listings aggregator on
    // "beauty". Every salon page on earth contains "beauty" and every
    // hairdresser listing contains "frisor", so those words select nothing.
    //
    // The niche words are exactly the ones a DIRECTORY of this niche is full
    // of, which is what makes them worse than useless here.
    const GENERIC = new Set([
      'salon', 'salong', 'salonger', 'beauty', 'hair', 'spa', 'nails', 'nail',
      'barber', 'studio', 'lash', 'lashes', 'brows', 'skin', 'clinic', 'klinikk',
      'peluqueria', 'estetica', 'parrucchiere', 'frisor', 'frisør', 'kapper',
      'real', 'estate', 'realty', 'properties', 'property', 'homes',
      'inmobiliaria', 'immobiliare', 'eiendom', 'megler', 'realtor',
      'oslo', 'dubai', 'norway', 'norge', 'centre', 'center', 'care',
    ]);
    const tokens = String(b.name_norm || '').split(/\s+/)
      .filter((w) => w.length >= 4 && !GENERIC.has(w));
    if (!tokens.length) continue;    // nothing distinctive to match on

    // Title or host only, not the snippet. A snippet is search-engine prose
    // about the page and routinely quotes the query back, so matching it
    // proves the search ran rather than that the page is theirs.
    const hay = `${r.title || ''} ${host}`.toLowerCase();
    if (!tokens.some((w) => hay.includes(w))) continue;

    candidate = host;
    why = `search result "${String(r.title || '').slice(0, 60)}" names them`;
    break;
  }

  checks.push({
    stage: 'search', method: 'serper', candidate_url: candidate || null,
    outcome: candidate ? 'found' : 'not_found',
    evidence: { query: q, results: organic.length, why: why || 'no non-platform result named them' },
  });
}

return {
  json: {
    ...b,
    stage_c_ran: ran,
    stage_c_candidate: candidate,
    // Stage D probes this first: a domain a search already surfaced is a far
    // better guess than one assembled from the business name.
    search_candidate_domain: candidate,
    website_checks: checks,
  },
};
