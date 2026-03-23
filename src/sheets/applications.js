import { readRange, appendRow, updateCell } from './client.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const SHEET = config.sheets.applications;

// Column mapping for the Applications sheet (0-indexed)
const COL = {
  COMPANY: 0,      // A
  ROLE: 1,         // B
  SENIORITY: 2,    // C
  LOCATION: 3,     // D
  DATE_APPLIED: 4, // E
  JOB_LINK: 5,     // F
  SOURCE: 6,       // G
  REFERRAL: 7,     // H
  STATUS: 8,       // I
  STAGE: 9,        // J
  NEXT_ACTION: 10, // K
  FOLLOWUP: 11,    // L
  REJ_REASON: 12,  // M
  DAYS_SINCE: 13,  // N (formula)
  SALARY: 14,      // O
  TECH_STACK: 15,  // P
  COMPANY_SIZE: 16,// Q
  NOTES: 17,       // R
};

/**
 * Check if a job URL or company+role combo already exists in the sheet.
 * Prevents duplicate applications.
 */
export async function isDuplicate(jobUrl, company, role) {
  try {
    const rows = await readRange(`${SHEET}!A2:F1000`);

    for (const row of rows) {
      // Check by URL (most reliable)
      if (jobUrl && row[COL.JOB_LINK] && row[COL.JOB_LINK].toString().includes(jobUrl)) {
        return { isDupe: true, reason: 'Same job URL already in sheet' };
      }
      // Check by company + role
      const existingCompany = (row[COL.COMPANY] || '').toString().toLowerCase();
      const existingRole = (row[COL.ROLE] || '').toString().toLowerCase();
      if (
        existingCompany === company.toLowerCase() &&
        existingRole === role.toLowerCase()
      ) {
        return { isDupe: true, reason: `Already applied to ${company} — ${role}` };
      }
    }
    return { isDupe: false };
  } catch (err) {
    logger.error('Duplicate check failed', { error: err.message });
    return { isDupe: false }; // fail open — let them add it
  }
}

/**
 * Log a new job application to the sheet.
 */
export async function logApplication({
  company,
  role,
  seniority = '',
  location = '',
  jobUrl = '',
  source = '',
  referral = '-',
  status = 'Applied',
  techStack = '',
  notes = '',
}) {
  const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY

  const row = [
    company,
    role,
    seniority,
    location,
    today,
    jobUrl,
    source,
    referral,
    status,
    '',          // Interview Stage
    'Wait for response', // Next Action
    '',          // Follow-up Date
    '',          // Rejection Reason
    '',          // Days Since (formula in sheet)
    '',          // Salary
    techStack,
    '',          // Company Size
    notes,
  ];

  await appendRow(SHEET, row);
  return { company, role, date: today };
}

/**
 * Get stats for the dashboard / weekly digest.
 */
export async function getStats() {
  const rows = await readRange(`${SHEET}!A2:N1000`);
  const dataRows = rows.filter((r) => r[COL.COMPANY]); // non-empty rows

  const total = dataRows.length;
  const statusCounts = {};
  const sourceCounts = {};
  let referralCount = 0;

  for (const row of dataRows) {
    const status = (row[COL.STATUS] || 'Unknown').toString();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const source = (row[COL.SOURCE] || 'Unknown').toString();
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    const referral = (row[COL.REFERRAL] || '-').toString();
    if (referral !== '-' && referral !== '' && referral.toLowerCase() !== 'no') {
      referralCount++;
    }
  }

  // This week's applications
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Sunday
  weekStart.setHours(0, 0, 0, 0);

  let thisWeek = 0;
  for (const row of dataRows) {
    const dateStr = (row[COL.DATE_APPLIED] || '').toString();
    if (!dateStr) continue;
    // Parse DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const d = new Date(parts[2], parts[1] - 1, parts[0]);
      if (d >= weekStart) thisWeek++;
    }
  }

  const interviews = statusCounts['Interview'] || 0;
  const offers = statusCounts['Offer'] || 0;
  const rejected = statusCounts['Rejected'] || 0;
  const ghosted = statusCounts['Ghosted'] || 0;
  const responded = interviews + offers + rejected;

  return {
    total,
    thisWeek,
    statusCounts,
    sourceCounts,
    referralCount,
    responseRate: total > 0 ? ((responded / total) * 100).toFixed(1) : '0',
    interviewRate: total > 0 ? ((interviews / total) * 100).toFixed(1) : '0',
  };
}

/**
 * Get jobs that need follow-up (applied > N days ago, still "Applied" status).
 */
export async function getFollowUpNeeded(days = 7) {
  const rows = await readRange(`${SHEET}!A2:N1000`);
  const now = new Date();
  const needFollowUp = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = (row[COL.STATUS] || '').toString();
    if (status !== 'Applied') continue;

    const dateStr = (row[COL.DATE_APPLIED] || '').toString();
    if (!dateStr) continue;

    const parts = dateStr.split('/');
    if (parts.length !== 3) continue;

    const applied = new Date(parts[2], parts[1] - 1, parts[0]);
    const daysSince = Math.floor((now - applied) / (1000 * 60 * 60 * 24));

    if (daysSince >= days) {
      needFollowUp.push({
        row: i + 2, // sheet row (1-indexed + header)
        company: row[COL.COMPANY] || 'Unknown',
        role: row[COL.ROLE] || 'Unknown',
        daysSince,
        referral: row[COL.REFERRAL] || '-',
      });
    }
  }

  return needFollowUp.sort((a, b) => b.daysSince - a.daysSince);
}
