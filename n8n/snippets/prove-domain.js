// CH-02, node: "Stage D: prove the domain"
// Mode: Run Once for Each Item
//
// NOTE ON COMMENTS IN THIS FILE: n8n validates a Code node body as raw text
// and does not skip comments. Naming a disallowed accessor here - even to
// explain a past bug - is rejected exactly like calling one. So the accessors
// that are illegal in per-item mode are not written down anywhere below.
//
// ---------------------------------------------------------------------------
// A business name is not a website. Turn it into candidate domains, fetch
// each one, and keep it ONLY if the page proves it belongs to this business.
//
// Ported from job-hunt-automation/n8n/workflows/05-find-companies.json, node
// "Find and prove their website", which earned each of these rules:
//
//   * a parked domain answers 200 and proves nothing
//   * a placeholder page whose title is just the domain proves nothing
//   * evidence must scale with the size of the guess. A domain built from the
//     whole name is a small leap. A domain built from one word out of four is
//     a large one: "Anchor QX chemical industries" became anchor.com, and
//     anchor.com does say "anchor" somewhere.
//   * when a name has no distinctive word, REFUSE. An earlier version treated
//     "nothing to check" as "check passed" and matched "Zed Example
//     Solutions" to zed.com, an unrelated agency.
//
// Added here, and the most important rule in this project:
//
//   * UNKNOWN IS NOT A PASS. A fetch that times out is `unreachable`, never
//     "no website". The same repo shipped a bug where a timed-out probe was
//     read as proof of absence. Here that mistake would send an email opening
//     "I noticed you don't have a website" to somebody who does.

const biz = $json;
const CFG = $('Config').first().json;

const UA = CFG.user_agent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = Number(CFG.probe_timeout_ms || 9000);
const MAX_PROBES = Number(CFG.max_probes_per_business || 8);

const checks = [...(biz.website_checks || [])];   // carried forward from A/B/C
const record = (method, url, outcome, evidence) =>
  checks.push({ stage: 'probe', method, candidate_url: url || null, outcome, evidence: evidence || {} });

// The Maps listing naming its own site is the business speaking for itself.
// Probing anyway would cost up to eight HTTP fetches per business to
// re-answer a question that is closed.
if (biz.stage_a_claim === 'real') {
  return {
    json: {
      ...biz,
      probe_result: 'skipped',
      probe_looked: false,
      probe_candidates_tried: 0,
      probe_why: 'a website was already established before this stage',
      website_checks: checks,
    },
  };
}

