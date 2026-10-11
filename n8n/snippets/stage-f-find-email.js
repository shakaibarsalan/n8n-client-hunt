// CH-02, node: "Stage F: find a contact email"
// Mode: Run Once for Each Item
//
// Only runs for businesses a real website was found for. For the businesses
// this project actually wants to reach - the ones with NO website - there is
// nowhere for this stage to look, and it correctly finds nothing.
//
// That asymmetry is worth being honest about up front: the leads highest in
// value here (confirmed no website) are structurally the leads least likely
// to have a discoverable email. This stage does not solve that; it only
// stops HAS_WEBSITE and WEAK_WEBSITE leads from being emailed blind.

const b = $json;
const CFG = $('Config').first().json;

const eligible = b.website_status === 'HAS_WEBSITE' || b.website_status === 'WEAK_WEBSITE';
if (!eligible || !b.website_url) {
  return { json: { ...b, contact_email: '', contact_email_source: 'not_applicable' } };
}

const UA = CFG.user_agent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Addresses that exist on a page but are not a real contact route. Image
// CDNs and theme boilerplate leave these behind constantly - sentry.io error
// reporting addresses, wixpress placeholder accounts, and the literal
// "you@example.com" every contact-form tutorial copies verbatim.
const JUNK = /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|abuse|webmaster|sentry|test|admin@wixpress|wix@wix)/i;
// example.com/.org/.net are RFC 2606 reserved for documentation - every
// "you@example.com" copied verbatim out of a contact-form tutorial lands
// here. Caught by DOMAIN, not by the local-part prefix list above: the first
// version only checked the start of the address ("^example"), which matches
// "example@..." but not "you@example.com" - the reserved word is on the
// other side of the @. Confirmed missed on a fixture built for exactly this.
// company.com is the same shape of problem with a different literal - the
// generic placeholder every "you@company.com" contact-form template ships
// with. Found for real on an Oslo salon's site.
// Template placeholders in other languages and shapes too: name@domaine.com
// (French "domaine") was found on a real Oslo business's site, alongside the
// usual you@yourdomain.com / mail@yoursite.com family.
const JUNK_DOMAIN = /\.(png|jpg|jpeg|gif|svg|webp|heic|avif|bmp|tiff?|ico)$|sentry\.io|wixpress\.com|godaddy\.com|schema\.org|example\.(com|org|net)$|(?<![a-z0-9-])company\.com$|(?<![a-z0-9-])(your-?)?(domaine?|site|website|email)\.(com|net|org)$/i;

// A real-world TLD allowlist, not an attempt at RFC completeness. The bare
// character class below has no length limit, so it will happily swallow run-
// on text with no separator into what it treats as the TLD - found for real
// as "<name>@<company>.commob" (the page read "...<company>.com
// mob:+971..." with no space) and as an image filename's "@2x" resolution
// suffix parsed as a whole address ("...600x600@2x.heic" -> domain "2x.heic").
// Neither "commob" nor "heic" is a real TLD; checking against a known list
// catches both classes at once without trying to regex-detect run-on text
// directly, which the JUNK_DOMAIN extension list above cannot do (a length
// bound alone would not reject "commob" - six letters is a perfectly
// ordinary TLD length). An unrecognised TLD is refused outright rather than
// guessed at (e.g. trimmed back to "com") - the same "refuse rather than
// guess" rule Stage D applies to domain candidates.
const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'info', 'biz', 'co', 'io', 'me', 'tv', 'app',
  'shop', 'store', 'studio', 'online', 'xyz',
  'no', 'se', 'dk', 'ae', 'sa', 'qa', 'es', 'it', 'pt', 'ca',
]);
const hasKnownTld = (addr) => {
  const tld = addr.split('.').pop();
  return KNOWN_TLDS.has(tld);
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const isJunk = (addr) => JUNK.test(addr) || JUNK_DOMAIN.test(addr) || !hasKnownTld(addr);

const extract = (html) => {
  const found = new Set();
  const text = String(html || '');
  // mailto: links are the strongest signal - the page author put this there
  // on purpose, as opposed to an address that merely appears in a script tag
  // or a tracking pixel URL. That does not make a mailto: link immune to
  // junk, though - a template's placeholder contact link is still a mailto:
  // link - so the same filter applies here too, not only to plain page text.
  const mailtoRe = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let m;
  const mailtos = new Set();
  while ((m = mailtoRe.exec(text))) {
    const addr = m[1].toLowerCase();
    if (isJunk(addr)) continue;
    mailtos.add(addr);
  }

  // The page-text pass reads only what a visitor can SEE. Scripts, styles,
  // comments and meta tags carry addresses nobody published as a contact -
  // found for real on a Dubai property agency's site, whose only address was
  // the WordPress author account in its JSON-LD metadata (the site builder's
  // gmail). The draft would have told the person who built the site that the
  // site was weak.
  const visible = text
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<meta\b[^>]*>/gi, ' ');

  let g;
  while ((g = EMAIL_RE.exec(visible))) {
    const addr = g[0].toLowerCase();
    if (isJunk(addr)) continue;
    found.add(addr);
  }
  return { mailtos, all: found };
};

