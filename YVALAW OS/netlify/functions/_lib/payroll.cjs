/**
 * Payroll (PLAN.md Step 6). preparePayroll(payday) builds the Friday payroll:
 *   • every person × project (or YVA team) whose pay period ends so that its payday is this Friday
 *     (weekly / biweekly / quincena / monthly — the project's schedule, or the person's for the YVA team)
 *   • hours = APPROVED YVA Time blocks + YVA's adjustments; pay rate on each day (placement → dated →
 *     base) + night premium; time not approved yet is flagged, not paid
 *   • bonuses / deductions: each pending one is attached to this payroll (one per repeat group),
 *     used up when the person is marked paid (payroll_mark_paid)
 *   • flags (info only): hours not approved, missing pay rate, no bank / PayPal details, net below zero,
 *     client hasn't paid for these hours yet
 * Paid lines are never changed. Preparing again updates the rest.
 */
const { rest, enc } = require('./supa.cjs')
const M = require('./money.cjs')

async function optional(path) { try { return await rest(path) } catch (e) { if (e.status === 404 || e.status === 400) return []; throw e } }
const hmText = s => { const m = Math.round(Math.abs(s) / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }

/** Pay periods of a schedule that are paid on this Friday */
function periodsForPayday(payday, schedule, anchor) {
  const out = []
  for (let i = 1; i <= 7; i++) {
    const end = M.addDays(payday, -i)
    const p = M.payPeriod(end, schedule, anchor)
    if (p.end === end && p.payday === payday) out.push(p)
  }
  return out
}

/** The next payday (Friday) on or after a date */
function nextFriday(date) { return M.addDays(date, (5 - M.weekdayOf(date) + 7) % 7) }

async function preparePayroll(payday, { by = null } = {}) {
  if (M.weekdayOf(payday) !== 5) throw new Error('Payday must be a Friday')
  const [settings] = await rest('settings?id=eq.1&select=business_timezone').catch(() => [{}])
  const tz = settings?.business_timezone || M.DEFAULT_TZ
  const from = M.addDays(payday, -40)
  const fromIso = new Date(M.zonedMidnight(from, tz)).toISOString(), toIso = new Date(M.zonedMidnight(payday, tz)).toISOString()

  let [run] = await rest(`payroll_runs?payday=eq.${payday}&select=*`)
  if (!run) [run] = await rest('payroll_runs?on_conflict=payday', { method: 'POST', prefer: 'return=representation,resolution=merge-duplicates', body: { payday } })

  const [employees, projects, clients, rates, blocks, adjustments, existing, pendingAdj, payouts, invoices] = await Promise.all([
    rest('employees?select=id,name,user_id,works_for,pay_rate,premium_enabled,premium_percent,premium_start_time,timezone,pay_schedule,pay_anchor,status'),
    rest('projects?select=id,name,client_id,pay_schedule,pay_anchor'),
    rest('clients?select=id,name'),
    optional('placement_rates?select=employee_id,project_id,position,bill_rate,pay_rate,effective_from'),
    rest(`tracker_blocks?block_start=gte.${enc(fromIso)}&block_start=lt.${enc(toIso)}&status=in.(tracked,approved)&select=employee_id,block_start,project_id,seconds,first_offset,last_offset,status&limit=200000`),
    optional(`time_adjustments?day=gte.${from}&day=lt.${payday}&status=eq.applied&select=employee_id,project_id,day,seconds_delta`),
    rest(`payroll_lines?run_id=eq.${run.id}&select=*`),
    rest(`payroll_adjustments?or=(status.eq.pending,run_id.eq.${run.id})&status=neq.cancelled&select=*&order=sequence`),
    optional('employee_payout_methods?select=employee_id,method'),
    optional(`invoices?status=in.(sent,viewed,overdue,partial)&billing_end=gte.${from}&select=number,client_id,client_name,billing_start,billing_end,status`),
  ])
  const projById = Object.fromEntries(projects.map(p => [p.id, p]))
  const clientById = Object.fromEntries(clients.map(c => [c.id, c]))
  const empById = Object.fromEntries(employees.map(e => [e.id, e]))
  const dayOf = (b, e) => M.localParts(Date.parse(b.block_start), e.timezone || tz).date
  const flags = []

  // person → bucket → items
  const lines = []
  const byEmp = new Map()
  for (const b of blocks) { if (!byEmp.has(b.employee_id)) byEmp.set(b.employee_id, []); byEmp.get(b.employee_id).push(b) }
  const adjByEmp = new Map()
  for (const a of adjustments) { if (!adjByEmp.has(a.employee_id)) adjByEmp.set(a.employee_id, []); adjByEmp.get(a.employee_id).push(a) }

  for (const emp of employees) {
    const bl = byEmp.get(emp.id) || [], ad = adjByEmp.get(emp.id) || []
    if (!bl.length && !ad.length) continue
    const e = { ...emp, timezone: emp.timezone || tz }
    const keys = new Set([...bl.map(b => b.project_id || 'yva'), ...ad.map(a => a.project_id || 'yva')])
    for (const key of keys) {
      const project = key === 'yva' ? null : projById[key]
      if (key !== 'yva' && !project) continue
      const schedule = emp.pay_schedule || project?.pay_schedule || 'weekly'
      const anchor = emp.pay_schedule ? emp.pay_anchor : project?.pay_anchor
      for (const per of periodsForPayday(payday, schedule, anchor)) {
        const inP = d => d >= per.start && d <= per.end
        const mine = bl.filter(b => (b.project_id || 'yva') === key && inP(dayOf(b, e)))
        const approved = mine.filter(b => b.status === 'approved')
        const unapproved = mine.filter(b => b.status === 'tracked').reduce((s, b) => s + (Number(b.seconds) || 0), 0)
        const adj = ad.filter(a => (a.project_id || 'yva') === key && inP(a.day)).map(a => ({
          block_start: new Date(M.zonedMidnight(a.day, tz) + 12 * 3600_000).toISOString(), seconds: Number(a.seconds_delta), first_offset: null, last_offset: null, project_id: a.project_id, status: 'approved' }))
        if (unapproved > 0) flags.push({ kind: 'unapproved', employeeId: emp.id, employeeName: emp.name, seconds: unapproved,
          message: `${emp.name}: ${hmText(unapproved)} on ${project ? project.name : 'YVA team'} not approved yet — not included (approve the week first)` })
        if (!approved.length && !adj.length) continue
        const m = M.blocksMoney({ blocks: [...approved, ...adj], employee: e, projectsById: projById, clientsById: clientById, rates, kind: 'pay', tz })
        const g = m.byProject[key] || { rates: [0], missingRate: true }
        const latestRate = M.resolveRates({ employee: e, project, rates, day: per.end }).pay.rate
        if (g.missingRate) flags.push({ kind: 'missing_rate', employeeId: emp.id, employeeName: emp.name, message: `${emp.name} has no pay rate on ${project ? project.name : 'YVA team work'} — paid $0` })
        lines.push({
          employee_id: emp.id, project_id: project ? project.id : null, label: project ? project.name : 'YVA team', schedule: per.schedule,
          period_start: per.start, period_end: per.end, payday, regular_seconds: m.seconds - m.premiumSeconds, premium_seconds: m.premiumSeconds,
          pay_rate: latestRate, rates: g.rates, premium_percent: emp.premium_enabled ? M.num(emp.premium_percent) : 0, gross_usd: m.amount,
        })
        // Info: the client hasn't paid for these hours yet
        if (project?.client_id) {
          const unpaid = invoices.filter(i => i.client_id === project.client_id && i.billing_start <= per.end && i.billing_end >= per.start)
          if (unpaid.length) flags.push({ kind: 'client_unpaid', employeeId: emp.id, employeeName: emp.name,
            message: `${clientById[project.client_id]?.name ?? 'The client'} hasn't paid ${unpaid.map(i => i.number).join(', ')} yet (covers ${emp.name}'s hours) — payroll is not held back` })
        }
      }
    }
  }

  // Bonuses / deductions: one per repeat group per payroll; people without hours get a line of their own.
  // Groups already used on this payday, and people already fully paid on it, get nothing more here.
  const usedGroups = new Set(pendingAdj.filter(a => a.status === 'applied' && a.run_id === run.id).map(a => a.group_id || a.id))
  const paidHere = new Set(existing.filter(x => x.status === 'paid').map(x => x.employee_id))
  const stillPending = new Set(existing.filter(x => x.status === 'pending').map(x => x.employee_id))
  const fullyPaid = id => paidHere.has(id) && !stillPending.has(id) && !lines.some(l => l.employee_id === id && !existing.some(x => x.status === 'paid' && x.employee_id === id && (x.project_id || null) === (l.project_id || null) && x.period_start === l.period_start))
  const chosen = new Map()
  for (const a of pendingAdj.filter(x => x.status === 'pending' && !usedGroups.has(x.group_id || x.id) && !fullyPaid(x.employee_id))) {
    const k = a.group_id || a.id
    const cur = chosen.get(k)
    if (!cur || a.sequence < cur.sequence || (a.run_id === run.id && cur.run_id !== run.id)) chosen.set(k, a)
  }
  const attach = [...chosen.values()]
  const adjTotal = new Map()
  for (const a of attach) adjTotal.set(a.employee_id, (adjTotal.get(a.employee_id) || 0) + (a.type === 'bonus' ? 1 : -1) * Number(a.amount))
  const isPaidLine = l => existing.some(x => x.status === 'paid' && x.employee_id === l.employee_id && (x.project_id || null) === (l.project_id || null) && x.period_start === l.period_start)
  for (const [empId, total] of adjTotal) {
    let mine = lines.filter(l => l.employee_id === empId && !isPaidLine(l))
    if (!mine.length) {
      const emp = empById[empId]; if (!emp) continue
      const per = M.payPeriod(M.addDays(payday, -5), 'weekly')
      lines.push({ employee_id: empId, project_id: null, label: 'Bonus / deduction', schedule: 'weekly', period_start: per.start, period_end: per.end, payday,
        regular_seconds: 0, premium_seconds: 0, pay_rate: 0, rates: [], premium_percent: 0, gross_usd: 0 })
      mine = lines.filter(l => l.employee_id === empId && !isPaidLine(l))
    }
    mine.sort((a, b) => b.gross_usd - a.gross_usd)[0].adjustments_usd = M.round2(total)
  }
  for (const l of lines) {
    l.adjustments_usd = l.adjustments_usd || 0
    l.net_usd = M.round2(l.gross_usd + l.adjustments_usd)
    if (l.net_usd < 0) flags.push({ kind: 'negative', employeeId: l.employee_id, employeeName: empById[l.employee_id]?.name, message: `${empById[l.employee_id]?.name}: deductions are more than the pay (${l.net_usd.toFixed(2)} USD)` })
  }
  const withPayout = new Set(payouts.map(p => p.employee_id))
  for (const empId of new Set(lines.map(l => l.employee_id))) if (!withPayout.has(empId)) {
    flags.push({ kind: 'no_payout', employeeId: empId, employeeName: empById[empId]?.name, message: `${empById[empId]?.name}: no bank or PayPal details saved (employee profile → Payout)` })
  }

  // Save: never touch paid lines; update / insert / remove pending ones
  const keyOf = l => `${l.employee_id}|${l.project_id || ''}|${l.period_start}`
  const paidKeys = new Set(existing.filter(x => x.status === 'paid').map(keyOf))
  const wanted = lines.filter(l => !paidKeys.has(keyOf(l)))
  for (const l of wanted) {
    const prev = existing.find(x => x.status === 'pending' && keyOf(x) === keyOf(l))
    if (prev) await rest(`payroll_lines?id=eq.${prev.id}&status=eq.pending`, { method: 'PATCH', body: l })
    else await rest('payroll_lines', { method: 'POST', body: { run_id: run.id, ...l } })
  }
  const wantedKeys = new Set(wanted.map(keyOf))
  for (const x of existing) if (x.status === 'pending' && !wantedKeys.has(keyOf(x))) await rest(`payroll_lines?id=eq.${x.id}&status=eq.pending`, { method: 'DELETE' })
  // attach chosen adjustments to this run; release the others that were attached before
  const keepIds = new Set(attach.filter(a => lines.some(l => l.employee_id === a.employee_id)).map(a => a.id))
  for (const a of pendingAdj.filter(x => x.status === 'pending')) {
    if (keepIds.has(a.id) && a.run_id !== run.id) await rest(`payroll_adjustments?id=eq.${a.id}&status=eq.pending`, { method: 'PATCH', body: { run_id: run.id } })
    if (!keepIds.has(a.id) && a.run_id === run.id) await rest(`payroll_adjustments?id=eq.${a.id}&status=eq.pending`, { method: 'PATCH', body: { run_id: null } })
  }
  await rest(`payroll_runs?id=eq.${run.id}`, { method: 'PATCH', body: { flags, prepared_at: new Date().toISOString(), prepared_by: by } })
  const all = await rest(`payroll_lines?run_id=eq.${run.id}&select=*`)
  return { runId: run.id, payday, exchangeRate: run.exchange_rate, lines: all, flags,
    totals: { people: new Set(all.map(l => l.employee_id)).size, netUsd: M.round2(all.reduce((s, l) => s + Number(l.net_usd), 0)) } }
}

module.exports = { preparePayroll, periodsForPayday, nextFriday }
