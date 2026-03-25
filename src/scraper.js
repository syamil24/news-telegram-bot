const axios = require('axios');
const cheerio = require('cheerio');

// Cookie jar to persist login session
let cookieJar = {};
let isLoggedIn = false;

/**
 * Build a cookie header string from the jar
 */
function buildCookieHeader() {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Parse Set-Cookie headers and store in jar
 */
function parseCookies(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return;
  setCookie.forEach((cookie) => {
    const [pair] = cookie.split(';');
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      cookieJar[key.trim()] = value.trim();
    }
  });
}

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Extract CSRF token from The Star page HTML.
 * It lives in window.Laravel = {"csrfToken":"..."} and also in <meta name="csrf-token">
 */
function extractCsrfToken(html) {
  // Try window.Laravel JS object first
  const laravelMatch = html.match(/window\.Laravel\s*=\s*\{[^}]*"csrfToken"\s*:\s*"([^"]+)"/);
  if (laravelMatch) return laravelMatch[1];

  // Fall back to meta tag
  const metaMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
  if (metaMatch) return metaMatch[1];

  return '';
}

/**
 * Login to The Star website using stored credentials.
 * The Star uses POST /login (Laravel-style) with email, password, _token (CSRF).
 */
async function loginToTheStar() {
  if (isLoggedIn) return true;

  const email = process.env.THESTAR_EMAIL;
  const password = process.env.THESTAR_PASSWORD;

  if (!email || !password) {
    console.warn('[Scraper] No Star credentials found, scraping without login.');
    return false;
  }

  try {
    console.log('[Scraper] Logging in to The Star...');

    // Step 1: GET /login to obtain fresh CSRF token + session cookie
    const loginPageRes = await axios.get('https://www.thestar.com.my/login', {
      headers: BASE_HEADERS,
      maxRedirects: 5,
      timeout: 15000,
    });

    parseCookies(loginPageRes.headers);
    const csrfToken = extractCsrfToken(loginPageRes.data);

    if (!csrfToken) {
      console.warn('[Scraper] Could not find CSRF token on login page, attempting login anyway.');
    }

    // Step 2: POST /login — same endpoint the browser form uses
    const loginRes = await axios.post(
      'https://www.thestar.com.my/login',
      new URLSearchParams({
        email,
        password,
        remember: '1',
        _token: csrfToken,
      }).toString(),
      {
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': buildCookieHeader(),
          'Referer': 'https://www.thestar.com.my/login',
          'Origin': 'https://www.thestar.com.my',
        },
        maxRedirects: 5,
        timeout: 15000,
        validateStatus: (s) => s < 500,
      }
    );

    parseCookies(loginRes.headers);

    // Verify login success — authenticated users get redirected away from /login
    // and the response body will NOT contain the login form
    const loggedIn = !loginRes.data.includes('<form action="/login"') &&
                     (loginRes.status === 200 || loginRes.status === 302);

    if (loggedIn) {
      isLoggedIn = true;
      console.log('[Scraper] Logged in to The Star successfully.');
    } else {
      console.warn('[Scraper] Login may have failed (wrong credentials or CAPTCHA). Scraping without auth.');
    }

    return isLoggedIn;
  } catch (err) {
    console.warn('[Scraper] Login to The Star failed:', err.message, '- continuing without auth.');
    return false;
  }
}

/**
 * Scrape article content from a thestar.com.my URL
 * @param {string} url - full article URL
 * @returns {Object} { title, author, date, content, imageUrl, url }
 */
async function scrapeArticle(url) {
  // Only handle thestar.com.my URLs
  if (!url.includes('thestar.com.my')) {
    return null;
  }

  try {
    await loginToTheStar();

    const res = await axios.get(url, {
      headers: {
        ...BASE_HEADERS,
        'Cookie': buildCookieHeader(),
        'Referer': 'https://www.thestar.com.my/',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    parseCookies(res.headers);
    const $ = cheerio.load(res.data);

    // Extract article title — og:title is most reliable; h1 can contain sidebar junk
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('h1.headline').text().trim() ||
      $('h1[class*="title"]').text().trim() ||
      $('h1').first().text().trim() ||
      'Untitled';

    // Extract author
    const author =
      $('span.author').text().trim() ||
      $('div.author-name').text().trim() ||
      $('[class*="author"]').first().text().trim() ||
      $('meta[name="author"]').attr('content') ||
      '';

    // Extract published date
    const date =
      $('time').attr('datetime') ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('span.date').text().trim() ||
      '';

    // Extract article body - try multiple selectors used by The Star
    let content = '';
    const bodySelectors = [
      'div.story-body',
      'div#story-body',
      'div.article-body',
      'div[class*="article-content"]',
      'div[class*="story-content"]',
      'article',
    ];

    for (const selector of bodySelectors) {
      const el = $(selector);
      if (el.length) {
        // Remove ads, scripts, related articles
        el.find('script, style, .advertisement, .related-articles, .social-share, .tags, iframe').remove();
        content = el.text().replace(/\s+/g, ' ').trim();
        if (content.length > 200) break;
      }
    }

    // Fallback: grab all paragraph text from main content area
    if (content.length < 200) {
      const paragraphs = [];
      $('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) paragraphs.push(text);
      });
      content = paragraphs.join('\n\n');
    }

    // Extract featured image
    const imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('figure img').first().attr('src') ||
      '';

    // Extract section/category
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('nav.breadcrumb a').last().text().trim() ||
      '';

    return {
      url,
      title: title.replace(/\n/g, ' ').trim(),
      author: author.replace(/\n/g, ' ').trim(),
      date,
      category,
      content: content.substring(0, 8000), // Cap at 8000 chars for AI input
      imageUrl,
      wordCount: content.split(/\s+/).length,
    };
  } catch (err) {
    console.error(`[Scraper] Failed to scrape ${url}:`, err.message);
    return null;
  }
}

/**
 * Check if a URL is a valid The Star article URL
 */
function isStarUrl(url) {
  return url && url.includes('thestar.com.my') && !url.endsWith('thestar.com.my/') && !url.includes('/tag/');
}

module.exports = {
  scrapeArticle,
  isStarUrl,
  loginToTheStar,
};
