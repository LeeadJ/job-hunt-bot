import TelegramBot from 'node-telegram-bot-api';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { getSheetsClient } from './sheets/client.js';
import { registerHandlers } from './bot/handlers.js';
import { startReminders } from './services/reminder.js';
import { startWeeklyDigest } from './services/weeklyDigest.js';

async function main() {
  logger.info('Starting Job Hunt Bot...');

  // ── 1. Verify Google Sheets connection ──────────────────
  try {
    await getSheetsClient();
    logger.info('✅ Google Sheets connected');
  } catch (err) {
    logger.error('❌ Google Sheets connection failed — check credentials.json and GOOGLE_SHEET_ID');
    process.exit(1);
  }

  // ── 2. Initialize Telegram Bot ──────────────────────────
  const bot = new TelegramBot(config.telegram.token, { polling: true });

  // Verify bot is working
  const me = await bot.getMe();
  logger.info(`✅ Telegram bot connected as @${me.username}`);

  // ── 3. Register message handlers ────────────────────────
  registerHandlers(bot);

  // ── 4. Start cron jobs ──────────────────────────────────
  startReminders(bot);
  startWeeklyDigest(bot);

  // ── 5. Notify owner that bot is live ────────────────────
  try {
    await bot.sendMessage(
      config.telegram.ownerId,
      '🟢 Job Hunt Bot is online\\! Paste a LinkedIn job URL to get started\\.',
      { parse_mode: 'MarkdownV2' }
    );
  } catch (err) {
    logger.warn('Could not send startup message — make sure TELEGRAM_OWNER_ID is correct');
  }

  // ── 6. Graceful shutdown ────────────────────────────────
  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down`);
    bot.stopPolling();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('🚀 Bot is running. Waiting for messages...');
}

main().catch((err) => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
