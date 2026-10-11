// CH-02, node: "What did verification decide?"
// Mode: Run Once for All Items
//
// The report that tells you whether the core claim of this project is holding
// up. It deliberately leads with the numbers that would reveal it failing.

const rows = $('Classify and score confidence').all().map((i) => i.json);

if (!rows.length) {
  // Nothing pending is the steady state once a market is fully verified. It
  // is the system idling correctly and must not read as a fault.
  return [{ json: { quiet: true, message: 'CH-02: nothing waiting to be verified.' } }];
}

const by = (s) => rows.filter((r) => r.website_status === s).length;

const confirmed = by('NO_WEBSITE_CONFIRMED');
const likely = by('NO_WEBSITE_LIKELY');
const weak = by('WEAK_WEBSITE');
const has = by('HAS_WEBSITE');
const uncertain = by('WEBSITE_UNCERTAIN');
const invalid = by('INVALID');

// The single most important number in the project.
//
// Every one of these is a business whose Maps listing claimed no website and
// which turned out to have one. Stage A alone would have shipped all of them
// as leads, and each would have produced an email opening "I noticed you
// don't have a website" to somebody who does.
//
// If this number is near zero, the cross-check stages are not earning their
// place. If it is large, they are the reason the list is worth anything.
const caughtByCrossCheck = rows.filter(
  (r) => r.stage_a_claim !== 'real' && (r.website_status === 'HAS_WEBSITE' || r.website_status === 'WEAK_WEBSITE')
).length;

const caughtByDataset = rows.filter(
  (r) => r.stage_a_claim !== 'real' && r.stage_b_website
).length;
const caughtByProbe = rows.filter(
  (r) => r.stage_a_claim !== 'real' && !r.stage_b_website && r.probe_result === 'found'
).length;

// Probes that could not complete. These are the rows where we genuinely do
// not know, and they are held back from qualification rather than guessed at.
const unreachable = rows.filter((r) => r.probe_result === 'unreachable').length;
const refused = rows.filter((r) => r.probe_result === 'refused').length;

const pct = (n) => (rows.length ? Math.round((n / rows.length) * 100) : 0);

const lines = [
  `CH-02 verified ${rows.length}`,
  '',
  `${confirmed} no website (confirmed)`,
  `${likely} no website (likely)`,
  `${weak} weak website`,
  `${has} has a working website`,
  `${uncertain} uncertain - held for review`,
];
if (invalid) lines.push(`${invalid} invalid or closed`);

lines.push('');
lines.push(`False positives caught: ${caughtByCrossCheck} (${pct(caughtByCrossCheck)}%)`);
lines.push(`  ${caughtByDataset} by the free datasets, ${caughtByProbe} by probing`);

if (unreachable || refused) {
  lines.push('');
  lines.push(`Could not establish: ${unreachable} unreachable, ${refused} unprovable name`);
}

// A cross-check catch rate of zero means one of two things, and they need
// different fixes, so the report says which to check rather than leaving it
// as a number to interpret.
if (caughtByCrossCheck === 0 && rows.length >= 20) {
  lines.push('');
  lines.push('No false positives caught at all. Either the reference tables are empty for this city, or Maps is unusually accurate here. Check: SELECT count(*) FROM ref_overture_places WHERE lower(city) = ...');
}

// Search failing. Serper answers 400 when the account is out of credits,
// and from then on Stage C cannot run: leads stop reaching LIKELY and stop
// being emailed, silently. That is the one thing here worth a message.
const searchFailed = rows.filter((r) => (r.website_checks || []).some((c) =>
  c.stage === 'search' && c.evidence && /40[0-3]|credit/i.test(String(c.evidence.error || '')))).length;

// CH-02 runs every 5 minutes. A Telegram message per run was a dozen an
// hour - noise that buries the messages that matter (sends, replies,
// bounces). So it stays quiet unless search is failing, and even then
// speaks at most once an hour.
const alertSearch = searchFailed > 0 && new Date().getUTCMinutes() < 5;
if (alertSearch) {
  lines.unshift(`SEARCH IS FAILING for ${searchFailed} of ${rows.length} - the Serper account is ` +
    'probably out of credits. New leads cannot be verified as no-website until it is topped up ' +
    'or another key is set (SERPER_API_KEY, then re-import the workflows).', '');
}

return [{
  json: {
    quiet: !alertSearch,
    search_failed: searchFailed,
    total: rows.length,
    confirmed, likely, weak, has, uncertain,
    caught_by_cross_check: caughtByCrossCheck,
    message: lines.join('\n'),
  },
}];
