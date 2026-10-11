// CH-05, node: "Is the mailbox real?"
// Mode: Run Once for All Items
//
// Asks Reoon whether the mailbox exists before the FIRST message to it goes.
// Five of the first 34 sends bounced - every one an address copied from a
// directory listing, two of them on gmail.com with the business's own name
// (a restaurant's <name>@gmail.com: "The email account that you tried to reach
// does not exist"). No rule about how an address looks can tell a live
// mailbox from a dead one; only asking the mail server can, and this server
// cannot ask itself - outbound port 25 is blocked.
//
// Verdicts:
//   send  - the mailbox accepts mail
//   hold  - could not be confirmed (catch-all listing domain, unknown, full);
//           goes to needs_review, never sent on its own
//   drop  - the mailbox does not exist or must never be mailed; skipped and
//           the address suppressed
//   error - the check itself failed (key refused, credits used up, timeout).
//           Nothing is sent and the message stays approved: an address that
//           was never checked is never mailed.

const c = $input.first().json;
const CFG = $('Config').first().json;
const out = (verdict, reason, extra) => [{ json: { ...c, send: verdict === 'send', verdict, reason, ...(extra || {}) } }];

// A follow-up goes to an address that already took our first message
// without bouncing - CH-06 stops the sequence on a bounce. No credit spent.
if (Number(c.sequence_step) > 1) {
  return out('send', 'follow-up: the first message to this address was delivered', { mailbox: 'delivered before' });
}

// An alarm that stays true (credits used up for the day) would otherwise
// message every 5 minutes. Once every 6 hours per kind of failure; workflow
// static data survives between scheduled runs.
const memory = $getWorkflowStaticData('global');
const alarmOnce = (kind) => {
  const last = Number((memory.mailbox_alarms || {})[kind] || 0);
  if (Date.now() - last < 6 * 3600000) return false;
  memory.mailbox_alarms = { ...(memory.mailbox_alarms || {}), [kind]: Date.now() };
  return true;
};
const failed = (kind, reason) => out('error', reason, { alert: alarmOnce(kind) });

const key = String(CFG.reoon_api_key || '');
if (!key || key.startsWith('__ENV')) {
  return failed('no-key', 'STOPPED: no Reoon key in CH-05 Config, so no address can be checked - nothing is sent unchecked.');
}

let r;
try {
  r = await this.helpers.httpRequest({
    method: 'GET',
    // No URL / URLSearchParams in the Code node sandbox.
    url: 'https://emailverifier.reoon.com/api/v1/verify?email=' + encodeURIComponent(c.to_email) +
         '&key=' + encodeURIComponent(key) + '&mode=power',
    json: true,
    // Power mode waits on the recipient's mail server: "a few seconds to more
    // than a minute". Inside the Code node's 300s budget.
    timeout: 120000,
  });
} catch (e) {
  const msg = String((e && e.message) || e);
  if (/status code 40[0-3]\b/.test(msg)) {
    return failed('refused', `STOPPED: Reoon refused the check (${msg}) - the key is wrong or the credits are used up. ` +
      `Nothing is sent unchecked; sending resumes when checks work again.`);
  }
  return failed('unreachable', `Mailbox check failed for ${c.to_email} (${msg}) - will try again next run.`);
}

const status = String((r && r.status) || '').toLowerCase();
const check = { mailbox: status, mailbox_score: r && r.overall_score };

if (status === 'safe') return out('send', 'mailbox exists', check);
if (status === 'role_account') {
  // info@, sales@ - normal for a small business. Fine when deliverable.
  return r.is_deliverable === true
    ? out('send', 'shared mailbox (info@ etc.) that accepts mail', check)
    : out('hold', 'shared mailbox that would not confirm delivery', check);
}
if (status === 'catch_all') {
  // The domain accepts every address, so "exists" means nothing. Fine for an
  // address printed on the business's own website; a directory's guess is
  // exactly what bounced before.
  return c.email_source === 'listing'
    ? out('hold', 'catch-all domain, and the address came from a directory listing - cannot be confirmed', check)
    : out('send', 'catch-all domain, address taken from their own website', check);
}
if (['invalid', 'disabled', 'spamtrap', 'disposable'].includes(status)) {
  return out('drop', `mailbox check: ${status} - not sent, address suppressed`, check);
}
if (['unknown', 'inbox_full'].includes(status)) {
  return out('hold', `mailbox check: ${status} - could not confirm the mailbox takes mail`, check);
}
// Anything else is a reply we do not understand - an error body, a changed
// API. Treated as the check failing, never as a pass.
return failed('unexpected', `STOPPED: Reoon gave an answer we do not understand ` +
  `(${JSON.stringify(r).slice(0, 200)}) - nothing is sent unchecked.`);
