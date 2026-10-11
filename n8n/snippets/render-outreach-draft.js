// CH-04, node: "Render the draft and guard it"
// Mode: Run Once for Each Item
//
// Turns one (business, template) pair into a subject/body, and decides
// whether it is safe to leave in 'draft' or must be held as 'needs_review'.
//
// The guard is deliberately generous about what it flags and strict about
// what it lets straight through. The failure mode this project cares most
// about is not "a good lead sat in review for an extra day" - it is "a
// message went out that should not have."
//
// Ported pattern from the job-hunt project's letter guard: a check that flags
// too eagerly gets waved away out of habit, including the one time it is
// right. Every flag below is something that was actually found in these 30
// leads, not a hypothetical.

const b = $json;                                   // business, with template fields merged in

const problems = [];

// --- 1. Is there anywhere to send this? -------------------------------------
const email = String(b.email || '').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!email || !EMAIL_RE.test(email)) {
  problems.push('no usable email address on file');
}

// --- 2. Is this actually the kind of lead this project targets? ------------
const OPPORTUNITY = new Set(['NO_WEBSITE_CONFIRMED', 'NO_WEBSITE_LIKELY', 'WEAK_WEBSITE']);
if (!OPPORTUNITY.has(b.website_status)) {
  problems.push(`website_status is ${b.website_status}, not an opportunity this pitch fits`);
}
if (b.permanently_closed) {
  problems.push('business is permanently closed');
}

// --- 3. The consent hold ----------------------------------------------------
if (b.is_natural_person) {
  problems.push(b.natural_person_reason || 'flagged as a natural person - consent required');
}

// --- 3b. In a consent country, only a legal entity is emailed ---------------
//
// Norway's Marketing Control Act s.15 protects natural persons, and a sole
// proprietorship (enkeltpersonforetak) IS its owner - whatever the trading
// name says. The name check above only catches names that look like a
// person's; a sole trader's "<first name>s frisor" with a personal hotmail
// address, and a one-word trading name, went through it. So in a country whose rule is
// 'consent', the name must carry a company form (AS, ASA, AB, ApS, Ltd...)
// before anything goes out on its own. The rest belong on the call list.
const COMPANY_FORM = /(^|\s)(AS|ASA|A\/S|ApS|AB|DA|SA|BV|GmbH|Ltd\.?|Limited|Inc\.?|LLC|Oy)(\s|$|,)/;
if (b.consent_rule === 'consent' && !COMPANY_FORM.test(String(b.name || ''))) {
  problems.push(`no company form (AS, ASA...) in "${b.name}" - likely a sole proprietorship, which ` +
    `${b.country || 'this country'} treats as a natural person needing prior consent; call instead`);
}

// --- 4. Suppressed already? -------------------------------------------------
if (b.is_suppressed) {
  problems.push(`suppressed: ${b.suppression_reason || 'no reason recorded'}`);
}

