import 'dotenv/config';

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key, fallback) => process.env[key] || fallback;

export const config = {
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    ownerId: Number(required('TELEGRAM_OWNER_ID')),
  },
  google: {
    sheetId: required('GOOGLE_SHEET_ID'),
    credentialsPath: optional('GOOGLE_CREDENTIALS_PATH', './credentials.json'),
  },
  sheets: {
    applications: optional('SHEET_APPLICATIONS', 'Applications'),
    networking: optional('SHEET_NETWORKING', 'Networking'),
  },
  scraping: {
    delayMs: Number(optional('SCRAPE_DELAY_MS', '3000')),
    maxPerHour: Number(optional('MAX_SCRAPES_PER_HOUR', '30')),
  },
  reminders: {
    followUpDays: Number(optional('FOLLOWUP_DAYS', '7')),
    weeklyDigestDay: Number(optional('WEEKLY_DIGEST_DAY', '0')), // 0 = Sunday
    weeklyDigestHour: Number(optional('WEEKLY_DIGEST_HOUR', '10')),
  },
  rapidApi: {
    key: optional('RAPIDAPI_KEY', ''),
  },
};
