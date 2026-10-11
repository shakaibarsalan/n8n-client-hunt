// CH-05, node: "BRAKES: may we send this one?"
// Mode: Run Once for All Items
//
// This workflow runs on a schedule and sends on its own: the owner asked for
// sending without a human click, once CH-04 started auto-approving only the
// drafts that pass every guard. That makes this node the ONLY thing between
// the queue and a stranger's inbox, which is why every check below is
// restated here rather than trusted from upstream, and why each run sends at
// most one message.
//
// Checks run in order of what they protect against, most serious first -
// mirroring the job-hunt project's own ordering: "Bounces - first, because it
// is the one that ends an account [reputation]."

const stats = $('How is the sender doing?').first().json;
const CFG = $('Config').first().json;

// Up to 25 approved messages, best first (select-next-approved.sql). The
// first one that may go NOW is sent. It used to be only the top one: when
// that was an Oslo lead before Oslo's office hours, every Dubai message
// queued behind it waited too - a whole morning of sends lost to one row.
const ref = $('Next approved message');
const candidates = (typeof ref.all === 'function' ? ref.all().map((i) => i.json) : [ref.first().json])
  .filter((c) => c && c.id);

// CH-05 runs every 5 minutes, and an alarm that stays true (a tripped bounce
// brake) used to message every run - about fifty Telegram messages in one
// morning, burying everything else. An alarm now speaks at most once an
// hour, in the first run after the hour.
const alarmThisRun = new Date().getUTCMinutes() < 5;
const stop = (reason, alert) => [{ json: { send: false, reason, alert: Boolean(alert) && alarmThisRun } }];

// --- 1. Bounce circuit breaker ----------------------------------------------
// A RATE over the last 7 days, not a lifetime count: at 100 sends a day a
// fixed "3 bounces ever" would stop the pipeline for good within days on
// ordinary stale addresses, while a real list or domain problem shows up as
// a rate. Never below max_bounces; 8% is where mailbox providers start
// treating a sender as a spammer. Without the 7-day fields (an older stats
// query), the lifetime count is used, as before.
const maxBounces = Number(CFG.max_bounces || 3);
const bounces = Number(stats.bounced_7d != null ? stats.bounced_7d : (stats.bounced_total || 0));
const bounceLimit = Math.max(maxBounces, Math.ceil(Number(stats.sent_7d || 0) * 0.08));
if (bounces >= bounceLimit) {
  // A tripped brake stays tripped until the oldest bounce is a week old -
  // days. Hourly, that was 24 messages a day saying the same thing. It now
  // speaks in the run right after a bounce (the one that tripped it, or a
  // later one), and the twice-daily digest repeats it. A run every 5 minutes
  // sees a new bounce within 6 minutes; one late run costs a second message,
  // never none.
  const bounceAge = stats.last_bounced_at
    ? (Date.now() - new Date(stats.last_bounced_at).getTime()) / 60000 : null;
  const speak = bounceAge == null ? alarmThisRun : bounceAge < 6;
  return [{ json: { send: false, alert: speak, reason:
    `STOPPED: ${bounces} bounces in the last 7 days (limit ${bounceLimit}). ` +
    `Something is wrong with the address list or the sending domain - check before clearing this.` } }];
}

// --- 2. Daily cap ------------------------------------------------------------
// Warm-up: a new sending domain that goes from nothing to 100 a day is
// treated as a spammer. The cap starts at warmup_start on the day of the
// first send and rises by warmup_step a day until it reaches max_per_day.
const ceiling = Number(CFG.max_per_day || 15);
let maxPerDay = ceiling;
if (stats.first_sent_at && CFG.warmup_start) {
  const days = Math.floor((Date.now() - new Date(stats.first_sent_at).getTime()) / 86400000);
  maxPerDay = Math.min(ceiling, Number(CFG.warmup_start) + Number(CFG.warmup_step || 0) * Math.max(0, days));
}
if (Number(stats.sent_today || 0) >= maxPerDay) {
  return stop(`Daily cap reached (${stats.sent_today}/${maxPerDay}` +
    (maxPerDay < ceiling ? `, warming up towards ${ceiling}` : '') + '). Try again tomorrow.', false);
}

