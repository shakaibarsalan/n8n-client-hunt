// CH-08, node: "Build the concept"
// Mode: Run Once for All Items
//
// The cold email promises "a quick website concept". When someone says yes,
// /concept <id> builds one: a single self-contained HTML page (no images or
// fonts to fetch, so it opens offline on a phone) in the business's name,
// coloured and laid out for its kind of business, with their real phone,
// WhatsApp, address and socials. Content we cannot know - dishes, prices,
// photos - is shown as clearly marked samples.
//
// The owner opens it from Telegram, takes screenshots, and sends them in his
// reply. Output: a file item (binary "data") or, if nothing matched, a text.

const b = $('Find the business').first().json || {};
const asked = $('From the owner?').first().json.arg || '';

if (!b.id) {
  return [{ json: { kind: 'text', message: asked
    ? `No business matches "${asked}". Use the number from a reply alert, e.g. /concept 1234, or part of the name.`
    : 'Which business? Send /concept with the number from a reply alert, e.g. /concept 1234, or part of the name.' } }];
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The trading name, as the outreach uses it: no "- Street 2" or "| Area".
const rawName = String(b.name || '').replace(/\s*[-|,]\s+[^-|,]*$/, '').replace(/_/g, ' ')
  .replace(/[.\s]+$/, '').trim() || String(b.name || '');
// Listings are often typed in lower case ("lumi signature beauty salon."); on
// the page their own name should look like a name. Only all-lower-case words
// are capitalised, so "McDonald's" or "BBQ" stay as written.
const SMALL = /^(and|of|the|for|in|at|by|on|to|a|an|&)$/;
const name = rawName.split(/\s+/).map((w, i) => (w === w.toLowerCase() && !(i > 0 && SMALL.test(w))
  ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
const city = String(b.city || '').trim();
// Listing addresses carry noise: "Q04...shop - s09...parking", and the country.
const address = String(b.address || '').replace(/\.{2,}/g, ' ').replace(/\s*-\s*(United Arab Emirates|Norway|Norge)\s*$/i, '')
  .replace(/\s+/g, ' ').trim();
const cc = String(b.country_code || '').toLowerCase();
const money = { ae: 'AED', no: 'NOK', se: 'SEK', dk: 'DKK', qa: 'QAR' }[cc] || '';
const kindText = `${b.category_primary || ''} ${b.niche || ''} ${name}`.toLowerCase();

const KINDS = [
  { re: /restaurant|cafe|coffee|bakery|food|grill|kitchen|sweet|mandi|shawarma|pizza|burger|seafood/,
    label: 'Restaurant', accent: '#c2410c', deep: '#431407', soft: '#fff7ed',
    tagline: `Fresh food, made to order${city ? ` in ${city}` : ''}`,
    cta: 'Order on WhatsApp', section: 'Our menu',
    items: [['Signature dish', 'Our most-loved plate'], ['Chef’s special', 'Changes with the season'],
            ['Family platter', 'Made for sharing'], ['Fresh juices', 'Squeezed to order'],
            ['Desserts', 'Something sweet to finish'], ['Breakfast', 'Served every morning']],
    perks: [['Dine in', 'A table for two or twenty'], ['Takeaway', 'Ready when you arrive'], ['Delivery', 'Straight to your door']] },
  { re: /salon|beauty|spa|nail|barber|hair|lash|brow|makeup/,
    label: 'Beauty', accent: '#be185d', deep: '#500724', soft: '#fdf2f8',
    tagline: `Look and feel your best${city ? ` in ${city}` : ''}`,
    cta: 'Book on WhatsApp', section: 'Services',
    items: [['Haircut & styling', 'From'], ['Colour & highlights', 'From'], ['Manicure & pedicure', 'From'],
            ['Facial treatments', 'From'], ['Bridal & occasions', 'From'], ['Lashes & brows', 'From']],
    perks: [['Experienced team', 'Years of practice'], ['Easy booking', 'One message on WhatsApp'], ['Clean & calm', 'A space to relax']] },
  { re: /real_estate|real estate|property|propert|realt|homes|estate/,
    label: 'Real estate', accent: '#1d4ed8', deep: '#172554', soft: '#eff6ff',
    tagline: `Find your next home${city ? ` in ${city}` : ''}`,
    cta: 'Talk to an agent', section: 'Featured properties',
    items: [['2-bedroom apartment', 'For rent'], ['Family villa', 'For sale'], ['Studio near the metro', 'For rent'],
            ['Office space', 'For lease'], ['Townhouse', 'For sale'], ['Penthouse', 'For sale']],
    perks: [['Buy', 'Homes and investments'], ['Rent', 'Apartments and villas'], ['Sell', 'We find the right buyer']] },
  { re: /clinic|dental|dentist|medical|physio|doctor|health|pharma/,
    label: 'Clinic', accent: '#0f766e', deep: '#042f2e', soft: '#f0fdfa',
    tagline: `Care you can trust${city ? ` in ${city}` : ''}`,
    cta: 'Book a visit', section: 'Our services',
    items: [['General consultation', 'Walk-ins welcome'], ['Check-ups', 'For the whole family'], ['Specialist care', 'By appointment'],
            ['Dental care', 'Cleaning and treatment'], ['Lab tests', 'Results the same day'], ['Follow-up visits', 'We stay with you']],
    perks: [['Qualified doctors', 'Licensed and experienced'], ['Short waits', 'Book ahead on WhatsApp'], ['Modern clinic', 'Clean and comfortable']] },
  { re: /car|auto|garage|tyre|tire|repair|polish|mechanic/,
    label: 'Car care', accent: '#b91c1c', deep: '#1f2937', soft: '#f9fafb',
    tagline: `Your car in good hands${city ? ` in ${city}` : ''}`,
    cta: 'Book a slot', section: 'Services',
    items: [['Full service', 'From'], ['Oil change', 'From'], ['Tyres & alignment', 'From'],
            ['Polish & detailing', 'From'], ['AC repair', 'From'], ['Diagnostics', 'From']],
    perks: [['Skilled mechanics', 'Every make and model'], ['Fair prices', 'Quoted before we start'], ['Quick turnaround', 'Back on the road fast']] },
];
const K = KINDS.find((k) => k.re.test(kindText)) || {
  label: 'Business', accent: '#4338ca', deep: '#1e1b4b', soft: '#eef2ff',
  tagline: `Welcome to ${name}${city ? `, ${city}` : ''}`,
  cta: 'Message us on WhatsApp', section: 'What we offer',
  items: [['Our main service', 'What most customers come for'], ['Second service', 'Another thing we do well'],
          ['Packages', 'Combine and save'], ['Custom requests', 'Ask us anything'], ['Consultations', 'Talk it through first'], ['After-care', 'We stay in touch']],
  perks: [['Experienced', 'Years in the business'], ['Local', `Right here${city ? ` in ${city}` : ''}`], ['Easy to reach', 'Call or message any time']],
};

const phone = String(b.phone_e164 || '').trim();
// WhatsApp only for a mobile number: a landline (Dubai's +9714...) has no
// WhatsApp, and a dead button is the first thing they would tap.
const mobile = phone.replace(/[^0-9]/g, '');
const digits = ({ ae: /^9715/, no: /^47[49]/, se: /^467/, dk: /^45[2-9]/ }[cc] || /./).test(mobile) ? mobile : '';
const socials = (() => { try { return typeof b.social_profiles === 'string' ? JSON.parse(b.social_profiles) : (b.social_profiles || {}); } catch (e) { return {}; } })();
const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${name} ${city}`);
const priceNote = (label) => (label === 'From' ? `From ${money || ''} —`.replace(/\s+/g, ' ') : label);

const ICON = {
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
};

const cards = K.items.map(([t, s], i) => `
      <div class="card">
        <div class="thumb" style="background:linear-gradient(${135 + i * 25}deg, ${K.accent}22, ${K.accent}55)"><span>${esc(t.split(' ')[0])}</span></div>
        <h3>${esc(t)}</h3>
        <p>${esc(priceNote(s))}</p>
      </div>`).join('');
const perks = K.perks.map(([t, s]) => `<div class="perk"><b>${esc(t)}</b><span>${esc(s)}</span></div>`).join('');
const socialLinks = Object.entries(socials).filter(([, u]) => /^https?:\/\//i.test(String(u)))
  .map(([k, u]) => `<a href="${esc(u)}">${esc(k.charAt(0).toUpperCase() + k.slice(1))}</a>`).join(' · ');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — website concept</title>
<style>
  :root { --accent: ${K.accent}; --deep: ${K.deep}; --soft: ${K.soft}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; background: #fff; line-height: 1.5; }
  a { color: inherit; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
  header { position: sticky; top: 0; background: rgba(255,255,255,.95); border-bottom: 1px solid #eee; z-index: 5; }
  header .wrap { display: flex; align-items: center; justify-content: space-between; height: 60px; }
  .logo { font-weight: 800; font-size: 18px; color: var(--deep); letter-spacing: -.2px; }
  .logo small { display: block; font-weight: 500; font-size: 11px; color: #6b7280; letter-spacing: .5px; text-transform: uppercase; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none; }
  .btn.main { background: var(--accent); color: #fff; }
  .btn.ghost { background: #fff; color: var(--deep); }
  .btn.small { padding: 8px 14px; font-size: 14px; }
  .hero { background: radial-gradient(circle at 80% 20%, ${K.accent}cc, transparent 55%), linear-gradient(135deg, var(--deep), ${K.accent}); color: #fff; padding: 72px 0 64px; }
  .hero .tag { display: inline-block; background: rgba(255,255,255,.15); padding: 4px 12px; border-radius: 999px; font-size: 13px; margin-bottom: 16px; }
  .hero h1 { font-size: clamp(32px, 7vw, 54px); line-height: 1.1; letter-spacing: -1px; margin-bottom: 12px; }
  .hero p { font-size: 18px; opacity: .9; max-width: 560px; margin-bottom: 28px; }
  .hero .actions { display: flex; flex-wrap: wrap; gap: 12px; }
  .perks { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: -28px; }
  .perk { background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
  .perk b { display: block; color: var(--deep); }
  .perk span { font-size: 14px; color: #6b7280; }
  section { padding: 56px 0; }
  h2 { font-size: 28px; color: var(--deep); letter-spacing: -.5px; margin-bottom: 6px; }
  .sub { color: #6b7280; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .card { border: 1px solid #eee; border-radius: 16px; overflow: hidden; background: #fff; }
  .thumb { height: 96px; display: flex; align-items: center; justify-content: center; }
  .thumb span { font-weight: 800; font-size: 22px; color: var(--deep); opacity: .35; }
  .card h3 { font-size: 15px; padding: 12px 14px 0; }
  .card p { font-size: 13px; color: #6b7280; padding: 2px 14px 14px; }
  .sample { font-size: 12px; color: #9ca3af; margin-top: 12px; }
  .visit { background: var(--soft); }
  .visit .box { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .visit .item { background: #fff; border-radius: 16px; padding: 20px; }
  .visit .item b { display: flex; align-items: center; gap: 8px; color: var(--deep); margin-bottom: 6px; }
  .cta { background: var(--deep); color: #fff; text-align: center; }
  .cta h2 { color: #fff; }
  .cta p { opacity: .85; margin-bottom: 20px; }
  footer { padding: 24px 0; font-size: 13px; color: #6b7280; text-align: center; }
  .float { position: fixed; right: 16px; bottom: 16px; background: #22c55e; color: #fff; border-radius: 999px; padding: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.2); display: flex; }
</style>
</head>
<body>
<header><div class="wrap">
  <div class="logo">${esc(name)}<small>${esc(K.label)}${city ? ` · ${esc(city)}` : ''}</small></div>
  ${phone ? `<a class="btn main small" href="tel:${esc(phone)}">${ICON.phone} Call</a>` : ''}
</div></header>

<div class="hero"><div class="wrap">
  <span class="tag">${esc(K.label)}${city ? ` in ${esc(city)}` : ''}</span>
  <h1>${esc(name)}</h1>
  <p>${esc(K.tagline)}.</p>
  <div class="actions">
    ${digits ? `<a class="btn ghost" href="https://wa.me/${digits}">${ICON.chat} ${esc(K.cta)}</a>` : ''}
    ${phone ? `<a class="btn ghost" href="tel:${esc(phone)}">${ICON.phone} ${esc(phone)}</a>` : ''}
    <a class="btn ghost" href="${esc(mapsUrl)}">${ICON.pin} Directions</a>
  </div>
</div></div>

<div class="wrap"><div class="perks">${perks}</div></div>

<section><div class="wrap">
  <h2>${esc(K.section)}</h2>
  <p class="sub">A quick look at what ${esc(name)} offers.</p>
  <div class="grid">${cards}
  </div>
  <p class="sample">Sample content — your own photos, items and prices go here.</p>
</div></section>

<section class="visit"><div class="wrap">
  <h2>Visit or contact us</h2>
  <p class="sub">We’re easy to find and quick to answer.</p>
  <div class="box">
    <div class="item"><b>${ICON.pin} Address</b>${esc(address || city || '')}<br><a href="${esc(mapsUrl)}">Open in Google Maps</a></div>
    ${phone ? `<div class="item"><b>${ICON.phone} Phone</b><a href="tel:${esc(phone)}">${esc(phone)}</a>${digits ? `<br><a href="https://wa.me/${digits}">WhatsApp us</a>` : ''}</div>` : ''}
    ${b.email || socialLinks ? `<div class="item"><b>${ICON.chat} Online</b>${b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ''}${socialLinks ? `<br>${socialLinks}` : ''}</div>` : ''}
  </div>
</div></section>

<section class="cta"><div class="wrap">
  <h2>Ready when you are</h2>
  <p>Message ${esc(name)} and we’ll get back to you quickly.</p>
  ${digits ? `<a class="btn ghost" href="https://wa.me/${digits}">${ICON.chat} ${esc(K.cta)}</a>` : (phone ? `<a class="btn ghost" href="tel:${esc(phone)}">${ICON.phone} Call us</a>` : '')}
</div></section>

<footer>Website concept for ${esc(name)} · prepared by Example Web Studio</footer>
${digits ? `<a class="float" href="https://wa.me/${digits}" aria-label="WhatsApp">${ICON.chat}</a>` : ''}
</body>
</html>
`;

const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `business-${b.id}`;
const base64 = typeof Buffer !== 'undefined'
  ? Buffer.from(html, 'utf8').toString('base64')
  : btoa(unescape(encodeURIComponent(html)));

return [{
  json: {
    kind: 'file', business_id: b.id, name,
    caption: `Website concept for ${name}. Open it on your phone, take screenshots, and send them in your reply.`,
  },
  binary: {
    data: { data: base64, mimeType: 'text/html', fileName: `${slug}-concept.html`, fileExtension: 'html' },
  },
}];
