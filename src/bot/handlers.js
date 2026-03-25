import { extractUrls } from '../scraper/linkedin.js';
import { processJobUrl, markApplied, markWaitingForConnection, formatJobMessage } from '../services/jobProcessor.js';
import { getStats, getFollowUpNeeded } from '../sheets/applications.js';
import { updateCell, formatCompanyCell } from '../sheets/client.js';
import { searchContacts } from '../sheets/networking.js';
import { jobActionKeyboard, followUpKeyboard, appliedFollowUpKeyboard, connectionPromptKeyboard } from './keyboards.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// Track connection flow state per user
// Key: chatId, Value: { rowNumber, connectionCount, connections[], pendingUrl? }
const connectionState = new Map();

// Track jobIds that have already been logged to prevent duplicate rows
const loggedJobs = new Set();

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
  // ─── Set bot commands (shows menu button in Telegram) ───
  bot.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'stats', description: 'Your search stats' },
    { command: 'remind', description: 'Jobs needing follow-up' },
    { command: 'weekly', description: 'Full weekly digest' },
    { command: 'contacts', description: 'Search your network' },
    { command: 'help', description: 'All commands' },
  ]).catch((err) => logger.warn('Failed to set bot commands', { error: err.message }));

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

    // ── Connection flow: intercept text input ──
    const state = connectionState.get(msg.chat.id);
    if (state) {
      const input = msg.text.trim();
      const isUrl = /^https?:\/\//i.test(input);

      if (isUrl) {
        // Try to extract name from LinkedIn profile URL
        const extractedName = extractNameFromLinkedInUrl(input);
        const name = extractedName || input;
        state.connections.push({ name: extractedName || name, url: input });

        // Update column H in sheet
        await updateConnectionsInSheet(state);

        state.connectionCount++;
        await bot.sendMessage(
          msg.chat.id,
          `✅ Added *${escMd(name)}*\n\n👤 *Connection ${state.connectionCount}:* Send a name or profile link`,
          {
            parse_mode: 'MarkdownV2',
            reply_markup: connectionPromptKeyboard(state.rowNumber, true),
          }
        );
      } else {
        // User sent a plain name
        state.connections.push({ name: input, url: null });

        // Update column H in sheet
        await updateConnectionsInSheet(state);

        state.connectionCount++;
        await bot.sendMessage(
          msg.chat.id,
          `✅ Added *${escMd(input)}*\n\n👤 *Connection ${state.connectionCount}:* Send a name or profile link`,
          {
            parse_mode: 'MarkdownV2',
            reply_markup: connectionPromptKeyboard(state.rowNumber, true),
          }
        );
      }
      return;
    }

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
        case 'add': {
          // Prevent duplicate rows
          if (loggedJobs.has(id)) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ Already logged this job' });
            return;
          }

          const result = await markApplied(id);
          loggedJobs.add(id);
          await bot.answerCallbackQuery(query.id, { text: '✅ Logged to your sheet!' });

          // Format company cell (bold, size 14, centered)
          if (result.rowNumber) {
            formatCompanyCell('Applications', result.rowNumber).catch((err) =>
              logger.warn('Failed to format company cell', { error: err.message })
            );
          }

          // Remove buttons from job card
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});

          // Ask follow-up about application status
          if (result.rowNumber) {
            await bot.sendMessage(chatId, '📝 Did you already apply to this position?', {
              reply_markup: appliedFollowUpKeyboard(result.rowNumber),
            });
          }
          break;
        }

        case 'skip': {
          await bot.answerCallbackQuery(query.id, { text: '❌ Skipped' });
          // Just remove buttons — no row added
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
          break;
        }

        case 'waitconn': {
          // Prevent duplicate rows
          if (loggedJobs.has(id)) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ Already logged this job' });
            return;
          }

          const result = await markWaitingForConnection(id);
          loggedJobs.add(id);
          await bot.answerCallbackQuery(query.id, { text: '🤝 Logged — now add connections' });

          // Format company cell (bold, size 14, centered)
          if (result.rowNumber) {
            formatCompanyCell('Applications', result.rowNumber).catch((err) =>
              logger.warn('Failed to format company cell', { error: err.message })
            );
          }

          // Remove buttons from job card
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});

          // Write referral message template — clean the URL to remove tracking params
          const cleanUrl = result.jobUrl.replace(/[?#].*$/, '');
          const referralMsg = `הי מה קורה? שמי ליעד, אני מפתח Backend וראיתי משרה אצלך בחברה שמעניינת אותי. אשמח לשלוח דרכך קו״ח. מעריך מאוד🙏 ${cleanUrl}`;
          await updateCell(`Applications!J${result.rowNumber}`, referralMsg);

          // Start connection flow
          connectionState.set(chatId, {
            rowNumber: result.rowNumber,
            connectionCount: 1,
            connections: [],
            pendingUrl: null,
            referralMsg,
          });

          await bot.sendMessage(
            chatId,
            '👤 *Connection 1:* Send a name or profile link',
            {
              parse_mode: 'MarkdownV2',
              reply_markup: connectionPromptKeyboard(result.rowNumber),
            }
          );
          break;
        }

        case 'conn_skip': {
          const state = connectionState.get(chatId);
          connectionState.delete(chatId);

          if (state && state.connections.length > 0) {
            await bot.answerCallbackQuery(query.id, { text: `✅ ${state.connections.length} connection(s) saved` });
            await bot.editMessageText(
              `✅ ${state.connections.length} connection\\(s\\) added to the sheet`,
              { chat_id: chatId, message_id: messageId, parse_mode: 'MarkdownV2' }
            ).catch(() => {});

            // Send referral message for easy copy-paste
            if (state.referralMsg) {
              await bot.sendMessage(chatId, `📋 *Referral message:*\n\n${escMd(state.referralMsg)}`, {
                parse_mode: 'MarkdownV2',
              });
            }
          } else {
            await bot.answerCallbackQuery(query.id, { text: '⏭️ Skipped' });
            await bot.editMessageText(
              '⏭️ No connections added',
              { chat_id: chatId, message_id: messageId }
            ).catch(() => {});
          }
          break;
        }

        case 'followedup': {
          const row = parseInt(id);
          const today = new Date().toLocaleDateString('en-GB');
          await updateCell(`Applications!N${row}`, today);
          await updateCell(`Applications!M${row}`, 'Waiting for response');
          await bot.answerCallbackQuery(query.id, { text: '✅ Follow-up logged!' });
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
          break;
        }

        case 'snooze': {
          await bot.answerCallbackQuery(query.id, { text: '😴 Snoozed for 3 days' });
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
          break;
        }

        case 'ghosted': {
          const row = parseInt(id);
          await updateCell(`Applications!K${row}`, 'Ghosted');
          await updateCell(`Applications!O${row}`, 'No Response');
          await bot.answerCallbackQuery(query.id, { text: '👻 Marked as Ghosted' });
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
          break;
        }

        case 'applied_yes': {
          const row = parseInt(id);
          await updateCell(`Applications!K${row}`, 'Applied');
          await bot.answerCallbackQuery(query.id, { text: '✅ Status set to Applied' });
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
          break;
        }

        case 'applied_no': {
          await bot.answerCallbackQuery(query.id, { text: '👍 Got it' });
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId },
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

/**
 * Extract a person's name from a LinkedIn profile URL.
 * e.g. https://www.linkedin.com/in/michal-fingerut/ → "Michal Fingerut"
 */
function extractNameFromLinkedInUrl(url) {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!match) return null;
  return match[1]
    .replace(/\/$/, '')
    .split('-')
    .filter((w) => !/^\d+$/.test(w)) // remove numeric ID suffixes
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Update column H (Referral Contact) with the current list of connections.
 * Names with URLs become hyperlinks, plain names stay as text.
 */
async function updateConnectionsInSheet(state) {
  let value;

  if (state.connections.length === 1 && state.connections[0].url) {
    // Single connection with URL — clickable hyperlink
    value = `=HYPERLINK("${state.connections[0].url}","${state.connections[0].name}")`;
  } else {
    // Multiple connections — plain text, each on its own line
    value = state.connections.map((c) => {
      return c.url ? `- ${c.name}\n  ${c.url}` : `- ${c.name}`;
    }).join('\n\n');
  }

  await updateCell(`Applications!I${state.rowNumber}`, value);
}
