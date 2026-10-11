// Shared test plumbing.
//
// The one rule that matters here: node source is READ OUT OF THE WORKFLOW
// JSON, never copied into the test. A test holding its own copy of the code
// passes forever while the flow rots, and the day it matters it is testing
// something nobody has run in months.

const fs = require('fs');
const path = require('path');

const WORKFLOWS = path.join(__dirname, '..', 'n8n', 'workflows');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Compile ONCE per node. Rebuilding a function inside a loop turned a
// two-second check in the job-hunt repo into one that outran its own timeout.
const cache = new Map();

function nodeCode(workflowFile, nodeName) {
  const key = workflowFile + '::' + nodeName;
  if (cache.has(key)) return cache.get(key);

  const p = path.join(WORKFLOWS, workflowFile);
  if (!fs.existsSync(p)) {
    throw new Error(`${workflowFile} not built. Run: node tools/build-workflows.js`);
  }
  const wf = JSON.parse(fs.readFileSync(p, 'utf8'));
  const node = (wf.nodes || []).find((n) => n.name === nodeName);
  if (!node) {
    const names = (wf.nodes || []).map((n) => n.name).join(', ');
    throw new Error(`${workflowFile} has no node "${nodeName}". Nodes are: ${names}`);
  }
  const src = (node.parameters || {}).jsCode;
  if (!src) throw new Error(`${workflowFile} / "${nodeName}" has no jsCode`);

  const out = { src, mode: (node.parameters || {}).mode || 'runOnceForAllItems' };
  cache.set(key, out);
  return out;
}

// Builds a callable version of a Code node. The n8n globals it uses become
// parameter names, and the caller supplies the stubs.
// `thisArg` matters: a Code node reaches the HTTP client as
// this.helpers.httpRequest, so a node that fetches anything cannot be tested
// without binding `this`. Supplying a fake helpers object there is what lets
// the prover run against saved HTML instead of the live web.
// The n8n Code node sandbox does NOT expose a working URL constructor. That
// is not a guess: merge-stage-b.js records how it parsed a host, and a live
// production run reported "regex", meaning its `new URL()` had thrown.
//
// Every test in this project used to run under plain Node, where URL exists,
// so four snippets that called `new URL()` passed every test while doing
// nothing in production - Stage C skipped every search result it ever got,
// Stage F never fetched a /contact page, and Stage B accepted booking pages
// as real websites. Tests that are more capable than production do not test
// production.
//
// So URL is shadowed with undefined for every compiled node. A test that
// needs it is testing something the real sandbox cannot do.
//
// URLSearchParams is missing from the sandbox too - found the same way, from
// a production evidence row reading "URLSearchParams is not defined" on every
// PageSpeed call ever made. It is shadowed for the same reason.
const SANDBOX_MISSING = ['URL', 'URLSearchParams'];

function compile(workflowFile, nodeName, globals) {
  const { src } = nodeCode(workflowFile, nodeName);
  const names = Object.keys(globals);
  const fn = new AsyncFunction(...names, ...SANDBOX_MISSING, src);
  return (values, thisArg) =>
    fn.call(thisArg || {}, ...names.map((n) => values[n]), ...SANDBOX_MISSING.map(() => undefined));
}

// $('Some Node') stub built from a plain map of node name -> array of items.
function nodeRef(map) {
  return (name) => {
    if (!(name in map)) {
      throw new Error(`test stub has no node "${name}" - add it to the map`);
    }
    const items = map[name].map((json) => ({ json }));
    return {
      all: () => items,
      first: () => items[0],
      last: () => items[items.length - 1],
      item: items[0],
    };
  };
}

// --- tiny assertion runner -------------------------------------------------
let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ok    ' + label);
  } else {
    failures.push(label + (detail ? ' -- ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : ''));
  }
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function done(title) {
  console.log('');
  if (failures.length) {
    console.log(`${title}: ${passed} passed, ${failures.length} FAILED`);
    process.exit(1);
  }
  console.log(`${title}: ${passed} passed`);
  process.exit(0);
}

module.exports = { nodeCode, compile, nodeRef, ok, eq, done };
