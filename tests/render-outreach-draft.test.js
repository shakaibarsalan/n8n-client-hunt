// The last check before a draft is safe to leave un-reviewed. Every case
// here is something that either broke, or nearly did, in the real business
// data: no email, an unfilled placeholder, a natural-person hold, a business
// that closed between discovery and drafting.
//
// The businesses, people, addresses and domains below are FICTIONAL stand-ins
// for the real rows each case was found on - same shape, invented names.
// Domains use the reserved .test TLD, and free-mail providers appear as
// gmail.test / hotmail.test / eim.test: FREE_MAIL matches the provider label
// before the first dot, so these take exactly the branch a real gmail.com or
// eim.ae address takes, while no address in this file can be anyone's mailbox.

const { compile, ok, eq, done } = require('./helpers');

const render = compile(
  'CH-04-prepare-outreach.json', 'Render the draft and guard it', { $json: null });

const run = async (fields) => (await render({ $json: fields })).json;

const OPENER = {
  id: 1, business_id: 1, name: 'Salong Eksempel', email: 'salongeksempel@gmail.test',
  website_status: 'NO_WEBSITE_CONFIRMED', permanently_closed: false,
  is_natural_person: false, natural_person_reason: null, is_suppressed: false,
  social_profiles: {},
  template_id: 10, sequence_step: 1,
  template_subject: 'Quick note about {{business_name}}',
  template_body: 'Hi{{greeting_name}}, I noticed {{business_name}} does not have its own ' +
                 'website yet{{social_note}}. Would a free concept be useful? Best, Example Web Studio.',
};

