import cron from 'node-cron';
import { getFollowUpNeeded } from '../sheets/applications.js';
import { followUpKeyboard } from '../bot/keyboards.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Start the follow-up reminder cron job.
 * Runs daily at 9:00 AM and sends reminders for stale applications.
 *
 * @param {TelegramBot} bot - the Telegram bot instance
 */
export function startReminders(bot) {
  // Daily at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    logger.info('Running daily follow-up check');

    try {
      const needFollowUp = await getFollowUpNeeded(config.reminders.followUpDays);

      if (needFollowUp.length === 0) {
        logger.info('No follow-ups needed today');
        return;
      }

      // Send a summary header
      let msg = `📬 *Follow\\-Up Reminders* — ${needFollowUp.length} applications need attention:\n\n`;

      // Send individual reminders (max 5 per day to avoid spam)
      const toSend = needFollowUp.slice(0, 5);

      for (const job of toSend) {
        const referralNote = job.referral !== '-'
          ? `\n👤 Referral: ${escMd(job.referral)}`
          : '';

        const jobMsg = [
          `🏢 *${escMd(job.company)}* — ${escMd(job.role)}`,
          `⏰ Applied ${job.daysSince} days ago`,
          referralNote,
        ].filter(Boolean).join('\n');

        await bot.sendMessage(config.telegram.ownerId, jobMsg, {
          parse_mode: 'MarkdownV2',
          reply_markup: followUpKeyboard(job.row),
        });

        // Small delay between messages to avoid rate limiting
        await delay(500);
      }

      if (needFollowUp.length > 5) {
        await bot.sendMessage(
          config.telegram.ownerId,
          `\\.\\.\\.and ${needFollowUp.length - 5} more\\. Use /remind to see all\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }
    } catch (err) {
      logger.error('Reminder cron failed', { error: err.message });
    }
  });

  logger.info('Follow-up reminder cron started (daily at 9:00 AM)');
}

function escMd(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
