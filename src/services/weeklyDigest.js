import cron from 'node-cron';
import { getStats } from '../sheets/applications.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Start the weekly digest cron job.
 * Sends a comprehensive stats summary every Sunday at the configured hour.
 *
 * @param {TelegramBot} bot - the Telegram bot instance
 */
export function startWeeklyDigest(bot) {
  const { weeklyDigestDay, weeklyDigestHour } = config.reminders;

  // Cron: at configured hour on configured day
  cron.schedule(`0 ${weeklyDigestHour} * * ${weeklyDigestDay}`, async () => {
    logger.info('Generating weekly digest');

    try {
      const stats = await getStats();
      const msg = formatDigest(stats);

      await bot.sendMessage(config.telegram.ownerId, msg, {
        parse_mode: 'MarkdownV2',
      });

      logger.info('Weekly digest sent');
    } catch (err) {
      logger.error('Weekly digest failed', { error: err.message });
    }
  });

  logger.info(`Weekly digest cron started (day ${weeklyDigestDay} at ${weeklyDigestHour}:00)`);
}

function formatDigest(stats) {
  const e = escMd; // shorthand

  const lines = [
    '📊 *WEEKLY JOB SEARCH DIGEST*',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `📨 *This Week:* ${e(String(stats.thisWeek))} applications`,
    `📋 *Total All Time:* ${e(String(stats.total))}`,
    '',
    '📈 *Funnel Metrics*',
    `  Response Rate: ${e(stats.responseRate + '%')}`,
    `  Interview Rate: ${e(stats.interviewRate + '%')}`,
    '',
    '📊 *Status Breakdown*',
  ];

  const statusEmojis = {
    Applied: '📨',
    Interview: '🎯',
    Offer: '🎉',
    Rejected: '❌',
    Ghosted: '👻',
    Withdrawn: '🚪',
    Saved: '⭐',
  };

  for (const [status, count] of Object.entries(stats.statusCounts).sort((a, b) => b[1] - a[1])) {
    const emoji = statusEmojis[status] || '•';
    lines.push(`  ${emoji} ${e(status)}: ${count}`);
  }

  lines.push('');
  lines.push('📡 *Top Sources*');
  const sortedSources = Object.entries(stats.sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [source, count] of sortedSources) {
    lines.push(`  • ${e(source)}: ${count}`);
  }

  if (stats.referralCount > 0) {
    lines.push('');
    lines.push(`🤝 *Referrals Used:* ${stats.referralCount}`);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Motivational nudge based on activity
  if (stats.thisWeek === 0) {
    lines.push('⚡ No applications this week — time to get back on it\\!');
  } else if (stats.thisWeek < 5) {
    lines.push('💪 Slow week — try to ramp up next week\\.');
  } else if (stats.thisWeek >= 15) {
    lines.push('🔥 Beast mode\\! Keep this momentum going\\.');
  } else {
    lines.push('✅ Solid week\\. Stay consistent\\.');
  }

  return lines.join('\n');
}

function escMd(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
