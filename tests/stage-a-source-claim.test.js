// Stage A had no direct test coverage at all before this - the classifier
// logic downstream is tested in website-classification.test.js, but nothing
// exercised this node's own input handling. That gap is exactly how the
// alwaysOutputData bug below went unnoticed: every test in this project fed
// real rows in, never n8n's own "nothing pending" shape.

const { compile, eq, done } = require('./helpers');

const stageA = compile(
  'CH-02-verify.json', 'Stage A: what did the source actually claim?', { $input: null, $: null });

const PLATFORMS = [
  { domain: 'facebook.com', kind: 'social', counts_as_social: true, active: true },
  { domain: 'wixsite.com', kind: 'builder_subdomain', counts_as_social: false, active: true },
];
const $ = (n) => ({ all: () => (n === 'Load platform domains' ? PLATFORMS : []).map((json) => ({ json })) });

const run = async (rows) =>
  stageA({ $input: { all: () => rows.map((json) => ({ json })) }, $ });

(async () => {
  console.log('Stage A: what did the source actually claim?\n');

  // --- a real business is classified normally ------------------------------
  {
    const [r] = await run([{ id: 1, source_website_raw: '' }]);
    eq('an empty website field is a genuine absence', r.json.stage_a_claim, 'absent');
  }
  {
    const [r] = await run([{ id: 2, source_website_raw: 'https://facebook.com/mysalon' }]);
    eq('a platform domain is not a real website', r.json.stage_a_claim, 'platform');
    eq('and it counts as a social signal', r.json.stage_a_social_only, true);
  }
  {
    const [r] = await run([{ id: 3, source_website_raw: 'https://mysalon.test' }]);
    eq('an unrecognised domain is a real claim', r.json.stage_a_claim, 'real');
  }

  // --- the real bug: alwaysOutputData sends one blank item, not zero -------
  // "Pick what needs checking" has alwaysOutputData set, so a zero-row query
  // arrives here as ONE blank {} item, not an empty array. Found running for
  // real: that blank item was processed as a business (id: undefined) and
  // pushed all the way through Stages B-F before crashing "Write the verdict
  // and the evidence" on a NOT NULL violation, on every 30-minute tick once
  // the verification backlog was actually empty.
  {
    const out = await run([{}]);
    eq('a blank alwaysOutputData placeholder produces no output at all', out.length, 0);
  }
  {
    const out = await run([{ id: null, source_website_raw: 'https://should-be-unreachable.test' }]);
    eq('an id-less row is the same case, whatever shape the blank arrives in', out.length, 0);
  }
  {
    // A real row alongside a blank one - only the real one should survive.
    const out = await run([{}, { id: 5, source_website_raw: '' }]);
    eq('a blank item does not swallow real rows in the same batch', out.length, 1);
    eq('and the real row is the one that comes through', out[0].json.id, 5);
  }

  done('Stage A: what did the source actually claim?');
})();
