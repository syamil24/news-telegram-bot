const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'session.txt');

let client = null;
let sessionString = '';

/**
 * Load existing session from file if available
 */
function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      sessionString = fs.readFileSync(SESSION_FILE, 'utf8').trim();
      console.log('[Userbot] Loaded existing session.');
    }
  } catch (err) {
    console.warn('[Userbot] No existing session found, will create new one.');
  }
}

/**
 * Save session string to file for reuse
 */
function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, session, 'utf8');
  console.log('[Userbot] Session saved.');
}

/**
 * Initialize and connect the userbot (personal Telegram account)
 */
async function initUserbot() {
  loadSession();

  const apiId = parseInt(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;

  client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
    }
  );

  await client.start({
    phoneNumber: async () => await input.text('Enter your Telegram phone number (with country code, e.g. +60123456789): '),
    password: async () => await input.text('Enter your 2FA password (leave blank if none): '),
    phoneCode: async () => await input.text('Enter the OTP code sent to your Telegram: '),
    onError: (err) => console.error('[Userbot] Auth error:', err),
  });

  const currentSession = client.session.save();
  saveSession(currentSession);

  console.log('[Userbot] Connected as:', (await client.getMe()).username || (await client.getMe()).firstName);
  return client;
}

/**
 * Get client instance (must call initUserbot first)
 */
function getClient() {
  return client;
}

/**
 * List all joined channels/groups for channel discovery
 */
async function listDialogs() {
  const dialogs = [];
  for await (const dialog of client.iterDialogs()) {
    if (dialog.isChannel || dialog.isGroup) {
      dialogs.push({
        id: dialog.id,
        name: dialog.name,
        username: dialog.entity.username || null,
      });
    }
  }
  return dialogs;
}

/**
 * Fetch recent messages from a channel by name or username
 * @param {string} channelIdentifier - channel username or name
 * @param {number} limit - max number of messages to fetch
 * @param {number} minId - only return messages newer than this message ID (0 = no filter)
 * @returns {Array} array of message objects, newest first
 */
async function fetchChannelMessages(channelIdentifier, limit = 20, minId = 0) {
  try {
    const messages = [];
    const entity = await client.getEntity(channelIdentifier);

    const iterOptions = { limit };
    if (minId > 0) iterOptions.minId = minId;

    for await (const msg of client.iterMessages(entity, iterOptions)) {
      if (msg.message) {
        messages.push({
          id: msg.id,
          text: msg.message,
          date: new Date(msg.date * 1000),
          urls: extractUrls(msg.message, msg.entities),
        });
      }
    }
    return messages; // newest first (GramJS default)
  } catch (err) {
    console.error(`[Userbot] Failed to fetch messages from ${channelIdentifier}:`, err.message);
    return [];
  }
}

/**
 * Extract all URLs from a message — checks both:
 *   1. Raw URLs visible in the message text
 *   2. Hyperlinked text entities (MessageEntityTextUrl) — common in channel posts
 * @param {string} text - plain message text
 * @param {Array}  entities - GramJS message entities array (optional)
 */
function extractUrls(text, entities = []) {
  const found = new Set();

  // 1. Plain URLs in text
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const textMatches = (text || '').match(urlRegex) || [];
  textMatches.forEach(u => found.add(u.replace(/[).,]+$/, ''))); // strip trailing punctuation

  // 2. Hyperlinked entities (the URL is in entity.url, not visible in text)
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      // GramJS entity className is 'MessageEntityTextUrl'
      if (entity.className === 'MessageEntityTextUrl' && entity.url) {
        found.add(entity.url);
      }
      // Also handle plain URL entities
      if (entity.className === 'MessageEntityUrl' && text) {
        const urlText = text.substr(entity.offset, entity.length);
        if (urlText.startsWith('http')) found.add(urlText);
      }
    }
  }

  return [...found];
}

/**
 * Listen for new messages in specified channels and trigger a callback
 * @param {string[]} channelIdentifiers - array of channel usernames/identifiers
 * @param {Function} callback - async function(message, channelName)
 */
async function listenForNewMessages(channelIdentifiers, callback) {
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg || !msg.message) return;

    try {
      const chat = await msg.getChat();
      const chatTitle = chat.title || chat.username || String(chat.id);

      // Check if message is from one of our watched channels
      const isWatched = channelIdentifiers.some((id) => {
        const normalized = id.replace('@', '').toLowerCase();
        return (
          (chat.username && chat.username.toLowerCase() === normalized) ||
          chatTitle.toLowerCase().includes(normalized) ||
          String(chat.id) === String(id)
        );
      });

      if (isWatched) {
        const messageObj = {
          id: msg.id,
          text: msg.message,
          date: new Date(msg.date * 1000),
          urls: extractUrls(msg.message, msg.entities),
          channelName: chatTitle,
        };
        await callback(messageObj, chatTitle);
      }
    } catch (err) {
      // Ignore errors for non-channel messages
    }
  }, new NewMessage({}));

  console.log('[Userbot] Listening for new messages in channels:', channelIdentifiers);
}

module.exports = {
  initUserbot,
  getClient,
  listDialogs,
  fetchChannelMessages,
  listenForNewMessages,
  extractUrls,
};
