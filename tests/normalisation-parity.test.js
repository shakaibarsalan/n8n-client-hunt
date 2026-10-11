// The Python loader and the n8n node must normalise names IDENTICALLY.
//
// Stage B matches a business from Google Maps against a business from Overture
// by `name_norm`. Google's copy is normalised by JavaScript inside n8n; the
// Overture copy is normalised by Python at load time. If those two ever
// disagree, Stage B stops matching.
//
// What makes this worth a dedicated test is that the failure is SILENT. There
// is no error. Every business simply looks like "not present in the open
// datasets", the classifier correctly declines to give Stage B credit,
// confidence caps below 0.85, and every lead in the database quietly
// downgrades from CONFIRMED to LIKELY. It would look exactly like a region
// with thin open data - which is a thing that genuinely happens, so it would
// be believed.
//
// Skipped, not failed, when Python is unavailable: a test that cannot run is
// not evidence of a fault.

const { execFileSync } = require('child_process');
const path = require('path');
const { compile, ok, done } = require('./helpers');

const root = path.join(__dirname, '..');

const NAMES = [
  'Frisor Eksempel AS',
  'Frisør Eksempel',
  'Peluquería Sol S.L.',
  'Inmobiliaria Costa S.A.',
  'Al Noor Salon LLC',
  'Hair & Beauty Studio',
  'Hair and Beauty Studio',
  'Salong Eksempel',
  'Estetica Bellìzza S.r.l.',
  'Cabeleireiro Rosário Lda',
  'Månes Skjønnhet',
  'The Beauty Group International Ltd',
  "O'Brien Realty Inc",
  'A/S Kronborg Ejendomme',
  '24/7 Hair 2 Go',
  'Cœur de Beauté',
];

let python = null;
for (const cmd of ['python', 'python3']) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    python = cmd;
    break;
  } catch (e) { /* try the next one */ }
}

(async () => {
  console.log('normalisation parity: JavaScript vs Python\n');

  if (!python) {
    console.log('  SKIP  no python on PATH - parity not checked this run');
    console.log('\nnormalisation parity: skipped');
    process.exit(0);
  }

  // --- the Python side -----------------------------------------------------
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("m", r"${path.join(root, 'tools', 'load_reference_data.py').replace(/\\/g, '\\\\')}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'names = json.loads(sys.stdin.read())',
    'print(json.dumps([m.name_norm(n) for n in names]))',
  ].join('\n');

  // The payload is JSON-escaped to pure ASCII, and Python is forced into UTF-8
  // mode. Without BOTH, this harness is the thing that fails rather than the
  // code: Node writes UTF-8 down the pipe, Python on Windows reads stdin as
  // cp1252, and every accented name arrives mangled. The first run of this
  // test reported six mismatches that did not exist - a harness reproducing
  // the very bug it was built to detect.
  const asciiJson = JSON.stringify(NAMES).replace(
    /[^\x00-\x7F]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

  let fromPython;
  try {
    const raw = execFileSync(python, ['-X', 'utf8', '-c', script], {
      input: asciiJson,
      encoding: 'utf8',
    });
    fromPython = JSON.parse(raw);
  } catch (e) {
    console.log('  SKIP  could not run the Python loader: ' + String(e.message).split('\n')[0]);
    console.log('\nnormalisation parity: skipped');
    process.exit(0);
  }

  // --- the JavaScript side, read out of the built workflow -----------------
  const normalise = compile('CH-01-discover.json', 'Normalise the business', {
    $input: null, $: null,
  });
  const target = { id: 1, niche: 'x', niche_query: 'x', country: 'Norway', city: 'Oslo' };
  const rows = NAMES.map((title, i) => ({
    placeId: 'p' + i, title, location: { lat: 59.9139, lng: 10.7522 },
  }));
  const out = await normalise({
    $input: { all: () => rows.map((json) => ({ json })) },
    $: (name) => ({ first: () => ({ json: name === 'Config' ? {} : target }) }),
  });
  const fromJs = out.map((o) => o.json.name_norm);

  // --- compare -------------------------------------------------------------
  let mismatches = 0;
  for (let i = 0; i < NAMES.length; i++) {
    const same = fromJs[i] === fromPython[i];
    if (!same) mismatches++;
    ok(`${JSON.stringify(NAMES[i])} -> ${JSON.stringify(fromJs[i])}`,
      same, `python said ${JSON.stringify(fromPython[i])}`);
  }

  ok('every name normalises identically in both languages', mismatches === 0,
    `${mismatches} of ${NAMES.length} differ`);

  done('normalisation parity');
})();
