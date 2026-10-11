// CH-01, node: "Normalise the business"
// Mode: Run Once for All Items
//
// Turns whatever the Apify actor happened to return into the shape the
// businesses table expects, and computes the three dedup keys.
//
// Two things here are defensive on purpose:
//
//   1. Field names. Apify's Maps actors do not agree with each other and do
//      not agree with their own previous versions. Every read goes through
//      pick(), which tries several spellings. The whole record is kept in
//      `raw` so a field that moves can be re-mapped later without re-scraping
//      and re-paying for it.
//
//   2. Accents. This project targets Norway, Spain, Portugal, Italy and the
//      UAE. "Frisør" and "frisor", "Peluquería" and "peluqueria" are the same
//      business, and a name key that does not fold them produces a duplicate
//      on every second Scandinavian salon. NFD-normalising before stripping
//      combining marks is what makes name_norm stable across sources — which
//      matters most at Stage B, where we match Google's spelling against
//      Overture's.

const CFG = $('Config').first().json;
const target = $('Pick one target').first().json;

// --- field access ----------------------------------------------------------
const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
};

// --- name normalisation ----------------------------------------------------
// Legal forms carry no identifying information and are written inconsistently
// across sources: "Salong Eksempel AS" in Google is often "Salong Eksempel" in
// Overture. Stripping them is what lets the two match.
const LEGAL = new Set([
  // Scandinavia
  'as', 'asa', 'ans', 'da', 'nuf', 'ab', 'hb', 'kb', 'aps', 'is', 'ks',
  // Southern Europe
  'sl', 'slu', 'sa', 'sau', 'lda', 'unipessoal', 'srl', 'srls', 'spa', 'snc', 'sas',
  // Gulf
  'llc', 'lc', 'fze', 'fzco', 'fzllc', 'dmcc', 'est', 'establishment',
  // Anglo
  'inc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'ulc', 'plc',
  // Generic filler
  'the', 'and', 'group', 'holdings', 'international',
]);

// Folds accents so that the same business matches across sources.
// NFD splits an accented letter into base + combining mark; the mark is
// then stripped by code point rather than by a literal character class,
// because this file is round-tripped through JSON on its way into n8n and
// a literal combining mark does not survive that reliably.
const COMBINING = /[̀-ͯ]/g;
// Letters that do NOT decompose under NFD and so must be mapped by hand.
// Norwegian and Danish alone make this non-optional: without it, every
// "Frisor" / "Frisør" pair is two businesses instead of one.
const FOLD = [
  [/ø/g, 'o'], [/Ø/g, 'o'],   // o-slash
  [/æ/g, 'ae'], [/Æ/g, 'ae'], // ae ligature
  [/å/g, 'a'], [/Å/g, 'a'],   // a-ring
  [/ß/g, 'ss'],                     // sharp s
  [/đ/g, 'd'], [/ł/g, 'l'],   // d-stroke, l-stroke
  [/œ/g, 'oe'], [/Œ/g, 'oe'], // oe ligature - matters for Quebec
  [/þ/g, 'th'], [/ð/g, 'd'],  // thorn, eth
];
const deaccent = (s) => {
  let t = String(s || '').normalize('NFD').replace(COMBINING, '');
  for (const [re, to] of FOLD) t = t.replace(re, to);
  return t;
};

const normaliseName = (raw) => {
  const words = deaccent(raw)
    .toLowerCase()
    // Dots are CLOSED UP, not turned into spaces. Southern-European legal
    // forms are written "S.L.", "S.p.A.", "A/S" — splitting on the dots turns
    // one legal form into several single letters, which then survive the
    // LEGAL filter because "s" and "l" are not "sl". That produced
    // "peluqueria sol s l" where Overture holds "peluqueria sol", so the two
    // never matched and Stage B silently stopped catching Spanish
    // false positives.
    .replace(/[.\/]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !LEGAL.has(w))
    // A bare single letter left over from an abbreviation is noise, never a
    // distinguishing feature of a business name.
    .filter((w) => w.length > 1 || /[0-9]/.test(w));
  return words.join(' ').trim();
};

// --- phone -----------------------------------------------------------------
// E.164 is the strongest dedup key there is: two listings that share a phone
// number are the same business, whatever they call themselves.
const DIAL = {
  'norway': '47', 'sweden': '46', 'denmark': '45', 'finland': '358',
  'united arab emirates': '971', 'qatar': '974', 'saudi arabia': '966',
  'spain': '34', 'portugal': '351', 'italy': '39', 'greece': '30',
  'canada': '1', 'united states': '1', 'pakistan': '92',
};

const toE164 = (raw, country) => {
  let s = String(raw || '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return '';
  if (hasPlus) return '+' + s;
  if (s.startsWith('00')) return '+' + s.slice(2);

  const cc = DIAL[String(country || '').toLowerCase()];
  if (!cc) return '';                       // unknown country: refuse to guess
  // A national number conventionally carries a trunk 0 that E.164 drops.
  // Getting this wrong makes every Italian number a non-match, so Italy is
  // the exception worth knowing: it KEEPS its leading 0 on landlines.
  if (s.startsWith(cc) && s.length > String(cc).length + 5) return '+' + s;
  if (s.startsWith('0') && cc !== '39') s = s.slice(1);
  return '+' + cc + s;
};

// --- geohash ---------------------------------------------------------------
// Precision 7 is roughly a 153m x 153m cell. Chosen because it is about the
// size of a city block: two listings of the same salon rarely differ by more
// than a few metres, and two DIFFERENT salons with the same normalised name
// inside one block is rare enough to accept as a collision.
//
// Written out rather than imported because an n8n Code node has no packages.
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const geohash = (lat, lon, precision) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  // Null island. pick() returns '' for a missing field and Number('') is 0, so
  // a business with no coordinates lands at 0,0 and hashes to 7zzzzzz - the
  // SAME cell as every other business with no coordinates. Combined with
  // name_norm that is a dedup key which starts merging unrelated businesses,
  // and a Stage B cross-check that matches them against each other. An
  // absent coordinate has to stay absent.
  if (lat === 0 && lon === 0) return '';
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = '', bits = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon > mid) { ch = (ch << 1) + 1; lonMin = mid; } else { ch = ch << 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) { ch = (ch << 1) + 1; latMin = mid; } else { ch = ch << 1; latMax = mid; }
    }
    even = !even;
    if (++bits === 5) { hash += B32[ch]; bits = 0; ch = 0; }
  }
  return hash;
};

