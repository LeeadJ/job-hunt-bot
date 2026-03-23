import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

let sheetsClient = null;

/**
 * Initialize the Google Sheets API client using service account credentials.
 * Caches the client so we only auth once.
 */
export async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  try {
    const credentials = JSON.parse(readFileSync(config.google.credentialsPath, 'utf8'));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    sheetsClient = google.sheets({ version: 'v4', auth: authClient });

    logger.info('Google Sheets client initialized');
    return sheetsClient;
  } catch (err) {
    logger.error('Failed to initialize Sheets client', { error: err.message });
    throw err;
  }
}

/**
 * Read a range from the spreadsheet.
 * @param {string} range - e.g. "Applications!A:R" or "Networking!A1:K100"
 * @returns {string[][]} rows of values
 */
export async function readRange(range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

/**
 * Append a row to a sheet.
 * @param {string} sheetName - tab name
 * @param {any[]} row - array of cell values
 */
export async function appendRow(sheetName, row) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  logger.info(`Row appended to ${sheetName}`, { company: row[0] });
}

/**
 * Update a specific cell.
 * @param {string} range - e.g. "Applications!I5"
 * @param {any} value
 */
export async function updateCell(range, value) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

/**
 * Get the number of data rows in a sheet (excluding header).
 */
export async function getRowCount(sheetName) {
  const rows = await readRange(`${sheetName}!A:A`);
  return Math.max(0, rows.length - 1); // subtract header
}
