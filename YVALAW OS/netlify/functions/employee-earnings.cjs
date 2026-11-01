/**
 * employee-earnings — GET, the signed-in employee (My workspace → My pay, refreshed every minute).
 *
 * Returns the employee's own earnings only — their pay rate and amounts, never bill rates or
 * invoice totals:
 *   { currency, dopRate, today: { seconds, amount },
 *     periods: [{ key, label, schedule, start, end, payday, seconds, premiumSeconds, amount,
 *                 approvedAmount, pendingAmount, payRate, missingRate }],
 *     totals: { seconds, amount, approvedAmount }, paid: [{ payday, netUsd, netDop, paidAt }],
 *     pendingAdjustments: [{ id, type, amount, reason, sequence, total, payday, later }] }
 *
 * pendingAdjustments = this person's bonuses / deductions still waiting for a payday (payroll_adjustments
 * status 'pending'; employees can only read applied ones through RLS). payday = the payroll it is attached to
 * (run_id), else null = the next payday. later = a later row of a repeat (one per repeat group per payday,
 * as payroll.cjs does), so it is not part of the next payday.
 *
 * Amounts come from YVA Time blocks × the pay rate that applied on each day (placement →
 * dated pay rate → employee pay rate), night premium included, plus time YVA adjusted
 * (time_adjustments, once the weekly close exists). "Estimated" = not approved yet.
 */
const { rest, restAll, enc, callerFromEvent, json } = require('./_lib/supa.cjs')
const M = require('./_lib/money.cjs')