// --- 5. Does this address actually belong to THIS business? ----------------
//
// An email is only as good as the page it was found on. Stage F reads it off
// whatever site CH-02 settled on, and for months that site could be a
// neighbour's: a phone number shared with the clinic a stylist rents a chair
// in, a directory, an estate agent's parent company. The queue that existed
// when this check was written held 9 drafts, and 7 were addressed to a
// different business than the one named in the message:
//
//   Beauty Care by KN           -> post@klinikk-a.test         (the clinic she works in)
//   Fjordlys Frisor og ...      -> post@nabo-klinikk.test      (a neighbour)
//   Sample Ladies ... Dubai     -> info@salons-directory.test  (a directory)
//
// (Names and domains here are fictional stand-ins for the real rows.)
//
// So the address has to carry the business's name: in its domain, or - for a
// free mailbox like gmail - in the part before the @, or it has to sit on the
// business's own website whose domain carries the name. Anything else is
// held for a human, who can still approve it knowingly. A held draft costs a
// day; an email to the wrong business costs the first impression.
const fold = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\u00f8/g, 'o').replace(/\u00e6/g, 'ae').replace(/\u00e5/g, 'a')
  .replace(/\u0153/g, 'oe').replace(/\u00df/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Words that prove nothing: the niche itself, legal forms, and places. A
// Dubai directory's domain says "dubai"; a Dubai salon's name says it too.
const NOT_DISTINCTIVE = new Set([
  'salon', 'salong', 'beauty', 'hair', 'spa', 'nails', 'barber', 'studio',
  'frisor', 'kapper', 'peluqueria', 'estetica', 'parrucchiere', 'ladies', 'gents',
  'real', 'estate', 'realty', 'properties', 'property', 'homes', 'eiendom', 'megler',
  'centre', 'center', 'senter', 'clinic', 'klinikk', 'shop', 'store', 'house', 'home',
  'international', 'group', 'company', 'services', 'service',
  'oslo', 'norge', 'norway', 'dubai', 'emirates', 'sharjah', 'ajman',
  'and', 'the', 'for', 'your', 'best', 'new', 'city', 'llc', 'gmbh',
]);
for (const w of fold(b.city).split(' ')) NOT_DISTINCTIVE.add(w);

const nameTokens = fold(b.name_norm || b.name).split(' ')
  .filter((w) => w.length >= 4 && !NOT_DISTINCTIVE.has(w));

// Host without "www." and without its last label, squashed: testvikhouse.no
// -> "testvikhouse". Regex only - the Code node sandbox has no URL global.
const hostOf = (url) => String(url || '').trim()
  .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  .split(/[/?#]/)[0].split('@').pop().split(':')[0]
  .toLowerCase().replace(/^www\./, '');
const stemOf = (host) => host.split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '');
const carriesName = (s) => nameTokens.some((t) => s.includes(t));

// Free and ISP mailboxes - including the UAE's eim.ae and emirates.net.ae,
// which is where many Dubai listings' addresses live.
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|proton|protonmail|gmx|yandex|mail|online|getmail|eim|emirates)\./;

if (email && EMAIL_RE.test(email)) {
  const [localPart, domain] = email.toLowerCase().split('@');
  const siteHost = hostOf(b.website_url);
  const siteNamed = Boolean(siteHost) && carriesName(stemOf(siteHost));
  let belongs;
  // An email published on THIS business's own listing (the Overture record
  // CH-00 found it on) is theirs by provenance, whatever its spelling -
  // most are gmail addresses that carry no part of the trading name.
  // Even when the domain IS their proven site: a restaurant's info@ on its
  // own proven domain was exactly that, and bounced. A listing's company address is often a
  // mailbox nobody set up or kept. Only an address read off their own site
  // (Stage F) or a business-shaped free mailbox goes out on its own.
  if (b.email_source === 'listing' && !FREE_MAIL.test(domain)) {
    // A listing address on a company domain whose website we never found:
    // the domain is often bought and abandoned, or the mailbox long gone.
    // Found for real - a building-management company's listed address
    // bounced "address not found" within a minute. Bounces are what ruin a sending domain, so
    // these wait for a human rather than go out on their own.
    belongs = true;   // provenance is fine; the risk is the mailbox, reported here
    problems.push(`${email} is a listing address on ${domain}, where no website of theirs was found - ` +
      'high bounce risk, check the address before approving');
  } else if (b.email_source === 'listing' && FREE_MAIL.test(domain)
             && !carriesName(localPart.replace(/[^a-z0-9]/g, ''))) {
    // A free mailbox on the listing that carries no part of the business
    // name - digits only, initials and digits, a person's name - is often
    // someone's old personal address. The first day's bounces were all of
    // this kind, while every address shaped like the business (the salon's
    // or restaurant's own name, at a free mailbox) arrived.
    // Held, not sent: bounces are what cost a sending domain its inbox.
    belongs = true;   // provenance is fine; the risk is the mailbox
    problems.push(`${email} is a listing address that carries no part of the business name - ` +
      'often an old personal mailbox, high bounce risk; check it before approving');
  } else if (b.email_source === 'listing') {
    belongs = true;
  } else if (!nameTokens.length) {
    belongs = false;
  } else if (FREE_MAIL.test(domain)) {
    belongs = carriesName(localPart.replace(/[^a-z0-9]/g, '')) || siteNamed;
  } else {
    belongs = carriesName(stemOf(domain))
      || (siteNamed && (domain === siteHost || domain.endsWith('.' + siteHost)));
  }
  if (!belongs) {
    problems.push(nameTokens.length
      ? `${email} does not carry the business name, so it may belong to a different ` +
        `business (a neighbour sharing their phone number, or a directory) - check before approving`
      : `"${b.name}" has no distinctive word to check ${email} against - ` +
        `cannot tell whether that address is theirs`);
  }
}

// --- 5a. In a consent country, only the company's shared address -----------
//
// Even for a company, Norwegian guidance (Forbrukertilsynet) treats an
// employee's own address - ola.nordmann@<company>.no - as the person's, needing
// their prior consent. A shared address (post@, info@, kontakt@) or one that
// is the business's own name may be emailed.
const GENERIC_LOCAL = /^(post|postmottak|firmapost|info|kontakt|contact|mail|epost|e-post|hei|hallo|hello|hi|booking|bestilling|bestill|timebestilling|salg|sales|office|kontor|resepsjon|reception|admin|administrasjon|service|kundeservice|support|team|butikk|shop|ordre|order|faktura|regnskap|inquiries|enquiries|marketing)$/;
if (b.consent_rule === 'consent' && email && EMAIL_RE.test(email)) {
  const local = email.toLowerCase().split('@')[0];
  if (!GENERIC_LOCAL.test(local) && !carriesName(local.replace(/[^a-z0-9]/g, ''))) {
    problems.push(`${email} looks like a person's own address - in ${b.country || 'this country'} that needs their ` +
      `prior consent; only a shared company address (post@, info@...) or one in the business's name may be emailed`);
  }
}

// --- 5b. Is the website the pitch is about really THEIRS? ------------------
//
// A WEAK_WEBSITE pitch criticises a specific site, and the address came off
// that site. If nothing ties the site to this business except its name, it
// may be a same-named company elsewhere - an Oslo trading AS was drafted
// against the site of a same-named fuel company in Slovakia. CH-02 records
// whether the site carried their phone number or street address, or whether
// the Maps listing itself linked it; anything weaker is held for a human.
// Undefined (a caller that does not supply it) is treated as unknown, not
// as proof.
if (b.website_url && b.website_status === 'WEAK_WEBSITE'
    && !['phone', 'address', 'listing'].includes(b.site_corroborated)) {
  problems.push(`${b.website_url} matched "${b.name}" by name only - neither their phone number ` +
    `nor their address appears on it, so it may be a different company with the same name`);
}

// --- 6. Build the substitutions ---------------------------------------------
//
// greeting_name: always the generic "there". The job-hunt guard's hardest
// lesson was that a GUESSED name is worse than no name - "the clearest
// possible sign the sender never looked" - and detected_person_name is a
// guess: a capitalised run of words in a business name. It produced
// "Hi <district>," for an apartment company named after its district and
// "Hi The," for one called "The ... company". A human who knows the owner's
// name can edit it in before approving.
const greetingName = ' there';

// business_name: the trading name, without the location Google Maps appends
// to a listing ("Testvik House Apartments - Eksempelgata 2", "Lumi Beauty
// Salon | Example District") and without stray wrapping quotes. Nobody writes
// their own business name with their street address on the end.
const tradingName = String(b.name || '').trim()
  .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '')
  .split(/\s+[|\u2013\u2014-]\s+/)[0]
  .replace(/_+/g, ' ')
  .trim();

