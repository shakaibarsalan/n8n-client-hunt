#!/usr/bin/env node
//
// Runs everything. No test framework, no package.json, no install step - the
// same reasoning as the job-hunt repo: a test suite that needs setting up is
// one that gets skipped, and this project has exactly four test files.
//
//   node tests/run-all.js

const { execFileSync } = require('child_process');
const path = require('path');

const steps = [
  ['build is current', ['tools/build-workflows.js', '--check']],
  ['n8n preflight', ['tests/n8n-node-preflight.js']],
  ['preflight catches faults', ['tests/preflight-self.test.js']],
  ['dedup and normalisation', ['tests/dedup.test.js']],
  ['stage C: search for them', ['tests/stage-c-search.test.js']],
  ['stage D: prove the domain', ['tests/prove-domain.test.js']],
  ['website classification', ['tests/website-classification.test.js']],
  ['stage E: is the site any good?', ['tests/quality-check.test.js']],
  ['normalisation parity', ['tests/normalisation-parity.test.js']],
  ['real Apify output', ['tests/real-apify-output.test.js']],
  ['stage B platform filter', ['tests/stage-b-platform-filter.test.js']],
  ['stage F: find a contact email', ['tests/stage-f-find-email.test.js']],
  ['score-lead.js', ['tests/score-lead.test.js']],
  ['scoring_version parity', ['tests/score-lead-version.test.js']],
  ['natural-person detection', ['tests/detect-natural-person.test.js']],
  ['render + guard outreach draft', ['tests/render-outreach-draft.test.js']],
  ['CH-05 send brake', ['tests/brake-may-we-send.test.js']],
  ['CH-05 is the mailbox real?', ['tests/verify-mailbox.test.js']],
  ['CH-08 /stats on Telegram', ['tests/ch08-stats.test.js']],
  ['CH-06 classify inbound mail', ['tests/classify-inbound-mail.test.js']],
  ['CH-06 suggest an answer', ['tests/ch06-draft-reply.test.js']],
];

const root = path.join(__dirname, '..');
const failed = [];

for (const [label, args] of steps) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const out = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
    failed.push(label);
  }
}

console.log('\n' + '-'.repeat(60));
if (failed.length) {
  console.log('FAILED: ' + failed.join(', '));
  process.exit(1);
}
console.log(`all ${steps.length} checks passed`);
