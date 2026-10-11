// CH-04, node: "What did drafting produce?"
// Mode: Run Once for All Items

const rows = $('Insert the draft').all().map((i) => i.json).filter((r) => r && r.id);

if (!rows.length) {
  // Nothing to draft is the normal state once every qualified, emailed lead
  // already has whatever step is next in flight. Not a fault.
  return [{ json: { quiet: true, message: 'CH-04: nothing due to draft right now.' } }];
}

const approved = rows.filter((r) => r.status === 'approved').length;
const drafts = rows.filter((r) => r.status === 'draft').length;
const review = rows.filter((r) => r.status === 'needs_review').length;

const lines = [`CH-04 drafted ${rows.length}`];
if (approved) lines.push(`  ${approved} passed every guard - queued for CH-05 to send in business hours`);
if (drafts) lines.push(`  ${drafts} ready for review`);
if (review) lines.push(`  ${review} held (needs a decision - nothing held is ever sent automatically)`);

// Quiet since 5 Oct 2026, at the owner's request: a message per run (every
// 10 minutes) buried the ones that matter. CH-07's twice-daily digest
// reports what this produced.
return [{ json: { quiet: true, total: rows.length, approved, drafts, review, message: lines.join('\n') } }];
