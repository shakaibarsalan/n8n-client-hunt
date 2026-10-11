// Stage F, against saved pages instead of the live web - same reasoning as
// Stage D's test: one live fetch produces a fixture that supports a hundred
// iterations, and the failure modes here (junk addresses, sites that only
// reveal an address on a /contact page) are exactly the shapes Stage D
// guards against for domains.
//
// Every site and address here is fictional. Domains sit under example.no /
// example.ae because Stage F only accepts a known TLD - a .test address would
// be refused for its TLD and prove nothing about the rule under test.

const { compile, ok, eq, done } = require('./helpers');

const findEmail = compile(
  'CH-02-verify.json', 'Stage F: find a contact email', { $json: null, $: null });

const CONFIG = [{ user_agent: 'test', probe_timeout_ms: 1000 }];

const page = (body) => `<!doctype html><html><body>${body}${'x'.repeat(600)}</body></html>`;

const WEB = {
  // A real mailto: link - the strongest signal.
  'https://studio-a.example.no': page('<a href="mailto:hello@studio-a.example.no">Email us</a>'),

  // No email on the homepage, but the contact page has one.
  'https://klinikk-b.example.no': page('<p>Welcome</p>'),
  'https://klinikk-b.example.no/contact': page('<a href="mailto:kn@klinikk-b.example.no">Contact KN</a>'),

  // A page whose only addresses are junk - error reporting, a wixpress
  // placeholder, a literal tutorial example. None should be picked.
  'https://junky.example.no': page(
    '<img src="x.png" onerror="sentry@sentry.io.track()">' +
    '<span>owner: admin@wixpress.com</span>' +
    '<p>contact: you@example.com</p>'),

  // Real bugs found running Stage F against real sites this session: a
  // "you@company.com" boilerplate placeholder (found on an Oslo salon's
  // real site), an image filename's "@2x" resolution suffix parsed as an
  // email ("...600x600@2x.heic", found for real on a Real Estate listing's
  // gallery page), and a real address glued to trailing text with no
  // separator so the bare TLD group swallowed it whole ("...commob", found
  // for real as a ".com" address immediately followed by "mob:+971...").
  'https://placeholder.example.no': page('<p>Contact us: you@company.com</p>'),
  'https://imagejunk.example.no': page('<img src="photos/img_8626_600x600@2x.heic" alt="listing">'),
  // Shaped on a Dubai property agency's site: the only address on the page is
  // the WordPress author account inside JSON-LD - the site builder's gmail,
  // not a contact anybody published.
  'https://jsonldonly.example.ae': '<!doctype html><html><head>' +
    '<script type="application/ld+json">{"@type":"Person","name":"site-builder@builder.example.ae",' +
    '"author":{"name":"site-builder@builder.example.ae"}}</script>' +
    '<meta name="author" content="dev@agency.example.ae"><style>/* ops@css.example */</style>' +
    '</head><body><!-- todo: admin@hidden.example.ae --><p>Call us on WhatsApp</p>' + 'x'.repeat(600) + '</body></html>',
  'https://visible.example.ae': '<!doctype html><html><head>' +
    '<script type="application/ld+json">{"author":{"name":"site-builder@builder.example.ae"}}</script>' +
    '</head><body><p>Write to us: sales@visible.example.ae</p>' + 'x'.repeat(600) + '</body></html>',
  'https://frenchplaceholder.example.no': page('<p>Contact: name@domaine.com or you@yourdomain.com</p>'),
  'https://runontext.example.ae': page('<p>Email: jane.doe@example-agency.commob: +971 50 000 0000</p>'),

  // Two real-looking addresses: one on the business's own domain, one at a
  // generic mail provider. The own-domain one must win.
  'https://twoaddresses.example.no': page(
    '<a href="mailto:info@freemail.example.no">Info</a> ' +
    '<a href="mailto:hei@twoaddresses.example.no">Hei</a>'),
};

const httpRequest = async ({ url }) => {
  if (url in WEB) return WEB[url];
  const e = new Error('getaddrinfo ENOTFOUND ' + url);
  throw e;
};
const THIS = { helpers: { httpRequest } };