// social_note: only rendered when a social profile was actually found, and
// names the specific platform rather than a vague "your socials". It reads
// as part of "while looking at ... and saw your Instagram page, but I
// couldn't find a website for you."
let socialNote = '';
const socials = b.social_profiles || {};
const platform = Object.keys(socials).find((k) => k !== 'other');
if (platform) {
  const label = platform.charAt(0).toUpperCase() + platform.slice(1);
  socialNote = ` and saw your ${label} page`;
}

// business_type: what to call them, from their own category - "hair salons
// in Oslo", "garages in Dubai" - so the message reads as written to them and
// not to "local businesses". Falls back to the niche, then to the generic.
const TYPES = [
  [/hair_salon/, 'hair salon', 'hair salons'],
  [/barber/, 'barber shop', 'barber shops'],
  [/nail_salon/, 'nail salon', 'nail salons'],
  [/spa|massage/, 'spa', 'spas'],
  [/beauty|skin_care|makeup|tanning|waxing|hair_removal|hair_extensions/, 'beauty salon', 'beauty salons'],
  [/real_estate|property|^real estate$/, 'real estate agency', 'real estate agencies'],
  [/restaurant/, 'restaurant', 'restaurants'],
  [/cafe|coffee/, 'cafe', 'cafes'],
  [/bakery/, 'bakery', 'bakeries'],
  [/automotive_repair|auto_detailing/, 'garage', 'garages'],
  [/car_dealer/, 'car dealership', 'car dealerships'],
  [/car_rental/, 'car rental company', 'car rental companies'],
  [/yoga/, 'yoga studio', 'yoga studios'],
  [/gym|fitness/, 'gym', 'gyms'],
  [/dentist/, 'dental clinic', 'dental clinics'],
  [/medical|doctor|physical_therapy|clinic|veterinar/, 'clinic', 'clinics'],
  [/travel/, 'travel agency', 'travel agencies'],
  [/event|party/, 'event company', 'event companies'],
  [/furniture/, 'furniture store', 'furniture stores'],
  [/jewelry/, 'jewellery store', 'jewellery stores'],
  [/clothing|tailor/, 'boutique', 'boutiques'],
  [/photograph/, 'photography studio', 'photography studios'],
  [/interior_design/, 'interior design studio', 'interior design studios'],
  [/contractor|plumbing|electrician|cleaning/, 'service company', 'service companies'],
  [/florist/, 'florist', 'florists'],
  [/pet_groomer/, 'pet groomer', 'pet groomers'],
  [/tutoring|language_school|driving_school|education/, 'training centre', 'training centres'],
  [/accountant/, 'accounting firm', 'accounting firms'],
  [/lawyer/, 'law firm', 'law firms'],
];
const typeKey = String(b.category_primary || '').toLowerCase();
const nicheKey = String(b.niche || '').toLowerCase();
const typed = TYPES.find(([re]) => typeKey && re.test(typeKey))
  || TYPES.find(([re]) => nicheKey && re.test(nicheKey.replace(/s$/, '').replace(/ /g, '_')))
  || [null, 'local business', 'local businesses'];

