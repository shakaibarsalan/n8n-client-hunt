// CH-06, node: "What kind of mail is this?"
// Mode: Run Once for All Items
//
// Sorts what arrived in the outreach mailbox into the only two kinds that
// must change what this pipeline does next:
//
//   reply   a person answered. Their sequence stops - nobody who has replied
//           should ever get "I'll make this my last message" four days later.
//   bounce  the address is dead. The row is marked bounced, which is what
//           CH-05's bounce circuit breaker counts, and the address is
//           suppressed so no future draft can reuse it.
//
// Everything else is dropped here rather than guessed at: the BCC copies CH-05
// sends to our own mailbox, out-of-office auto-replies (they are not an answer,
// and the follow-up should still go), and anything unrelated. Dropping an
// unrelated mail costs nothing because record-inbound-mail.sql only ever
// touches a row it can tie to something we actually sent.
//
// Field shapes: the IMAP trigger's "resolved" format hands over a parsed mail
// (from.value[].address, inReplyTo, references, text). The "simple" format
// uses plain strings and textPlain. Both are read, so a format change on the
// trigger degrades nothing.

const CFG = $('Config').first().json;
const OWN = String(CFG.own_address || '').toLowerCase().trim();
const OWN_DOMAIN = OWN.includes('@') ? OWN.split('@')[1] : '';

const ADDR_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const MSGID_RE = /<[^<>\s]+@[^<>\s]+>/g;

const firstAddress = (v) => {
  if (v && typeof v === 'object') {
    const list = Array.isArray(v.value) ? v.value : Array.isArray(v) ? v : [];
    for (const x of list) if (x && x.address) return String(x.address).toLowerCase();
    return v.text ? firstAddress(String(v.text)) : '';
  }
  const m = String(v || '').match(ADDR_RE);
  return m ? m[0].toLowerCase() : '';
};

// A header may sit at the top level (resolved format), under headers, or under
// metadata, and its name may or may not be camel-cased.
const field = (m, ...names) => {
  for (const src of [m, m.headers || {}, m.metadata || {}]) {
    for (const n of names) {
      const v = src[n];
      if (v != null && v !== '') return Array.isArray(v) ? v.join(' ') : String(v);
    }
  }
  return '';
};

const ids = (s) => (String(s || '').match(MSGID_RE) || [])
  .map((x) => x.slice(1, -1).toLowerCase());

// What the person actually wrote, not the quoted message underneath it.
const ownWords = (text) => {
  const out = [];
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*(on .+ wrote:|den .+ skrev|-{2,}\s*original message|from:\s|fra:\s|sent:\s|sendt:\s)/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery/i;
const BOUNCE_SUBJECT = /undeliver|delivery status notification|returned mail|failure notice|delivery (has )?failed|could not be delivered|non.?delivery|ikke levert|kunne ikke leveres/i;
const AUTO_SUBJECT = /^\s*(auto(matic)?[ -]?(reply|response|svar)|automatisk svar|autosvar|out of (the )?office|frav(ae|\u00e6)r|abwesenheit|ferie|vacation)/i;

const out = [];

// Read from the trigger by name, not from this node's input: the input is the
// Config node's output, which carries only the config fields.
for (const item of $('New mail in the inbox').all()) {
  const m = item.json || {};
  const from = firstAddress(m.from);
  const subject = String(m.subject || '');
  const text = String(m.text || m.textPlain || '');

  if (!from) continue;
  // Our own BCC copy of something CH-05 sent - never a reply.
  if (from === OWN || (OWN_DOMAIN && from.endsWith('@' + OWN_DOMAIN))) continue;

  const isBounce = BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject);
  const autoSubmitted = field(m, 'auto-submitted', 'autoSubmitted').toLowerCase();
  const isAuto = !isBounce && (AUTO_SUBJECT.test(subject) || (autoSubmitted && autoSubmitted !== 'no'));
  if (isAuto) continue;

  // Which of our messages is this about? In-Reply-To and References name it
  // directly; a bounce usually quotes the original Message-ID in its body.
  const messageIds = new Set([
    ...ids(field(m, 'inReplyTo', 'in-reply-to')),
    ...ids(field(m, 'references')),
    ...(isBounce ? ids(text) : []),
  ]);

  // For a bounce, the dead address is somewhere in the report. Every address
  // in it is offered; the SQL only matches one we actually sent to.
  const bounceAddresses = isBounce
    ? [...new Set((text + ' ' + subject).match(ADDR_RE) || [])]
      .map((a) => a.toLowerCase())
      .filter((a) => a !== OWN && !BOUNCE_FROM.test(a) && !(OWN_DOMAIN && a.endsWith('@' + OWN_DOMAIN)))
    : [];

  out.push({
    json: {
      kind: isBounce ? 'bounce' : 'reply',
      from_address: from,
      subject,
      message_ids: [...messageIds].join(' '),
      bounce_addresses: bounceAddresses.join(' '),
      excerpt: (isBounce ? text : ownWords(text)).slice(0, 500),
    },
  });
}

return out;