// --- 3. Is there anything approved to send? ---------------------------------
if (!candidates.length) {
  return stop('Nothing is approved and waiting.', false);
}

// --- 4. Minimum gap since the last send -------------------------------------
const minGapMinutes = Number(CFG.min_gap_minutes || 5);
if (stats.last_sent_at) {
  const minutesSince = (Date.now() - new Date(stats.last_sent_at).getTime()) / 60000;
  if (minutesSince < minGapMinutes) {
    return stop(`Too soon since the last send (${minutesSince.toFixed(1)} of ${minGapMinutes} ` +
                `minutes). Run again shortly.`, false);
  }
}

let hours;
try { hours = JSON.parse(CFG.business_hours_json || '{}'); } catch (e) { hours = {}; }
const nowUtc = new Date();

// Why one candidate may not go right now, or null if it may.
const blockedBecause = (candidate) => {
  // --- 5. Restate every precondition at the point of sending ---------------
  //
  // Re-checked here even though CH-04's guard already checked these, because
  // time passes between a draft being approved and this node running - a
  // suppression can be added, a business can close, in the gap.
  if (candidate.now_suppressed) {
    return { alert: true, reason: `${candidate.business_name} is now suppressed - was approved before the ` +
      `suppression was added. Skipping, not sending.` };
  }
  if (candidate.permanently_closed) {
    return { alert: true, reason: `${candidate.business_name} is now marked permanently closed.` };
  }
  if (candidate.is_natural_person) {
    return { alert: true, reason: `${candidate.business_name} is flagged as a natural person. This should have ` +
      `been held at draft time and was approved anyway - check CH-04's guard.` };
  }

  // --- 6. Business hours, in the RECIPIENT's country ------------------------
  //
  // The window belongs to the recipient, not to whoever clicks the button.
  // Approximated from the recipient's UTC offset rather than a real timezone
  // library, which a Code node does not have; a country whose offset changes
  // with daylight saving drifts by an hour twice a year.
  const cc = String(candidate.country_code || '').toLowerCase();
  const offsetHours = { no: 1, se: 1, dk: 1, ae: 4, qa: 3, es: 1, pt: 0, it: 1, ca: -5 }[cc] || 0;
  const recipientNow = new Date(nowUtc.getTime() + offsetHours * 3600000);

  // --- 6a. Not at the weekend, in the RECIPIENT's country -------------------
  //
  // A cold email landing on a Saturday reads as sent by a machine. The
  // weekend is not the same everywhere: the UAE moved to Saturday-Sunday in
  // 2022, Qatar keeps Friday-Saturday.
  const WEEKEND = { qa: [5, 6], sa: [5, 6], kw: [5, 6], om: [5, 6], bh: [5, 6] }[cc] || [6, 0];
  if (WEEKEND.includes(recipientNow.getUTCDay())) {
    return { alert: false, reason: `Weekend for ${candidate.country_code} - holding until the next working day.` };
  }

  // --- 6b. Business hours ---------------------------------------------------
  const window = hours[cc];
  if (window) {
    const [startHour, endHour] = window;
    const recipientHour = recipientNow.getUTCHours();
    if (recipientHour < startHour || recipientHour >= endHour) {
      return { alert: false, reason: `Outside business hours for ${candidate.country_code} ` +
        `(recipient's local hour is about ${recipientHour}, window is ${startHour}-${endHour}).` };
    }
  }
  return null;
};

const blocked = [];
for (const candidate of candidates) {
  const why = blockedBecause(candidate);
  if (!why) return [{ json: { send: true, ...candidate } }];
  blocked.push(why);
}

// Nothing may go now. An integrity problem (suppressed, closed, a natural
// person approved) is an alarm; waiting for office hours is routine.
const alarm = blocked.find((b) => b.alert);
return stop((alarm || blocked[0]).reason +
  (candidates.length > 1 ? ` (none of the ${candidates.length} approved may go right now)` : ''), Boolean(alarm));
