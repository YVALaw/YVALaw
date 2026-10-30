/**
 * Escape text before inserting it into HTML we build as a string
 * (invoice/statement print windows, previews and email attachments).
 * Names, notes and addresses must never be able to add tags or scripts.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
