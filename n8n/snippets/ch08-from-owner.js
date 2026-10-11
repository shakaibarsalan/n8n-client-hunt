// CH-08, node: "From the owner?"
// Mode: Run Once for All Items
//
// Anyone can find a Telegram bot and message it. Only the owner's chat is
// answered; anything else ends the run here with no reply, so a stranger
// cannot even learn that the bot is alive.

const update = $('Message to the bot').first().json;
const CFG = $('Config').first().json;
const msg = update.message || {};
const chatId = String((msg.chat && msg.chat.id) || '');

if (!chatId || !CFG.owner_chat_id || chatId !== String(CFG.owner_chat_id)) {
  return [];
}

const raw = String(msg.text || '').trim();
const text = raw.toLowerCase();
// /concept 1234, or /concept part of a name: a website concept for that
// business (ch08-concept.js).
const concept = raw.match(/^\/concept(?:@\w+)?\s*(.*)$/i);
if (concept) return [{ json: { command: 'concept', arg: concept[1].trim().slice(0, 80) } }];
// /stats, /start, "stats", or "/stats@botname" from a group.
const wantsStats = /^\/?(stats|start|status)(@\w+)?\b/.test(text);
return [{ json: { command: wantsStats ? 'stats' : 'help' } }];