async function optional(path) { try { return await rest(path) } catch (e) { if (e.status === 404 || e.status === 400) return []; throw e } }

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })
  try {
    const user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    const [employee] = await rest(`employees?user_id=eq.${enc(user.id)}&select=id,name,pay_rate,role,premium_enabled,premium_percent,premium_start_time,timezone,works_for,pay_schedule,pay_anchor&limit=1`)
    if (!employee) return json(404, { error: 'No employee profile is linked to this login.' })

    // Days and pay periods follow the business time zone (as approvals and payroll do); the night
    // premium uses the person's own zone when their profile has a valid one (money.cjs)
    const [biz] = await rest('settings?id=eq.1&select=business_timezone').catch(() => [{}])
    const tz = M.safeTz(biz?.business_timezone)
    const now = Date.now()
    const today = M.localParts(now, tz).date

    // Projects the employee is on (+ any project with tracked time in the window)
    const allProjects = await rest('projects?select=id,name,client_id,employee_ids,pay_schedule,pay_anchor,status')
    const mine = allProjects.filter(p => Array.isArray(p.employee_ids) && p.employee_ids.includes(employee.id))
    // Earliest possible period start: monthly / semimonthly / biweekly go back at most ~31 days
    const from = M.addDays(today, -32)
    const blocks = await restAll(`tracker_blocks?employee_id=eq.${employee.id}&block_start=gte.${enc(new Date(M.zonedMidnight(from, tz)).toISOString())}` +
      '&select=id,block_start,project_id,work_type,seconds,first_offset,last_offset,status,updated_at&order=block_start')
    const adjustments = await optional(`time_adjustments?employee_id=eq.${employee.id}&day=gte.${from}&select=day,project_id,seconds_delta,status`)
    const rates = await optional(`placement_rates?employee_id=eq.${employee.id}&select=employee_id,project_id,position,pay_rate,effective_from`)
    const [settings] = await rest('settings?id=eq.1&select=usd_to_dop')
    const projectsById = Object.fromEntries(allProjects.map(p => [p.id, p]))

    // Adjustments become synthetic blocks at local noon of their day (premium never applies to them)
    const adjBlocks = adjustments.filter(a => a.status !== 'cancelled').map(a => ({
      block_start: new Date(M.zonedMidnight(a.day, tz) + 12 * 3600_000).toISOString(), seconds: Number(a.seconds_delta) || 0,
      first_offset: null, last_offset: null, project_id: a.project_id, status: 'approved', adjustment: true,
    }))
    const all = [...blocks, ...adjBlocks]
    const dayOf = b => M.localParts(Date.parse(b.block_start), tz).date
    const emp = employee
    // Waiting manual-time requests are not earnings yet; removed/rejected blocks never are
    const money = list => M.blocksMoney({ blocks: list.filter(b => b.status !== 'pending'), employee: emp, projectsById, rates, kind: 'pay', tz })

    const todayMoney = money(all.filter(b => dayOf(b) === today && !b.adjustment))

    // One period per project (its own pay schedule) + the YVA team bucket (employee schedule or weekly)
    const keys = new Set([...mine.map(p => p.id), ...all.filter(b => b.project_id).map(b => b.project_id)])
    if (employee.works_for === 'yva' || all.some(b => !b.project_id)) keys.add('yva')
    const periods = []
    for (const key of keys) {
      const project = key === 'yva' ? null : projectsById[key]
      if (key !== 'yva' && !project) continue
      // Same as payroll: client work follows the project's schedule, YVA-team work the person's own
      const schedule = key === 'yva' ? (employee.pay_schedule || 'weekly') : (project.pay_schedule || 'weekly')
      const anchor = key === 'yva' ? employee.pay_anchor : project.pay_anchor
      const per = M.payPeriod(today, schedule, anchor)
      const inPeriod = all.filter(b => (b.project_id || 'yva') === key && dayOf(b) >= per.start && dayOf(b) <= per.end)
      const m = money(inPeriod)
      const approved = money(inPeriod.filter(b => b.status === 'approved'))
      const rate = M.resolveRates({ employee: emp, project, rates, day: today }).pay.rate
      periods.push({
        key, label: project ? project.name : 'YVA team', schedule: per.schedule, start: per.start, end: per.end, payday: per.payday,
        seconds: m.seconds, premiumSeconds: m.premiumSeconds, amount: m.amount, approvedAmount: approved.amount,
        pendingAmount: M.round2(m.amount - approved.amount), payRate: rate, missingRate: !rate,
      })
    }
    periods.sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label))

    // Bonuses / deductions waiting for a payday (own rows only; never who created them or anyone else's)
    const pendingRows = await optional(`payroll_adjustments?employee_id=eq.${employee.id}&status=eq.pending&select=id,type,amount,reason,sequence,total,run_id,group_id,created_at&order=created_at,id`)
    const runIds = [...new Set(pendingRows.map(a => a.run_id).filter(Boolean))]
    const runs = runIds.length ? await optional(`payroll_runs?id=in.(${runIds.map(enc).join(',')})&select=id,payday`) : []
    const paydayOfRun = Object.fromEntries(runs.map(r => [r.id, r.payday]))
    // A repeat group gives one row per payday: the lowest unattached sequence goes to the next payday unless
    // another row of the group is already attached to an open payroll
    const nextOfGroup = {}
    for (const a of pendingRows) {
      if (!a.group_id) continue
      const g = nextOfGroup[a.group_id] ||= { attached: false, next: null }
      if (a.run_id) g.attached = true
      else if (!g.next || Number(a.sequence) < Number(g.next.sequence)) g.next = a
    }
    const pendingAdjustments = pendingRows.map(a => {
      const g = a.group_id ? nextOfGroup[a.group_id] : null
      const later = !a.run_id && !!g && (g.attached || g.next !== a)
      return { id: a.id, type: a.type === 'deduction' ? 'deduction' : 'bonus', amount: M.round2(Number(a.amount) || 0), reason: a.reason || '',
        sequence: Number(a.sequence) || 1, total: Number(a.total) || 1, payday: a.run_id ? paydayOfRun[a.run_id] ?? null : null, later }
    }).sort((x, y) => Number(x.later) - Number(y.later) || (x.payday || '9999').localeCompare(y.payday || '9999') || x.sequence - y.sequence)

    // Paid history (payroll, once it exists)
    const paid = await optional(`payroll_lines?employee_id=eq.${employee.id}&status=eq.paid&select=payday,net_usd,net_dop,paid_at,run_id&order=payday.desc&limit=12`)

    return json(200, {
      currency: 'USD',
      dopRate: Number(settings?.usd_to_dop) || null,
      today: { date: today, seconds: todayMoney.seconds, amount: todayMoney.amount },
      // the desktop app uploads about once a minute while tracking
      lastActivityAt: blocks.reduce((m, b) => (b.updated_at && b.updated_at > m ? b.updated_at : m), '') || null,
      trackingNow: blocks.some(b => b.updated_at && now - Date.parse(b.updated_at) < 3 * 60_000),
      // what they last worked on (project name or YVA work type), for "Last active … on …"
      lastActivityOn: (() => { const last = blocks.reduce((m, b) => (b.updated_at && (!m || b.updated_at > m.updated_at) ? b : m), null); return last ? (last.project_id ? projectsById[last.project_id]?.name ?? null : last.work_type || null) : null })(),
      periods,
      totals: { seconds: periods.reduce((s, p) => s + p.seconds, 0), amount: M.round2(periods.reduce((s, p) => s + p.amount, 0)), approvedAmount: M.round2(periods.reduce((s, p) => s + p.approvedAmount, 0)) },
      paid: paid.map(p => ({ payday: p.payday, netUsd: Number(p.net_usd), netDop: p.net_dop == null ? null : Number(p.net_dop), paidAt: p.paid_at })),
      pendingAdjustments,
      updatedAt: new Date(now).toISOString(),
    })
  } catch (e) {
    console.error('employee-earnings', e)
    return json(500, { error: 'Could not load your earnings right now.' })
  }
}
