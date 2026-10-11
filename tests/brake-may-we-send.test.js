// CH-05's brake. Since 3 Oct 2026 CH-05 runs on a schedule and sends on its
// own, so this node is the only thing between the approved queue and a
// stranger's inbox.

const { compile, ok, eq, done } = require('./helpers');

const brake = compile(
  'CH-05-send-approved.json', 'BRAKES: may we send this one?',
  { $: null });

const CFG = {
  max_per_day: 15, min_gap_minutes: 5, max_bounces: 3,
  business_hours_json: JSON.stringify({ no: [9, 18], ae: [9, 19] }),
};

const STATS = { sent_today: 0, sent_total: 10, bounced_total: 0, last_sent_at: null };
const CANDIDATE = {
  id: 501, business_id: 1, to_email: 'x@salongeksempel.test', subject: 'Hi', body: 'body',
  sequence_step: 1, business_name: 'Salong Eksempel', country_code: 'no',
  is_natural_person: false, permanently_closed: false, now_suppressed: false,
};

const $ = (stats, candidate, cfg) => (name) => ({
  first: () => ({
    json: name === 'How is the sender doing?' ? stats
         : name === 'Next approved message' ? candidate
         : cfg,
  }),
});

// This node runs "Run Once for All Items" and returns an array (n8n's shape
// for that mode), not a single {json} object - unlike the per-item nodes
// tested elsewhere in this suite.
const run = async (stats, candidate, cfg) =>
  (await brake({ $: $(stats, candidate, cfg) }))[0].json;

// A fixed, known-safe hour: 12:00 UTC is inside both Norway's and the UAE's
// 09:00-19:00 windows at the offsets the brake uses (+1, +4), so tests below
// that are not specifically ABOUT the hours check are not flaky depending on
// when they happen to run.
const REAL_NOW = Date;
function withClock(hourUtc, fn) {
  const fixed = new REAL_NOW(Date.UTC(2026, 8, 15, hourUtc, 0, 0));
  global.Date = class extends REAL_NOW {
    constructor(...a) { return a.length ? new REAL_NOW(...a) : fixed; }
    static now() { return fixed.getTime(); }
  };
  return fn().finally(() => { global.Date = REAL_NOW; });
}

