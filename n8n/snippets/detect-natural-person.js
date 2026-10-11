// CH-04, node: "Is this a natural person or a trading name?"
// Mode: Run Once for All Items
//
// Norway's Marketing Control Act section 15 requires PRIOR CONSENT before
// electronic marketing to a natural person - a different rule than reaching a
// company mailbox. A large share of one-person salons trade under their own
// name rather than a business name: "Nail IT! <first> <middle> <surname>" and
// "<word> beauty Advisor <full name>" are the shapes of two real businesses in
// the first 30 leads this project found, and both are, legally, a person.
// (Names in this file are fictional stand-ins - Kari/Ola Nordmann and the
// like - never the real traders'.)
//
// This is a HEURISTIC, not a legal determination. It exists to make the safe
// default automatic - hold and ask a human - rather than to make the final
// call. Getting this wrong in the cautious direction costs a manual review
// click. Getting it wrong in the other direction is a compliance breach in
// somebody's name, not just a bad email.
//
// Run Once for ALL Items, not each - deliberately, and not how this was
// first written. "Who is due a message?" has alwaysOutputData set, so this
// node still runs (and CH-04 does not silently do nothing with no trace)
// even when nothing is due, and a zero-row query arrives as ONE blank item
// ({}), not zero items. The first fix for that tried to filter it out by
// returning [] for that one item - which is not valid in "Run Once for Each
// Item" mode. n8n does not treat an empty array there as "no output for this
// item": either it errors ("Code doesn't return a single object... An array
// of objects was returned"), or - what actually happened running this for
// real - it is coerced into another blank placeholder one step further down
// the chain, and "Insert the draft" crashed on the exact same NOT NULL
// violation as before, just moved. "Run Once for All Items" mode has no such
// restriction: an empty array is simply zero items, which is what Stage A in
// CH-02 already relies on for the identical shape of bug, verified working
// live in production.

const consentCountries = $('Load consent-required countries').all().map((i) => i.json);

// Titles, role words and niche vocabulary that precede or follow a name
// without themselves being part of it. Stripped before judging whether what
// is left looks like a person.
//
// This is a heuristic over a small vocabulary, not general-purpose name
// detection, and it says so honestly rather than pretending otherwise. Two
// classes of false positive it does NOT catch, found on the first 30 real
// leads and left as a documented limitation rather than chased further,
// because the cost of a false positive here is one manual review click,
// which is the safe direction:
//
//   * a coined/compound trading name sharing a root with a role word -
//     "LumiBee Frisor-Health" is not "Frisor" once hyphenated and cased
//     differently, so it is not caught by an exact-match list.
//   * a descriptor ahead of a real name - "Nail & Spa GARDEN Kari Nordmann"
//     pulls in "Garden" as part of the matched run. The HOLD this produces
//     is still correct (the trader is a real person); only the
//     extracted first name for the greeting is imprecise, and a human
//     reviews every held draft before it can be approved regardless.
const ROLE_WORDS = new Set([
  'salon', 'salong', 'salonger', 'studio', 'beauty', 'hair', 'nails', 'nail',
  'spa', 'clinic', 'klinikk', 'advisor', 'consulting', 'by', 'frisor', 'frisør',
  // Norwegian service vocabulary for this niche - added after "<Placename>
  // Fotterapi" (a care-facility's foot-therapy service, not a person) was
  // flagged as a two-word name because "Fotterapi" matched nothing.
  'fotterapi', 'hudpleie', 'massasje', 'negler', 'skjonnhetssalong',
  'skjønnhetssalong', 'kapper', 'parrucchiere', 'peluqueria', 'estetica',
  // Geography. A city or country name run alongside another capitalised word
  // reads exactly like a two-word name to a check this simple - confirmed on
  // "<Word> Nail Supply in Oslo Norway", which matched "Oslo Norway".
  // Kept to the countries and cities this project's own search_targets
  // actually covers; extend it there if the geographic scope grows.
  'oslo', 'norway', 'norge', 'dubai', 'uae', 'emirates', 'abu', 'dhabi',
  'stockholm', 'sweden', 'copenhagen', 'denmark', 'barcelona', 'madrid',
  'spain', 'lisbon', 'portugal', 'milan', 'italy', 'toronto', 'vancouver',
  'canada', 'doha', 'qatar',
  // Business and real-estate vocabulary - added after "<District> House
  // Apartments" and "The APARTMENTS company" were both held as people's names,
  // and "Hi <District>," / "Hi The," reached a drafted greeting.
  'the', 'and', 'house', 'apartments', 'apartment', 'company', 'group', 'hotel',
  'hotell', 'eiendom', 'eiendomsmegling', 'megler', 'meglerhuset', 'properties',
  'property', 'real', 'estate', 'realty', 'homes', 'bolig', 'utleie', 'invest',
  'holding', 'partners', 'services', 'senter', 'center', 'centre',
  'international', 'ladies', 'gents', 'barber', 'barbershop',
]);

