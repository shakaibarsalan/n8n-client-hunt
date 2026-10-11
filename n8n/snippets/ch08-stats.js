// CH-08, node: "Write the answer"
// Mode: Run Once for All Items
//
// Turns the numbers into one short Telegram message. Times are shown in
// Pakistan time (PKT, UTC+5), the operator's display zone - change pkt() below
// for another; the cap and the brake are worked out the same
// way CH-05's brake works them out, from the values mirrored in Config.

const d = $('The numbers').first().json;
const CFG = $('Config').first().json;
const { command } = $('From the owner?').first().json;

if (command !== 'stats') {
  return [{ json: { message: 'Send /stats for the latest numbers: mails sent today, replies, bounces and the queue.\n' +
    'Send /concept 1234 (the number from a reply alert) for a website concept to show that business.' } }];
}

const n = (v) => Number(v || 0);
const pkt = (t) => {
  if (!t) return '-';
  const x = new Date(new Date(t).getTime() + 5 * 3600000);
  const hh = String(x.getUTCHours()).padStart(2, '0');
  const mm = String(x.getUTCMinutes()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${x.getUTCDate()} ${months[x.getUTCMonth()]} ${hh}:${mm}`;
};
const list = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []));

// Today's cap: warm-up from the first send, up to max_per_day (CH-05's rule).
let cap = n(CFG.max_per_day);
if (d.first_sent_at && CFG.warmup_start) {
  const days = Math.floor((Date.now() - new Date(d.first_sent_at).getTime()) / 86400000);
  cap = Math.min(cap, n(CFG.warmup_start) + n(CFG.warmup_step) * Math.max(0, days));
}
const bounceLimit = Math.max(n(CFG.max_bounces), Math.ceil(n(d.sent_7d) * 0.08));
const brakeOn = n(d.bounced_7d) >= bounceLimit;

const lines = [];
lines.push(`Client Hunt - ${pkt(new Date())} PKT`);
lines.push('');
if (brakeOn) {
  lines.push(`SENDING STOPPED by the bounce brake: ${n(d.bounced_7d)} bounces in the last 7 days (limit ${bounceLimit}).`);
  lines.push('');
}
const cities = list(d.today_by_city).map((c) => `${c.city} ${c.n}`).join(', ');
lines.push(`Sent today: ${n(d.sent_today)} of ${cap}` +
  (n(d.followups_today) ? ` (${n(d.followups_today)} follow-ups)` : '') +
  (cities ? ` - ${cities}` : ''));
lines.push(`Last sent: ${pkt(d.last_sent_at)}`);
lines.push(`Replies: ${n(d.replies_today)} today, ${n(d.replies_total)} in total`);
lines.push(`Bounces: ${n(d.bounced_7d)} in the last 7 days (brake at ${bounceLimit}), ${n(d.bounced_total)} in total`);
lines.push(`Dead mailboxes caught before sending: ${n(d.dead_mailboxes_caught)}`);
lines.push(`Queue: ${n(d.queued)} approved to send, ${n(d.held)} held for review`);
lines.push(`Leads: ${n(d.leads_total)} found, ${n(d.pending)} waiting to be verified`);
lines.push(`All time: ${n(d.sent_total)} sent`);

const replies = list(d.recent_replies);
if (replies.length) {
  lines.push('');
  lines.push('Latest replies:');
  for (const r of replies) {
    lines.push(`- ${r.name}${r.city ? ` (${r.city})` : ''}, ${pkt(r.reply_at)}: ${String(r.excerpt || '').replace(/\s+/g, ' ').trim()}`);
  }
}

return [{ json: { message: lines.join('\n') } }];