const biz = (over) => ({
  name: 'Studio A', website_status: 'HAS_WEBSITE', website_url: 'https://studio-a.example.no',
  website_checks: [], ...over,
});

const run = async (b) =>
  (await findEmail({ $json: b, $: () => ({ first: () => ({ json: CONFIG[0] }) }) }, THIS)).json;

(async () => {
  console.log('stage F: find a contact email\n');

  // --- not applicable at all ------------------------------------------
  {
    const r = await run(biz({ website_status: 'NO_WEBSITE_CONFIRMED', website_url: null }));
    eq('a confirmed no-website lead has nowhere to look', r.contact_email, '');
    eq('and says so explicitly, not silently', r.contact_email_source, 'not_applicable');
  }
  {
    const r = await run(biz({ website_status: 'WEBSITE_UNCERTAIN' }));
    eq('an uncertain lead is not eligible either', r.contact_email, '');
  }

  // --- finds a real mailto: link -----------------------------------------
  {
    const r = await run(biz());
    eq('a real mailto link is found', r.contact_email, 'hello@studio-a.example.no');
    eq('and the source is recorded', r.contact_email_source, 'mailto_link');
  }

  // --- falls through to a contact page when the homepage has nothing -----
  {
    const r = await run(biz({ name: 'Beauty Care by KN', website_url: 'https://klinikk-b.example.no' }));
    eq('found on the contact page after the homepage came up empty',
      r.contact_email, 'kn@klinikk-b.example.no');
  }

  // --- junk is filtered, not picked as a fallback -------------------------
  {
    const r = await run(biz({ name: 'Junky', website_url: 'https://junky.example.no' }));
    eq('sentry, wixpress and example addresses are all rejected',
      r.contact_email, '');
    eq('and it is reported as genuinely not found, not an error',
      r.contact_email_source, 'not_found');
  }

  // --- three real bugs found running this against real sites -------------
  {
    const r = await run(biz({ name: 'Placeholder Salon', website_url: 'https://placeholder.example.no' }));
    eq('a company.com placeholder is rejected like example.com is',
      r.contact_email, '');
  }
  {
    const r = await run(biz({ name: 'Image Junk', website_url: 'https://imagejunk.example.no' }));
    eq('an image filename\'s @2x suffix is not mistaken for an email',
      r.contact_email, '');
  }
  {
    const r = await run(biz({ name: 'Run-on Text', website_url: 'https://runontext.example.ae' }));
    eq('a real address glued to trailing text with no separator is refused, not truncated to a guess',
      r.contact_email, '');
  }

  // --- prefers the business's own domain over a generic address ----------
  {
    const r = await run(biz({ name: 'Two Addresses', website_url: 'https://twoaddresses.example.no' }));
    eq('the own-domain address wins over a free-mail address',
      r.contact_email, 'hei@twoaddresses.example.no');
  }

  // --- an unreachable site is not silently empty --------------------------
  {
    const r = await run(biz({ name: 'Gone', website_url: 'https://gone-forever.example.no' }));
    eq('no email found', r.contact_email, '');
    const c = r.website_checks.find((x) => x.outcome === 'unreachable' || x.outcome === 'not_found');
    ok('a check row exists recording what happened', Boolean(c), JSON.stringify(r.website_checks));
  }

  // --- only addresses a visitor can SEE count as page text ---------------
  {
    const r = await run(biz({ name: 'Json Ld Only', website_url: 'https://jsonldonly.example.ae' }));
    eq('an address only in script metadata, meta tags, styles or comments is not a contact',
      r.contact_email, '');
  }
  {
    const r = await run(biz({ name: 'Visible And Jsonld', website_url: 'https://visible.example.ae' }));
    eq('a visible address is still found next to hidden metadata',
      r.contact_email, 'sales@visible.example.ae');
  }

  {
    const r = await run(biz({ name: 'French Placeholder', website_url: 'https://frenchplaceholder.example.no' }));
    eq('template placeholders like name@domaine.com are not contacts', r.contact_email, '');
  }
  {
    const r = await run(biz({ name: 'Domaine Dupont', website_url: 'https://twoaddresses.example.no' }));
    ok('a real domain merely containing a placeholder word is untouched', r.contact_email !== '', r.contact_email);
  }

  done('stage F: find a contact email');
})();