// weak_reason: the MEASURED reason a site counts as weak, in plain words.
// A generic "could be working harder" claim to a site that is fine is the
// fastest way to be ignored - or reported.
const psi = Number(b.psi_performance);
let weakReason = 'It looks like it could be doing more to bring you customers, especially on a phone.';
if (psi > 0 && psi < 50) {
  weakReason = `On a phone it loads slowly - Google's own PageSpeed test scores it ${Math.round(psi)}/100 ` +
    'for mobile, and most of your visitors will be on a phone.';
} else if (/wixsite\.com|blogspot\.com|godaddysites\.com|webnode|jimdosite/.test(String(b.website_url || ''))) {
  weakReason = "It's on a free website-builder address rather than your own domain, which makes it " +
    'harder for customers to find you and to trust the site.';
}

const SUBS = {
  business_name: tradingName || 'your business',
  greeting_name: greetingName,
  social_note: socialNote,
  business_type: typed[1],
  business_type_plural: typed[2],
  in_city: b.city ? ` in ${String(b.city).trim()}` : '',
  weak_reason: weakReason,
};
// A follow-up's subject is 'Re: ' + what step 1 actually went out with. Left
// out when unknown, so {{first_subject}} stays unfilled and the draft is held
// rather than sent as 'Re: '.
if (b.first_subject) SUBS.first_subject = String(b.first_subject).replace(/^\s*(re:\s*)+/i, '');

const fill = (tpl) =>
  String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(SUBS, key) ? SUBS[key] : m);

const subject = fill(b.template_subject);
const body = fill(b.template_body);

// Templates are single-phrasing text. A "{a|b}" alternatives group is not
// rendered, so a template written that way would go out with the braces in
// it - held rather than sent broken.
if (/\{[^{}]*\|[^{}]*\}/.test(subject) || /\{[^{}]*\|[^{}]*\}/.test(body)) {
  problems.push('template contains an {a|b} alternatives group, which is not rendered - ' +
    'rewrite it as one phrasing');
}

// --- 7. Nothing left unfilled ------------------------------------------------
//
// The single most important check in this file. A template placeholder that
// made it past `fill()` unfilled means a field this business does not have -
// and the job-hunt project's own rule applies directly here: "contains an
// unfilled [placeholder]" was one of its first checks, for exactly this
// reason.
if (/\{\{\w+\}\}/.test(subject) || /\{\{\w+\}\}/.test(body)) {
  problems.push('template has an unfilled placeholder');
}

if (body.length < 40) {
  problems.push('rendered body is suspiciously short');
}

const status = problems.length ? 'needs_review' : 'draft';

return {
  json: {
    business_id: b.id,
    template_id: b.template_id,
    sequence_step: b.sequence_step,
    to_email: email,
    subject,
    body,
    status,
    review_reason: problems.length ? problems.join('; ') : null,
    guard_flags: { problems, greeting_name: greetingName.trim(), social_note: Boolean(socialNote) },
  },
};
