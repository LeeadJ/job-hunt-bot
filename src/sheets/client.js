import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

let sheetsClient = null;

function loadCredentials() {
  // Priority 1: Base64-encoded env var (for cloud deployment)
  if (config.google.credentialsBase64) {
    logger.info('Loading credentials from GOOGLE_CREDENTIALS_BASE64 env var');
    const json = Buffer.from(config.google.credentialsBase64, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  // Priority 2: File on disk (for local development)
  if (existsSync(config.google.credentialsPath)) {
    logger.info('Loading credentials from file', { path: config.google.credentialsPath });
    return JSON.parse(readFileSync(config.google.credentialsPath, 'utf8'));
  }

  throw new Error(
    'No Google credentials found. Set GOOGLE_CREDENTIALS_BASE64 env var or place credentials.json in project root.'
  );
}

export async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  try {
    const credentials = loadCredentials();

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

export async function appendRow(sheetName, row) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'OVERWRITE',
    requestBody: { values: [row] },
  });
  // Extract the row number from the updated range (e.g. "Applications!A5:R5" → 5)
  const updatedRange = res.data.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+)/);
  const rowNumber = match ? parseInt(match[1]) : null;
  logger.info(`Row appended to ${sheetName}`, { company: row[0], row: rowNumber });
  return rowNumber;
}

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
 * Format the company cell (column A) as bold, size 14, centered.
 */
export async function formatCompanyCell(sheetName, rowNumber) {
  const sheets = await getSheetsClient();

  // Get the numeric sheet ID for the tab
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: config.google.sheetId,
    fields: 'sheets.properties',
  });
  const sheet = spreadsheet.data.sheets.find(
    (s) => s.properties.title === sheetName
  );
  const sheetId = sheet?.properties?.sheetId || 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.google.sheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 14 },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields:
              'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
          },
        },
      ],
    },
  });
}

export async function getRowCount(sheetName) {
  const rows = await readRange(`${sheetName}!A:A`);
  return Math.max(0, rows.length - 1);
}