(async () => {
  console.log('CH-05 send brake\n');

  // --- the happy path --------------------------------------------------
  await withClock(12, async () => {
    const r = await run(STATS, CANDIDATE, CFG);
    eq('a clean candidate at a safe hour clears', r.send, true);
    eq('the candidate fields are carried through for the send step',
      r.to_email, CANDIDATE.to_email);
  });

  // --- bounce circuit breaker: first, because it is the one that ends ----
  // --- a sending reputation ------------------------------------------------
  await withClock(12, async () => {
    const r = await run({ ...STATS, bounced_total: 3 }, CANDIDATE, CFG);
    eq('3+ bounces stops everything', r.send, false);
    eq('and it is an alert, not a quiet skip', r.alert, true);
    ok('names the count', /3 bounces/.test(r.reason), r.reason);
  });

  // --- daily cap -------------------------------------------------------
  await withClock(12, async () => {
    const r = await run({ ...STATS, sent_today: 15 }, CANDIDATE, CFG);
    eq('cap reached, quiet stop', r.send, false);
    eq('not an alert - this is normal, expected behaviour', r.alert, false);
  });

  // --- nothing approved --------------------------------------------------
  await withClock(12, async () => {
    const r = await run(STATS, {}, CFG);
    eq('no candidate id -> nothing to send', r.send, false);
    eq('quiet', r.alert, false);
  });

  // --- preconditions restated at send time, not just trusted from draft --
  await withClock(12, async () => {
    const r = await run(STATS, { ...CANDIDATE, now_suppressed: true }, CFG);
    eq('suppressed since approval -> refused', r.send, false);
    eq('and flagged - a human approved something that should not send now',
      r.alert, true);
  });
  await withClock(12, async () => {
    const r = await run(STATS, { ...CANDIDATE, permanently_closed: true }, CFG);
    eq('closed since approval -> refused', r.send, false);
  });
  await withClock(12, async () => {
    const r = await run(STATS, { ...CANDIDATE, is_natural_person: true }, CFG);
    eq('a natural-person row that got approved anyway is still refused ' +
       '- this is the second, independent line of defence', r.send, false);
    eq('and it is an alert - this means the draft guard was bypassed', r.alert, true);
  });

  // --- minimum gap -----------------------------------------------------
  await withClock(12, async () => {
    const stats = { ...STATS, last_sent_at: new Date().toISOString() };
    const r = await run(stats, CANDIDATE, CFG);
    eq('a send one second ago is too soon', r.send, false);
    eq('not an alert - just wait', r.alert, false);
  });
  await withClock(12, async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    const r = await run({ ...STATS, last_sent_at: tenMinAgo }, CANDIDATE, CFG);
    eq('a send 10 minutes ago clears a 5-minute gap', r.send, true);
  });

  // --- business hours, in the RECIPIENT's country -------------------------
  await withClock(3, async () => {   // 03:00 UTC = 04:00 in Norway
    const r = await run(STATS, CANDIDATE, CFG);
    eq('outside Norway\'s 09-18 window is refused', r.send, false);
    eq('quiet - this resolves itself in a few hours', r.alert, false);
  });
  await withClock(3, async () => {   // 03:00 UTC = 07:00 in the UAE - still outside 09-19
    const r = await run(STATS, { ...CANDIDATE, country_code: 'ae' }, CFG);
    eq('outside the UAE\'s window too, at the same UTC hour', r.send, false);
  });
  await withClock(11, async () => {  // 11:00 UTC = 15:00 in the UAE - inside 09-19
    const r = await run(STATS, { ...CANDIDATE, country_code: 'ae' }, CFG);
    eq('inside the UAE\'s window clears', r.send, true);
  });
  await withClock(12, async () => {
    const r = await run(STATS, { ...CANDIDATE, country_code: 'zz' }, CFG);
    eq('a country with no configured window is not blocked by one',
      r.send, true);
  });

  // --- one blocked message must not hold up the rest -----------------------
  //
  // The real morning: the top-scoring approved row was Oslo (not yet open),
  // and five Dubai rows sat behind it unsent while Dubai's office was open.
  {
    const OSLO = { ...CANDIDATE, id: 1, business_name: 'Testvik House', country_code: 'no' };
    const DXB = { ...CANDIDATE, id: 2, business_name: 'Sample Dental Clinic', country_code: 'AE', to_email: 'dental@sample.test' };
    const many = (rows) => (name) => name === 'Next approved message'
      ? { all: () => rows.map((json) => ({ json })), first: () => ({ json: rows[0] }) }
      : { first: () => ({ json: name === 'How is the sender doing?' ? STATS : CFG }) };
    await withClock(7, async () => {          // 08:00 in Oslo by the brake's offset, 11:00 in Dubai
      const r = (await brake({ $: many([OSLO, DXB]) }))[0].json;
      eq('the Dubai message goes while the Oslo one waits for its office hours', r.id, 2);
      eq('  and it is a send', r.send, true);
    });
    await withClock(2, async () => {          // 03:00 Oslo, 06:00 Dubai - neither open
      const r = (await brake({ $: many([OSLO, DXB]) }))[0].json;
      eq('nothing goes when no recipient is in office hours', r.send, false);
      eq('  and that is routine, not an alarm', r.alert, false);
    });
    await withClock(11, async () => {
      const bad = { ...DXB, id: 3, now_suppressed: true };
      const r = (await brake({ $: many([bad, OSLO]) }))[0].json;
      eq('a suppressed row is skipped, not sent, and the next one goes', r.id, 1);
    });
  }

  // --- warm-up: the cap grows from the day of the first send ---------------
  const WARM = { ...CFG, max_per_day: 100, warmup_start: 20, warmup_step: 10 };
  await withClock(12, async () => {
    const first = new REAL_NOW(Date.UTC(2026, 8, 15, 6)).toISOString();     // same day
    eq('day one: 19 sent, the 20th may go', (await run({ ...STATS, sent_today: 19, first_sent_at: first }, CANDIDATE, WARM)).send, true);
    const r = await run({ ...STATS, sent_today: 20, first_sent_at: first }, CANDIDATE, WARM);
    eq('day one: the 21st waits', r.send, false);
    ok('  and says it is warming up', /warming up towards 100/.test(r.reason), r.reason);
  });
  await withClock(12, async () => {
    const first = new REAL_NOW(Date.UTC(2026, 8, 12, 6)).toISOString();     // 3 days earlier
    eq('day four allows 50', (await run({ ...STATS, sent_today: 49, first_sent_at: first }, CANDIDATE, WARM)).send, true);
    eq('but not 51', (await run({ ...STATS, sent_today: 50, first_sent_at: first }, CANDIDATE, WARM)).send, false);
  });
  await withClock(12, async () => {
    const first = new REAL_NOW(Date.UTC(2026, 7, 1, 6)).toISOString();      // weeks earlier
    eq('once warm, max_per_day is the cap', (await run({ ...STATS, sent_today: 99, first_sent_at: first }, CANDIDATE, WARM)).send, true);
  });

  // --- a standing alarm speaks once an hour, not every run -----------------
  //
  // A tripped bounce brake messaged Telegram every 5 minutes - about fifty
  // messages in one morning.
  {
    const tripped = { ...STATS, bounced_7d: 6, sent_7d: 30 };
    const atMinute = (m, fn) => {
      const fixed = new REAL_NOW(Date.UTC(2026, 8, 15, 12, m, 0));
      global.Date = class extends REAL_NOW {
        constructor(...a) { return a.length ? new REAL_NOW(...a) : fixed; }
        static now() { return fixed.getTime(); }
      };
      return fn().finally(() => { global.Date = REAL_NOW; });
    };
    await atMinute(1, async () => {
      const r = await run(tripped, CANDIDATE, CFG);
      eq('the first run after the hour raises the alarm', r.alert, true);
    });
    await atMinute(35, async () => {
      const r = await run(tripped, CANDIDATE, CFG);
      eq('the same alarm mid-hour stays quiet', r.alert, false);
      eq('  while still refusing to send', r.send, false);
    });
  }

  // --- a tripped bounce brake speaks once, right after the bounce ----------
  //
  // It stays tripped for days; hourly, that was 24 messages a day.
  {
    const ago = (min) => new REAL_NOW(REAL_NOW.now() - min * 60000).toISOString();
    const fresh = await run({ ...STATS, bounced_7d: 5, sent_7d: 34, last_bounced_at: ago(2) }, CANDIDATE, CFG);
    eq('the run right after the tripping bounce raises the alarm', fresh.alert, true);
    eq('  and does not send', fresh.send, false);
    const old = await run({ ...STATS, bounced_7d: 5, sent_7d: 34, last_bounced_at: ago(180) }, CANDIDATE, CFG);
    eq('hours later the brake is still on, quietly', old.alert, false);
    eq('  still refusing to send', old.send, false);
  }

  // --- the bounce breaker is a 7-day rate --------------------------------
  await withClock(12, async () => {
    const r = await run({ ...STATS, bounced_total: 9, bounced_7d: 4, sent_7d: 200 }, CANDIDATE, CFG);
    eq('4 bounces in 200 sends (2%) does not stop sending', r.send, true);
  });
  await withClock(12, async () => {
    const r = await run({ ...STATS, bounced_7d: 17, sent_7d: 200 }, CANDIDATE, CFG);
    eq('17 in 200 (8.5%) stops it', r.send, false);
    eq('  and raises an alarm', r.alert, true);
  });
  await withClock(12, async () => {
    const r = await run({ ...STATS, bounced_7d: 3, sent_7d: 5 }, CANDIDATE, CFG);
    eq('at low volume the max_bounces floor still applies', r.send, false);
  });

  // --- the weekend, in the recipient's country ---------------------------
  //
  // CH-05 sends on its own now, so nothing else stops a Saturday send. These
  // use real calendar dates: 3 Oct 2026 is a Saturday, 5 Oct a Monday, 2 Oct
  // a Friday.
  const at = (iso, fn) => {
    const fixed = new REAL_NOW(iso);
    global.Date = class extends REAL_NOW {
      constructor(...a) { return a.length ? new REAL_NOW(...a) : fixed; }
      static now() { return fixed.getTime(); }
    };
    return fn().finally(() => { global.Date = REAL_NOW; });
  };
  const DUBAI = { ...CANDIDATE, country_code: 'AE' };
  await at('2026-10-03T08:00:00Z', async () => {      // Saturday, 12:00 in Dubai
    const r = await run(STATS, DUBAI, CFG);
    eq('a Saturday in the UAE holds the send, even inside office hours', r.send, false);
    ok('and says it is the weekend', /Weekend/.test(r.reason), r.reason);
    eq('holding for the weekend is routine, not an alarm', r.alert, false);
  });
  await at('2026-10-04T08:00:00Z', async () => {      // Sunday
    eq('a Sunday in the UAE holds too', (await run(STATS, DUBAI, CFG)).send, false);
  });
  await at('2026-10-05T05:30:00Z', async () => {      // Monday, 09:30 in Dubai
    eq('Monday morning in Dubai clears', (await run(STATS, DUBAI, CFG)).send, true);
  });
  await at('2026-10-02T08:00:00Z', async () => {      // Friday, 12:00 in Dubai
    eq('Friday is a working day in the UAE since 2022', (await run(STATS, DUBAI, CFG)).send, true);
  });
  await at('2026-10-02T08:00:00Z', async () => {      // Friday, 11:00 in Doha
    const r = await run(STATS, { ...CANDIDATE, country_code: 'qa' },
      { ...CFG, business_hours_json: JSON.stringify({ qa: [9, 19] }) });
    eq('but Friday is the weekend in Qatar', r.send, false);
  });
  await at('2026-10-03T11:00:00Z', async () => {      // Saturday, 12:00 in Oslo
    eq('a Saturday in Norway holds', (await run(STATS, CANDIDATE, CFG)).send, false);
  });

  done('CH-05 send brake');
})();
