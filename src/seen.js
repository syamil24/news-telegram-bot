/**
 * seen.js
 * Persists processed state to disk so the bot never re-summarizes
 * articles across restarts.
 *
 * Stored in seen.json (project root):
 * {
 *   "lastMessageIds": { "<channelName>": <messageId> },
 *   "seenUrls": ["https://...", ...]
 * }
 */

const fs = require('fs');
const path = require('path');

const SEEN_FILE = path.join(__dirname, '..', 'seen.json');

// In-memory state — loaded once at startup
let state = {
  lastMessageIds: {},
  seenUrls: new Set(),
};

/**
 * Load state from disk. Call once at startup.
 */
function loadSeen() {
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
      state.lastMessageIds = raw.lastMessageIds || {};
      state.seenUrls = new Set(raw.seenUrls || []);
      console.log(`[Seen] Loaded ${state.seenUrls.size} seen URLs, channels: ${JSON.stringify(state.lastMessageIds)}`);
    } else {
      console.log('[Seen] No seen.json found, starting fresh.');
    }
  } catch (err) {
    console.warn('[Seen] Could not load seen.json, starting fresh:', err.message);
  }
}

/**
 * Persist current state to disk.
 */
function saveSeen() {
  try {
    fs.writeFileSync(SEEN_FILE, JSON.stringify({
      lastMessageIds: state.lastMessageIds,
      seenUrls: [...state.seenUrls],
    }, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Seen] Could not save seen.json:', err.message);
  }
}

/**
 * Get the last processed message ID for a channel.
 * Returns 0 if never seen before.
 */
function getLastMessageId(channel) {
  return state.lastMessageIds[channel] || 0;
}

/**
 * Update the last processed message ID for a channel.
 * Only updates if newId is higher than the stored value.
 */
function setLastMessageId(channel, newId) {
  if (newId > (state.lastMessageIds[channel] || 0)) {
    state.lastMessageIds[channel] = newId;
    saveSeen();
  }
}

/**
 * Check if a URL has already been processed.
 */
function hasSeenUrl(url) {
  return state.seenUrls.has(url);
}

/**
 * Mark a URL as processed and persist.
 */
function markUrlSeen(url) {
  if (!state.seenUrls.has(url)) {
    state.seenUrls.add(url);
    saveSeen();
  }
}

module.exports = {
  loadSeen,
  getLastMessageId,
  setLastMessageId,
  hasSeenUrl,
  markUrlSeen,
};