// --- social profiles -------------------------------------------------------
const SOCIAL_KEYS = [
  ['facebook', 'facebooks', 'facebookUrl'],
  ['instagram', 'instagrams', 'instagramUrl'],
  ['linkedin', 'linkedIns', 'linkedinUrl'],
  ['twitter', 'twitters', 'twitterUrl'],
  ['tiktok', 'tiktoks', 'tiktokUrl'],
  ['youtube', 'youtubes', 'youtubeUrl'],
];

const collectSocials = (p) => {
  const out = {};
  for (const [name, ...aliases] of SOCIAL_KEYS) {
    const v = pick(p, name, ...aliases);
    if (!v) continue;
    out[name] = Array.isArray(v) ? v[0] : v;
  }
  return out;
};

// ---------------------------------------------------------------------------

const rows = $input.all().map((i) => i.json);

// An empty result is ambiguous — it can mean "the actor returned nothing" or
// "the HTTP node handed us the wrong shape" — and the two need different
// fixes. Saying which it is here saves the half hour of reading execution
// output that the job-hunt repo spent learning to do this.
if (!rows.length) {
  throw new Error(
    `Apify returned 0 items for "${target.niche_query}" in ${target.city || target.country}. ` +
    `Either the search genuinely has no results without websites, or the dataset ` +
    `id was wrong. Check the run in the Apify console before changing this node.`
  );
}

const out = [];
const seen = new Set();
let skippedNoId = 0;
let skippedClosed = 0;

for (const p of rows) {
  const placeId = String(pick(p, 'placeId', 'place_id', 'placeID', 'cid', 'fid') || '').trim();
  if (!placeId) { skippedNoId++; continue; }
  if (seen.has(placeId)) continue;             // within-batch dedup
  seen.add(placeId);

  const closed = Boolean(pick(p, 'permanentlyClosed', 'permanently_closed') === true);
  if (closed) { skippedClosed++; continue; }   // a closed business is not a lead

  const name = String(pick(p, 'title', 'name', 'placeName') || '').trim();
  if (!name) { skippedNoId++; continue; }

  const country = String(pick(p, 'countryCode', 'country') || target.country || '');
  // Number('') is 0, so an absent coordinate has to be rejected before the
  // conversion rather than after it.
  const numOrNull = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const lat = numOrNull(pick(p, 'location.lat', 'latitude', 'lat'));
  const lon = numOrNull(pick(p, 'location.lng', 'location.lon', 'longitude', 'lng', 'lon'));
  const phoneRaw = String(pick(p, 'phone', 'phoneUnformatted', 'internationalPhoneNumber') || '');

  const categories = []
    .concat(pick(p, 'categories', 'categoryName') || [])
    .flat()
    .filter(Boolean)
    .map(String);

  out.push({
    json: {
      google_place_id: placeId,
      search_target_id: target.id,
      niche: target.niche,

      name,
      name_norm: normaliseName(name),
      category_primary: String(pick(p, 'categoryName', 'category') || categories[0] || ''),
      categories,

      address: String(pick(p, 'address', 'formattedAddress') || ''),
      street: String(pick(p, 'street') || ''),
      city: String(pick(p, 'city', 'locality') || target.city || ''),
      state: String(pick(p, 'state', 'region') || target.state || ''),
      country: target.country,
      country_code: String(pick(p, 'countryCode') || ''),
      postal_code: String(pick(p, 'postalCode', 'zip') || ''),
      lat,
      lon,
      geohash7: geohash(lat, lon, 7),

      phone_raw: phoneRaw,
      phone_e164: toE164(phoneRaw, country) || toE164(phoneRaw, target.country),
      email: String(pick(p, 'email', 'emails.0') || ''),
      listing_url: String(pick(p, 'url', 'placeUrl', 'googleMapsUrl') || ''),
      social_profiles: collectSocials(p),

      rating: Number(pick(p, 'totalScore', 'rating')) || null,
      review_count: Number(pick(p, 'reviewsCount', 'userRatingCount', 'reviews')) || 0,
      price_level: String(pick(p, 'price', 'priceLevel') || ''),
      permanently_closed: false,
      temporarily_closed: Boolean(pick(p, 'temporarilyClosed') === true),

      // What the SOURCE said. Stage A decides what it means; this node does
      // not classify, it only records. Keeping the two separate is what lets
      // the classifier be re-run over old rows when its rules change.
      source_website_raw: String(pick(p, 'website', 'webSite', 'url_website') || ''),

      raw: p,
      source: 'apify:google-maps-extractor',
    },
  });
}

if (!out.length) {
  throw new Error(
    `All ${rows.length} Apify rows were discarded: ${skippedNoId} had no place id or name, ` +
    `${skippedClosed} were permanently closed. Nothing was stored.`
  );
}

return out;
