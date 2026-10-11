// CH-07, node: "Write the digest"
// Mode: Run Once for All Items
//
// The twice-daily report the owner asked for in place of a message per send:
// how many emails went in the last 12 hours, where, to what kind of business,
// what came back, and what is queued.

const d = $('What happened?').first().json;

const arr = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []));
const pretty = (s) => String(s || '?').replace(/_/g, ' ');
const list = (v, key) => arr(v).map((x) => `${pretty(x[key])} ${x.n}`).join(', ');
const n = (v) => Number(v || 0);

const lines = ['Client Hunt - last 12 hours', ''];

lines.push(`Emails sent: ${n(d.sent)}` + (n(d.followups) ? ` (${n(d.followups)} follow-ups)` : ''));
if (n(d.sent)) {
  lines.push(`  where: ${list(d.by_city, 'city')}`);
  lines.push(`  to: ${list(d.by_kind, 'kind')}`);
}

const replies = arr(d.replies);
lines.push(`Replies: ${replies.length}`);
for (const r of replies) {
  lines.push(`  - ${r.name} (${r.city || '?'}): "${String(r.excerpt || '').replace(/\s+/g, ' ').trim()}"`);
}
lines.push(`Bounced: ${n(d.bounced)}`);

lines.push('');
lines.push(`Queued to send: ${n(d.queued)}   Held for your review: ${n(d.held)}`);
lines.push(`New leads: ${n(d.new_leads)}   Verified: ${n(d.verified)} (${n(d.verified_no_site)} with no website)   Waiting: ${n(d.pending)}`);
lines.push('');
lines.push(`All time: ${n(d.sent_total)} sent, ${n(d.replies_total)} replies, ` +
  `${n(d.whatsapp_listed)} leads handed over for WhatsApp`);

// --- Watchdog -------------------------------------------------------------
// Zeros are only reassuring if the pipeline is running. It once stopped for
// two weeks with nothing to say so; these say so.
const warn = [];
const minsSince = (t) => (t ? (Date.now() - new Date(t).getTime()) / 60000 : Infinity);
// CH-02 now waits on purpose while 90+ messages are approved (select-pending.sql;
// keep in step with its verify_while_queue_below) - silence is only a fault below that.
if (n(d.pending) > 0 && n(d.queued) < 90 && minsSince(d.last_check_at) > 30) {
  warn.push(`Verification (CH-02) has not written anything for ${Math.round(minsSince(d.last_check_at))} min ` +
    `with ${n(d.pending)} waiting - it may be stopped.`);
}
// CH-05's bounce brake. 8 is CH-05's max_bounces; keep the two in step.
const brakeOn = n(d.bounced_7d) >= Math.max(8, Math.ceil(n(d.sent_7d) * 0.08));
if (brakeOn) {
  const eases = d.brake_eases_at
    ? new Date(new Date(d.brake_eases_at).getTime() + 5 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' PKT'
    : 'when the oldest bounce is a week old';
  warn.push(`Sending is STOPPED by the bounce brake: ${n(d.bounced_7d)} bounces in the last 7 days. ` +
    `It eases on its own around ${eases}, unless more bounce.`);
}
const uaeDay = new Date(Date.now() + 4 * 3600000).getUTCDay();
if (!brakeOn && n(d.queued) > 0 && minsSince(d.last_sent_at) > 26 * 60 && uaeDay !== 0 && uaeDay !== 6 && uaeDay !== 1) {
  warn.push(`${n(d.queued)} emails are approved but nothing has been sent for over a day - CH-05 may be stopped.`);
}
if (n(d.searches) >= 5 && n(d.search_errors) / n(d.searches) > 0.5) {
  warn.push(`${n(d.search_errors)} of ${n(d.searches)} searches failed - the Serper key is probably out of credits.`);
}
if (warn.length) {
  lines.unshift('');
  for (const w of warn.reverse()) lines.unshift(`WARNING: ${w}`);
}

return [{ json: { message: lines.join('\n') } }];
