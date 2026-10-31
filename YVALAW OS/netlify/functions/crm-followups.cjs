/**
 * crm-followups — Netlify scheduled function, daily 12:17 UTC (8:17 am Dominican time).
 * Reminds each lead owner of follow-ups due today or overdue (lead next follow-up date, or an
 * open follow-up activity). Leads without an owner go to everyone with leads.manage.
 */
const { rest, usersWithPermission } = require('./_lib/supa.cjs')
const M = require('./_lib/money.cjs')
const { notify, dispatchPending } = require('./_lib/notify.cjs')

exports.handler = async function handler() {
  try {
    const today = M.localParts(Date.now()).date
    const [leads, acts] = await Promise.all([
      rest(`leads?next_follow_up=lte.${today}&stage=not.in.(won,lost)&select=id,name,owner_id,next_follow_up`),
      rest(`lead_activities?kind=eq.follow_up&done_at=is.null&due_on=lte.${today}&select=lead_id,body,due_on`),
    ])
    const actLeadIds = [...new Set(acts.map(a => a.lead_id))].filter(id => !leads.some(l => l.id === id))
    const extra = actLeadIds.length ? await rest(`leads?id=in.(${actLeadIds.join(',')})&stage=not.in.(won,lost)&select=id,name,owner_id,next_follow_up`) : []
    const due = [...leads, ...extra]
    if (!due.length) return { statusCode: 200, body: 'nothing due' }
    const managers = await usersWithPermission('leads.manage')
    const byUser = new Map()
    for (const l of due) for (const u of (l.owner_id ? [l.owner_id] : managers)) byUser.set(u, [...(byUser.get(u) || []), l.name])
    for (const [u, names] of byUser) {
      await notify(u, { kind: 'followup_due', title: `${names.length} lead follow-up${names.length === 1 ? '' : 's'} due today`, body: names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : ''), link: '/leads' })
    }
    await dispatchPending()
    return { statusCode: 200, body: JSON.stringify({ users: byUser.size, leads: due.length }) }
  } catch (e) {
    console.error('crm-followups', e)
    return { statusCode: 500, body: String(e.message || e) }
  }
}
