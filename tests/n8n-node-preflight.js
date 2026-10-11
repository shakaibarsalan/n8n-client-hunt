#!/usr/bin/env node
//
// Checks every workflow for the faults n8n rejects but JavaScript does not.
//
// Adapted from job-hunt-automation/tests/n8n-node-preflight.js, whose header
// explains why it exists:
//
//     "Three faults reached the operator in one session, all of them things a
//      normal unit test cannot see, because the thing rejecting the code was
//      n8n itself rather than JavaScript."
//
// Run:  node tests/n8n-node-preflight.js

const fs = require('fs');
const path = require('path');

// Defaults to the built workflows. An explicit directory is accepted so the
// checker can be pointed at a fixture set - including the deliberately broken
// one in tests/fixtures/broken-workflows, which is how we know it still
// catches anything at all.
const DIR = process.argv[2] || path.join(__dirname, '..', 'n8n', 'workflows');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const failures = [];
let codeNodes = 0;
let expressions = 0;

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// --- 1. Per-item mode forbids the all-items accessors ----------------------
//
// n8n finds them by matching the SOURCE TEXT, so a comment mentioning one is
// rejected exactly like a call to one. The job-hunt repo lost a session to
//   "Can't use .first() here [line 49, for item 0]"
// from a line that called nothing.
//
// The pattern is assembled from parts so that this checker does not trip the
// very rule it enforces if anyone ever pastes it into a Code node.
const FORBIDDEN = new RegExp(
  '\\$' + 'input\\s*\\.\\s*(all|first|last|itemMatching)\\s*\\(', 'g');

const checkPerItemMode = (wf, node, src) => {
  if ((node.parameters || {}).mode !== 'runOnceForEachItem') return;
  let m;
  FORBIDDEN.lastIndex = 0;
  while ((m = FORBIDDEN.exec(src))) {
    failures.push(
      `${wf} / "${node.name}" line ${lineOf(src, m.index)}: ` +
      `uses ${m[0]} in Run Once for Each Item mode (n8n reads comments too)`);
  }
};

// --- 2. The body must parse as an ASYNC function ---------------------------
//
// A Code node body runs in an async context, so top-level await is legal
// there. Parsing it with a plain Function reports every httpRequest call as a
// syntax error, and a checker that cries wolf gets ignored - which is worse
// than not having one.
const checkParses = (wf, node, src) => {
  try {
    new AsyncFunction(src);
  } catch (e) {
    failures.push(`${wf} / "${node.name}": does not parse - ${e.message}`);
  }
};

// --- 3. Expressions must evaluate ------------------------------------------
//
// Two shapes exist and they are not interchangeable:
//   "={{ expr }}"                  one expression
//   "=text {{ a }} more {{ b }}"   a template with literal text between
// Slicing the ends off blindly turns the second into a syntax error that is
// not really there.
// A stub that survives anything an expression does to it: property access to
// any depth, being called, and being interpolated into a template literal.
//
// The first version returned '' for every key, which broke the moment an
// expression was interpolated - the engine asks for Symbol.toPrimitive, got
// the string '', and tried to call it. The checker then reported a failure in
// a node that was fine. A checker that invents failures gets ignored exactly
// as fast as one that hides them.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => '';
    if (k === 'toString' || k === 'valueOf') return () => '';
    if (typeof k === 'symbol') return undefined;
    return stub();
  },
  apply: () => stub(),
  construct: () => stub(),
});

const STUB = {
  $json: stub(),
  $now: new Date(),
  $runIndex: 0,
  $: () => ({
    first: () => ({ json: stub() }),
    all: () => [],
    item: { json: stub() },
  }),
};

const evalExpression = (raw) => {
  const body = raw.slice(1);

  // Is this ONE expression, or a template with literal text around several?
  //
  //   "={{ expr }}"                       one expression
  //   "={{ a }}/actor-runs/{{ b }}"       a template
  //
  // A greedy /^\{\{([^]*)\}\}$/ matches the second as if it were the first,
  // because it happily spans the "}}...{{" in the middle. It then produces
  // `return ( a }}/actor-runs/{{ b );` and reports a syntax error that is not
  // in the workflow at all. Requiring exactly one opening brace pair is what
  // tells the two shapes apart.
  const single =
    body.startsWith('{{') &&
    body.endsWith('}}') &&
    body.indexOf('{{', 2) === -1;

  const src = single
    ? `return (${body.slice(2, -2)});`
    : 'return `' + body
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\{\{([^]*?)\}\}/g, (_, e) => '${' + e + '}') + '`;';
  const fn = new Function('$json', '$now', '$runIndex', '$', src);
  return fn(STUB.$json, STUB.$now, STUB.$runIndex, STUB.$);
};

