// CH-03, node: "What did scoring produce?"
// Mode: Run Once for All Items

const rows = $('Store the score').all().map((i) => i.json).filter((r) => r && r.id);

if (!rows.length) {
  // Nothing to score is the normal state once every verified business
  // already has a current score. Not a fault.
  return [{ json: { quiet: true, message: 'CH-03: nothing waiting to be scored.' } }];
}

const qualified = rows.filter((r) => r.qualified).length;

const lines = [
  `CH-03 scored ${rows.length}`,
  `  ${qualified} qualified (ready for CH-04 to draft)`,
];

const top = rows.slice().sort((a, b) => b.total - a.total).slice(0, 3);
if (top.length) {
  lines.push('');
  lines.push('Top of this batch:');
  for (const r of top) lines.push(`  ${r.total}  business #${r.business_id}`);
}

// Quiet since 5 Oct 2026, at the owner's request: a message per run (every
// 10 minutes) buried the ones that matter. CH-07's twice-daily digest
// reports what this produced.
return [{ json: { quiet: true, total: rows.length, qualified, message: lines.join('\n') } }];
