/**
 * payroll-reminder — Netlify scheduled function, Wednesdays 13:07 UTC (9:07 am Dominican time).
 * Prepares this Friday's payroll (so it's ready to review) and reminds everyone with payroll.manage:
 * "Payroll due Friday Nov 6: 12 people · $2,340". Does nothing if that payroll is already paid.
 */
const { rest } = require('./_lib/supa.cjs')
const M = require('./_lib/money.cjs')
const { preparePayroll, nextFriday } = require('./_lib/payroll.cjs')
const { notifyPermission, dispatchPending } = require('./_lib/notify.cjs')

exports.handler = async function handler() {
  try {
    const payday = nextFriday(M.localParts(Date.now()).date)
    const [run] = await rest(`payroll_runs?payday=eq.${payday}&select=status`)
    if (run?.status === 'paid') return { statusCode: 200, body: 'already paid' }
    const r = await preparePayroll(payday)
    if (!r.totals.people) return { statusCode: 200, body: 'nobody to pay' }
    const label = new Date(`${payday}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
    await notifyPermission('payroll.manage', {
      kind: 'payroll_due',
      title: `Payroll due ${label}: ${r.totals.people} ${r.totals.people === 1 ? 'person' : 'people'} · $${r.totals.netUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      body: `${r.flags.length ? `${r.flags.length} thing${r.flags.length === 1 ? '' : 's'} to check. ` : ''}Enter the exchange rate and mark people paid in YVA OS → Payroll.`,
      link: '/payroll',
    })
    await dispatchPending()
    return { statusCode: 200, body: JSON.stringify(r.totals) }
  } catch (e) {
    console.error('payroll-reminder', e)
    return { statusCode: 500, body: String(e.message || e) }
  }
}
