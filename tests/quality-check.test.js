// Stage E: is the site any good?
//
// Pins the bug that made every one of the first 30 WEAK_WEBSITE leads weak
// for the same reason: "no HTTPS", read off an http:// address an open
// dataset happened to store. Their drafts told working, secure sites they
// "could be working harder". HTTPS is only known when the site was actually
// fetched over HTTPS.

const { compile, ok, eq, done } = require('./helpers');

const quality = compile('CH-02-verify.json', 'Stage E: is the site any good?', { $json: null, $: null });
const classify = compile('CH-02-verify.json', 'Classify and score confidence', { $json: null });

const CONFIG = { pagespeed_api_key: '', psi_timeout_ms: 1000 };
// PageSpeed unreachable, as it is in production without a key (HTTP 429).
const THIS = { helpers: { httpRequest: async () => { throw new Error('Request failed with status code 429'); } } };

const run = async (b) => (await quality({ $json: b, $: () => ({ first: () => ({ json: CONFIG }) }) }, THIS)).json;

(async () => {
  console.log('stage E: is the site any good?\n');

  {
    const r = await run({ stage_b_website: 'http://www.testvikhouse.test/', probe_result: 'skipped', stage_b_unverified: true });
    eq('an http:// address we merely hold says nothing about HTTPS', r.psi.https, null);
    const c = (await classify({ $json: { ...r, stage_b_checked: true, stage_b_matched: true } })).json;
    eq('so the site is not called weak for it', c.website_status, 'HAS_WEBSITE');
    ok('and the evidence does not claim "no HTTPS"', !/no HTTPS/.test(c.website_evidence), c.website_evidence);
  }
  {
    const r = await run({ stage_b_website: 'http://www.testvikhouse.test/', probe_result: 'found', probe_domain: 'testvikhouse.test' });
    eq('a site Stage D fetched over HTTPS has HTTPS', r.psi.https, true);
  }
  {
    const r = await run({ stage_a_url: 'https://salongeksempel.test', probe_result: 'skipped' });
    eq('an https:// address the listing gives has HTTPS', r.psi.https, true);
  }
  {
    const r = await run({ probe_result: 'not_found' });
    eq('no site at all, nothing to measure', r.psi, null);
  }
  {
    const r = await run({ stage_a_url: 'https://salongeksempel.test', probe_result: 'skipped' });
    eq('an unreachable PageSpeed is recorded as unmeasured, not as a score', r.psi.measured, false);
  }

  // --- PageSpeed actually runs ------------------------------------------
  //
  // Every production call used to throw "URLSearchParams is not defined"
  // before reaching the network, so no site was ever measured. The harness
  // now hides URLSearchParams the way the sandbox does, which makes this
  // case fail against the old code.
  {
    let asked = '';
    const PSI_OK = { helpers: { httpRequest: async ({ url }) => {
      asked = url;
      return { lighthouseResult: {
        finalUrl: 'https://salongeksempel.test/',
        categories: { performance: { score: 0.31 } },
        audits: { viewport: { score: 0 } },
      } };
    } } };
    const cfg = { ...CONFIG, pagespeed_api_key: 'test-key' };
    const r = (await quality({ $json: { probe_result: 'found', probe_domain: 'salongeksempel.test' },
      $: () => ({ first: () => ({ json: cfg }) }) }, PSI_OK)).json;
    eq('a working PageSpeed answer is measured', r.psi.measured, true);
    eq('with its score', r.psi.performance, 31);
    eq('and the viewport audit', r.psi.mobile_friendly, false);
    ok('the site is passed URL-encoded', asked.includes('url=https%3A%2F%2Fsalongeksempel.test'), asked);
    ok('on the mobile strategy', asked.includes('strategy=mobile'), asked);
    ok('with the key when one is configured', asked.includes('key=test-key'), asked);

    const c = (await classify({ $json: { ...r, stage_b_checked: true, stage_b_matched: true } })).json;
    eq('a slow, non-mobile site is a WEAK_WEBSITE lead', c.website_status, 'WEAK_WEBSITE');
    ok('for the measured reasons, not for HTTPS',
      /mobile performance 31/.test(c.website_evidence) && !/no HTTPS/.test(c.website_evidence), c.website_evidence);
  }

  done('stage E: is the site any good?');
})();
