/**
 * Build the action keyboard shown after a job is scraped.
 * @param {string} jobId - LinkedIn job ID (used in callback data)
 */
export function jobActionKeyboard(jobId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Apply', callback_data: `apply:${jobId}` },
        { text: '❌ Skip', callback_data: `skip:${jobId}` },
        { text: '⭐ Save', callback_data: `save:${jobId}` },
      ],
    ],
  };
}

/**
 * Build keyboard for follow-up reminder.
 */
export function followUpKeyboard(sheetRow) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Followed Up', callback_data: `followedup:${sheetRow}` },
        { text: '😴 Snooze 3 Days', callback_data: `snooze:${sheetRow}` },
        { text: '🗑️ Mark Ghosted', callback_data: `ghosted:${sheetRow}` },
      ],
    ],
  };
}

/**
 * Build keyboard asking if the user already applied.
 * @param {number} sheetRow - the row number in the sheet
 */
export function appliedFollowUpKeyboard(sheetRow) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Yes, I applied', callback_data: `applied_yes:${sheetRow}` },
        { text: '🕐 Not yet', callback_data: `applied_no:${sheetRow}` },
      ],
    ],
  };
}

/**
 * Simple confirmation keyboard.
 */
export function confirmKeyboard(action, id) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Yes', callback_data: `confirm_${action}:${id}` },
        { text: '❌ No', callback_data: `cancel:${id}` },
      ],
    ],
  };
}
