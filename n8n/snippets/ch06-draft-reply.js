// CH-06, node: "Suggest an answer"
// Mode: Run Once for All Items
//
// A business answered. The owner replies himself - a reply starts a real
// conversation about price and timing, and a machine promising the wrong
// thing loses the client - but he should not have to start from a blank
// page on his phone. So the Telegram alert carries a suggested answer he can
// copy, edit and send from the outreach mailbox.
//
// Rules, not a language model: the reply text is written by a stranger, and
// nothing a stranger writes should be able to steer what this produces. The
// rules only pick which of a few fixed answers to suggest.

const out = [];

// What the concept would show first, by kind of business.
const SHOWS = [
  [/restaurant|cafe|coffee|bakery|food|grill|kitchen|sweet|mandi|shawarma|pizza|burger/, 'your menu, a few photos and a button to order or book on WhatsApp'],
  [/salon|beauty|spa|nail|barber|hair|lash|brow|makeup/, 'your services and prices, photos of your work and a button to book an appointment'],
  [/real_estate|real estate|property|realt/, 'your listings, the areas you cover and a quick way to contact an agent'],
  [/clinic|dental|dentist|medical|physio|doctor|health/, 'your services, your team and a button to book a visit'],
  [/car|auto|garage|tyre|tire|repair|polish/, 'your services and prices, your location and a button to book a slot'],
];

const has = (t, re) => re.test(t);

for (const item of $input.all()) {
  const r = item.json;
  if (!r || !r.outreach_id) continue;

  const name = String(r.business_name || 'your business').replace(/\s*[-|,]\s+[^-|,]*$/, '').trim() || 'your business';
  const kind = `${r.category_primary || ''} ${r.niche || ''} ${name}`.toLowerCase();
  const shows = (SHOWS.find(([re]) => re.test(kind)) || [null, 'your services, a few photos and an easy way for customers to reach you'])[1];
  const text = String(r.reply_excerpt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const pitch = String(r.pitch || 'default');
  const offer = pitch === 'weak_website' ? 'the short list of what I would improve on your website' : `the website concept for ${name}`;

  // Order matters: "no problem, please send it" is a yes, not a no.
  let intent = 'question';
  if (has(text, /\b(not interested|unsubscribe|remove me|don'?t (contact|email|message)|do not (contact|email)|stop (emailing|sending|contacting))\b/)
      || /^(no|nope|no thanks?( you)?|not now|not needed|stop)[.!\s]*$/.test(text)
      || /^(لا|لا شكرا)/.test(text)) {
    intent = 'no';
  } else if (has(text, /\b(we (already )?have (a |our own )?(website|site)|already have (a )?(website|site)|our website is)\b/)) {
    intent = 'has_site';
  } else if (has(text, /\b(price|prices|pricing|cost|costs|how much|charges?|rates?|budget|fees?|quote|quotation|aed|dhs?|dirhams?|nok|kr)\b|كم|السعر|سعر/)) {
    intent = 'price';
  } else if (has(text, /\b(yes|yeah|yep|sure|ok|okay|please|send|share|show me|interested|go ahead|why not|of course|definitely|let'?s see|would love|sounds good)\b|نعم|أرسل|ارسل|تمام/)) {
    intent = 'yes';
  }

  const SIGN = '\n\nKind regards,\nAlex\nExample Web Studio';
  const DRAFT = {
    yes: `Hi,\n\nThanks for getting back to me! I'll put together ${offer} and send it over in the next day or two.\n\n` +
         `So it's closer to what you'd want: is there anything you'd like it to show first - for example ${shows}?` + SIGN,
    price: `Hi,\n\nThanks for your reply! It depends on what you need - a simple one-page website starts from [your starting price], ` +
           `and more pages or online booking add to that.\n\nThe easiest way is for me to send ${offer} first, with a clear quote ` +
           `alongside it, so you know exactly what you would get. Would that work for you?` + SIGN,
    has_site: `Hi,\n\nThanks for letting me know, and sorry for the mix-up - I couldn't find it when I looked. ` +
              `If you ever want a second opinion on it, or help making it faster on a phone, just reply here.\n\nAll the best with ${name}.` + SIGN,
    no: `Hi,\n\nThanks for letting me know - I won't contact you again. All the best with ${name}.` + SIGN,
    question: `Hi,\n\nThanks for getting back to me! [answer their question here]\n\n` +
              `If it helps, I can also send over ${offer} so you can see what I have in mind - shall I?` + SIGN,
  }[intent];

  const LABEL = {
    yes: 'Interested - send the concept',
    price: 'Asking about price - fill in your price',
    has_site: 'Says they already have a website',
    no: 'Not interested - nothing more will be sent to them; answering is optional',
    question: 'A question - answer it in the draft',
  }[intent];

  const lines = [];
  lines.push(`REPLY - ${r.business_name} (${r.city || '?'}) <${r.to_email}>` +
    (Number(r.later_steps_stopped) > 0 ? ' - follow-up cancelled' : ''));
  lines.push('');
  lines.push(String(r.reply_excerpt || '(no text)').trim());
  lines.push('');
  lines.push(`Looks like: ${LABEL}`);
  lines.push('');
  lines.push('Suggested answer - reply in the same thread, from the outreach mailbox:');
  lines.push('');
  lines.push(DRAFT);
  if (intent === 'yes' || intent === 'price' || intent === 'question') {
    lines.push('');
    lines.push(`Website concept for them: /concept ${r.business_id}`);
  }

  out.push({ json: { ...r, intent, message: lines.join('\n') } });
}

return out;
