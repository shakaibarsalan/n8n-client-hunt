// CH-03's Config.scoring_version and score-lead.js's SCORING_VERSION constant
// have to name the same string, and nothing enforces that at runtime - a
// mismatch does not error, it just means select-pending-scoring.sql's
// NOT EXISTS check never finds a business without a current-version score,
// because every business already has one under the version Config no longer
// names. The workflow would report "nothing waiting to be scored" forever,
// which reads as the system idling correctly rather than as broken.
//
// Same shape of seam as the JS/Python normalisation parity test - two
// representations of one fact that must be kept in sync by hand, pinned here
// so drift fails CI instead of failing silently in production.

const fs = require('fs');
const path = require('path');
const { ok, done } = require('./helpers');

const scoreLeadSrc = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'snippets', 'score-lead.js'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'workflows', 'CH-03-score-leads.json'), 'utf8'));

(async () => {
  console.log('scoring_version stays in sync between score-lead.js and CH-03\n');

  const m = scoreLeadSrc.match(/const SCORING_VERSION = '([^']+)';/);
  ok('score-lead.js declares a SCORING_VERSION constant', Boolean(m), 'pattern not found');
  const jsVersion = m && m[1];

  const configNode = workflow.nodes.find((n) => n.name === 'Config');
  ok('CH-03 has a Config node', Boolean(configNode));
  const assignment = configNode.parameters.assignments.assignments
    .find((a) => a.name === 'scoring_version');
  ok('Config declares scoring_version', Boolean(assignment));
  const configVersion = assignment && assignment.value;

  ok(`versions match: score-lead.js="${jsVersion}" Config="${configVersion}"`,
    jsVersion && configVersion && jsVersion === configVersion,
    `${jsVersion} !== ${configVersion}`);

  done('scoring_version parity');
})();
