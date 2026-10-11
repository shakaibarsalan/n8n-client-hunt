#!/usr/bin/env node
//
// Builds n8n/workflows/*.json from n8n/templates/*.json by inlining the Code
// node bodies from n8n/snippets/.
//
//   node tools/build-workflows.js           build
//   node tools/build-workflows.js --check   fail if the built output is stale
//
// Why a build step rather than pasting code into the canvas:
//
//   The job-hunt repo keeps snippets as files and pastes them into n8n by
//   hand. That works until the two drift, and then the tests - which read the
//   workflow JSON - are testing code nobody is editing any more. Generating
//   the workflow FROM the snippet makes drift impossible, and --check makes it
//   impossible to forget.
//
// Non-ASCII is escaped to \uXXXX in the output. That is not cosmetic: a
// literal combining mark inside a regex character class does not reliably
// survive the trip through an editor, a JSON parser and n8n's own code
// validator, and when it breaks it breaks silently - the class stops matching
// and accented business names quietly stop folding.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'n8n', 'templates');
const SNIPPETS = path.join(ROOT, 'n8n', 'snippets');
const OUT = path.join(ROOT, 'n8n', 'workflows');

const check = process.argv.includes('--check');

// JSON.stringify emits raw UTF-8; force every non-ASCII code point into an
// escape so the built file is pure ASCII.
// The class is written as "not ASCII" rather than as a literal high
// range, for exactly the reason this function exists: a literal high
// character inside a character class is the fragile thing being defended
// against. Escaping per UTF-16 code unit is valid JSON even for surrogate
// pairs, so no special handling is needed for emoji or CJK.
const asciiSafe = (s) =>
  s.replace(/[^\x00-\x7F]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const inline = (node, file) => {
  if (Array.isArray(node)) return node.map((n) => inline(n, file));
  if (node && typeof node === 'object') {
    if (typeof node.$snippet === 'string') {
      const p = path.join(SNIPPETS, node.$snippet);
      if (!fs.existsSync(p)) {
        throw new Error(`${file}: references missing snippet ${node.$snippet}`);
      }
      // Normalise line endings. A CRLF that reaches an n8n Code node shows up
      // as a stray \r at the end of every line in the editor.
      return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    }
    if (typeof node.$sql === 'string') {
      const p = path.join(ROOT, 'n8n', 'sql', node.$sql);
      if (!fs.existsSync(p)) {
        throw new Error(`${file}: references missing sql ${node.$sql}`);
      }
      return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = inline(v, file);
    return out;
  }
  return node;
};

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const templates = fs.readdirSync(TEMPLATES).filter((f) => f.endsWith('.json')).sort();
if (!templates.length) {
  console.error('no templates found in n8n/templates/');
  process.exit(1);
}

let stale = 0;
let built = 0;

for (const file of templates) {
  const tpl = JSON.parse(fs.readFileSync(path.join(TEMPLATES, file), 'utf8'));
  const wf = inline(tpl, file);

  // A workflow that names a snippet it does not use, or a Code node with an
  // empty body, is a build that "succeeded" and produced something broken.
  for (const n of wf.nodes || []) {
    if (n.type === 'n8n-nodes-base.code') {
      const code = n.parameters && n.parameters.jsCode;
      if (!code || !String(code).trim()) {
        throw new Error(`${file}: Code node "${n.name}" has an empty body`);
      }
    }
  }

  const json = asciiSafe(JSON.stringify(wf, null, 2)) + '\n';
  const dest = path.join(OUT, file);
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;

  if (prev === json) {
    console.log(`  ok     ${file}`);
    continue;
  }
  if (check) {
    console.log(`  STALE  ${file}`);
    stale++;
    continue;
  }
  fs.writeFileSync(dest, json);
  console.log(`  built  ${file}  (${(wf.nodes || []).length} nodes)`);
  built++;
}

if (check && stale) {
  console.error(`\n${stale} workflow(s) out of date. Run: node tools/build-workflows.js`);
  process.exit(1);
}
console.log(check ? '\nworkflows are up to date' : `\nbuilt ${built}, ${templates.length} total`);
