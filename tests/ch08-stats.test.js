// CH-08: /stats on Telegram. Only the owner is answered, and the answer
// tells the truth about the cap and the brake.

const { compile, ok, eq, done } = require('./helpers');

const owner = compile('CH-08-telegram-stats.json', 'From the owner?', { $: null });
const write = compile('CH-08-telegram-stats.json', 'Write the answer', { $: null });

const CFG = { owner_chat_id: '555', max_per_day: 30, warmup_start: 20, warmup_step: 10, max_bounces: 8 };
const ask = async (chatId, text) => owner({ $: (name) => ({ first: () => ({ json:
  name === 'Config' ? CFG : { message: { chat: { id: chatId }, text } } }) }) });

const NUMBERS = {
  sent_today: 29, followups_today: 2, sent_total: 51, replies_total: 1, replies_today: 1,
  bounced_total: 5, bounced_7d: 5, sent_7d: 51, queued: 220, held: 315, dead_mailboxes_caught: 1,
  last_sent_at: '2026-10-06T12:10:00Z', first_sent_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  leads_total: 2400, pending: 80, today_by_city: [{ city: 'Dubai', n: 20 }, { city: 'Abu Dhabi', n: 9 }],
  recent_replies: [{ name: 'Sample Fish', city: 'Dubai', reply_at: '2026-10-06T12:20:00Z', excerpt: 'Yes please send it' }],
};
const answer = async (numbers, command = 'stats') => (await write({ $: (name) => ({ first: () => ({ json:
  name === 'Config' ? CFG : name === 'From the owner?' ? { command } : numbers }) }) }))[0].json.message;

(async () => {
  console.log('CH-08: /stats on Telegram\n');

  eq('a stranger gets nothing at all', (await ask(999, '/stats')).length, 0);
  eq('the owner asking /stats gets stats', (await ask(555, '/stats'))[0].json.command, 'stats');
  eq('  as does /start', (await ask(555, '/start'))[0].json.command, 'stats');
  eq('  and /stats@botname', (await ask(555, '/stats@ClientHuntBot'))[0].json.command, 'stats');
  eq('anything else from the owner gets the help line', (await ask(555, 'hello'))[0].json.command, 'help');

  {
    const m = await answer(NUMBERS);
    ok('shows sent today against the cap', /Sent today: 29 of 30 \(2 follow-ups\) - Dubai 20, Abu Dhabi 9/.test(m), m);
    ok('shows replies', /Replies: 1 today, 1 in total/.test(m), m);
    ok('shows the latest reply', /Sample Fish \(Dubai\), 6 Oct 17:20: Yes please send it/.test(m), m);
    ok('times are in Pakistan time', /Last sent: 6 Oct 17:10/.test(m), m);
    ok('no brake warning when it is off', !/STOPPED/.test(m), m);
  }
  {
    const m = await answer({ ...NUMBERS, first_sent_at: new Date().toISOString() });
    ok('on the first day the cap is the warm-up start', /of 20/.test(m), m);
  }
  {
    const m = await answer({ ...NUMBERS, bounced_7d: 8 });
    ok('a tripped brake leads the message', /^Client Hunt[^\n]*\n\nSENDING STOPPED/.test(m), m);
  }
  ok('the help line names the command', /\/stats/.test(await answer(NUMBERS, 'help')));

  // --- /concept ----------------------------------------------------------
  {
    const c = (await ask(555, '/concept 1234'))[0].json;
    eq('/concept 1234 asks for a concept', c.command, 'concept');
    eq('  for that id', c.arg, '1234');
    eq('/concept by name keeps the name', (await ask(555, '/concept Sample Fish'))[0].json.arg, 'Sample Fish');
    eq('a stranger asking for a concept gets nothing', (await ask(999, '/concept 1234')).length, 0);
  }
  {
    const build = compile('CH-08-telegram-stats.json', 'Build the concept', { $: null });
    const make = async (biz, arg = '1234') => (await build({ $: (name) => ({ first: () => ({ json:
      name === 'Find the business' ? biz : { command: 'concept', arg } }) }) }))[0];
    const r = await make({ id: 1234, name: 'Sample Fish - Example Street', category_primary: 'seafood_restaurant', city: 'Dubai',
      country_code: 'AE', address: 'Example Street 1, Dubai', phone_e164: '+971500000001', email: 'samplefish@example.com',
      social_profiles: { facebook: 'https://facebook.com/samplefish.example' } });
    eq('a found business becomes a file', r.json.kind, 'file');
    const html = Buffer.from(r.binary.data.data, 'base64').toString('utf8');
    ok('  named after the business, without the street suffix', /<h1>Sample Fish<\/h1>/.test(html));
    ok('  with their WhatsApp', /wa\.me\/971500000001/.test(html));
    ok('  laid out as a restaurant', /Our menu/.test(html));
    ok('  sample content is marked as sample', /Sample content/.test(html));
    ok('  file name is safe', /^sample-fish-concept\.html$/.test(r.binary.data.fileName), r.binary.data.fileName);
    const land = Buffer.from((await make({ id: 7, name: 'Sample Cafe', category_primary: 'cafe', country_code: 'AE',
      phone_e164: '+97140000001' })).binary.data.data, 'base64').toString('utf8');
    ok('a Dubai landline gets a call button, never a dead WhatsApp one', !/wa\.me/.test(land) && /tel:\+97140000001/.test(land));
    const atia = Buffer.from((await make({ id: 120, name: 'Lumi signature beauty salon.', category_primary: 'Beauty salon',
      city: 'Dubai', country_code: 'AE', phone_e164: '+971500000002',
      address: 'Q01...shop - s01...parking side - Example Block - Sample Cluster - Dubai - United Arab Emirates' })).binary.data.data, 'base64').toString('utf8');
    ok('a lower-case listing name reads as a name, without the trailing dot', /<h1>Lumi Signature Beauty Salon<\/h1>/.test(atia));
    ok('  laid out as a salon', /Services/.test(atia) && /Book on WhatsApp/.test(atia));
    ok('  address noise cleaned', /Q01 shop - s01 parking side - Example Block - Sample Cluster - Dubai</.test(atia));
    const none = await make({}, 'Nobody');
    eq('nothing found: a text, not a file', none.json.kind, 'text');
    ok('  saying what to send instead', /\/concept 1234/.test(none.json.message), none.json.message);
    const html2 = Buffer.from((await make({ id: 5, name: '<script>x</script> Spa', category_primary: 'spa' })).binary.data.data, 'base64').toString('utf8');
    ok('a name is escaped, never run as HTML', !/<script>x/.test(html2));
  }

  done('CH-08: /stats on Telegram');
})();
