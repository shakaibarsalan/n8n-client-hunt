// CH-07, node: "Write the WhatsApp list"
// Mode: Run Once for All Items
//
// The best no-website leads that have no email, as tap-to-message WhatsApp
// links with the message already written: tap, read it, press send. These
// were 233 of the best leads in the database and nothing was reaching them.
//
// Sent by a person from their own phone, a few at a time - never automated:
// WhatsApp bans numbers that bulk-message strangers, and a human reading
// each one first is the point.

const leads = $('Pick WhatsApp leads').all().map((i) => i.json).filter((r) => r && r.phone_e164);
if (!leads.length) return [];

const TYPES = [
  [/hair_salon/, 'hair salons'], [/barber/, 'barber shops'], [/nail_salon/, 'nail salons'],
  [/spa|massage/, 'spas'], [/beauty|skin_care|makeup/, 'beauty salons'],
  [/real_estate|property/, 'real estate agencies'], [/restaurant/, 'restaurants'],
  [/cafe|coffee/, 'cafes'], [/automotive_repair|auto_detailing/, 'garages'],
  [/gym|fitness/, 'gyms'], [/dentist/, 'dental clinics'], [/medical|doctor|clinic/, 'clinics'],
  [/travel/, 'travel agencies'], [/car_rental/, 'car rental companies'],
];
const typeOf = (r) => {
  const k = String(r.category_primary || r.niche || '').toLowerCase();
  const hit = TYPES.find(([re]) => re.test(k.replace(/ /g, '_')));
  return hit ? hit[1] : 'local businesses';
};
const clean = (s) => String(s || '').replace(/_+/g, ' ').split(/\s+[|-]\s+/)[0].trim();

const message = (r) =>
  `Hi! We came across ${clean(r.name)} online and couldn't find a website for you. ` +
  `We're a small web design team and we build simple, mobile-friendly websites for ${typeOf(r)}. ` +
  `We'd be happy to make a sample homepage for ${clean(r.name)} - you'd only pay if you like it. ` +
  `Would you be interested? - Example Web Studio`;

const header = 'WhatsApp today - tap a link, read the message, press send:';
const lines = [header, ''];
let n = 0;
for (const r of leads) {
  const entry = [
    `${n + 1}. ${clean(r.name)} (${r.city || '?'}, ${String(r.category_primary || r.niche || '').replace(/_/g, ' ')})`,
    `https://wa.me/${String(r.phone_e164).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message(r))}`,
    '',
  ].join('\n');
  // A Telegram message holds 4,096 characters; stop before the limit rather
  // than have the whole list rejected.
  if ((lines.join('\n') + entry).length > 3900) break;
  lines.push(entry);
  n++;
}

return [{ json: { listed: n, message: lines.join('\n').trim() } }];
