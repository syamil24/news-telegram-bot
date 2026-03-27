require('dotenv').config();
const { initUserbot, listDialogs, listenForNewMessages } = require('./userbot');
const { initBot, pushStarSummary, pushTradingDigest } = require('./bot');
const { isStarUrl } = require('./scraper');

// Pending trading messages buffer (batch them before summarizing)
let tradingBuffer = [];
let tradingBufferTimer = null;
const TRADING_BUFFER_DELAY = 30000; // 30 seconds - batch messages before summarizing

async function main() {
  console.log('===========================================');
  console.log('  The Star & Trading Digest Bot');
  console.log('===========================================');

  // Step 1: Start the Telegram bot (commands + polling)
  const bot = initBot();
  console.log('[Main] Telegram bot initialized.');

  // Step 2: Connect the userbot (personal account to read channels)
  console.log('[Main] Connecting userbot (you may be prompted for OTP)...');
  await initUserbot();

  // Step 3: Discover channel identifiers if not set
  let starChannel = process.env.THE_STAR_CHANNEL;
  let tradingChannel = process.env.NEWBIE_TRADING_CHANNEL;

  if (!starChannel || !tradingChannel) {
    console.log('[Main] Channel names not set. Listing your joined channels...\n');
    const dialogs = await listDialogs();

    console.log('Your joined channels/groups:');
    dialogs.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.name} ${d.username ? '(@' + d.username + ')' : ''} [ID: ${d.id}]`);
    });

    console.log('\n[Main] Please update THE_STAR_CHANNEL and NEWBIE_TRADING_CHANNEL in your .env file');
    console.log('[Main] Use the @username (without @) or the channel ID shown above.');
    console.log('[Main] Then restart the bot.\n');

    // Try auto-detect by name matching
    for (const d of dialogs) {
      const name = d.name.toLowerCase();
      if (!starChannel && (name.includes('star') && (name.includes('news') || name.includes('the star')))) {
        starChannel = d.username || String(d.id);
        console.log(`[Main] Auto-detected The Star channel: ${d.name} -> ${starChannel}`);
      }
      if (!tradingChannel && (name.includes('newbie') || name.includes('trading'))) {
        tradingChannel = d.username || String(d.id);
        console.log(`[Main] Auto-detected Trading channel: ${d.name} -> ${tradingChannel}`);
      }
    }

    if (starChannel) process.env.THE_STAR_CHANNEL = starChannel;
    if (tradingChannel) process.env.NEWBIE_TRADING_CHANNEL = tradingChannel;
  }

  // Step 4: Start listening for new messages
  const channelsToWatch = [];
  if (starChannel) channelsToWatch.push(starChannel);
  if (tradingChannel) channelsToWatch.push(tradingChannel);

  if (channelsToWatch.length === 0) {
    console.warn('[Main] No channels configured. Bot will only respond to commands.');
    console.warn('[Main] Set THE_STAR_CHANNEL and NEWBIE_TRADING_CHANNEL in .env and restart.');
  } else {
    await listenForNewMessages(channelsToWatch, async (message, channelName) => {
      const name = channelName.toLowerCase();
      const isStarChannel = name.includes('star') || channelName === starChannel;
      const isTradingChannel = name.includes('newbie') || name.includes('trading') || channelName === tradingChannel;

      if (isStarChannel) {
        // For The Star channel: extract and summarize Star URLs immediately
        const starUrls = message.urls.filter(isStarUrl);
        for (const url of starUrls) {
          console.log(`[Main] New Star article detected: ${url}`);
          await pushStarSummary(url);
        }
      } else if (isTradingChannel) {
        // For Trading channel: buffer messages and batch-summarize
        tradingBuffer.push(message);
        console.log(`[Main] Trading message buffered (${tradingBuffer.length} pending)`);

        // Reset debounce timer
        if (tradingBufferTimer) clearTimeout(tradingBufferTimer);
        tradingBufferTimer = setTimeout(async () => {
          if (tradingBuffer.length > 0) {
            const batch = [...tradingBuffer];
            tradingBuffer = [];
            console.log(`[Main] Flushing ${batch.length} trading messages to digest...`);
            await pushTradingDigest(batch, channelName);
          }
        }, TRADING_BUFFER_DELAY);
      }
    });

    console.log(`[Main] Listening for new messages in: ${channelsToWatch.join(', ')}`);
  }

  console.log('\n[Main] Bot is running! Send /start to your bot in Telegram to begin.');
  console.log('[Main] Press Ctrl+C to stop.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Main] Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('[Main] Unhandled error:', err.message);
});

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
