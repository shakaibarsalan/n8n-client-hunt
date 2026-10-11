// CH-02, node: "Stage E: is the site any good?"
// Mode: Run Once for Each Item
//
// Only runs when a website was actually established. Turns "they have a site"
// into "they have a site that loads in 11 seconds on a phone and has no
// HTTPS", which is a different and frequently better sales conversation: the
// owner already believes a website matters, so the argument is about quality
// rather than about whether to have one at all.
//
// PageSpeed Insights is free - 25,000 requests a day - but that quota is
// shared globally across all callers rather than granted per key, so it is a
// soft limit. A failure here degrades the lead to a plain HAS_WEBSITE; it
// never blocks the pipeline and never invents a score.

const b = $json;
const CFG = $('Config').first().json;

const url = b.probe_result === 'found'
  ? 'https://' + b.probe_domain
  : (b.stage_a_url || b.stage_b_website || '');

if (!url) {
  return { json: { ...b, psi: null } };
}

const checks = [...(b.website_checks || [])];

// HTTPS is KNOWN only when the site was actually fetched over HTTPS - which is
// exactly what Stage D does when it proves a domain. An http:// address we
// merely hold proves nothing: the open datasets store most addresses as
// http:// whether or not the site redirects to HTTPS.
//
// Reading the scheme off the stored URL made every one of the first 30
// WEAK_WEBSITE leads weak for the same reason, "no HTTPS" - and their drafts
// told working, secure sites they "could be working harder". Unknown is
// recorded as null, which the classifier treats as no evidence either way.
const https = b.probe_result === 'found' || /^https:/i.test(url) ? true : null;

let psi = { https, performance: 0, mobile_friendly: null, measured: false };

const key = CFG.pagespeed_api_key || '';
try {
  // Built by hand: the Code node sandbox has no URLSearchParams, any more than
  // it has URL. This line used `new URLSearchParams(...)`, which threw on every
  // call - so PageSpeed never measured a single site in production, and every
  // "weak website" verdict rested on the http:// scheme alone. The evidence
  // rows said so ("URLSearchParams is not defined") and nobody read them.
  const params = { url, strategy: 'mobile', category: 'performance' };
  if (key) params.key = key;
  const q = Object.keys(params)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  const res = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + q,
    json: true,
    timeout: Number(CFG.psi_timeout_ms || 60000),
  });

  const lh = res && res.lighthouseResult;
  const score = lh && lh.categories && lh.categories.performance
    ? Number(lh.categories.performance.score) * 100
    : 0;

  // A viewport audit that fails is the clearest single signal of a site built
  // before phones mattered, which is most of what this project will find.
  const viewport = lh && lh.audits && lh.audits['viewport'];
  const mobileFriendly = viewport ? viewport.score !== 0 : null;

  psi = {
    https,
    performance: score,
    mobile_friendly: mobileFriendly,
    measured: true,
    final_url: lh && lh.finalUrl,
  };

  checks.push({
    stage: 'quality', method: 'pagespeed.mobile', candidate_url: url, outcome: 'found',
    evidence: { performance: score, mobile_friendly: mobileFriendly, https },
  });
} catch (e) {
  // Unmeasured is not "fine" and not "bad". It is unmeasured, and the
  // classifier treats a missing performance number as no evidence either way
  // rather than as a passing grade.
  checks.push({
    stage: 'quality', method: 'pagespeed.mobile', candidate_url: url, outcome: 'unreachable',
    evidence: { error: String(e && e.message || e).slice(0, 200), https },
  });
}

return { json: { ...b, psi, website_checks: checks } };
