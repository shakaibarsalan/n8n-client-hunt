// CH-02, node: "Stage A: what did the source actually claim?"
// Mode: Run Once for All Items
//
// Cheapest stage, so it runs first. It decides what the Maps listing's
// website field MEANS, which is not the same as whether it is empty.
//
// Three outcomes:
//   'absent'   - no website field at all
//   'platform' - a field pointing at Facebook, Instagram, Linktree, a
//                directory, a booking platform, or a dead business.site.
//                Commercially this is the same prospect as 'absent', and
//                sometimes a better one.
//   'real'     - something that might genuinely be their own site
//
// The platform list comes from the platform_domains TABLE, not from a
// constant here, because it changes. business.site was a real website in 2023
// and a dead link by June 2024, and that change should be one UPDATE rather
// than an edit-and-reimport of this workflow.

const platforms = $('Load platform domains').all().map((i) => i.json);

const byDomain = new Map();
for (const p of platforms) {
  if (p.active === false) continue;
  byDomain.set(String(p.domain).toLowerCase(), p);
}

// See the same guard in merge-stage-b.js. An empty list here means a Facebook
// page or a dead business.site in the Maps website field is read as a real
// website, which throws away exactly the prospects this project exists to
// find. Silence is the dangerous outcome, so this refuses instead.
if (byDomain.size === 0) {
  throw new Error(
    'Stage A has an EMPTY platform list. "Load platform domains" returned no usable ' +
    'rows, so a social or directory URL in the Maps website field would be read as a ' +
    'real website and the lead discarded. Refusing to classify rather than classify ' +
    'wrongly.');
}

// Matches the host itself and any subdomain of it, so that
// "mysalon.wixsite.com" is caught by the "wixsite.com" row.
const classifyHost = (host) => {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return null;
  if (byDomain.has(h)) return byDomain.get(h);
  const parts = h.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join('.');
    if (byDomain.has(suffix)) return byDomain.get(suffix);
  }
  return null;
};

// Host extraction that does not depend on the sandbox providing URL. PROVEN
// necessary, not defensive: the n8n Code node sandbox does not expose a
// working URL constructor, confirmed in production by the host_parsed_by
// evidence field in merge-stage-b.js, which reported "regex" on a live run.
// Every `new URL()` in this project was therefore always throwing, and each
// site's catch block quietly did the wrong thing - here, returning '' makes a
// listing that HAS a website read as 'absent'.
const hostOf = (url) => {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    if (typeof URL === 'function') {
      const h = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s).hostname;
      if (h) return h;
    }
  } catch (e) { /* fall through to the regex, which needs no globals */ }
  return s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
          .split(/[/?#]/)[0]
          .split('@').pop()
          .split(':')[0];
};

// "Pick what needs checking" has alwaysOutputData set, so that this stage
// still runs (and CH-02 does not silently do nothing with no trace) even
// when there is nothing pending. But that means a zero-row query arrives
// here as ONE blank item ({}), not zero items - $input.all() is never
// actually empty. Without this filter, that blank item would be processed
// as if it were a real business (an empty name, an empty city, id:
// undefined) and pushed all the way through Stages B-F for real, wasting
// real HTTP and Serper calls on nothing, before eventually crashing far
// downstream on a NOT NULL violation when the verdict tries to write with
// business_id undefined - found running for real, id-less rows reaching
// "Write the verdict and the evidence" whenever the pending backlog was
// genuinely empty.
const out = [];

for (const item of $input.all().filter((i) => i.json && i.json.id != null)) {
  const b = item.json;
  const raw = String(b.source_website_raw || '').trim();

  let claim = 'absent';
  let socialOnly = false;
  let url = '';
  const socials = { ...(b.social_profiles || {}) };

  if (raw) {
    const host = hostOf(raw);
    const hit = classifyHost(host);
    if (hit) {
      claim = 'platform';
      // A social profile in the website field is a marketing channel they are
      // actively using, and that is a buying signal - they already care about
      // being findable and have nowhere of their own to send people.
      if (hit.counts_as_social) {
        socialOnly = true;
        socials[hit.kind === 'shortener' ? 'linkinbio' : hit.domain.split('.')[0]] = raw;
      }
    } else if (host) {
      claim = 'real';
      url = raw;
    }
  }

  // Social presence from the listing itself counts too, even when the website
  // field was simply empty.
  if (claim !== 'real' && Object.keys(socials).length) socialOnly = true;

  out.push({
    json: {
      ...b,
      social_profiles: socials,
      stage_a_claim: claim,
      stage_a_url: url,
      stage_a_social_only: socialOnly,
      website_checks: [{
        stage: 'source',
        method: 'maps.website_field',
        candidate_url: raw || null,
        outcome: claim === 'real' ? 'found' : (raw ? 'rejected' : 'not_found'),
        evidence: { claim, raw_value: raw, social_only: socialOnly },
      }],
    },
  });
}

return out;
