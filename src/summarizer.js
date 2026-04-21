const Groq = require('groq-sdk');

// llama-3.3-70b-versatile: best quality on Groq free tier
// fallback: llama3-8b-8192 (faster, lighter)
const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama3-8b-8192';

let groqClient = null;

/**
 * Get or initialise the Groq client
 */
function getClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

/**
 * Core wrapper — tries primary model, falls back on rate-limit / error
 */
async function callGroq(systemPrompt, userPrompt, maxTokens = 700) {
  const client = getClient();

  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt  },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      });
      return response.choices[0].message.content.trim();
    } catch (err) {
      const isRateLimit = err.status === 429 || (err.message && err.message.includes('rate'));
      console.warn(`[AI] Model ${model} failed (${err.status || err.message}). ${isRateLimit && model === PRIMARY_MODEL ? 'Falling back...' : ''}`);
      if (!isRateLimit || model === FALLBACK_MODEL) throw err;
      // brief pause before fallback
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

/**
 * Summarize a The Star news article into a clean Telegram-friendly digest.
 * @param {Object} article  { title, author, date, category, content, url }
 * @returns {string}
 */
async function summarizeStarArticle(article) {
  const systemPrompt =
    'You are a professional news summarizer. Always respond in English. ' +
    'Be concise, factual, and informative. Use plain Telegram-compatible Markdown ' +
    '(*bold* and bullet points only — no #headings, no underscores for bold).';

  const userPrompt =
`Summarize the news article below for a Telegram message.

Title   : ${article.title}
Author  : ${article.author  || 'Not specified'}
Date    : ${article.date    || 'Not specified'}
Category: ${article.category || 'General'}

Content:
${article.content}

Use EXACTLY this format (no extra sections):

📰 *${article.title}*
📅 ${article.date || 'N/A'} | 🏷️ ${article.category || 'General'}${article.author ? `\n✍️ ${article.author}` : ''}

📝 *Summary:*
• [key fact 1]
• [key fact 2]
• [key fact 3]
• [key fact 4 if needed]

💡 *Key Takeaway:*
[One sentence on why this matters]

Keep total length under 350 words. No financial advice.`;

  try {
    return await callGroq(systemPrompt, userPrompt, 600);
  } catch (err) {
    console.error('[AI] summarizeStarArticle failed:', err.message);
    // Graceful fallback — return a basic card
    return (
      `📰 *${article.title}*\n` +
      `📅 ${article.date || 'N/A'} | 🏷️ ${article.category || 'General'}\n\n` +
      `${article.content.substring(0, 400)}...\n\n` +
      `🔗 [Read full article](${article.url})`
    );
  }
}

/**
 * AI-driven filter + summarize in a single Groq call.
 *
 * The model decides whether the article is worth reading and, if so,
 * returns a formatted summary. If not, it returns a SKIP decision with
 * a short reason so the article can be shown as a headline-only link.
 *
 * Return value is always an object:
 *   { skip: true,  reason: string }                  — show as headline link
 *   { skip: false, summary: string }                  — send full summary
 *
 * @param {Object} article  { title, author, date, category, content, url, wordCount }
 * @returns {{ skip: boolean, reason?: string, summary?: string }}
 */
async function filterAndSummarizeStarArticle(article) {
  const systemPrompt =
`You are a smart news curator and summarizer for a busy Malaysian reader who wants to stay informed on what truly matters.

Your job is BOTH to decide whether an article deserves a full summary AND to write that summary if it does.

━━━ SKIP THESE (return DECISION: SKIP) ━━━

China / Chinese politics:
  Any news primarily about China, the Chinese government, Beijing leadership, Xi Jinping, the CCP, PRC foreign policy, Hong Kong protests, Xinjiang, Tibet, or products labelled "Made in China" / "China-made".

Celebrity & entertainment fluff:
  Celebrity spotted / dating / breakup / engaged / marriage rumours, K-pop or K-drama cast news, singer or actor personal life stories, music video releases, red carpet events, award shows, Billboard chart updates, showbiz gossip.

Daily stock market routine:
  Bursa opens/closes, KLCI opens/closes higher or lower, ringgit opens/closes, midday market updates — these are routine price-ticker reports with no analytical value.

Minor local accidents:
  Road accidents, car / lorry / motorcycle crashes, highway or expressway accidents, cyclists or pedestrians killed in traffic incidents.

Suicide & self-harm reports:
  Person jumps to death, body found, drowned, falls to death, suicide reports.

Petty / minor crime:
  Snatch theft, house break-ins, burglary, car theft, robbery of individuals, pickpocketing, drug trafficking arrests, casino raids, vice raids, prostitution rings — unless the story exposes a systemic issue.

Weather reports:
  Weather forecasts, rainfall updates, flood warnings, haze readings, wind advisories — routine meteorological reports with no broader news significance.

Very short news briefs:
  Articles under 85 words that are routine updates with no substantive new information.

━━━ ALWAYS SUMMARIZE THESE (return DECISION: SUMMARIZE) ━━━

Even if an article touches on a normally-skipped category, summarize it if it involves:
• Geopolitical events: wars, invasions, military strikes, airstrikes, ceasefires, war crimes, genocide, nuclear threats, missile tests
• International relations: sanctions, trade wars, trade deals, tariffs, embargoes, blockades, diplomatic talks, bilateral or multilateral agreements
• Key geopolitical actors: Iran, Israel, Ukraine, Russia, North Korea, Gaza, Palestine, Hezbollah, Hamas, Taiwan
• Global hotspots: South China Sea, Taiwan Strait, Strait of Hormuz
• Major institutions & leaders: NATO, UN Security Council, IMF, World Bank, WTO, G7, G20, BRICS, Trump, White House, Pentagon
• Malaysian economics & policy: Budget, EPF, Bank Negara, interest rates, major government policy, GLC announcements
• Science, technology, environment, education, public health (non-routine), and well-researched opinion/editorial pieces

━━━ RESPONSE FORMAT — follow EXACTLY, no extra text before or after ━━━

If skipping:
DECISION: SKIP
REASON: <one short phrase explaining why>

If summarizing:
DECISION: SUMMARIZE
📰 *<Title>*
📅 <Date> | 🏷️ <Category>
✍️ <Author>

📝 *Summary:*
• <key fact 1>
• <key fact 2>
• <key fact 3>
• <key fact 4 if needed>

💡 *Key Takeaway:*
<One sentence on why this matters>

Rules: respond in English only. Use *bold* and bullet points only — no #headings, no underscores for bold. Keep summaries under 350 words. No financial advice.`;

  const userPrompt =
`Evaluate and optionally summarize the article below.

Title   : ${article.title}
Author  : ${article.author   || 'Not specified'}
Date    : ${article.date     || 'Not specified'}
Category: ${article.category || 'General'}
Words   : ${article.wordCount || 'Unknown'}

Content:
${article.content}`;

  let raw;
  try {
    raw = await callGroq(systemPrompt, userPrompt, 700);
  } catch (err) {
    console.error('[AI] filterAndSummarizeStarArticle failed:', err.message);
    // On total AI failure fall back to a basic card (safe — show content)
    return {
      skip: false,
      summary: (
        `📰 *${article.title}*\n` +
        `📅 ${article.date || 'N/A'} | 🏷️ ${article.category || 'General'}\n\n` +
        `${article.content.substring(0, 400)}...\n\n` +
        `🔗 [Read full article](${article.url})`
      ),
    };
  }

  // ── Parse the structured response ──────────────────────────────────────────
  const firstLine = raw.split('\n')[0].trim();

  if (firstLine.startsWith('DECISION: SKIP')) {
    // Extract reason from second line if present
    const reasonLine = raw.split('\n').find(l => l.startsWith('REASON:'));
    const reason = reasonLine ? reasonLine.replace('REASON:', '').trim() : 'AI filtered';
    console.log(`[AI Filter] SKIP — ${article.title} — ${reason}`);
    return { skip: true, reason };
  }

  if (firstLine.startsWith('DECISION: SUMMARIZE')) {
    // Strip the decision line; the rest is the formatted summary
    const summary = raw.split('\n').slice(1).join('\n').trim();
    console.log(`[AI Filter] SUMMARIZE — ${article.title}`);
    return { skip: false, summary };
  }

  // ── Fallback: malformed response — default to summarize (safe) ─────────────
  console.warn(`[AI Filter] Unexpected response format for "${article.title}" — defaulting to summarize`);
  return { skip: false, summary: raw };
}

/**
 * Digest a batch of trading channel messages.
 * @param {Array}  messages      [{ text, date }]
 * @param {string} channelName
 * @returns {string}
 */
async function summarizeTradingMessages(messages, channelName) {
  const systemPrompt =
    'You are a financial market analyst assistant. ' +
    'Summarize trading channel content objectively and educationally. ' +
    'Never give direct financial advice. Use plain Telegram Markdown.';

  const combinedText = messages
    .map(m => {
      const ts = m.date ? `[${m.date.toLocaleString()}]` : '';
      return `${ts} ${m.text}`.trim();
    })
    .join('\n\n')
    .substring(0, 6000);

  const userPrompt =
`Below are recent messages from the Telegram channel "${channelName}".

${combinedText}

Produce a market digest using EXACTLY this format:

📊 *${channelName} — Market Digest*
🕐 Based on last ${messages.length} message(s)

📈 *Market Highlights:*
• [highlight 1]
• [highlight 2]
• [highlight 3]

🔔 *Key Signals & Alerts:*
• [signal 1]
• [signal 2]

🌍 *Market Sentiment:* [Bullish / Bearish / Neutral — 1-2 sentences]

⚠️ *Notable Risks / News:*
• [risk or news item]

💬 *Other Mentions:*
• [any tips, tools, or resources]

Keep total length under 450 words. Be objective.`;

  try {
    return await callGroq(systemPrompt, userPrompt, 750);
  } catch (err) {
    console.error('[AI] summarizeTradingMessages failed:', err.message);
    return (
      `📊 *${channelName} Digest*\n\n` +
      `⚠️ AI summary unavailable. Recent messages:\n\n` +
      `${combinedText.substring(0, 500)}...`
    );
  }
}

/**
 * Summarize a single trading message in 2-3 sentences.
 * @param {string} text
 * @param {string} channelName
 * @returns {string}
 */
async function summarizeSingleMessage(text, channelName) {
  const systemPrompt =
    'You are a concise trading/market assistant. ' +
    'Summarize in 2-3 sentences. Be factual and neutral.';

  const userPrompt =
    `Summarize this message from "${channelName}" in 2-3 sentences:\n\n${text.substring(0, 2000)}`;

  try {
    return await callGroq(systemPrompt, userPrompt, 120);
  } catch (err) {
    console.error('[AI] summarizeSingleMessage failed:', err.message);
    return text.substring(0, 200);
  }
}

module.exports = {
  summarizeStarArticle,
  filterAndSummarizeStarArticle,
  summarizeTradingMessages,
  summarizeSingleMessage,
};
