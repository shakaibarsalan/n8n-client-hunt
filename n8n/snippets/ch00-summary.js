// CH-00, node: "What did we add?"
// Mode: Run Once for All Items
//
// One line per target that gained leads. Nothing added is the normal state
// once a city's matching places are used up, and says nothing - an empty
// return ends the run quietly instead of sending "0 new" four times a day.

const rows = $('Take new leads from open data').all().map((i) => i.json)
  .filter((r) => r && r.target_id != null);

const added = rows.filter((r) => Number(r.added) > 0);
if (!added.length) return [];

const total = added.reduce((n, r) => n + Number(r.added), 0);
const lines = [`CH-00 added ${total} lead(s) from open data, free - CH-02 verifies them next:`];
for (const r of added) lines.push(`  ${r.niche} - ${r.city}: ${r.added}`);

return [{ json: { total, message: lines.join('\n') } }];