// A site an open dataset holds is NOT the same thing, and used to be treated
// as if it were. Stage B pairs a business with a dataset place mostly by
// phone number, and a phone number is shared far more often than it looks: a
// salon chair rented inside a clinic, a booking line for a whole building, an
// agent's mobile on two listings. The dataset place is then somebody else, and
// so is its website.
//
// Found for real in the outreach queue, 7 of 9 drafts (names and domains
// below are fictional stand-ins for the real rows):
//   "Beauty Care by KN"          -> klinikk-a.test     (the clinic she works in)
//   "Fjordlys Frisor og ..."     -> nabo-klinikk.test  (a neighbour)
//   "Xy eiendom"                 -> megler-f.test
// Each was believed, Stage F then found an email on that other business's
// site, and the draft would have told the clinic its website "could be
// working harder" - about somebody else's business.
//
// So the dataset's site is now the FIRST candidate this stage proves, under
// exactly the rules every guessed domain has to pass.
const hostOf = (url) => String(url || '').trim()
  .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  .split(/[/?#]/)[0]
  .split('@').pop()
  .split(':')[0]
  .toLowerCase()
  .replace(/^www\./, '');
const datasetUrl = String(biz.stage_b_website || '');
const datasetHost = datasetUrl ? hostOf(datasetUrl) : '';

// --- 1. Build the evidence vocabulary --------------------------------------
// Words distinctive enough to count as proof. "the" proves nothing, and
// neither does "salon", "beauty" or "estate" - they are on half the web, and
// certainly on every competitor's page in the same niche.
const GENERIC = new Set([
  'salon', 'salong', 'beauty', 'hair', 'spa', 'nails', 'barber', 'studio',
  'peluqueria', 'estetica', 'parrucchiere', 'frisor', 'kapper',
  'real', 'estate', 'realty', 'properties', 'property', 'homes', 'immobilien',
  'inmobiliaria', 'immobiliare', 'eiendom', 'megler', 'realtor',
  'centre', 'center', 'clinic', 'shop', 'store', 'house', 'home',
  'and', 'the', 'for', 'your', 'best', 'new', 'city',
]);

const words = String(biz.name_norm || '').split(/\s+/).filter(Boolean);
const core = words.filter((w) => !GENERIC.has(w));
const proof = words.filter((w) => w.length >= 4 && !GENERIC.has(w));

// If nothing distinctive survives, this name cannot be proved either way.
// Refusing here is not a gap in coverage; it is the check working. A salon
// literally called "Beauty Salon" cannot be matched to beautysalon.no with
// any confidence at all.
if (!proof.length) {
  record('name.no-distinctive-token', null, 'skipped',
    { name_norm: biz.name_norm, why: 'no distinctive word to prove a domain with' });
  // With a dataset site on file, keep believing it - the old behaviour - but
  // say it was never proved. Throwing it away instead would turn a business
  // that may well have a site into a "no website" pitch, which is the worse
  // of the two mistakes. CH-04's address check is what stops an email going
  // to that site's mailbox unproved.
  if (datasetHost) {
    return {
      json: {
        ...biz,
        probe_result: 'skipped',
        probe_looked: false,
        probe_candidates_tried: 0,
        probe_why: `an open dataset lists ${datasetHost}, but the name has no distinctive word to prove it with`,
        stage_b_unverified: true,
        website_checks: checks,
      },
    };
  }
  return {
    json: {
      ...biz,
      probe_result: 'refused',
      probe_looked: true,
      probe_candidates_tried: 0,
      probe_why: 'name has no distinctive word - refusing to guess',
      website_checks: checks,
    },
  };
}

// --- 2. Candidate domains ---------------------------------------------------
const basis = core.length ? core : words;
const stem = basis.join('');
const firstWord = basis[0] || '';
const full = words.join('');
const hyphen = basis.join('-');

// Country TLDs come from the search target, not from a constant. A Norwegian
// salon is on .no far more often than .com, and trying .com first wastes the
// probe budget on the wrong guesses.
const tlds = Array.isArray(biz.cctlds) && biz.cctlds.length
  ? biz.cctlds
  : ['.com'];

const candidates = [];
for (const s of [stem, firstWord, full, hyphen]) {
  if (!s || s.length < 4) continue;
  for (const t of tlds) {
    const d = s + t;
    if (!candidates.includes(d)) candidates.push(d);
  }
}

// A domain the search stage already surfaced is the strongest candidate we
// have, so it is probed first rather than after four guesses.
if (biz.search_candidate_domain) {
  const c = String(biz.search_candidate_domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (c) candidates.unshift(c);
}

// The dataset's own site goes ahead of everything: it is the claim this
// business would otherwise be classified on, so it is the one to settle.
if (datasetHost) {
  const i = candidates.indexOf(datasetHost);
  if (i >= 0) candidates.splice(i, 1);
  candidates.unshift(datasetHost);
}
let datasetUnreachable = false;

// --- 3. Probe ---------------------------------------------------------------
const titleOf = (html) => {
  const m = String(html).match(/<title[^>]*>([^]*?)<\/title>/i);
  //                                        ^^^ [^] is "any character including
  // newlines" and contains no backslash. The obvious [\s\S] does not survive
  // being written inside a single-quoted string - JS drops the backslash on an
  // unknown escape, so it compiles as [sS] and matches only the letters s
  // and S. That silently emptied every title in the job-hunt repo.
  return m ? m[1].replace(/\s+/g, ' ').trim().toLowerCase() : '';
};

const PARKED = /(domain (is )?for sale|buy this domain|parked (free )?courtesy|this domain may be for sale|godaddy\.com\/domain|namecheap\.com\/domains|sedo\.com|hugedomains)/;

let hit = '';
let hitText = '';
let why = '';
let looked = false;          // did ANY probe actually complete?
let tried = 0;

for (const cand of candidates.slice(0, MAX_PROBES)) {
  tried++;
  let html = '';
  try {
    html = await this.helpers.httpRequest({
      url: 'https://' + cand,
      method: 'GET',
      timeout: TIMEOUT,
      headers: { 'User-Agent': UA },
    });
  } catch (e) {
    // A DNS failure is real evidence of absence. A timeout or a 403 is not:
    // the site may exist and simply not want to talk to us. Only the former
    // counts towards "we looked".
    const msg = String(e && e.message || e);
    const dnsMiss = /ENOTFOUND|EAI_AGAIN|getaddrinfo|NXDOMAIN/i.test(msg);
    if (dnsMiss) looked = true;
    record('probe.' + cand, 'https://' + cand,
      dnsMiss ? 'not_found' : 'unreachable', { error: msg.slice(0, 200) });
    // The dataset's site would not answer, so it can be neither proved nor
    // refuted. It stays believed, as before, and guessing further domains
    // could not change that verdict - so stop spending fetches.
    if (cand === datasetHost && !dnsMiss) {
      datasetUnreachable = true;
      break;
    }
    continue;
  }

  looked = true;
  const text = String(html || '').toLowerCase();

  if (text.length < 500) {
    record('probe.' + cand, 'https://' + cand, 'rejected', { why: 'page too short to judge' });
    continue;
  }
  if (PARKED.test(text)) {
    record('probe.' + cand, 'https://' + cand, 'rejected', { why: 'parked domain' });
    continue;
  }

  const title = titleOf(text);
  const bare = cand.replace(/\.[a-z.]+$/, '');
  if (!title || title === cand || title === bare) {
    record('probe.' + cand, 'https://' + cand, 'rejected', { why: 'placeholder title' });
    continue;
  }

  // --- does the domain actually stand for the whole name? -----------------
  //
  // The original rule keyed off `proof.length > 1`, which silently switched
  // itself off whenever a name reduced to ONE distinctive word. "Salong
  // <Word>" is such a name: "salong" is generic in this niche, leaving the one
  // word. The candidate <word>.no then passed on a single title match - and
  // that domain belonged to an energy company. Marking a real prospect HAS_WEBSITE drops them from the
  // list permanently, which is the more expensive of the two mistakes.
  //
  // So the test is about COVERAGE, not token count: if the domain leaves part
  // of the business name out, the page has to mention the missing part.
  // Generic words count as corroboration here even though they are not proof
  // on their own - a hairdresser's own site says "salong" somewhere, and an
  // energy company's does not.
  const local = cand.replace(/\..*$/, '').replace(/-/g, '');
  const omitted = words.filter((w) => w.length >= 3 && !local.includes(w));
  if (omitted.length) {
    const corroborated = omitted.some((w) => text.includes(w));
    if (!corroborated) {
      record('probe.' + cand, 'https://' + cand, 'rejected', {
        why: 'domain covers only part of the name and the page never mentions the rest',
        omitted, title: titleOf(text),
      });
      continue;
    }
  }

  const inTitle = proof.filter((w) => title.includes(w)).length;
  const inBody = proof.filter((w) => text.includes(w)).length;
  const stemHit = stem.length >= 6 && text.includes(stem);

  // How big a leap is this candidate?
  //
  // Two cases need the TITLE to name the business rather than merely
  // containing one of its words somewhere on the page:
  //
  //   1. A domain built from one word out of several.
  //
  //   2. A domain that shares NO word with the business name at all. These
  //      arrive from Stage C or an open dataset, and they are the dangerous ones,
  //      because the thing a search most often turns up for a business with no
  //      site is a DIRECTORY of that niche - and a directory of salons
  //      contains precisely the words a salon's own site contains.
  //
  //      Measured: a lash-and-foot-spa salon was matched to
  //      neglesalonger.com - Norwegian for "nail salons" - because a page
  //      listing many salons naturally says "lash" and "extensions". That is a
  //      false HAS_WEBSITE, and a false HAS_WEBSITE deletes a real prospect
  //      from the list permanently.
  const sharesNothing = !words.some((w) => w.length >= 4 && local.includes(w));
  const guessedFromOneWord = (cand.startsWith(firstWord + '.') && proof.length > 1)
                             || sharesNothing;

  if (guessedFromOneWord) {
    const named = proof.filter((w) => title.includes(w)).length;
    if (named >= Math.min(2, proof.length)) {
      hit = cand; hitText = text; why = 'short domain, and the page title names them';
      record('probe.' + cand, 'https://' + cand, 'found', { title, matched_in_title: named });
      break;
    }
    record('probe.' + cand, 'https://' + cand, 'rejected',
      { why: 'one-word domain, title does not name them', title });
    continue;
  }

  if (inTitle >= 1) {
    hit = cand; hitText = text; why = 'named in the page title';
    record('probe.' + cand, 'https://' + cand, 'found', { title, matched_in_title: inTitle });
    break;
  }
  if (stemHit) {
    hit = cand; hitText = text; why = 'full name appears on the page';
    record('probe.' + cand, 'https://' + cand, 'found', { title });
    break;
  }
  if (inBody >= 2) {
    hit = cand; hitText = text; why = 'two distinctive words appear on the page';
    record('probe.' + cand, 'https://' + cand, 'found', { title, matched_in_body: inBody });
    break;
  }

  record('probe.' + cand, 'https://' + cand, 'rejected',
    { why: 'page did not name the business', title });
}

// --- Is this site THEIRS, or just a site with the same name? ---------------
//
// A name match proves the name, not the business. An Oslo trading AS was
// matched to the .com of a same-named Slovak fuel company, because the title
// said "<NAME> TRADING". With sending automatic, that is an email
// to the wrong company in the wrong country. So a found site is checked for
// something only the real business would carry: its phone number (the last
// eight digits, in any formatting) or at least two distinctive words of its
// street address. The result is recorded, and CH-04 only auto-approves a
// draft whose site was corroborated - anything else waits for a human.
const foldText = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\u00f8/g, 'o').replace(/\u00e6/g, 'ae').replace(/\u00e5/g, 'a')
  .replace(/[^a-z0-9]+/g, ' ');
const ADDRESS_NOISE = new Set([
  'office', 'floor', 'street', 'building', 'tower', 'road', 'suite', 'level',
  'dubai', 'united', 'arab', 'emirates', 'norway', 'norge', 'oslo', 'sharjah',
]);
const corroborate = (page) => {
  const digits = String(biz.phone_e164 || '').replace(/[^0-9]/g, '');
  if (digits.length >= 8) {
    const tail = digits.slice(-8).split('').join('[^0-9a-z]{0,2}');
    if (new RegExp('(^|[^0-9])' + tail + '([^0-9]|$)').test(String(page))) return 'phone';
  }
  const words = [...new Set(foldText(biz.address).split(' ')
    .filter((w) => w.length >= 5 && !/^[0-9]+$/.test(w) && !ADDRESS_NOISE.has(w)))];
  if (words.length) {
    const hay = ' ' + foldText(page) + ' ';
    const seen = words.filter((w) => hay.includes(' ' + w + ' ')).length;
    if (seen >= Math.min(2, words.length)) return 'address';
  }
  return 'none';
};

// --- 4. What became of the dataset's site? ----------------------------------
const datasetCheck = datasetHost
  ? checks.find((c) => c.stage === 'probe' && c.candidate_url === 'https://' + datasetHost)
  : null;
if (datasetCheck) {
  datasetCheck.evidence = { ...datasetCheck.evidence, source: 'open dataset', dataset_url: datasetUrl };
}

if (datasetUnreachable) {
  return {
    json: {
      ...biz,
      probe_result: 'skipped',
      probe_looked: false,
      probe_candidates_tried: tried,
      probe_why: `an open dataset lists ${datasetHost}, which did not answer - it could not be proved or refuted`,
      stage_b_unverified: true,
      website_checks: checks,
    },
  };
}

// Fetched and not theirs (or no longer resolving). The dataset site stops
// counting as their website, and - just as important - the dataset match it
// came from stops counting as evidence they have NO website: it matched
// somebody else. classify-website.js reads stage_b_disproved for exactly that.
const disproved = datasetHost && hit !== datasetHost
  ? {
    stage_b_website: '',
    stage_b_disproved: datasetUrl,
    stage_b_disproved_why: (datasetCheck && datasetCheck.evidence && datasetCheck.evidence.why)
      || (datasetCheck && datasetCheck.outcome === 'not_found' ? 'domain does not resolve' : 'not proved'),
  }
  : {};

const corroboration = hit ? corroborate(hitText) : 'none';
if (hit) {
  const foundCheck = checks.find((c) => c.stage === 'probe' && c.outcome === 'found'
    && c.candidate_url === 'https://' + hit);
  if (foundCheck) foundCheck.evidence = { ...foundCheck.evidence, corroborated: corroboration };
  return {
    json: {
      ...biz,
      ...disproved,
      probe_result: 'found',
      probe_looked: true,
      probe_candidates_tried: tried,
      probe_domain: hit,
      probe_url: 'https://' + hit,
      probe_why: hit === datasetHost ? `the open dataset's site - ${why}` : why,
      probe_corroborated: corroboration,
      website_checks: checks,
    },
  };
}

// Nothing found. Whether that MEANS anything depends entirely on whether we
// managed to look. This distinction is the whole safeguard.
return {
  json: {
    ...biz,
    ...disproved,
    probe_result: looked ? 'not_found' : 'unreachable',
    probe_looked: looked,
    probe_candidates_tried: tried,
    probe_why: looked
      ? `probed ${tried} candidate domain(s), none proved to belong to this business`
      : `probed ${tried} candidate domain(s) and could not reach any of them - this proves nothing`,
    website_checks: checks,
  },
};
