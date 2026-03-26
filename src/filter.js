/**
 * filter.js
 * Decides whether a Star article should be summarized or silently skipped.
 *
 * ALWAYS SKIP     → China-related news (checked first, no exceptions)
 * FORCE SUMMARIZE  → geopolitical topics (checked second, overrides remaining skip rules)
 * SKIP categories  → celebrities, stock market daily update, minor accidents,
 *                    minor criminal cases
 * KEEP categories  → knowledge/facts, long articles, major events, economy,
 *                    opinion, travel, tech, and everything else not explicitly skipped
 */

// ─── ALWAYS-SKIP rules (checked FIRST — nothing overrides these) ──────────────

/**
 * If the title matches any of these, always show as headline only.
 * These take priority over everything including geopolitical force-summarize.
 */
const ALWAYS_SKIP_TITLE_KEYWORDS = [
  // China-related news — always headline regardless of topic
  'china ', 'chinese ', 'beijing', 'xi jinping',
  'chinese government', 'chinese communist', 'ccp ', 'prc ',
  'hong kong protest', 'xinjiang', 'tibet',
  'made in china', 'china-made',
];

// ─── FORCE-SUMMARIZE rules (checked second — overrides remaining skip rules) ──

/**
 * If the title or content contains any of these, always summarize
 * regardless of other skip rules.
 */
const FORCE_SUMMARIZE_TITLE_KEYWORDS = [
  // Geopolitical — international relations, conflicts, alliances
  'geopolit',
  'sanctions', 'sanction',
  'trade war', 'trade deal', 'trade dispute',
  'nato', 'un security council', 'united nations',
  'nuclear', 'missile', 'military strike', 'airstrike', 'air strike',
  'invasion', 'occupied', 'occupation', 'ceasefire', 'cease-fire',
  'war crimes', 'genocide',
  'diplomatic', 'diplomacy', 'bilateral', 'multilateral',
  'tariff', 'tariffs', 'embargo', 'blockade',
  'strait of hormuz', 'south china sea', 'taiwan strait',
  'iran', 'israel', 'ukraine', 'russia', 'north korea',
  'middle east', 'gaza', 'palestine', 'hezbollah', 'hamas',
  'trump', 'white house', 'pentagon', 'g7', 'g20', 'brics',
  'imf', 'world bank', 'wto',
];

// ─── SKIP rules ───────────────────────────────────────────────────────────────

/**
 * URL path segments that indicate a skip category.
 * The Star URL structure: thestar.com.my/<section>/<subsection>/...
 */
const SKIP_URL_SEGMENTS = [
  '/entertainment/buzz',        // celebrity buzz
  '/entertainment/people',      // celebrity people
  '/lifestyle/entertainment',   // lifestyle entertainment
  '/showbiz',                   // showbiz
];

/**
 * Keywords checked against article TITLE for skipping.
 * Matched case-insensitively as whole phrases (not substrings of words).
 */
const SKIP_TITLE_KEYWORDS = [
  // Celebrities / entertainment fluff
  'spotted', 'dating', 'breakup', 'engaged', 'marriage rumour',
  'celebrity', 'actress', 'actor leaked', 'singer', 'kpop', 'k-pop',
  'drama cast', 'new song', 'mv released', 'music video',
  'red carpet', 'award show', 'billboard chart',

  // Stock market daily routine updates
  'bursa closes', 'bursa opens', 'klci closes', 'klci opens',
  'market closes higher', 'market closes lower', 'market opens higher',
  'market opens lower', 'ringgit closes', 'ringgit opens',
  'trading at midday', 'midday market', 'bursa at midday',

  // Minor accidents
  'road accident', 'car crash', 'lorry crash', 'motorcycle accident',
  'fatal crash', 'highway accident', 'expressway crash',
  'woman dies in crash', 'man dies in crash', 'cyclist killed',
  'pedestrian killed', 'knocked down', 'hit and run',

  // Suicide / self-harm
  'suicide', 'jumps to death', 'found dead', 'body found',
  'drowned', 'falls to death',

  // Minor crime
  'snatch theft', 'house break-in', 'burglar', 'car theft',
  'robbed at', 'pick pocket', 'scam victim', 'cheated of',
  'remanded for', 'arrested for drug', 'drug trafficking arrest',
  'casino raid', 'vice raid', 'prostitution ring',
];

/**
 * Category metadata (from og:section or breadcrumb) that triggers a skip.
 */
const SKIP_CATEGORIES = [
  'entertainment',
  'showbiz',
  'celebrity',
  'buzz',
];

// ─── Word-count threshold ──────────────────────────────────────────────────────
// Articles shorter than this are likely news-brief / routine updates → skip
const MIN_WORD_COUNT = 110;

// ─── Helper ───────────────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '').toLowerCase().trim();
}

function containsAny(haystack, needles) {
  const h = normalize(haystack);
  return needles.some(n => h.includes(normalize(n)));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Decide how to handle an article.
 *
 * Evaluation order:
 *   1. Always-skip check (China) — overrides everything, even geopolitical
 *   2. Force-summarize check (geopolitical) — overrides remaining skip rules
 *   3. URL segment skip check
 *   4. Category skip check
 *   5. Title keyword skip check
 *   6. Word count check
 *
 * Returns:
 *   { skip: false, action: 'summarize', reason }  — full AI summary
 *   { skip: true,  action: 'headline',  reason }  — title hyperlink only
 *
 * @param {Object} article  { url, title, category, content, wordCount }
 * @returns {{ skip: boolean, action: 'summarize'|'headline', reason: string }}
 */
function shouldSkipArticle(article) {
  const { url = '', title = '', category = '', wordCount = 0 } = article;

  // 1. Always-skip: China-related articles — headline only, no exceptions
  if (containsAny(title, ALWAYS_SKIP_TITLE_KEYWORDS)) {
    const matched = ALWAYS_SKIP_TITLE_KEYWORDS.find(k => normalize(title).includes(normalize(k)));
    return { skip: true, action: 'headline', reason: `Always-skip keyword: "${matched}"` };
  }

  // 2. Force-summarize: geopolitical topics win over all remaining skip rules
  if (containsAny(title, FORCE_SUMMARIZE_TITLE_KEYWORDS)) {
    const matched = FORCE_SUMMARIZE_TITLE_KEYWORDS.find(k => normalize(title).includes(normalize(k)));
    return { skip: false, action: 'summarize', reason: `Force-summarize: geopolitical keyword "${matched}"` };
  }

  // 3. URL path check
  if (containsAny(url, SKIP_URL_SEGMENTS)) {
    return { skip: true, action: 'headline', reason: `URL segment matched skip list` };
  }

  // 4. Category metadata check
  if (containsAny(category, SKIP_CATEGORIES)) {
    return { skip: true, action: 'headline', reason: `Category "${category}" is in skip list` };
  }

  // 5. Title keyword check
  if (containsAny(title, SKIP_TITLE_KEYWORDS)) {
    const matched = SKIP_TITLE_KEYWORDS.find(k => normalize(title).includes(normalize(k)));
    return { skip: true, action: 'headline', reason: `Title matched skip keyword: "${matched}"` };
  }

  // 6. Too short — likely a brief/routine update
  if (wordCount > 0 && wordCount < MIN_WORD_COUNT) {
    return { skip: true, action: 'headline', reason: `Article too short (${wordCount} words < ${MIN_WORD_COUNT})` };
  }

  return { skip: false, action: 'summarize', reason: 'OK' };
}

module.exports = { shouldSkipArticle };

