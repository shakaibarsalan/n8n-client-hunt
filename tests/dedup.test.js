// The dedup keys, and the normalisation they depend on.
//
// Three layers guard against storing the same business twice:
//
//   1. google_place_id   - exact, and the one the upsert uses
//   2. phone_e164        - two listings sharing a number are one business
//   3. name_norm + geohash7 - same name, same ~150m cell
//
// Layers 2 and 3 only work if normalisation is stable ACROSS SOURCES. That is
// the real subject of this file: Google writes "Frisor Eksempel AS", Overture
// writes "Frisor Eksempel", and Stage B is worthless unless both reduce to the
// same key. Every assertion below is a spelling difference that actually
// occurs between Google Maps and the open datasets in the target markets.

const { compile, ok, eq, done } = require('./helpers');

const normalise = compile('CH-01-discover.json', 'Normalise the business', {
  $input: null,
  $: null,
});

const TARGET = {
  id: 1, niche: 'Beauty Salons', niche_query: 'beauty salon',
  country: 'Norway', city: 'Oslo', state: null,
};

const run = async (rows, target) => {
  const t = target || TARGET;
  const out = await normalise({
    $input: { all: () => rows.map((json) => ({ json })) },
    $: (name) => ({ first: () => ({ json: name === 'Config' ? {} : t }) }),
  });
  return out.map((o) => o.json);
};

const place = (over) => ({
  placeId: 'p' + Math.random().toString(36).slice(2),
  title: 'Somewhere',
  location: { lat: 59.9139, lng: 10.7522 },
  ...over,
});

(async () => {
  console.log('dedup keys and normalisation\n');

  // --- name_norm must survive spelling differences -------------------------
  {
    const r = await run([
      place({ title: 'Frisor Eksempel AS' }),
      place({ title: 'Frisor Eksempel' }),
    ]);
    eq('a Norwegian legal suffix is stripped', r[0].name_norm, r[1].name_norm);
  }

  {
    // Google writes the o-slash; an open dataset may hold the ASCII form. This
    // letter does NOT decompose under NFD, so it needs explicit folding - and
    // without it roughly every second Norwegian salon becomes two rows.
    const r = await run([
      place({ title: 'Frisør Eksempel' }),
      place({ title: 'Frisor Eksempel' }),
    ]);
    eq('o-slash folds to o', r[0].name_norm, r[1].name_norm);
  }

  {
    const r = await run([
      place({ title: 'Peluquería Sol S.L.' }),
      place({ title: 'Peluqueria Sol' }),
    ]);
    eq('accents fold and a dotted legal form is stripped whole',
      r[0].name_norm, r[1].name_norm);
    eq('and the result is clean', r[0].name_norm, 'peluqueria sol');
  }

  {
    // The bug this pins: stripping punctuation to SPACES turns "S.L." into
    // two single letters that then survive the legal-form filter, because "s"
    // and "l" are not "sl". The key became "peluqueria sol s l" and stopped
    // matching the dataset entirely - a silent, total failure of Stage B for
    // one country.
    const r = await run([place({ title: 'Inmobiliaria Costa S.A.' })]);
    ok('no orphan single letters are left behind',
      !/\bs\b|\ba\b/.test(r[0].name_norm), r[0].name_norm);
  }

  {
    const r = await run([
      place({ title: 'Al Noor Salon LLC' }),
      place({ title: 'Al Noor Salon' }),
    ], { ...TARGET, country: 'United Arab Emirates', city: 'Dubai' });
    eq('a Gulf legal form is stripped', r[0].name_norm, r[1].name_norm);
  }

  {
    const r = await run([
      place({ title: 'Hair & Beauty Studio' }),
      place({ title: 'Hair and Beauty Studio' }),
    ]);
    eq('ampersand and "and" are the same word', r[0].name_norm, r[1].name_norm);
  }

  // --- phone_e164 ----------------------------------------------------------
  {
    const r = await run([
      place({ phone: '+47 400 00 001' }),
      place({ phone: '0400 00 001' }),
      place({ phone: '0047 400 00 001' }),
    ]);
    ok('international, national and 00-prefixed forms all agree',
      r[0].phone_e164 === r[1].phone_e164 && r[1].phone_e164 === r[2].phone_e164,
      r.map((x) => x.phone_e164).join(' vs '));
  }

  {
    // Italy keeps the trunk zero on landlines, which is the one exception that
    // turns every Italian number into a non-match if it is applied blindly.
    const r = await run(
      [place({ phone: '02 0000 0001' })],
      { ...TARGET, country: 'Italy', city: 'Milan' });
    eq('Italy keeps its leading zero', r[0].phone_e164, '+390200000001');
  }

  {
    const r = await run(
      [place({ phone: '400 00 001' })],
      { ...TARGET, country: 'Atlantis' });
    eq('an unknown country produces no phone key rather than a wrong one',
      r[0].phone_e164, '');
  }

  // --- geohash -------------------------------------------------------------
  {
    const r = await run([
      place({ location: { lat: 59.9139, lng: 10.7522 } }),
      place({ location: { lat: 59.9139, lng: 10.7523 } }),
    ]);
    eq('two points metres apart share a cell', r[0].geohash7, r[1].geohash7);
  }

  {
    const r = await run([
      place({ location: { lat: 59.9139, lng: 10.7522 } }),
      place({ location: { lat: 41.3874, lng: 2.1686 } }),
    ]);
    ok('Oslo and Barcelona do not', r[0].geohash7 !== r[1].geohash7);
  }

  {
    const r = await run([place({ location: null, latitude: null, longitude: null })]);
    eq('missing coordinates produce no cell rather than a fake one', r[0].geohash7, '');
  }

  // --- what must never be stored -------------------------------------------
  {
    const r = await run([
      place({ placeId: 'dup' }),
      place({ placeId: 'dup' }),
    ]);
    eq('the same place twice in one batch is stored once', r.length, 1);
  }

  {
    const r = await run([place({ permanentlyClosed: true }), place({})]);
    eq('a permanently closed business is not a lead', r.length, 1);
  }

  {
    const r = await run([{ title: 'No id' }, place({})]);
    eq('a row with no place id is dropped', r.length, 1);
  }

  // --- field drift ---------------------------------------------------------
  {
    // Apify's Maps actors disagree with each other and with their own past
    // versions. The mapper tries several spellings for every field.
    const r = await run([{
      place_id: 'alt-1',
      name: 'Alt Naming Salon',
      latitude: 59.9139, longitude: 10.7522,
      phoneUnformatted: '+4740000002',
      userRatingCount: 42,
      rating: 4.4,
    }]);
    eq('an alternative id spelling is found', r[0].google_place_id, 'alt-1');
    eq('an alternative name spelling is found', r[0].name, 'Alt Naming Salon');
    eq('alternative coordinate spellings are found', r[0].geohash7, 'u4xsudv');
    eq('an alternative review-count spelling is found', r[0].review_count, 42);
  }

  // --- an empty result is a diagnosis, not silence -------------------------
  {
    let threw = '';
    try {
      await run([]);
    } catch (e) {
      threw = String(e.message);
    }
    ok('zero rows throws with an explanation rather than returning nothing',
      /returned 0 items/.test(threw), threw);
  }

  done('dedup keys and normalisation');
})();
