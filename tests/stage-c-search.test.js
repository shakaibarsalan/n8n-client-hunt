// Stage C: search for the business.
//
// Pins what happens when the search API stops working. On 5 Oct 2026 the
// Serper credits ran out mid-afternoon and CH-02 carried on verifying without
// a search: 252 of 314 leads came out WEBSITE_UNCERTAIN and were never
// emailed. A refused key now stops the run, leaving the batch PENDING; a
// transient failure is still only recorded.

const { compile, ok, eq, done } = require('./helpers');

const search = compile('CH-02-verify.json', 'Stage C: search for them', { $json: null, $: null });

const refs = {
  'Config': [{ serper_api_key: 'test-key', search_timeout_ms: 1000 }],
  'Load platform domains': [{ domain: 'facebook.com' }],
};
const $ = (name) => ({ first: () => ({ json: refs[name][0] }), all: () => refs[name].map((json) => ({ json })) });
const biz = { id: 1, name: 'Glow Hair Studio', city: 'Dubai', website_checks: [] };

const failingWith = (message) => ({ helpers: { httpRequest: async () => { throw new Error(message); } } });

(async () => {
  console.log('stage C: search for them\n');

  {
    let threw = '';
    try {
      await search({ $json: biz, $ }, failingWith('Request failed with status code 400'));
    } catch (e) { threw = String(e.message); }
    ok('a refused key (out of credits) stops the run instead of verifying blind', /out of credits/.test(threw), threw);
  }
  {
    let threw = '';
    try {
      await search({ $json: biz, $ }, failingWith('Request failed with status code 403'));
    } catch (e) { threw = String(e.message); }
    ok('so does a forbidden key', /refused the key/.test(threw), threw);
  }
  {
    const r = (await search({ $json: biz, $ }, failingWith('Request failed with status code 429'))).json;
    eq('a rate limit is transient - recorded, not fatal', r.stage_c_ran, false);
    ok('  and leaves an evidence row', r.website_checks.some((c) => c.stage === 'search' && c.outcome === 'unreachable'));
  }
  {
    const r = (await search({ $json: biz, $ }, failingWith('timeout of 10000ms exceeded'))).json;
    eq('a timeout is transient too', r.stage_c_ran, false);
  }

  // --- a search done by hand stands in for the API -------------------------
  {
    let called = false;
    const spy = { helpers: { httpRequest: async () => { called = true; throw new Error('Request failed with status code 400'); } } };
    const r = (await search({ $json: { ...biz, hand_search: { candidate: 'www.glowhair.ae', results: 8, why: 'their own site', by: 'claude.websearch' } }, $ }, spy)).json;
    eq('a hand search counts as a search that ran', r.stage_c_ran, true);
    eq('  its candidate goes to Stage D to be proved', r.search_candidate_domain, 'glowhair.ae');
    eq('  and the refused API key is never touched', called, false);
    ok('  recorded as evidence, by whom', r.website_checks.some((c) => c.stage === 'search' && c.method === 'claude.websearch' && c.outcome === 'found'));
  }
  {
    const r = (await search({ $json: { ...biz, hand_search: { candidate: '', results: 5, why: 'only directories' } }, $ }, failingWith('x'))).json;
    eq('a hand search that found nothing ran and found nothing', r.stage_c_ran && r.stage_c_candidate === '', true);
  }
  {
    const r = (await search({ $json: { ...biz, hand_search: { candidate: 'facebook.com', results: 3 } }, $ }, failingWith('x'))).json;
    eq('a social page given as the candidate is not their site', r.stage_c_candidate, '');
  }

  done('stage C: search for them');
})();
