// The consent hold, checked against the SHAPES of the real business names
// from the first 30 leads. Every classification here was first checked
// against what the real business actually is (a web search, or plain reading
// of the name), the same way the POC's hand-labelling was done.
//
// The names themselves are fictional stand-ins (Kari / Ola Nordmann, Jane Doe
// and the like) built to keep each real name's structure - the same role
// words, punctuation and run of capitalised words - so each case exercises
// exactly the path the real name did, without putting a real trader's name in
// a public test file.
//
// This is a heuristic over a small vocabulary, not general-purpose name
// detection, and the file says so rather than pretending otherwise. Its job
// is narrower than "detect names correctly": it is to make the SAFE default
// automatic. A false positive here costs one manual review click. A false
// negative reaches CH-05's second, independent check at send time - but
// relying on that is not the plan, it is the backstop.

const { compile, ok, eq, done } = require('./helpers');

const detect = compile(
  'CH-04-prepare-outreach.json', 'Is this a natural person or a trading name?',
  { $input: null, $: null });

const NORWAY_LAW = [{ json: { country_code: 'no', law: 'Marketing Control Act s.15' } }];
const $ = (map) => (name) => ({ all: () => map[name] || [] });

// Run Once for ALL Items now (see the file header comment for why) - one
// call processes a batch, so this test helper wraps a single business the
// same way n8n would hand it a one-item batch, and unwraps the one result.
const runOne = async (name, country_code = 'no', consentRows = NORWAY_LAW) => {
  const out = await detect({
    $input: { all: () => [{ json: { id: 1, name, country: 'Norway', country_code } }] },
    $: $({ 'Load consent-required countries': consentRows }),
  });
  return out[0].json;
};

const runBatch = async (rows, consentRows = NORWAY_LAW) =>
  detect({
    $input: { all: () => rows.map((json) => ({ json })) },
    $: $({ 'Load consent-required countries': consentRows }),
  });

