import { scrapeJob, extractJobId } from '../scraper/linkedin.js';
import { isDuplicate, logApplication } from '../sheets/applications.js';
import { findContactsAtCompany } from '../sheets/networking.js';
import { logger } from '../utils/logger.js';

// In-memory cache of recently scraped jobs (cleared on restart)
// Key: jobId, Value: scraped job data
const jobCache = new Map();

/**
 * Process a LinkedIn job URL:
 *  1. Scrape job details
 *  2. Check for duplicates
 *  3. Look up contacts at the company
 *  4. Return enriched job data ready for display
 */
export async function processJobUrl(url) {
  const jobId = extractJobId(url);

  // Check cache first
  if (jobId && jobCache.has(jobId)) {
    logger.info('Job found in cache', { jobId });
    return jobCache.get(jobId);
  }

  // Scrape
  const job = await scrapeJob(url);

  // Duplicate check
  const dupeCheck = await isDuplicate(url, job.company, job.title);

  // Contact lookup
  const contacts = await findContactsAtCompany(job.company);

  const enrichedJob = {
    ...job,
    jobId: jobId || 'unknown',
    isDuplicate: dupeCheck.isDupe,
    duplicateReason: dupeCheck.reason || '',
    contacts,
  };

  // Cache it
  if (jobId) {
    jobCache.set(jobId, enrichedJob);
    // Auto-expire cache entries after 1 hour
    setTimeout(() => jobCache.delete(jobId), 3600000);
  }

  return enrichedJob;
}

/**
 * Log a job as "Applied" in the spreadsheet.
 */
export async function markApplied(jobId) {
  const job = jobCache.get(jobId);
  if (!job) throw new Error('Job not in cache — try pasting the URL again');

  const result = await logApplication({
    company: job.company,
    role: job.title,
    seniority: job.seniority,
    location: job.location,
    jobUrl: job.url,
    source: 'LinkedIn',
    referral: job.contacts.length > 0 ? job.contacts[0].name : '-',
    status: '',
    techStack: job.techStack,
    notes: `Via Job Hunt Bot`,
  });

  logger.info('Application logged', { company: job.company, role: job.title });
  return result;
}

/**
 * Log a job as "Waiting for connection" in the spreadsheet.
 */
export async function markWaitingForConnection(jobId) {
  const job = jobCache.get(jobId);
  if (!job) throw new Error('Job not in cache — try pasting the URL again');

  const result = await logApplication({
    company: job.company,
    role: job.title,
    seniority: job.seniority,
    location: job.location,
    jobUrl: job.url,
    source: 'LinkedIn',
    referral: '-',
    status: 'Waiting for connection',
    techStack: job.techStack,
    notes: 'Via Job Hunt Bot',
  });

  logger.info('Job logged as waiting for connection', { company: job.company, role: job.title });
  return result;
}

/**
 * Format a scraped job into a Telegram message.
 */
export function formatJobMessage(job) {
  const lines = [
    `🏢 *${escMd(job.company)}*`,
    `💼 ${escMd(job.title)}`,
    `📍 ${escMd(job.location || 'Not specified')}`,
    `📋 Seniority: ${escMd(job.seniority || 'Unknown')}`,
  ];

  if (job.techStack) {
    lines.push(`🛠️ Stack: ${escMd(job.techStack)}`);
  }

  lines.push('');

  // Duplicate warning
  if (job.isDuplicate) {
    lines.push(`⚠️ *DUPLICATE:* ${escMd(job.duplicateReason)}`);
    lines.push('');
  }

  // Contacts section
  if (job.contacts && job.contacts.length > 0) {
    lines.push(`👥 *Known contacts at ${escMd(job.company)}:*`);
    for (const c of job.contacts.slice(0, 3)) {
      lines.push(`  • ${escMd(c.name)} — ${escMd(c.role)} \\(strength: ${c.strength}/5\\)`);
    }
    lines.push('');
    lines.push('💡 *Tip: Reach out before applying\\!*');
  } else {
    lines.push('👥 No known contacts at this company');
  }

  lines.push('');
  lines.push(`🔗 [Open Job Posting](${escMdUrl(job.url)})`);

  return lines.join('\n');
}

/**
 * Escape special Markdown V2 characters for Telegram.
 */
function escMd(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Escape characters inside a MarkdownV2 inline URL (the part inside parentheses).
 * Only `)` and `\` need escaping inside URL parentheses.
 */
function escMdUrl(url) {
  if (!url) return '';
  return url.replace(/([)\\])/g, '\\$1');
}
