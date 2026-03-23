import { isLinkedInJobUrl, extractUrls } from '../scraper/linkedin.js';
import { processJobUrl, markApplied, markSaved, formatJobMessage } from '../services/jobProcessor.js';
import { getStats, getFollowUpNeeded } from '../sheets/applications.js';
import { updateCell } from '../sheets/client.js';
import { searchContacts } from '../sheets/networking.js';
import { jobActionKeyboard, followUpKeyboard } from './keyboards.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Guard: only allow the bot owner to use the bot.
 */
function isOwner(msg) {
  return msg.from?.id === config.telegram.ownerId;
}

function isOwnerCallback(query) {
  return query.from?.id === config.telegram.ownerId;
}

/**
 * Register all message and callback handlers on the bot instance.
 */
export function registerHandlers(bot) {
  // ─── /start ─────────────────────────────────────────────
  bot.onText(/\/start/, (msg) => {
    if (!isOwner(msg)) return;

    bot.sendMessage(msg.chat.id, [
      '🤖 *Job Hunt Bot is live\\!*',
      '',
      "Drop a LinkedIn job URL and I'll:",
      '• Scrape job details automatically',
      '• Check if you already applied',
      '• Look up contacts at the company',
      '• Log it to your Google Sheet',
      '',
      '*Commands:*',
      '/stats — Your search stats',
      '/remind — Jobs needing follow\\-up',
      '/weekly — Full weekly digest',
      '/contacts \\<name\\> — Search your network',
      '/help — All commands',
      '',
      'Just paste a LinkedIn URL to get started\\!',
    ].join('\n'), { parse_mode: 'MarkdownV2' });
  });

  // ─── /stats ─────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    if (!isOwner(msg)) return;

    try {
      const stats = await getStats();

      const text = [
        '📊 *Your Job Search Stats*',
        '',
        `📨 Total Applications: ${escMd(String(stats.total))}`,
        `📅 This Week: ${escMd(String(stats.thisWeek))}`,
        `📬 Response Rate: ${escMd(stats.responseRate + '%')}`,
        `🎯 Interview Rate: ${escMd(stats.interviewRate + '%')}`,
        `🤝 Referrals Used: ${escMd(String(stats.referralCount))}`,
        '',
        '*By Status:*',
        ...Object.entries(stats.statusCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([s, c]) => `  • ${escMd(s)}: ${c}`),
      ].join('\n');

      bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      logger.error('/stats failed', { error: err.message });
      bot.sendMessage(msg.chat.id, '❌ Failed to fetch stats. Check the logs.');
    }
  });

  // ─── /remind ────────────────────────────────────────────
  bot.onText(/\/remind/, async (msg) => {
    if (!isOwner(msg)) return;

    try {
      const jobs = await getFollowUpNeeded(config.reminders.followUpDays);

      if (jobs.length === 0) {
        bot.sendMessage(msg.chat.id, '✅ No follow-ups needed right now!');
        return;
      }

      bot.sendMessage(msg.chat.id, `📬 *${jobs.length} applications need follow\\-up:*`, {
        parse_mode: 'MarkdownV2',
      });

      for (const job of jobs.slice(0, 10)) {
        const text = `🏢 *${escMd(job.company)}* — ${escMd(job.role)}\n⏰ ${job.daysSince} days ago`;
        await bot.sendMessage(msg.chat.id, text, {
          parse_mode: 'MarkdownV2',
          reply_markup: followUpKeyboard(job.row),
        });
        await delay(300);
      }
    } catch (err) {
      logger.error('/remind failed', { error: err.message });
      bot.sendMessage(msg.chat.id, '❌ Failed to check follow-ups.');
    }
  });

  // ─── /contacts <query> ──────────────────────────────────
  bot.onText(/\/contacts (.+)/, async (msg, match) => {
    if (!isOwner(msg)) return;

    const query = match[1].trim();
    try {
      const contacts = await searchContacts(query);

      if (contacts.length === 0) {
        bot.sendMessage(msg.chat.id, `No contacts found for "${query}"`);
        return;
      }

      const lines = [`👥 *Contacts matching "${escMd(query)}":*`, ''];
      for (const c of contacts) {
        lines.push(`• *${escMd(c.name)}* — ${escMd(c.company)}`);
        lines.push(`  ${escMd(c.role)} \\(strength: ${c.strength}/5\\)`);
      }

      bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'MarkdownV2' });
    } catch (err) {
      logger.error('/contacts failed', { error: err.message });
      bot.sendMessage(msg.chat.id, '❌ Contact search failed.');
    }
  });

  // ─── /weekly ────────────────────────────────────────────
  bot.onText(/\/weekly/, async (msg) => {
    if (!isOwner(msg)) return;
    // Reuse the stats logic
    try {
      const stats = await getStats();
      const text = formatWeeklyText(stats);
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, '❌ Failed to generate weekly digest.');
    }
  });

  // ─── /help ──────────────────────────────────────────────
  bot.onText(/\/help/, (msg) => {
    if (!isOwner(msg)) return;
    bot.sendMessage(msg.chat.id, [
      '*Available Commands:*',
      '',
      '📎 Paste a LinkedIn URL — scrape \\& track a job',
      '/stats — Current search statistics',
      '/remind — Jobs needing follow\\-up',
      '/weekly — Full weekly digest',
      '/contacts \\<name\\> — Search your network',
      '/help — This message',
      '',
      '*Bulk mode:* Paste multiple URLs \\(one per line\\)',
    ].join('\n'), { parse_mode: 'MarkdownV2' });
  });

  // ─── LinkedIn URL Handler (main flow) ──────────────────
  bot.on('message', async (msg) => {
    if (!isOwner(msg)) return;
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return; // skip commands

    const urls = extractUrls(msg.text);
    if (urls.length === 0) return; // not a LinkedIn URL

    // Process each URL
    for (const url of urls) {
      try {
        const statusMsg = await bot.sendMessage(msg.chat.id, '🔍 Scraping job details...');

        const job = await processJobUrl(url);
        const text = formatJobMessage(job);

        // Delete "scraping" message
        await bot.deleteMessage(msg.chat.id, statusMsg.message_id).catch(() => {});

        await bot.sendMessage(msg.chat.id, text, {
          parse_mode: 'MarkdownV2',
          reply_markup: jobActionKeyboard(job.jobId),
          disable_web_page_preview: true,
        });
      } catch (err) {
        logger.error('Job processing failed', { url, error: err.message });
        const errMsg = err.message.length > 300
          ? err.message.slice(0, 300) + '…'
          : err.message;
        bot.sendMessage(msg.chat.id, `❌ Failed to process:\n${url}\n\nError: ${errMsg}`);
      }

      // Delay between multiple jobs
      if (urls.length > 1) await delay(1000);
    }
  });

  // ─── Callback Query Handler (button presses) ──────────
  bot.on('callback_query', async (query) => {
    if (!isOwnerCallback(query)) {
      bot.answerCallbackQuery(query.id, { text: '⛔ Not authorized' });
      return;
    }

    const [action, id] = query.data.split(':');
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    try {
      switch (action) {
        case 'apply': {
          const result = await markApplied(id);
          await bot.answerCallbackQuery(query.id, { text: '✅ Logged as Applied!' });

          // Update the message to show it was applied
          const newText = query.message.text + '\n\n✅ *APPLIED* — logged to your sheet';
          await bot.editMessageText(newText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'MarkdownV2',
          }).catch(() => {});
          break;
        }

        case 'skip': {
          await bot.answerCallbackQuery(query.id, { text: '❌ Skipped' });
          const newText = query.message.text + '\n\n❌ *SKIPPED*';
          await bot.editMessageText(newText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'MarkdownV2',
          }).catch(() => {});
          break;
        }

        case 'save': {
          const result = await markSaved(id);
          await bot.answerCallbackQuery(query.id, { text: '⭐ Saved for later!' });
          const newText = query.message.text + '\n\n⭐ *SAVED* for later';
          await bot.editMessageText(newText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'MarkdownV2',
          }).catch(() => {});
          break;
        }

        case 'followedup': {
          const row = parseInt(id);
          const today = new Date().toLocaleDateString('en-GB');
          await updateCell(`Applications!L${row}`, today);
          await updateCell(`Applications!K${row}`, 'Waiting for response');
          await bot.answerCallbackQuery(query.id, { text: '✅ Follow-up logged!' });
          await bot.editMessageText(
            query.message.text + `\n\n✅ Followed up on ${today}`,
            { chat_id: chatId, message_id: messageId, parse_mode: 'MarkdownV2' }
          ).catch(() => {});
          break;
        }

        case 'snooze': {
          await bot.answerCallbackQuery(query.id, { text: '😴 Snoozed for 3 days' });
          await bot.editMessageText(
            query.message.text + '\n\n😴 Snoozed — will remind again in 3 days',
            { chat_id: chatId, message_id: messageId, parse_mode: 'MarkdownV2' }
          ).catch(() => {});
          break;
        }

        case 'ghosted': {
          const row = parseInt(id);
          await updateCell(`Applications!I${row}`, 'Ghosted');
          await updateCell(`Applications!M${row}`, 'No Response');
          await bot.answerCallbackQuery(query.id, { text: '👻 Marked as Ghosted' });
          await bot.editMessageText(
            query.message.text + '\n\n👻 Marked as Ghosted',
            { chat_id: chatId, message_id: messageId, parse_mode: 'MarkdownV2' }
          ).catch(() => {});
          break;
        }

        default:
          await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
      }
    } catch (err) {
      logger.error('Callback handler failed', { action, id, error: err.message });
      // Telegram limits answerCallbackQuery text to 200 chars
      const errText = err.message.length > 180
        ? err.message.slice(0, 180) + '…'
        : err.message;
      await bot.answerCallbackQuery(query.id, { text: `❌ ${errText}` });
    }
  });

  logger.info('All handlers registered');
}

function formatWeeklyText(stats) {
  const lines = [
    '📊 *WEEKLY DIGEST*',
    '',
    `📨 This Week: ${escMd(String(stats.thisWeek))}`,
    `📋 Total: ${escMd(String(stats.total))}`,
    `📬 Response Rate: ${escMd(stats.responseRate + '%')}`,
    `🎯 Interview Rate: ${escMd(stats.interviewRate + '%')}`,
  ];
  return lines.join('\n');
}

function escMd(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
