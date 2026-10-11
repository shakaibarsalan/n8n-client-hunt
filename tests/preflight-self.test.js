// Does the preflight still catch anything?
//
// A linter that has quietly stopped working reports "all clear" forever, and
// that is indistinguishable from healthy code right up until the morning it
// matters. So the fixtures in tests/fixtures/broken-workflows each carry
// exactly one fault, and this asserts each one is still found.
//
// The sixth fixture carries NO fault: it is a valid multi-expression template
// like "={{ $json.base }}/runs/{{ $json.id }}". An earlier version of the
// checker matched that greedily and reported a syntax error that was not
// there. It is here as a regression guard, because a checker that invents
// failures gets ignored exactly as fast as one that hides them.

const { execFileSync } = require('child_process');
const path = require('path');
const { ok, done } = require('./helpers');

const root = path.join(__dirname, '..');
let out = '';
let exitCode = 0;

try {
  out = execFileSync(
    process.execPath,
    ['tests/n8n-node-preflight.js', 'tests/fixtures/broken-workflows'],
    { cwd: root, encoding: 'utf8' });
} catch (e) {
  out = String(e.stdout || '') + String(e.stderr || '');
  exitCode = e.status;
}

console.log('preflight self-check\n');

ok('it exits non-zero on broken workflows', exitCode === 1, 'exit ' + exitCode);

const expectations = [
  ['the per-item accessor, even inside a comment', /a-per-item-accessor.*Run Once for Each Item/],
  ['a body that does not parse', /b-syntax.*does not parse/],
  ['an expression that does not evaluate', /c-bad-expression.*does not evaluate/],
  ['a $() pointing at a node that is not there', /d-missing-node-ref.*does not exist in this workflow/],
  ['a connection to a node that is not there', /d-missing-node-ref.*is not a node/],
  ['a jsonBody that is not valid JSON', /e-invalid-jsonbody.*invalid JSON/],
];

for (const [label, re] of expectations) {
  ok('catches ' + label, re.test(out));
}

ok('does NOT flag a valid multi-expression template',
  !/f-multi-expression-template/.test(out),
  out.split('\n').filter((l) => /f-multi/.test(l)).join(' '));

done('preflight self-check');
