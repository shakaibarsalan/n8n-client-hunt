// CH-06: what arrived in the outreach mailbox, and does it change anything?
//
// The mistakes that matter here run in both directions. Missing a reply means
// the person who answered gets "I'll make this my last message" four days
// later. Mistaking our own BCC copy, or an out-of-office, for a reply would
// silently stop a sequence nobody actually answered.

const { compile, nodeRef, ok, eq, done } = require('./helpers');

const classify = compile('CH-06-track-replies.json', 'What kind of mail is this?', { $: null });

// Fictional throughout: the outreach mailbox and every correspondent use the
// reserved .test TLD.
const OWN = 'hello@outreach.test';

const run = async (mails) => (await classify({
  $: nodeRef({
    'Config': [{ own_address: OWN, telegram_chat_id: '1' }],
    'New mail in the inbox': mails,
  }),
})).map((i) => i.json);

// The "resolved" shape the IMAP trigger produces: a parsed mail.
const mail = (over) => ({
  from: { value: [{ address: 'post@testvikhouse.test', name: 'Testvik House' }], text: 'Testvik House <post@testvikhouse.test>' },
  subject: 'Re: Quick note about Testvik House Apartments',
  messageId: '<reply-1@testvikhouse.test>',
  inReplyTo: '<msg-0001@outreach.test>',
  references: '<msg-0001@outreach.test>',
  text: 'Hi, yes please send the concept.\n\nThanks\nKari\n\nOn Mon, 5 Oct 2026, Example Web Studio <hello@outreach.test> wrote:\n> Hi there,\n> I came across Testvik House',
  ...over,
});

(async () => {
  console.log('CH-06: classify inbound mail\n');

  // --- a genuine reply ----------------------------------------------------
  {
    const [r] = await run([mail()]);
    eq('a reply is a reply', r.kind, 'reply');
    eq('from the sender', r.from_address, 'post@testvikhouse.test');
    eq('tied to the message it answers, without angle brackets',
      r.message_ids, 'msg-0001@outreach.test');
    ok('the excerpt is what they wrote', r.excerpt.startsWith('Hi, yes please send the concept.'), r.excerpt);
    ok('not the quoted message underneath', !/I came across/.test(r.excerpt), r.excerpt);
  }

  // --- the owner answers from a different address -------------------------
  {
    const [r] = await run([mail({
      from: { value: [{ address: 'Kari.Nordmann@Example.COM' }] },
    })]);
    eq('still a reply', r.kind, 'reply');
    eq('address lower-cased for matching', r.from_address, 'kari.nordmann@example.com');
    ok('and still carries the Message-ID that ties it to our send', r.message_ids.length > 0);
  }

  // --- the simple format, as plain strings -------------------------------
  {
    const [r] = await run([{
      from: 'Testvik House <post@testvikhouse.test>',
      subject: 'Re: Quick note',
      textPlain: 'Not interested, thanks.',
      metadata: { 'in-reply-to': '<abc@outreach.test>' },
    }]);
    eq('plain-string sender is understood', r.from_address, 'post@testvikhouse.test');
    eq('header found under metadata', r.message_ids, 'abc@outreach.test');
    eq('textPlain is read', r.excerpt, 'Not interested, thanks.');
  }

  // --- a bounce ------------------------------------------------------------
  {
    const [r] = await run([mail({
      from: { value: [{ address: 'MAILER-DAEMON@mx.mail-provider.test', name: 'Mail Delivery System' }] },
      subject: 'Undelivered Mail Returned to Sender',
      inReplyTo: undefined,
      references: undefined,
      text: 'This is the mail system at host mx.mail-provider.test.\n\n<post@megler-f.test>: host mx.megler-f.test said: 550 5.1.1 User unknown\n\n' +
            'Message-ID: <msg-0001@outreach.test>\nFrom: hello@outreach.test',
    })]);
    eq('a delivery failure is a bounce', r.kind, 'bounce');
    ok('the dead address is offered', r.bounce_addresses.split(' ').includes('post@megler-f.test'), r.bounce_addresses);
    ok('our own address is never offered as the dead one',
      !r.bounce_addresses.includes(OWN), r.bounce_addresses);
    ok('the mailer-daemon is never offered either',
      !/mailer-daemon/.test(r.bounce_addresses), r.bounce_addresses);
    ok('the quoted Message-ID ties it to the send',
      r.message_ids.includes('msg-0001@outreach.test'), r.message_ids);
  }

  // --- things that are NOT replies -----------------------------------------
  {
    const r = await run([mail({ from: { value: [{ address: OWN }] }, subject: 'Quick note about X' })]);
    eq('our own BCC copy is ignored', r.length, 0);
  }
  {
    const r = await run([mail({ subject: 'Automatisk svar: Quick note about Testvik House' })]);
    eq('a Norwegian auto-reply is ignored', r.length, 0);
  }
  {
    const r = await run([mail({ subject: 'Out of Office: back on Monday' })]);
    eq('an out-of-office is ignored', r.length, 0);
  }
  {
    const r = await run([mail({ autoSubmitted: 'auto-replied', subject: 'Re: Quick note' })]);
    eq('an Auto-Submitted header marks it automatic too', r.length, 0);
  }
  {
    const r = await run([{ subject: 'no sender at all', text: 'x' }]);
    eq('a mail with no sender is dropped, not guessed at', r.length, 0);
  }

  // --- a batch, and nothing at all ----------------------------------------
  {
    const r = await run([mail(), mail({ from: { value: [{ address: OWN }] } }), mail()]);
    eq('a batch keeps the real ones and drops the copies', r.length, 2);
  }
  {
    const r = await run([]);
    eq('no mail, no items - and no crash', r.length, 0);
  }

  done('CH-06: classify inbound mail');
})();
