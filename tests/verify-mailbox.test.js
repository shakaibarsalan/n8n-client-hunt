// CH-05: "Is the mailbox real?" - the Reoon check before a first message.
//
// Five of the first 34 sends bounced, all directory addresses nobody had
// checked. Pins that only a confirmed mailbox is sent, that a failed check
// never lets an unchecked address through, and that a standing failure
// (credits used up) does not message Telegram every run.

const { compile, ok, eq, done } = require('./helpers');

const check = compile('CH-05-send-approved.json', 'Is the mailbox real?',
  { $input: null, $: null, $getWorkflowStaticData: null });

const CANDIDATE = { id: 7, to_email: 'glowsalon@example.com', sequence_step: 1, email_source: 'listing', send: true };

const run = async ({ candidate = CANDIDATE, answer, error, key = 'k', memory = {} } = {}) => {
  const calls = [];
  const helpers = { httpRequest: async (o) => { calls.push(o); if (error) throw new Error(error); return answer; } };
  const $ = () => ({ first: () => ({ json: { reoon_api_key: key } }) });
  const r = await check({ $input: { first: () => ({ json: candidate }) }, $, $getWorkflowStaticData: () => memory },
    { helpers });
  return { ...r[0].json, calls };
};

(async () => {
  console.log('CH-05: is the mailbox real?\n');

  {
    const r = await run({ answer: { status: 'safe', is_deliverable: true } });
    eq('a mailbox that exists is sent', r.verdict, 'send');
    ok('  asked in power mode, address encoded', /mode=power/.test(r.calls[0].url) && /glowsalon%40example\.com/.test(r.calls[0].url));
  }
  {
    const r = await run({ answer: { status: 'invalid' } });
    eq('a mailbox that does not exist is dropped', r.verdict, 'drop');
    eq('  and not sent', r.send, false);
  }
  for (const status of ['disabled', 'spamtrap', 'disposable']) {
    eq(`${status} is dropped`, (await run({ answer: { status } })).verdict, 'drop');
  }
  eq('unknown is held, not sent', (await run({ answer: { status: 'unknown' } })).verdict, 'hold');
  eq('a full inbox is held', (await run({ answer: { status: 'inbox_full' } })).verdict, 'hold');
  {
    const role = { status: 'role_account', is_deliverable: true };
    eq('info@ that accepts mail is sent', (await run({ answer: role })).verdict, 'send');
    eq('info@ that will not confirm is held', (await run({ answer: { ...role, is_deliverable: false } })).verdict, 'hold');
  }
  {
    const answer = { status: 'catch_all' };
    eq('a catch-all domain on a directory address is held', (await run({ answer })).verdict, 'hold');
    eq('a catch-all domain on an address from their own site is sent',
      (await run({ answer, candidate: { ...CANDIDATE, email_source: null } })).verdict, 'send');
  }
  {
    const r = await run({ candidate: { ...CANDIDATE, sequence_step: 2 }, answer: { status: 'invalid' } });
    eq('a follow-up is not re-checked - the first message was delivered', r.verdict, 'send');
    eq('  and spends no credit', r.calls.length, 0);
  }

  // --- the check failing never sends ------------------------------------
  {
    const memory = {};
    const r = await run({ error: 'Request failed with status code 402', memory });
    eq('a refused key / no credits sends nothing', r.verdict, 'error');
    eq('  says so', r.alert, true);
    const again = await run({ error: 'Request failed with status code 402', memory });
    eq('  but only once in six hours, not every run', again.alert, false);
  }
  {
    const r = await run({ error: 'timeout of 120000ms exceeded' });
    eq('a timeout sends nothing either', r.verdict, 'error');
  }
  {
    const r = await run({ key: '__ENV:REOON_API_KEY__' });
    eq('no key configured: nothing goes out unchecked', r.verdict, 'error');
    eq('  without spending a call', r.calls.length, 0);
  }
  eq('an answer we do not understand is a failure, not a pass',
    (await run({ answer: { status: 'error', reason: 'Invalid API key' } })).verdict, 'error');

  done('CH-05: is the mailbox real?');
})();