const walkParams = (wf, nodeName, obj, keyPath) => {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkParams(wf, nodeName, v, `${keyPath}[${i}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      walkParams(wf, nodeName, v, keyPath ? `${keyPath}.${k}` : k);
    }
    return;
  }
  if (typeof obj !== 'string') return;
  if (!obj.startsWith('=')) return;

  // A jsonBody is checked even with no {{ in it. It is still sent to a real
  // API as a body, and a literal that is not valid JSON fails there rather
  // than here - at which point the error names the remote service and sends
  // you looking in the wrong place.
  const isJsonBody = keyPath.endsWith('jsonBody');
  if (!obj.includes('{{') && !isJsonBody) return;

  expressions++;
  let result;
  try {
    result = evalExpression(obj);
  } catch (e) {
    failures.push(`${wf} / "${nodeName}" [${keyPath}]: expression does not evaluate - ${e.message}`);
    return;
  }
  // A jsonBody that evaluates to something JSON.parse rejects is the
  // apostrophe-inside-a-quoted-string class of bug, and it only shows up at
  // run time against a live API.
  if (keyPath.endsWith('jsonBody') && typeof result === 'string') {
    try {
      JSON.parse(result);
    } catch (e) {
      failures.push(`${wf} / "${nodeName}" [${keyPath}]: evaluates to invalid JSON - ${e.message}`);
    }
  }
};

// --- 4. Every referenced node must exist -----------------------------------
//
// Code nodes address each other by NAME, so a name is API surface. Renaming a
// node breaks every $('...') that points at it, and n8n reports that at run
// time as an empty result rather than as a missing reference.
const checkNodeRefs = (wf, node, src, names) => {
  const re = /\$\(\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (!names.has(m[1])) {
      failures.push(
        `${wf} / "${node.name}" line ${lineOf(src, m.index)}: ` +
        `references node "${m[1]}", which does not exist in this workflow`);
    }
  }
};

// --- 5. Connections must point at real nodes -------------------------------
const checkConnections = (wf, doc, names) => {
  for (const [from, spec] of Object.entries(doc.connections || {})) {
    if (!names.has(from)) {
      failures.push(`${wf}: connections reference "${from}", which is not a node`);
    }
    for (const branch of spec.main || []) {
      for (const c of branch || []) {
        if (!names.has(c.node)) {
          failures.push(`${wf}: "${from}" connects to "${c.node}", which is not a node`);
        }
      }
    }
  }
};

// ---------------------------------------------------------------------------

if (!fs.existsSync(DIR)) {
  console.error('no n8n/workflows directory - run: node tools/build-workflows.js');
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
if (!files.length) {
  console.error('no workflows found - run: node tools/build-workflows.js');
  process.exit(1);
}

// An n8n node runs ONCE PER INPUT ITEM unless executeOnce is set. So a query
// node placed downstream of a node that loads a lookup TABLE runs once per
// row of that table, re-running the same query and multiplying every business
// downstream by the size of the lookup.
//
// This is not hypothetical. CH-02 loaded 163 platform_domains rows, so "Pick
// what needs checking" ran 163 times, every business went through Stages C-F
// 163 times, and the workflow was killed at n8n's 300-second ceiling on every
// single scheduled run. It wrote 652 duplicate website_checks rows for the one
// business that did get through. CH-03 (11 scoring_weights) and CH-04 (4
// consent countries) had the identical wiring - their unique indexes hid it by
// swallowing the duplicate writes.
//
// No unit test can see this: it is a property of how n8n WIRES nodes, not of
// any node's code. Every snippet involved passed its own tests throughout.
const LOOKUP_HINT = /^(load|fetch|get) /i;
function checkFanOut(file, doc) {
  const byName = new Map((doc.nodes || []).map((n) => [n.name, n]));
  for (const [source, outputs] of Object.entries(doc.connections || {})) {
    const upstream = byName.get(source);
    // Only a node whose name says it loads a lookup set can fan out this way;
    // a node that legitimately emits one item per business is the normal case.
    if (!upstream || !LOOKUP_HINT.test(source)) continue;
    for (const group of (outputs.main || [])) {
      for (const conn of (group || [])) {
        const target = byName.get(conn.node);
        if (!target) continue;
        const runsPerItem = target.type === 'n8n-nodes-base.postgres' &&
                            !target.executeOnce;
        if (runsPerItem) {
          failures.push(
            `${file}: "${conn.node}" is a query node fed by "${source}", which loads a ` +
            `lookup table. It will run once PER ROW of that table and multiply every ` +
            `item downstream. Set "executeOnce": true on it.`);
        }
      }
    }
  }
}

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  } catch (e) {
    failures.push(`${file}: not valid JSON - ${e.message}`);
    continue;
  }

  const names = new Set((doc.nodes || []).map((n) => n.name));
  checkConnections(file, doc, names);
  checkFanOut(file, doc);

  for (const node of doc.nodes || []) {
    if (node.type === 'n8n-nodes-base.code') {
      const src = (node.parameters || {}).jsCode || '';
      codeNodes++;
      checkPerItemMode(file, node, src);
      checkParses(file, node, src);
      checkNodeRefs(file, node, src, names);
    }
    walkParams(file, node.name, node.parameters || {}, '');
  }
}

console.log(`checked ${codeNodes} code nodes and ${expressions} expressions in ${files.length} workflow(s)`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log('  FAIL  ' + f);
  console.log(`\n${failures.length} problem(s)`);
  process.exit(1);
}
console.log('all clear');