// Best match: an address on the business's OWN domain beats a generic gmail
// address beats nothing. A gmail/outlook address is common for a one-person
// salon and is not itself a red flag the way it would be for a company site.
const pickBest = (candidates, domain) => {
  const onDomain = [...candidates].filter((a) => domain && a.endsWith('@' + domain));
  if (onDomain.length) return onDomain[0];
  return candidates.size ? [...candidates][0] : '';
};

// No working URL constructor in the sandbox (proven in production - see
// merge-stage-b.js), so both the host and the contact-page URLs below are
// built by string work instead. Previously the catch here left `domain`
// blank, which silently disabled the "prefer an address on the business's
// own domain" rule.
const splitUrl = (url) => {
  const s = String(url || '').trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s;
  const scheme = withScheme.slice(0, withScheme.indexOf('://') + 3);
  const rest = withScheme.slice(scheme.length);
  const hostPart = rest.split(/[/?#]/)[0];
  return { origin: scheme + hostPart, host: hostPart.split('@').pop().split(':')[0].toLowerCase() };
};

const parsed = splitUrl(b.website_url);
const domain = parsed.host.replace(/^www\./, '');

const checks = [...(b.website_checks || [])];
let email = '';
let source = 'not_found';

const pagesToTry = [b.website_url];
// A contact page is worth one extra fetch: many sites keep the email off the
// homepage entirely. Norwegian and English paths cover both target markets.
for (const path of ['/contact', '/contact-us', '/kontakt', '/about']) {
  // Was `new URL(path, b.website_url)`, which threw every time, so this list
  // never grew past the homepage and the contact pages - where a small
  // business most often puts its address - were never fetched at all.
  if (parsed.origin) pagesToTry.push(parsed.origin + path);
}

for (const url of pagesToTry.slice(0, 3)) {   // homepage + at most two more
  let html;
  try {
    html = await this.helpers.httpRequest({
      url, method: 'GET', timeout: Number(CFG.probe_timeout_ms || 9000),
      headers: { 'User-Agent': UA },
    });
  } catch (e) {
    checks.push({ stage: 'quality', method: 'email.' + url, candidate_url: url,
                  outcome: 'unreachable', evidence: { error: String(e.message || e).slice(0, 150) } });
    continue;
  }

  const { mailtos, all } = extract(html);
  const best = pickBest(mailtos, domain) || pickBest(all, domain);
  if (best) {
    email = best;
    source = mailtos.has(best) ? 'mailto_link' : 'page_text';
    checks.push({ stage: 'quality', method: 'email.' + url, candidate_url: url,
                  outcome: 'found', evidence: { email: best, via: source } });
    break;
  }
  checks.push({ stage: 'quality', method: 'email.' + url, candidate_url: url,
                outcome: 'not_found', evidence: {} });
}

return {
  json: {
    ...b,
    contact_email: email,
    contact_email_source: source,
    website_checks: checks,
  },
};
