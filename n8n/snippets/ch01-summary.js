// CH-01, node: "What did we find?"
// Mode: Run Once for All Items
//
// Builds the Telegram line and the numbers the next node writes back.
//
// The distinction that matters here is NEW versus ALREADY KNOWN. The upsert
// returns `inserted` (from xmax = 0) precisely so this can be honest. A report
// that says "50 businesses found" every morning when 48 of them were found
// last week is a report that stops being read by Friday - and then the morning
// it says something real, nobody notices.

const rows = $input.all().map((i) => i.json).filter((r) => r && r.id);
const brake = $('BRAKE: can we afford this run?').first().json;

const total = rows.length;
const inserted = rows.filter((r) => r.inserted === true).length;
const known = total - inserted;

// Of the already-known rows, how many are still waiting on CH-02? Useful
// because a growing backlog here is the first sign CH-02 has stopped running,
// and that is invisible from CH-02's own output - a workflow that is not
// running produces no report at all.
const pending = rows.filter((r) => r.website_status === 'PENDING').length;

const where = [brake.city, brake.country].filter(Boolean).join(', ');

if (!total) {
  // Zero results is a real finding, not an error: it can genuinely mean every
  // business of this type in this city already has a website. Saying so
  // plainly beats an empty message that reads as a broken workflow.
  return [{
    json: {
      target_id: brake.target_id,
      total: 0,
      message:
        `CH-01 ${brake.niche} / ${where}\n` +
        `No businesses without a website were returned.\n` +
        `Asked for up to ${brake.asked_for}. Either this market is saturated, ` +
        `or the search term "${brake.niche_query}" is wrong for it.`,
    },
  }];
}

const lines = [
  `CH-01 ${brake.niche} / ${where}`,
  `${inserted} new, ${known} already known (${total} returned)`,
  `${pending} now waiting on verification`,
];

if (brake.budget_remaining != null) {
  const left = brake.budget_remaining - total;
  // Says WHICH limit is binding. "Running low" is not actionable on its own -
  // raising our own cap and topping up the Apify plan are different jobs, and
  // doing the wrong one leaves the pipeline just as stopped.
  lines.push(`~${Math.max(0, left)} places left before ${brake.budget_binding} runs out` +
             (brake.credit_remaining_usd != null ? ` ($${brake.credit_remaining_usd} credit)` : ''));
  if (left < 100) {
    lines.push(brake.budget_binding === 'Apify credit'
      ? 'Apify credit is nearly gone. It resets on the 1st and does not roll over.'
      : 'Our own cap is nearly reached. Raise app_state.apify_spend.monthly_place_cap.');
  }
}

// A sample makes the report checkable at a glance. A number alone cannot be
// sanity-checked; three names can.
const sample = rows.filter((r) => r.inserted).slice(0, 3).map((r) => r.google_place_id);
if (sample.length) lines.push(`e.g. ${sample.join(', ')}`);

return [{
  json: {
    target_id: brake.target_id,
    total,
    inserted,
    known,
    pending,
    message: lines.join('\n'),
  },
}];
