# The Star & Trading Digest Bot

A Node.js Telegram bot that monitors The Star news channel and a trading channel, then delivers AI-powered summaries directly to your Telegram chat.

## Features

- Reads The Star (`@thestar_official`) and Newbie Trading Channel using a personal Telegram account (userbot)
- Scrapes full article content from `thestar.com.my` (with login for paywall bypass)
- Summarizes articles using Groq AI (Llama 3.3-70b)
- Smart filtering — skips irrelevant articles, shows them as headline hyperlinks instead
- Tracks seen articles across restarts so you never get duplicate summaries
- Real-time push when new articles are posted to the channel
- Test mode for tuning filters without affecting production state

## Tech Stack

- **Runtime**: Node.js
- **Telegram userbot**: [GramJS](https://github.com/gram-js/gramjs) (`telegram` npm package)
- **Telegram bot**: `node-telegram-bot-api`
- **AI**: [Groq](https://groq.com/) — `llama-3.3-70b-versatile` with fallback to `llama3-8b-8192`
- **Scraping**: `axios` + `cheerio`

## Project Structure

```
src/
├── index.js        # Main entry point
├── userbot.js      # Personal Telegram account reader (GramJS)
├── scraper.js      # The Star login + article scraper
├── summarizer.js   # Groq AI summarizer
├── filter.js       # Smart article filter
├── seen.js         # Seen article persistence (seen.json)
└── bot.js          # Telegram bot commands + real-time push
```

## Setup

### 1. Clone and install

```bash
git clone https://github.com/syamil24/news-telegram-bot.git
cd news-telegram-bot
npm install
```

### 2. Configure environment

Copy the example below into a `.env` file in the project root:

```env
# Telegram Bot (from @BotFather)
TELEGRAM_BOT_TOKEN=your_bot_token

# Telegram Userbot (from https://my.telegram.org)
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash

# Groq API Key (from https://console.groq.com)
GROQ_API_KEY=your_groq_api_key

# The Star website credentials (for paywall bypass)
THESTAR_EMAIL=your_email
THESTAR_PASSWORD=your_password

# Telegram channel usernames (without @)
THE_STAR_CHANNEL=thestar_official
NEWBIE_TRADING_CHANNEL=newbietradingchannel

# Set to 'true' to re-fetch latest articles ignoring seen history (for testing)
# Set to 'false' for normal production behaviour
TEST_MODE=false
```

### 3. Run

```bash
npm start
```

On first run you will be prompted for your Telegram phone number and OTP. The session is saved to `session.txt` so you only need to do this once.

### 4. Start the bot

Send `/start` to your bot in Telegram.

## Bot Commands

| Command       | Description                                            |
| ------------- | ------------------------------------------------------ |
| `/star`       | Fetch and summarize new articles from The Star channel |
| `/star 30`    | Scan last 30 messages instead of the default 20        |
| `/trading`    | Get AI market digest from the trading channel          |
| `/trading 30` | Digest last 30 trading messages                        |
| `/latest`     | Quick digest from both channels                        |
| `/channels`   | Show configured channel names                          |
| `/help`       | Show help message                                      |

## Article Filtering

Articles are evaluated in this order:

1. **Always skip** (shown as headline hyperlink) — China-related news
2. **Always summarize** — geopolitical topics (sanctions, trade wars, conflicts, Iran, Israel, Ukraine, Russia, Trump, etc.)
3. **Skip** — celebrities, daily Bursa/KLCI open-close, minor road accidents, suicides, petty crime
4. **Skip** — articles under 85 words (too short to be meaningful)
5. Everything else — summarized

Skipped articles are not discarded. They appear grouped at the bottom as tap-to-read headline hyperlinks.

## Deployment

Requires a persistent server (not serverless). Recommended options:

- **Railway** — easiest cloud deploy, free tier available
- **VPS** (DigitalOcean, Hetzner, Contabo) — most reliable, ~$4-6/mo
- **Oracle Cloud Free Tier** — permanently free VPS

Run with [PM2](https://pm2.keymetrics.io/) to keep the process alive:

```bash
npm install -g pm2
pm2 start src/index.js --name news-bot
pm2 save
pm2 startup
```

## Notes

- `session.txt` and `seen.json` are git-ignored — never commit them
- `.env` is git-ignored — never commit it
- The bot uses long polling, not webhooks — no public URL required
