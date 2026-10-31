/**
 * week-close-scheduled — Netlify scheduled function, Monday 04:05 UTC = Monday 12:05 am in the
 * Dominican Republic (right after the week closes at midnight Sunday; see netlify.toml).
 * Prepares last week's draft invoices, flags and payroll preview, then notifies everyone with
 * the weekly_close.manage permission (bell + email + phone): "7 invoices ready ($12,340) · 3 things to check".
 */
const { prepareWeek, lastWeekStart } = require('./_lib/weekclose.cjs')
const { notifyPermission, dispatchPending } = require('./_lib/notify.cjs')

const money = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

exports.handler = async function handler() {
  try {
    const r = await prepareWeek(lastWeekStart())
    const s = r.summary
    await notifyPermission('weekly_close.manage', {
      kind: 'week_ready',
      title: `Weekly close: ${s.invoices} invoice${s.invoices === 1 ? '' : 's'} ready (${money(s.total)})${s.flags ? ` · ${s.flags} thing${s.flags === 1 ? '' : 's'} to check` : ''}`,
      body: `${s.label}. Payroll for these hours: ${money(s.payrollTotal)}. Review, approve and send in YVA OS → Weekly close.`,
      link: '/weekly-close',
    })
    await dispatchPending()
    return { statusCode: 200, body: JSON.stringify(s) }
  } catch (e) {
    console.error('week-close-scheduled', e)
    try {
      await notifyPermission('weekly_close.manage', { kind: 'week_ready', title: 'Weekly close could not be prepared', body: String(e.message || e).slice(0, 500), link: '/weekly-close' })
      await dispatchPending()
    } catch { /* nothing more to do */ }
    return { statusCode: 500, body: String(e.message || e) }
  }
}
