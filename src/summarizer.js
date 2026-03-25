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
  summarizeTradingMessages,
  summarizeSingleMessage,
};
