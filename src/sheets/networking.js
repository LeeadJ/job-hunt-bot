import { readRange } from './client.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const SHEET = config.sheets.networking;

// Column mapping for Networking sheet (0-indexed)
const COL = {
  NAME: 0,
  COMPANY: 1,
  ROLE: 2,
  HOW_CONNECTED: 3,
  LINKEDIN: 4,
  EMAIL: 5,
  LAST_CONTACT: 6,
  STRENGTH: 7,
  REFERRAL_GIVEN: 8,
  FOLLOWUP_NEEDED: 9,
  NOTES: 10,
};

/**
 * Find contacts who work at a given company.
 * Uses fuzzy matching (case-insensitive, partial match).
 *
 * @param {string} company - company name to search for
 * @returns {Array<{name, role, strength, email, linkedin}>}
 */
export async function findContactsAtCompany(company) {
  try {
    const rows = await readRange(`${SHEET}!A2:K500`);
    const searchTerm = company.toLowerCase().trim();
    const matches = [];

    for (const row of rows) {
      const contactCompany = (row[COL.COMPANY] || '').toString().toLowerCase().trim();
      if (!contactCompany) continue;

      // Fuzzy match: either contains or is contained
      const isMatch =
        contactCompany.includes(searchTerm) ||
        searchTerm.includes(contactCompany);

      if (isMatch) {
        matches.push({
          name: row[COL.NAME] || 'Unknown',
          role: row[COL.ROLE] || '',
          strength: row[COL.STRENGTH] || '?',
          email: row[COL.EMAIL] || '',
          linkedin: row[COL.LINKEDIN] || '',
        });
      }
    }

    return matches;
  } catch (err) {
    logger.error('Contact search failed', { company, error: err.message });
    return [];
  }
}

/**
 * Search contacts by name (for /contacts command).
 */
export async function searchContacts(query) {
  try {
    const rows = await readRange(`${SHEET}!A2:K500`);
    const searchTerm = query.toLowerCase().trim();

    return rows
      .filter((row) => {
        const name = (row[COL.NAME] || '').toString().toLowerCase();
        const company = (row[COL.COMPANY] || '').toString().toLowerCase();
        return name.includes(searchTerm) || company.includes(searchTerm);
      })
      .map((row) => ({
        name: row[COL.NAME] || 'Unknown',
        company: row[COL.COMPANY] || '',
        role: row[COL.ROLE] || '',
        strength: row[COL.STRENGTH] || '?',
      }))
      .slice(0, 10); // limit results
  } catch (err) {
    logger.error('Contact search failed', { error: err.message });
    return [];
  }
}
