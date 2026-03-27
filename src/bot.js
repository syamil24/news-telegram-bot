const TelegramBot = require('node-telegram-bot-api');
const { scrapeArticle, isStarUrl } = require('./scraper');
const { summarizeStarArticle, summarizeTradingMessages, summarizeSingleMessage } = require('./summarizer');
const { fetchChannelMessages, extractUrls } = require('./userbot');
const { shouldSkipArticle } = require('./filter');
const { loadSeen, getLastMessageId, setLastMessageId, hasSeenUrl, markUrlSeen } = require('./seen');

let bot = null;
const PARSE_MODE = 'Markdown';

// Track authorized chat IDs (users who have started the bot)
const authorizedChats = new Set();

// Buffer headline-only articles in real-time mode and flush as one grouped message
let headlineBuffer = [];
let headlineFlushTimer = null;
const HEADLINE_FLUSH_DELAY = 10000; // 10 s — group headlines from the same burst

function flushHeadlines() {
  if (headlineBuffer.length === 0) return;
  const batch = [...headlineBuffer];
  headlineBuffer = [];

  const lines = batch.map(({ title, url }) => `• [${title}](${url})`).join('\n');
  const text = `📋 *Also in The Star* _(not summarized — tap to read)_\n\n${lines}`;

  for (const chatId of authorizedChats) {
    sendLongMessage(chatId, text).catch(() => {});
  }
}

/**
 * Initialize the Telegram bot
 */
function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');

  loadSeen(); // load persisted seen state before bot starts

  bot = new TelegramBot(token, { polling: true });
  console.log('[Bot] Telegram bot started and polling...');

  registerHandlers();
  return bot;
}

/**
 * Get the bot instance
 */
function getBot() {
  return bot;
}

/**
 * Send a long message, splitting if needed (Telegram 4096 char limit)
 */
async function sendLongMessage(chatId, text, options = {}) {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    return bot.sendMessage(chatId, text, { parse_mode: PARSE_MODE, ...options });
  }

  // Split by paragraphs
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLen) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += '\n' + line;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk, { parse_mode: PARSE_MODE, ...options });
    await sleep(300);
  }
}

/**
 * Send a "typing..." action
 */
function sendTyping(chatId) {
  return bot.sendChatAction(chatId, 'typing');
}

/**
 * Register all bot command and message handlers
 */