(async () => {
  console.log('natural-person detection, against the shapes of real business names\n');

  // --- must be flagged: these are genuinely sole proprietors -------------
  {
    const r = await runOne('Glow beauty Advisor Kari Marie Nordmann');
    eq('"<word> beauty Advisor <full name>" -> flagged', r.is_natural_person, true);
    eq('and the name is extracted cleanly', r.detected_person_name, 'Kari Marie Nordmann');
    ok('with a citation', /Marketing Control Act/.test(r.natural_person_reason));
  }
  {
    const r = await runOne('Nail IT! Lise Marit Nordmann');
    eq('Nail IT! ... -> flagged', r.is_natural_person, true);
    eq('"IT!" is excluded, not mistaken for part of the name',
      r.detected_person_name, 'Lise Marit Nordmann');
  }
  {
    const r = await runOne('Nails By Jane Doe');
    eq('flagged', r.is_natural_person, true);
    eq('"By" is excluded as a role word, not part of the name',
      r.detected_person_name, 'Jane Doe');
  }
  {
    const r = await runOne('Beauty Care Anne Nordmann');
    eq('flagged', r.is_natural_person, true);
    ok('the real name is at least a substring of what was extracted',
      r.detected_person_name.includes('Anne Nordmann'), r.detected_person_name);
  }

  // --- must NOT be flagged: these are trading names, not people ----------
  {
    const r = await runOne('Eksempelvik Fotterapi');
    eq('a care facility\'s foot-therapy service is not a person', r.is_natural_person, false);
  }
  {
    const r = await runOne('Sample Nail Supply in Oslo Norway');
    eq('a city and country name is not a person - "Oslo Norway" was the ' +
       'original false positive this test guards against', r.is_natural_person, false);
  }
  {
    const r = await runOne('Lumi Beauty Studio');
    eq('a single non-role word cannot form a 2-word run', r.is_natural_person, false);
  }
  {
    const r = await runOne('Glimt Beauty - Skjonnhetssalong');
    eq('Norwegian niche vocabulary is recognised, not read as a name', r.is_natural_person, false);
  }
  {
    const r = await runOne('9z nails salon');
    eq('a 2-letter/digit token cannot anchor a name', r.is_natural_person, false);
  }
  {
    const r = await runOne('OSLO');
    eq('a business literally named after its city is not a person', r.is_natural_person, false);
  }
  {
    // Held as "<District> House Apartments" reads as a person, and drafted as
    // "Hi <District>," - from the real outreach queue.
    const r = await runOne('Testvik House Apartments - Eksempelgata 2');
    eq('an apartment company with its street appended is not a person', r.is_natural_person, false);
  }
  {
    const r = await runOne('Karis Frisor - Eksempelgata 12');
    eq('a street name is never read as a surname', r.is_natural_person, false);
  }
  {
    // Still held - "Eksempel Brygge" stands in for a real place name, and
    // nothing here can know it is a place. A hold costs one review click; the
    // greeting no longer uses the guess.
    const r = await runOne('The APARTMENTS company - Eksempel Brygge');
    ok('"The APARTMENTS" itself is no longer the name extracted',
      r.detected_person_name !== 'The APARTMENTS', r.detected_person_name);
  }

  // --- an opt-out country does not hold named traders --------------------
  {
    const UAE = [{ json: { country_code: 'ae', law: 'PDPL - right to object', rule: 'opt_out' } }];
    const r = await runOne('Sample Dental', 'ae', UAE);
    eq('in an opt-out country a name-like trading name is not held', r.is_natural_person, false);
    ok('  and the reason says why it was let through', /opt-out/.test(r.natural_person_reason || ''), r.natural_person_reason);
    const n = await runOne('Glow beauty Advisor Kari Marie Nordmann');
    eq('Norway (consent) still holds a real person', n.is_natural_person, true);
    const u = await runOne('Sample Dental', 'qa', UAE);
    eq('a country with no recorded rule is still held', u.is_natural_person, true);
  }

  // --- documented, accepted limitations - false positives, safe direction -
  {
    const r = await runOne('LumiBee Frisor-Health & Beauty');
    ok('a coined trading name can still false-positive - this is accepted, ' +
       'not silently fixed, because the cost is one review click',
      r.is_natural_person === true);
  }

  // --- fail-closed on an unlisted country ---------------------------------
  {
    const r = await runOne('Kari Marie Nordmann Salon', 'zz', []);   // no consent row at all
    eq('a name is still held even when the country has no confirmed rule',
      r.is_natural_person, true);
    ok('and the reason says the rule is unverified, not confirmed safe',
      /not yet in consent_required_countries/.test(r.natural_person_reason),
      r.natural_person_reason);
  }

  // --- never invents a name where there is genuinely none to find --------
  {
    const r = await runOne('Eksempel’s Beauty');
    eq('no person name in a business name -> no name field either',
      r.detected_person_name, null);
    eq('and nothing to hold for', r.natural_person_reason, null);
  }

  // --- the real bug: alwaysOutputData sends one blank item, not zero -----
  // "Who is due a message?" has alwaysOutputData set, so a zero-row query
  // arrives here as ONE blank {} item, not an empty array. The first fix
  // tried to make this node (then Run Once for Each Item) return [] for
  // that one item - invalid in that mode, so the blank item survived and
  // "Insert the draft" crashed on the same NOT NULL violation as before.
  // Switching to Run Once for All Items and filtering the batch up front
  // (same pattern as CH-02's Stage A, verified working live) is the real
  // fix - an empty array is simply zero items in this mode.
  {
    const out = await runBatch([{}]);
    eq('a blank alwaysOutputData placeholder produces no output at all', out.length, 0);
  }
  {
    const out = await runBatch([{ id: null, name: 'should be unreachable' }]);
    eq('an id-less row is the same case, whatever shape the blank arrives in', out.length, 0);
  }
  {
    // A real row alongside a blank one - only the real one should survive.
    const out = await runBatch([{}, { id: 9, name: 'Real Business AS', country: 'Norway', country_code: 'no' }]);
    eq('a blank item does not swallow real rows in the same batch', out.length, 1);
    eq('and the real row is the one that comes through', out[0].json.id, 9);
  }

  done('natural-person detection');
})();
