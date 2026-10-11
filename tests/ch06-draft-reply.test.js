// CH-06: the suggested answer that rides along with a reply alert. Fixed
// answers picked by rules - pins that each kind of reply gets the right one,
// and that a "no" is never answered with a pitch.

const { compile, ok, eq, done } = require('./helpers');

const suggest = compile('CH-06-track-replies.json', 'Suggest an answer', { $input: null });

const ROW = {
  outreach_id: 9, business_id: 1234, business_name: 'Sample Fish', city: 'Dubai', to_email: 'samplefish@example.com',
  category_primary: 'seafood_restaurant', niche: 'Small Businesses', pitch: 'default', later_steps_stopped: 1,
};
const run = async (reply, extra) => (await suggest({ $input: { all: () => [{ json: { ...ROW, ...extra, reply_excerpt: reply } }] } }))[0].json;

(async () => {
  console.log('CH-06: suggest an answer\n');

  {
    const r = await run('Yes please send it');
    eq('a yes is read as interested', r.intent, 'yes');
    ok('  the draft promises the concept', /website concept for Sample Fish/.test(r.message), r.message);
    ok('  asks what a restaurant would want shown', /your menu/.test(r.message), r.message);
    ok('  signed as the outreach is', /Alex\nExample Web Studio/.test(r.message), r.message);
    ok('  and offers /concept with their id', /\/concept 1234/.test(r.message), r.message);
    ok('  the alert still says the follow-up was cancelled', /follow-up cancelled/.test(r.message), r.message);
  }
  eq('"no problem, send it" is a yes, not a no', (await run('No problem, send it over')).intent, 'yes');
  eq('a price question', (await run('How much does it cost?')).intent, 'price');
  ok('  leaves the price for the owner to fill', /\[your starting price\]/.test((await run('price?')).message));
  {
    const r = await run('No thanks');
    eq('a plain no', r.intent, 'no');
    ok('  is never answered with a pitch or a concept', !/concept/.test(r.message), r.message);
  }
  eq('"not interested" in a longer reply is a no', (await run('Sorry we are not interested at the moment')).intent, 'no');
  eq('"we already have a website"', (await run('We already have a website: samplefish.test')).intent, 'has_site');
  eq('anything else is a question to answer', (await run('Who are you and where are you based?')).intent, 'question');
  eq('Arabic yes', (await run('نعم ارسل')).intent, 'yes');
  ok('a salon is asked about services and prices',
    /services and prices/.test((await run('ok', { business_name: 'Glow Salon', category_primary: 'beauty_salon' })).message));
  ok('a weak-website pitch offers the improvement list, not a concept',
    /short list of what I would improve/.test((await run('yes', { pitch: 'weak_website' })).message));

  done('CH-06: suggest an answer');
})();