(async () => {
  console.log('render + guard the outreach draft\n');

  // --- the happy path --------------------------------------------------
  {
    const r = await run(OPENER);
    eq('a clean lead drafts clean', r.status, 'draft');
    eq('no review reason on a clean draft', r.review_reason, null);
    ok('the business name is substituted', r.subject.includes('Salong Eksempel'), r.subject);
    ok('a generic greeting is used when no name was found',
      r.body.startsWith('Hi there,'), r.body);
    ok('a realistic-length body is not flagged short', r.body.length >= 40, r.body.length);
  }

  // --- no guessed names in the greeting -----------------------------------
  //
  // detected_person_name is a guess, and it produced "Hi <district>," and
  // "Hi The," in real drafts. A guessed name is worse than none.
  {
    const r = await run({ ...OPENER, detected_person_name: 'The APARTMENTS' });
    ok('a detected name is never used as the greeting',
      r.body.startsWith('Hi there,'), r.body);
  }

  // --- the trading name, not the Maps listing ------------------------------
  {
    const r = await run({ ...OPENER, name: 'Testvik House Apartments - Eksempelgata 2',
      email: 'booking@testvikhouse.test' });
    ok('the street Google appends to the listing is dropped from the subject',
      r.subject === 'Quick note about Testvik House Apartments', r.subject);
    ok('and from the body', !/Eksempelgata/.test(r.body), r.body);
  }
  {
    const r = await run({ ...OPENER, name: 'Lumi Beauty Salon | Example District',
      email: 'hello@lumibeautysalon.test' });
    ok('a "| area" suffix is dropped too', r.subject === 'Quick note about Lumi Beauty Salon', r.subject);
  }
  {
    const r = await run({ ...OPENER, name: '"Sample Ladies Beauty Salon"', email: 'info@sampleladies.test' });
    ok('stray wrapping quotes are dropped', r.subject === 'Quick note about Sample Ladies Beauty Salon', r.subject);
  }
  {
    const r = await run({ ...OPENER, name: 'Hair-by-Kari', email: 'post@hairbykari.test' });
    ok('a hyphen inside a name is kept', r.subject === 'Quick note about Hair-by-Kari', r.subject);
  }

  // --- social note ---------------------------------------------------------
  {
    const r = await run({ ...OPENER, social_profiles: { instagram: 'https://instagram.com/x' } });
    ok('names the specific platform that was actually found',
      /Instagram/.test(r.body), r.body);
  }
  {
    const r = await run(OPENER);
    ok('no social note when nothing was found', !/nowhere to send people/.test(r.body));
  }

  // --- no email: this SQL should never select such a row, but the guard --
  // --- catches it anyway, as a second line of defence --------------------
  {
    const r = await run({ ...OPENER, email: '' });
    eq('no email -> held', r.status, 'needs_review');
    ok('says why', /email/i.test(r.review_reason), r.review_reason);
  }
  {
    const r = await run({ ...OPENER, email: 'not-an-email' });
    eq('an unparseable address is held, not sent to a broken address',
      r.status, 'needs_review');
  }

  // --- not actually an opportunity ---------------------------------------
  {
    const r = await run({ ...OPENER, website_status: 'HAS_WEBSITE' });
    eq('a business that has a website is held, never drafted clean',
      r.status, 'needs_review');
  }
  {
    const r = await run({ ...OPENER, permanently_closed: true });
    eq('a closed business is held', r.status, 'needs_review');
  }

  // --- the consent hold ----------------------------------------------------
  {
    const r = await run({
      ...OPENER, is_natural_person: true,
      natural_person_reason: '"Kari Marie Nordmann" reads as a person, Norway requires consent.',
    });
    eq('a flagged natural person is held', r.status, 'needs_review');
    eq('the exact reason is carried through, not summarised away',
      r.review_reason, '"Kari Marie Nordmann" reads as a person, Norway requires consent.');
  }

  // --- suppression -----------------------------------------------------
  {
    const r = await run({ ...OPENER, is_suppressed: true, suppression_reason: 'opted out 2026-08-01' });
    eq('a suppressed address is held even if it slipped past the SQL filter',
      r.status, 'needs_review');
    ok('and the reason is visible', /opted out/.test(r.review_reason));
  }

  // --- the template itself is broken --------------------------------------
  {
    const r = await run({ ...OPENER, template_body: 'Hi, about {{unknown_field}}.' });
    eq('an unfilled placeholder holds the draft, not sends it broken',
      r.status, 'needs_review');
    ok('names the fault', /placeholder/i.test(r.review_reason), r.review_reason);
  }
  {
    // Templates are single phrasing. An alternatives group is not rendered,
    // so it would reach the recipient with its braces - held instead.
    const r = await run({ ...OPENER, template_subject: '{Question about {{business_name}}|{{business_name}} website}' });
    eq('an {a|b} group in a template holds the draft', r.status, 'needs_review');
    ok('  and names the fault', /alternatives group/.test(r.review_reason || ''), r.review_reason);
  }

  // --- the address has to belong to THIS business ------------------------
  //
  // The real outreach queue, 3 Oct 2026: 9 drafts, 7 addressed to a different
  // business than the one the message was about. Each case below is shaped on
  // one of those rows, with the names and domains replaced.
  const WEAK = { ...OPENER, website_status: 'WEAK_WEBSITE', city: 'Oslo', site_corroborated: 'address' };
  const wrongBusiness = [
    ['Beauty Care by KN', 'beauty care by kn', 'http://www.klinikk-a.test/', 'post@klinikk-a.test'],
    ['Lokalfrisor V/ Kari Nordmann', 'lokalfrisor v kari nordmann',
      'http://www.booking-b.test', 'stylist@booking-b.test'],
    ['Fjordlys Frisor og Skjonnhetssalong', 'fjordlys frisor og skjonnhetssalong',
      'http://www.nabo-klinikk.test', 'post@nabo-klinikk.test'],
    ['Frisor Eksempelby Senter', 'frisor eksempelby senter', 'http://beautybar-d.test/', 'post@beautybar-d.test'],
    ['Ola Nordmann AS', 'ola nordmann as', 'http://hodepineklinikk-e.test/',
      'post@hodepineklinikk-e.test'],
  ];
  for (const [name, nameNorm, site, email] of wrongBusiness) {
    const r = await run({ ...WEAK, name, name_norm: nameNorm, website_url: site, email });
    eq(`held: ${name} -> ${email}`, r.status, 'needs_review');
    ok('  and says the address may be someone else\'s',
      /different business/.test(r.review_reason || ''), r.review_reason);
  }
  {
    const r = await run({
      ...OPENER, name: '"Sample Ladies Beauty Salon International City Dubai"',
      name_norm: 'sample ladies beauty salon international city dubai', city: 'Dubai',
      website_url: null, email: 'info@salons-directory-dubai.test',
    });
    eq('a directory\'s address is held even though both say "dubai"', r.status, 'needs_review');
  }
  {
    const r = await run({ ...WEAK, name: 'Xy eiendom', name_norm: 'xy eiendom',
      website_url: 'http://www.megler-f.test', email: 'post@megler-f.test' });
    eq('a name with nothing distinctive cannot vouch for any address', r.status, 'needs_review');
    ok('  and says so', /no distinctive word/.test(r.review_reason || ''), r.review_reason);
  }
  {
    const r = await run({ ...WEAK, name: 'Testvik House Apartments - Eksempelgata 2',
      name_norm: 'testvik house apartments eksempelgata 2',
      website_url: 'http://www.testvikhouse.test/', email: 'booking@testvikhouse.test' });
    eq('an address on a domain carrying the name is fine', r.status, 'draft');
  }
  {
    const r = await run({ ...OPENER, name: 'Salong Eksempel', name_norm: 'salong eksempel',
      website_url: 'https://salongeksempel.test', email: 'kontakt.salong@gmail.test' });
    eq('a free mailbox found on their own named site is fine', r.status, 'draft');
  }
  {
    const r = await run({ ...OPENER, name: 'Salong Eksempel', name_norm: 'salong eksempel',
      website_url: null, email: 'kari.nordmann@gmail.test' });
    eq('a free mailbox with no tie to the business is held', r.status, 'needs_review');
  }
  {
    // Kept deliberately: theresco.test is very likely theirs, but nothing on
    // file says so. Held for a human to approve, not guessed.
    const r = await run({ ...WEAK, name: 'The RESIDENCE company - Eksempelbrygga',
      name_norm: 'the residence company eksempelbrygga',
      website_url: 'http://www.theresidencecompany.test/', email: 'info@theresco.test' });
    eq('an abbreviated domain that cannot be tied to the name is held', r.status, 'needs_review');
  }

  // --- the site itself has to be theirs, not a same-named company ---------
  {
    const r = await run({ ...WEAK, name: 'Sample Trading AS', name_norm: 'sample trading as',
      website_url: 'https://sampletrading.test', email: 'reception@sampletrading.test',
      site_corroborated: 'none' });
    eq('a site matched by name only is held (it may be a same-named company abroad)', r.status, 'needs_review');
    ok('  and says why', /by name only/.test(r.review_reason || ''), r.review_reason);
  }
  {
    const { site_corroborated, ...noField } = WEAK;
    const r = await run({ ...noField, name: 'Testvik House Apartments', name_norm: 'testvik house apartments',
      website_url: 'http://www.testvikhouse.test/', email: 'booking@testvikhouse.test' });
    eq('unknown corroboration is not proof', r.status, 'needs_review');
  }
  for (const how of ['phone', 'address', 'listing']) {
    const r = await run({ ...WEAK, name: 'Testvik House Apartments', name_norm: 'testvik house apartments',
      website_url: 'http://www.testvikhouse.test/', email: 'booking@testvikhouse.test', site_corroborated: how });
    eq(`a site corroborated by ${how} drafts clean`, r.status, 'draft');
  }

  // --- an email from the business's own listing is theirs ----------------
  {
    const r = await run({ ...OPENER, name: 'Sample Auto Garage', name_norm: 'sample auto garage',
      city: 'Dubai', website_url: null, email: 'ahmed.example1987@gmail.test', email_source: 'listing' });
    eq('a listing gmail with no part of the name is held for its bounce risk', r.status, 'needs_review');
    ok('  and says so', /bounce risk/.test(r.review_reason || ''), r.review_reason);
    const named = await run({ ...OPENER, name: 'Sample Auto Garage', name_norm: 'sample auto garage',
      city: 'Dubai', website_url: null, email: 'samplegarage99@gmail.test', email_source: 'listing' });
    eq('a listing gmail shaped like the business goes', named.status, 'draft');
  }
  {
    const r = await run({ ...OPENER, name: 'Sample Auto Garage', name_norm: 'sample auto garage',
      city: 'Dubai', website_url: null, email: 'ahmed.example1987@gmail.test' });
    eq('the same address with no provenance is held', r.status, 'needs_review');
  }

  // --- written to THEM: their kind of business and their city -------------
  const TYPED = { ...OPENER, email_source: 'listing', city: 'Dubai', category_primary: 'automotive_repair',
    template_subject: 'Question about {{business_name}}',
    template_body: 'Hi{{greeting_name}}, I came across {{business_name}} while looking at ' +
      '{{business_type_plural}}{{in_city}}. Regards, Alex' };
  {
    const r = await run({ ...TYPED, id: 11 });
    ok('the business type comes from their own category', /garages in Dubai/.test(r.body), r.body);
    eq('  and the template renders as written', r.subject, 'Question about Salong Eksempel');
  }
  {
    const r = await run({ ...TYPED, category_primary: null, niche: 'Small Businesses', city: '' });
    ok('with nothing to go on it says local businesses, and no dangling "in"',
      /looking at local businesses\./.test(r.body), r.body);
  }
  {
    const r = await run({ ...WEAK, name: 'Sample Homes Real Estate', name_norm: 'sample homes real estate',
      website_url: 'https://samplehomesre.test', email: 'info@samplehomesre.test', psi_performance: 49,
      template_body: 'Hi{{greeting_name}}, {{weak_reason}} Regards, Alex' });
    ok('a weak-site pitch quotes the measured score', /49\/100/.test(r.body), r.body);
  }

  // --- listing addresses that are likely to bounce ------------------------
  {
    // Shaped on a real one: bounced 'address not found' within a minute of sending.
    const r = await run({ ...OPENER, name: 'Sample_Gate_Tower', name_norm: 'sample gate tower', city: 'Dubai',
      website_url: null, email: 'management@samplegatetower.test', email_source: 'listing' });
    eq('a listing address on a domain with no site of theirs is held', r.status, 'needs_review');
    ok('  for the bounce risk, and only for that', /high bounce risk/.test(r.review_reason)
      && !/different business/.test(r.review_reason), r.review_reason);
    ok('  and the name reads without underscores', /Sample Gate Tower/.test(r.subject + r.body), r.subject);
  }
  {
    const r = await run({ ...OPENER, name: 'Sample Rose Tailoring', name_norm: 'sample rose tailoring', city: 'Dubai',
      website_url: null, email: 'srose99@eim.test', email_source: 'listing' });
    eq('a UAE ISP mailbox on the listing is treated like gmail', r.status, 'draft');
  }

  // --- consent countries: only a legal entity goes out on its own --------
  {
    const r = await run({ ...OPENER, name: 'Karis frisor', email: 'kari.n@hotmail.test',
      email_source: 'listing', consent_rule: 'consent', country: 'Norway' });
    eq('a Norwegian trader with no company form is held', r.status, 'needs_review');
    ok('  and told to call instead', /call instead/.test(r.review_reason || ''), r.review_reason);
    const as = await run({ ...OPENER, name: 'Eksempel eiendom AS', email: 'post@eksempel-eiendom.test',
      email_source: 'listing', consent_rule: 'consent', country: 'Norway' });
    ok('an AS is a legal person - not held for this', !/company form/.test(as.review_reason || ''), as.review_reason);
    const ae = await run({ ...OPENER, name: 'Sample Dental Clinic', email: 'sampledental@gmail.test',
      email_source: 'listing', consent_rule: 'opt_out', country: 'United Arab Emirates' });
    eq('an opt-out country does not need a company form', ae.status, 'draft');
  }

  // --- consent countries: only the company's shared address -------------
  //
  // Even an AS: an employee's own address is the person's, and needs their
  // consent (Forbrukertilsynet). Addresses read off the site, not a listing,
  // so only this rule is in play.
  {
    const NO = { ...OPENER, name: 'Eksempel eiendom AS', name_norm: 'eksempel eiendom as',
      consent_rule: 'consent', country: 'Norway', website_url: 'https://eksempel-eiendom.test' };
    const person = await run({ ...NO, email: 'ola.nordmann@eksempel-eiendom.test' });
    eq("an employee's own address at an AS is held", person.status, 'needs_review');
    ok('  saying why', /person's own address/.test(person.review_reason || ''), person.review_reason);
    eq('post@ at an AS goes', (await run({ ...NO, email: 'post@eksempel-eiendom.test' })).status, 'draft');
    eq('an address in the business name goes', (await run({ ...NO, email: 'eksempeleiendom@gmail.test' })).status, 'draft');
    eq('an opt-out country does not care whose address it is',
      (await run({ ...NO, consent_rule: 'opt_out', email: 'ola.nordmann@eksempel-eiendom.test' })).status, 'draft');
  }

  // --- a follow-up lands in the first message's thread -------------------
  {
    const FUP = { ...OPENER, sequence_step: 2, template_subject: 'Re: {{first_subject}}' };
    const r = await run({ ...FUP, first_subject: 'A quick idea for Salong Eksempel' });
    eq('the follow-up subject is Re: the subject step 1 went out with', r.subject, 'Re: A quick idea for Salong Eksempel');
    eq('  and drafts clean', r.status, 'draft');
    eq('never "Re: Re:"', (await run({ ...FUP, first_subject: 'Re: A quick idea for Salong Eksempel' })).subject,
      'Re: A quick idea for Salong Eksempel');
    const lost = await run({ ...FUP, first_subject: null });
    eq('without the first subject the follow-up is held, not sent as "Re: "', lost.status, 'needs_review');
  }

  {
    // Shaped on a real one: on their own proven site's domain, and it still bounced.
    const r = await run({ ...OPENER, name: 'Sample Tikka Inn', name_norm: 'sample tikka inn', city: 'Dubai',
      website_status: 'WEAK_WEBSITE', website_url: 'https://sampletikkainn.test', site_corroborated: 'phone',
      email: 'info@sampletikkainn.test', email_source: 'listing' });
    eq('a listing address on their own site domain is still held', r.status, 'needs_review');
    const f = await run({ ...OPENER, name: 'Sample Tikka Inn', name_norm: 'sample tikka inn', city: 'Dubai',
      website_status: 'WEAK_WEBSITE', website_url: 'https://sampletikkainn.test', site_corroborated: 'phone',
      email: 'info@sampletikkainn.test' });
    eq('the same address read off their own site (Stage F) goes', f.status, 'draft');
  }

  // --- multiple problems accumulate, none is silently dropped -----------
  {
    const r = await run({ ...OPENER, email: '', permanently_closed: true });
    ok('both problems are listed',
      /email/i.test(r.review_reason) && /closed/i.test(r.review_reason),
      r.review_reason);
  }

  // --- determinism ---------------------------------------------------------
  {
    const a = await run(OPENER);
    const b = await run(OPENER);
    eq('same input renders identically', a.body, b.body);
  }

  done('render + guard the outreach draft');
})();
