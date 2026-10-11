// The normaliser, against the shape the actor really produces.
//
// tests/fixtures/apify-oslo-salons.json mirrors one live run (30 beauty salons
// in Oslo, `website: "withoutWebsite"`, 13 September 2026): the same field
// names, the same nesting, the same optional fields missing on the same kinds
// of row, and the same quirks - listings with no phone, address or city of
// their own, a foreign mobile on an Oslo business, an Instagram handle as a
// business name, and somebody's test listing.
//
// The VALUES are fictional. The public copy carries 10 invented businesses,
// placeholder phone numbers and made-up place ids instead of the real run's
// data, so this checks the field mapping against the actor's real field names
// - which is where the defensive mapping either earns its place or turns out
// to be guarding the wrong names - without publishing anybody's listing.
//
// It is also the fixture that makes re-testing free. From the LinkedIn
// post-mortem, on why that project got a warning: "One live page load produces
// a fixture that supports a hundred iterations."

const fs = require('fs');
const path = require('path');
const { compile, ok, eq, done } = require('./helpers');

const rows = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'apify-oslo-salons.json'), 'utf8'));

const normalise = compile('CH-01-discover.json', 'Normalise the business', {
  $input: null, $: null,
});

const TARGET = {
  id: 1, niche: 'Beauty Salons', niche_query: 'beauty salon',
  country: 'Norway', country_code: 'no', city: 'Oslo', state: null,
  cctlds: ['.no', '.com'],
};

(async () => {
  console.log('normaliser vs real Apify output\n');

  const out = (await normalise({
    $input: { all: () => rows.map((json) => ({ json })) },
    $: (n) => ({ first: () => ({ json: n === 'Config' ? {} : TARGET }) }),
  })).map((o) => o.json);

  // --- the filter did what the whole cost model depends on -----------------
  eq('the fixture holds its 10 rows', rows.length, 10);
  eq('not one returned place had a website', rows.filter((r) => r.website).length, 0);

  // --- nothing real was silently dropped ----------------------------------
  const expected = rows.filter((r) => r.placeId && r.title && !r.permanentlyClosed).length;
  eq('every usable row survived normalisation', out.length, expected);

  // --- the mapped fields actually landed ----------------------------------
  ok('every row got a place id', out.every((b) => b.google_place_id));
  ok('every row got a name', out.every((b) => b.name));
  ok('every row got a name key', out.every((b) => b.name_norm));
  ok('every row got a category', out.every((b) => b.category_primary));

  const withGeo = out.filter((b) => b.geohash7).length;
  eq('every row had coordinates, so every row got a geo key', withGeo, out.length);

  const withPhone = out.filter((b) => b.phone_e164).length;
  ok('phones converted to E.164', withPhone >= 8, `${withPhone} of ${out.length}`);
  // NOT "every number is Norwegian". The first version asserted that and
  // failed on a Spanish mobile (+34 6...) listed for a salon in Oslo.
  // That is real: a business run by somebody using their own foreign mobile,
  // which is precisely the profile that tends not to have a website. The code
  // was right to pass a +-prefixed number through untouched; the assertion was
  // wrong, and "correcting" the normaliser to force +47 would have mangled a
  // perfectly good phone number into an unreachable one.
  const foreign = out.filter((b) => b.phone_e164 && !b.phone_e164.startsWith('+47'));
  ok('every phone is well-formed E.164',
    out.filter((b) => b.phone_e164).every((b) => /^\+[1-9]\d{6,14}$/.test(b.phone_e164)),
    out.filter((b) => b.phone_e164 && !/^\+[1-9]\d{6,14}$/.test(b.phone_e164))
       .map((b) => b.phone_e164).join(', '));
  ok('a foreign number is kept as given, not forced to the local country',
    foreign.every((b) => b.phone_raw.replace(/[^\d]/g, '') === b.phone_e164.slice(1)),
    foreign.map((b) => `${b.phone_raw} -> ${b.phone_e164}`).join('; '));

  // Two of the rows carry no city of their own. The target's city is the
  // correct fallback - these businesses were found BY searching Oslo.
  ok('a missing city falls back to the target city',
    out.every((b) => b.city), out.filter((b) => !b.city).length + ' blank');

  // --- the dedup keys are actually unique on real data --------------------
  //
  // This is the assertion that would catch a normaliser that looks fine on
  // invented input and collapses distinct businesses on real input.
  const ids = new Set(out.map((b) => b.google_place_id));
  eq('place ids are unique', ids.size, out.length);

  const phones = out.filter((b) => b.phone_e164).map((b) => b.phone_e164);
  eq('no two businesses share a phone number', new Set(phones).size, phones.length);

  const nameGeo = out.filter((b) => b.geohash7).map((b) => b.name_norm + '|' + b.geohash7);
  eq('no two share a name+geo cell', new Set(nameGeo).size, nameGeo.length);

  // --- what the data is actually like -------------------------------------
  //
  // Printed rather than asserted. These numbers feed the scoring model, and
  // the point of looking is that HALF of these businesses have no reviews at
  // all - so a viability score leaning on review count scores half the list
  // at zero.
  const withReviews = out.filter((b) => b.review_count > 0).length;
  const withRating = out.filter((b) => b.rating > 0).length;
  console.log('');
  console.log(`  note: ${withReviews}/${out.length} have any reviews, ` +
              `${withRating}/${out.length} have a rating`);
  console.log(`  note: ${out.filter((b) => Object.keys(b.social_profiles).length).length}` +
              `/${out.length} carry a social profile in the listing`);
  ok('at least some have reviews to score on', withReviews > 0);

  // --- a real name that broke nothing ------------------------------------
  // "@lashlift.sample" stands in for a business whose Maps name is an
  // Instagram handle, and "Eksempel Test Listing" for somebody's test listing.
  // Both shapes are in the live data. Neither should crash the normaliser, and neither should produce an
  // empty key that then collides with another empty key.
  const odd = out.filter((b) => /lashlift|test/i.test(b.name));
  ok('odd real-world names still produce usable keys',
    odd.every((b) => b.name_norm && b.name_norm.length > 1),
    odd.map((b) => `${b.name} -> "${b.name_norm}"`).join('; '));

  done('normaliser vs real Apify output');
})();