// Street names end in a handful of suffixes, and Google Maps often appends the
// street to a listing's name ("... - Eksempelgata 2").
const STREET = /(gata|gate|gaten|veien|vei|vegen|plass|plassen|torg|torget|street|road|avenue)$/i;

// A capitalised run of 2-3 words, none of them a role word, none of them
// shorter than 3 letters (an initial or a short acronym like "IT" - from
// "Nail IT! <name>..." - reads as noise, not as a name on its own), is
// treated as a person's name embedded in the business name.
const looksLikeAName = (run) => {
  if (run.length < 2 || run.length > 3) return false;
  return run.every((w) => {
    const bare = w.replace(/[^\p{L}]/gu, '');
    return bare.length >= 3 &&
           bare[0] === bare[0].toUpperCase() &&
           !ROLE_WORDS.has(bare.toLowerCase()) &&
           !STREET.test(bare);
  });
};

const out = [];

for (const item of $input.all().filter((i) => i.json && i.json.id != null)) {
  const b = item.json;

  const requiresConsent = consentCountries.find(
    (c) => String(c.country_code).toLowerCase() === String(b.country_code || '').toLowerCase());

  const words = String(b.name || '').split(/\s+/).filter(Boolean);

  let personName = '';
  for (let i = 0; i < words.length; i++) {
    for (const len of [3, 2]) {
      const run = words.slice(i, i + len);
      if (run.length === len && looksLikeAName(run)) {
        // Prefer the longest run found; keep scanning in case a longer one
        // exists later in the string, but do not overwrite a 3-word match
        // with a 2-word one.
        if (run.length > personName.split(/\s+/).filter(Boolean).length) {
          personName = run.join(' ');
        }
      }
    }
  }

  // Fail closed: a detected name holds the lead whether or not the country
  // is in consent_required_countries. Absence from that table means "nobody
  // has checked this country's law yet," not "this country has no such
  // law" - the migration that creates the table says so explicitly, and the
  // hold here is what makes that promise true rather than aspirational.
  //
  // Except where the country's recorded rule is 'opt_out': there a named
  // trader may be emailed, because every message carries an opt-out, so the
  // name is noted but nothing is held. (The UAE, on the owner's instruction -
  // most of what this flagged there was "<Word> Dental", "<Word> Times
  // Restaurant": trading names, not people.)
  const optOutCountry = requiresConsent && requiresConsent.rule === 'opt_out';
  const isNaturalPerson = Boolean(personName) && !optOutCountry;

  let reason = null;
  if (personName && optOutCountry) {
    reason = `"${personName}" may be a person's name; ${b.country} is recorded as opt-out ` +
      `(${requiresConsent.law}), so it is not held - the message carries an opt-out.`;
  } else if (isNaturalPerson) {
    reason = requiresConsent
      ? `"${personName}" reads as a person's name, and ${b.country} requires prior consent ` +
        `for electronic marketing to a natural person (${requiresConsent.law}).`
      : `"${personName}" reads as a person's name. ${b.country || 'This country'} is not yet in ` +
        `consent_required_countries, so its rule is unverified rather than confirmed safe - ` +
        `held as a precaution. Check the law and add the country if cold email to a named ` +
        `individual is actually permitted there.`;
  }

  out.push({
    json: {
      ...b,
      is_natural_person: isNaturalPerson,
      detected_person_name: personName || null,
      natural_person_reason: reason,
    },
  });
}

return out;
