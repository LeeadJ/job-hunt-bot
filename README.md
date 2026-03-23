# 🤖 Job Hunt Bot — Automated Job Search Pipeline

## Architecture Overview

```
You (Telegram)          Cloud                    Google Sheets
┌──────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Drop a   │────▶│  Telegram Bot     │────▶│ Applications Tab │
│ LinkedIn │     │  (Node.js)       │     │ Auto-populated   │
│ URL      │     │                  │     │ with job data    │
│          │◀────│  Scrapes job     │     │                  │
│ Get      │     │  details via     │     └──────────────────┘
│ summary  │     │  LinkedIn API /  │
│ + action │     │  scraper         │
│ buttons  │     │                  │
└──────────┘     └──────────────────┘
```

### How It Works

1. **You** paste a LinkedIn job URL into your Telegram bot (or a group chat)
2. **The bot** extracts job details: company, title, location, seniority, description
3. **The bot** checks your Google Sheet's Networking tab for contacts at that company
4. **The bot** sends you a clean summary card with:
   - Job details
   - Match score (based on your skills)
   - Known contacts at the company
   - "✅ Apply" / "❌ Skip" / "⭐ Save for Later" buttons
5. **When you tap Apply**: the bot logs it to your Google Sheet and opens the application link
6. **When you tap Skip**: logged as "Skipped" so you don't see it again

### What Gets Automated (saves ~10 min per job)
- ✅ Scraping job details from LinkedIn URLs
- ✅ Logging applications to your spreadsheet
- ✅ Contact lookup (do I know anyone there?)
- ✅ Duplicate detection (already applied?)
- ✅ Follow-up reminders (bot pings you after X days)
- ✅ Weekly stats summary every Sunday

### What Stays Manual (intentionally)
- ❌ Actually clicking "Apply" — you stay in control
- ❌ Writing cover letters
- ❌ Choosing which jobs to pursue

---

## Tech Stack

| Component        | Technology                | Why                                    |
|-----------------|---------------------------|----------------------------------------|
| Bot Framework   | `node-telegram-bot-api`   | Simple, well-documented, async         |
| Job Scraping    | `puppeteer` + `cheerio`   | LinkedIn needs JS rendering            |
| Google Sheets   | `googleapis` (Sheets v4)  | Native API, no third-party wrapper     |
| Scheduler       | `node-cron`               | Follow-up reminders, weekly digest     |
| Runtime         | Node.js 18+               | Matches your backend stack             |
| Hosting         | Railway / Render / VPS    | Free tier works for this scale         |

---

## Prerequisites

Before setup, you need 3 things:

### 1. Telegram Bot Token
1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Name it something like "Job Hunt Bot"
4. Copy the **bot token** (looks like `123456:ABCdef...`)

### 2. Google Sheets API Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., "Job Hunt Bot")
3. Enable the **Google Sheets API**
4. Go to **Credentials** → **Create Credentials** → **Service Account**
5. Download the JSON key file → rename to `credentials.json`
6. Copy the service account email (e.g., `bot@project.iam.gserviceaccount.com`)
7. **Share your Google Sheet** with that email (Editor access)

### 3. Your Google Sheet
- Use the tracker spreadsheet I built for you
- Upload it to Google Sheets
- Copy the **Sheet ID** from the URL:
  `https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit`

---

## Setup

```bash
# Clone / copy the project
cd job-hunt-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your tokens (see above)

# Place your Google credentials file
# Copy credentials.json into the project root

# Start the bot
npm start

# For development (auto-restart on changes)
npm run dev
```

---

## Usage

### Basic Commands

| Command         | What it does                                    |
|----------------|-------------------------------------------------|
| `/start`       | Welcome message + setup check                   |
| `/stats`       | Your current search stats from the sheet        |
| `/remind`      | List jobs you need to follow up on              |
| `/weekly`      | Full weekly digest                              |
| `/contacts`    | Search your networking contacts                 |
| `/help`        | Show all commands                               |

### Adding a Job

Just paste a LinkedIn URL:
```
https://www.linkedin.com/jobs/view/3830678214
```

The bot responds with:

```
🏢 TRAVELFACTORY Lab
💼 Full Stack Engineer
📍 Ra'anana
📋 Seniority: Mid-Level

👥 Known contacts: None found

🔗 Apply: [link]

[✅ Apply] [❌ Skip] [⭐ Save]
```

### Bulk Mode

Paste multiple URLs (one per line) and the bot processes them all:
```
https://www.linkedin.com/jobs/view/123456
https://www.linkedin.com/jobs/view/789012
https://www.linkedin.com/jobs/view/345678
```

---

## Project Structure

```
job-hunt-bot/
├── src/
│   ├── index.js              # Entry point — bot initialization
│   ├── bot/
│   │   ├── handlers.js       # Telegram message & callback handlers
│   │   └── keyboards.js      # Inline keyboard builders
│   ├── scraper/
│   │   └── linkedin.js       # LinkedIn job scraping logic
│   ├── sheets/
│   │   ├── client.js         # Google Sheets API client
│   │   ├── applications.js   # Read/write Applications sheet
│   │   └── networking.js     # Read Networking sheet for contact lookup
│   ├── services/
│   │   ├── jobProcessor.js   # Orchestrates: scrape → enrich → respond
│   │   ├── reminder.js       # Cron-based follow-up reminders
│   │   └── weeklyDigest.js   # Weekly stats summary
│   └── utils/
│       ├── config.js         # Environment config loader
│       └── logger.js         # Simple structured logger
├── .env.example
├── credentials.json          # (gitignored) Google service account key
├── package.json
└── README.md
```

---

## Deployment Options

### Option A: Railway (Recommended — Free Tier)
1. Push to GitHub
2. Connect repo to [Railway](https://railway.app)
3. Add env vars in Railway dashboard
4. Upload `credentials.json` as a secret file
5. Deploy — it runs 24/7

### Option B: Render
Same flow as Railway. Free tier spins down after inactivity but Telegram webhooks wake it up.

### Option C: Your Own VPS
```bash
# Use PM2 for process management
npm install -g pm2
pm2 start src/index.js --name job-bot
pm2 save
pm2 startup
```

---

## Limitations & Honest Notes

- **LinkedIn scraping is fragile.** LinkedIn changes their HTML frequently. The scraper may break and need updating. This is inherent to any LinkedIn scraper. An alternative is using the RapidAPI LinkedIn Jobs API (paid, ~$10/month, but reliable).
- **Rate limiting.** Don't scrape more than ~30 jobs/hour or LinkedIn may temporarily block your IP. The bot has built-in delays.
- **This is a personal tool.** Don't share the bot publicly or use it to scrape at scale. It's for YOUR job search.