function registerHandlers() {
  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    authorizedChats.add(chatId);

    const welcome = `
🤖 *The Star & Trading Digest Bot*

Welcome! I monitor your Telegram channels and deliver AI-powered summaries.

*Available Commands:*
/star - Get latest summaries from The Star channel
/trading - Get market digest from Newbie Trading channel
/latest - Get combined latest digest from both channels
/channels - List available channels
/help - Show this help message

*Smart Filtering (The Star):*
• Skips: celebrities, daily stock open/close, minor accidents, minor crimes
• Summarizes: major events, economy, opinion, tech, travel, knowledge & more

*Powered by Groq AI (Llama 3.3)*
`;
    await bot.sendMessage(chatId, welcome, { parse_mode: PARSE_MODE });
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const help = `
📖 *Bot Help*

*/star* — Summarize all relevant new articles from The Star channel
*/star [number]* — Scan last N messages instead of default 20 (e.g. \`/star 30\`)
*/trading* — Get AI market digest from Newbie Trading channel
*/trading [number]* — Digest last N messages (e.g. \`/trading 30\`)
*/latest* — Quick digest from both channels
*/channels* — Show configured channel names
*/help* — Show this help

*Smart Filtering (The Star):*
❌ Skipped: celebrities, daily KLCI/Bursa open-close, minor road accidents, suicides, petty crime
✅ Summarized: economy, major events, opinion, tech, travel, science, education & more

*Automatic Mode:*
The bot listens in real-time and pushes summaries only for articles that pass the filter.
`;
    await bot.sendMessage(chatId, help, { parse_mode: PARSE_MODE });
  });

  // /channels command - list detected channels
  bot.onText(/\/channels/, async (msg) => {
    const chatId = msg.chat.id;
    const starChannel = process.env.THE_STAR_CHANNEL || 'Not configured';
    const tradingChannel = process.env.NEWBIE_TRADING_CHANNEL || 'Not configured';

    await bot.sendMessage(chatId,
      `📡 *Monitored Channels:*\n\n` +
      `📰 *The Star:* \`${starChannel}\`\n` +
      `📊 *Newbie Trading:* \`${tradingChannel}\`\n\n` +
      `To update channel names, edit the \`.env\` file and restart the bot.`,
      { parse_mode: PARSE_MODE }
    );
  });

  // /star command - fetch and summarize The Star articles
  bot.onText(/\/star(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    // Optional arg now controls how many channel messages to scan (not summary cap)
    const scanLimit = Math.min(parseInt(match[1]) || 15, 50);
    const starChannel = process.env.THE_STAR_CHANNEL;

    if (!starChannel) {
      return bot.sendMessage(chatId,
        '⚠️ The Star channel not configured.\n\nPlease set `THE_STAR_CHANNEL` in your `.env` file with the channel username (e.g. `thestarmy`) and restart the bot.',
        { parse_mode: PARSE_MODE }
      );
    }

    await sendTyping(chatId);

    const isTestMode = process.env.TEST_MODE === 'true';

    // In test mode: ignore seen history, always fetch latest N messages fresh
    // In production: only fetch messages newer than the last processed ID
    let messages;
    let highestId;

    if (isTestMode) {
      messages = await fetchChannelMessages(starChannel, scanLimit);
      highestId = null; // don't advance cursor in test mode
      await bot.sendMessage(chatId,
        `🧪 *Test mode* — fetching latest *${scanLimit}* messages, ignoring seen history.`,
        { parse_mode: PARSE_MODE }
      );
    } else {
      const lastId = getLastMessageId(starChannel);
      const fetchLimit = lastId === 0 ? scanLimit : Math.max(scanLimit, 50);
      messages = await fetchChannelMessages(starChannel, fetchLimit, lastId);
      highestId = lastId;
    }

    if (messages.length === 0) {
      return bot.sendMessage(chatId,
        '✅ You are all caught up — no new messages in The Star channel since last check.',
        { parse_mode: PARSE_MODE }
      );
    }

    await bot.sendMessage(chatId,
      `🔍 Found *${messages.length}* message(s). Scanning for articles...`,
      { parse_mode: PARSE_MODE }
    );

    // Debug: log what messages + URLs were found
    for (const m of messages) {
      console.log(`[Star] msg#${m.id} | URLs: ${m.urls.length > 0 ? m.urls.join(', ') : '(none)'} | text: ${m.text.substring(0, 80).replace(/\n/g,' ')}`);
    }

    // Collect unique Star URLs
    // In test mode: include all URLs regardless of seen history
    // In production: skip URLs already processed
    const starUrls = [];
    const dedup = new Set();
    for (const m of messages) {
      if (highestId !== null && m.id > highestId) highestId = m.id;
      for (const url of m.urls) {
        if (isStarUrl(url) && !dedup.has(url) && (isTestMode || !hasSeenUrl(url))) {
          dedup.add(url);
          starUrls.push(url);
        }
      }
    }

    if (starUrls.length === 0) {
      if (!isTestMode) setLastMessageId(starChannel, highestId);
      return bot.sendMessage(chatId,
        '📭 No Star article links found in these messages.',
        { parse_mode: PARSE_MODE }
      );
    }

    try {
      let summarized = 0;
      let headlines = []; // filtered articles — show as hyperlinks

      for (const url of starUrls) {
        await sendTyping(chatId);

        try {
          const article = await scrapeArticle(url);
          if (!isTestMode) markUrlSeen(url); // only persist seen state in production

          if (!article || article.content.length < 100) {
            continue;
          }

          const { skip, reason } = shouldSkipArticle(article);
          if (skip) {
            console.log(`[Filter] Skipped: ${article.title} — ${reason}`);
            headlines.push({ title: article.title, url });
            continue;
          }

          const summary = await summarizeStarArticle(article);
          await sendLongMessage(chatId, summary + `\n\n🔗 [Read Full Article](${url})`);
          summarized++;
          await sleep(1000);
        } catch (err) {
          console.error('[Bot] Error processing article:', err.message);
        }
      }

      // Send headline-only block if any
      if (headlines.length > 0) {
        const lines = headlines.map(({ title, url }) => `• [${title}](${url})`).join('\n');
        await sendLongMessage(chatId, `📋 *Also in The Star* _(not summarized — tap to read)_\n\n${lines}`);
      }

      // Only advance the cursor in production mode
      if (!isTestMode && highestId !== null) setLastMessageId(starChannel, highestId);

      if (summarized === 0 && headlines.length === 0) {
        await bot.sendMessage(chatId, `📭 No Star articles found in new messages.`, { parse_mode: PARSE_MODE });
      } else {
        await bot.sendMessage(chatId,
          `✅ Done — *${summarized}* summarized, *${headlines.length}* headlines listed.`,
          { parse_mode: PARSE_MODE }
        );
      }
    } catch (err) {
      console.error('[Bot] /star command error:', err.message);
      await bot.sendMessage(chatId, `❌ Error fetching Star channel: ${err.message}`, { parse_mode: PARSE_MODE });
    }
  });

  // /trading command - get market digest from Newbie Trading channel
  bot.onText(/\/trading(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const limit = Math.min(parseInt(match[1]) || 20, 50);
    const tradingChannel = process.env.NEWBIE_TRADING_CHANNEL;

    if (!tradingChannel) {
      return bot.sendMessage(chatId,
        '⚠️ Newbie Trading channel not configured.\n\nPlease set `NEWBIE_TRADING_CHANNEL` in your `.env` file and restart.',
        { parse_mode: PARSE_MODE }
      );
    }

    await sendTyping(chatId);
    await bot.sendMessage(chatId, `🔍 Fetching last *${limit}* messages from Newbie Trading channel...`, { parse_mode: PARSE_MODE });

    try {
      const messages = await fetchChannelMessages(tradingChannel, limit);

      if (messages.length === 0) {
        return bot.sendMessage(chatId, '📭 No messages found. Check the channel name in `.env`.', { parse_mode: PARSE_MODE });
      }

      await sendTyping(chatId);
      const digest = await summarizeTradingMessages(messages, 'Newbie Trading Channel');
      await sendLongMessage(chatId, digest);
    } catch (err) {
      console.error('[Bot] /trading command error:', err.message);
      await bot.sendMessage(chatId, `❌ Error fetching Trading channel: ${err.message}`, { parse_mode: PARSE_MODE });
    }
  });

  // /latest command - quick digest from both channels
  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    await sendTyping(chatId);
    await bot.sendMessage(chatId, '🔄 Fetching latest from both channels...', { parse_mode: PARSE_MODE });

    // Trigger both with small limits
    await bot.sendMessage(chatId, '📰 *--- THE STAR ---*', { parse_mode: PARSE_MODE });
    bot.emit('text', { ...msg, text: '/star 3' });

    await sleep(500);

    await bot.sendMessage(chatId, '📊 *--- NEWBIE TRADING ---*', { parse_mode: PARSE_MODE });
    bot.emit('text', { ...msg, text: '/trading 15' });
  });

  // Handle unknown commands
  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/') &&
        !['/start', '/help', '/star', '/trading', '/latest', '/channels'].some(cmd => msg.text.startsWith(cmd))) {
      await bot.sendMessage(msg.chat.id, '❓ Unknown command. Type /help for available commands.', { parse_mode: PARSE_MODE });
    }
  });

  bot.on('polling_error', (err) => {
    console.error('[Bot] Polling error:', err.message);
  });
}

/**
 * Push a new Star article summary to all authorized chats
 * Called by main.js when a new message is detected in the Star channel
 */
async function pushStarSummary(url) {
  if (authorizedChats.size === 0) {
    console.log('[Bot] No authorized chats to push to.');
    return;
  }

  // Skip if already processed (e.g. user already ran /star manually)
  if (hasSeenUrl(url)) {
    console.log(`[Bot] Real-time push skipped (already seen): ${url}`);
    return;
  }

  try {
    const article = await scrapeArticle(url);
    markUrlSeen(url); // mark regardless of outcome

    if (!article || article.content.length < 100) return;

    // Apply smart filter before pushing
    const { skip, reason } = shouldSkipArticle(article);
    if (skip) {
      console.log(`[Filter] Real-time push headline-only: ${article.title} — ${reason}`);
      // Buffer the headline; flush as a grouped message after a short delay
      headlineBuffer.push({ title: article.title, url });
      if (headlineFlushTimer) clearTimeout(headlineFlushTimer);
      headlineFlushTimer = setTimeout(flushHeadlines, HEADLINE_FLUSH_DELAY);
      return;
    }

    const summary = await summarizeStarArticle(article);
    const fullMessage = `📡 *New from The Star*\n\n${summary}\n\n🔗 [Read Full Article](${url})`;

    for (const chatId of authorizedChats) {
      await sendLongMessage(chatId, fullMessage);
      await sleep(200);
    }
  } catch (err) {
    console.error('[Bot] Failed to push Star summary:', err.message);
  }
}

/**
 * Push a trading message summary to all authorized chats
 */
async function pushTradingDigest(messages, channelName) {
  if (authorizedChats.size === 0) return;

  try {
    let summary;
    if (messages.length === 1) {
      summary = await summarizeSingleMessage(messages[0].text, channelName);
      summary = `📡 *New from ${channelName}*\n\n${summary}`;
    } else {
      summary = await summarizeTradingMessages(messages, channelName);
      summary = `📡 *Update from ${channelName}*\n\n${summary}`;
    }

    for (const chatId of authorizedChats) {
      await sendLongMessage(chatId, summary);
      await sleep(200);
    }
  } catch (err) {
    console.error('[Bot] Failed to push trading digest:', err.message);
  }
}

/**
 * Add a chat ID to authorized chats (for push notifications)
 */
function addAuthorizedChat(chatId) {
  authorizedChats.add(chatId);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  initBot,
  getBot,
  pushStarSummary,
  pushTradingDigest,
  addAuthorizedChat,
  sendLongMessage,
};
