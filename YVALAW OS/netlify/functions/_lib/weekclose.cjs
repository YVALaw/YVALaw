/**
 * Weekly close (PLAN.md Step 4). Prepares a Monday–Sunday week (business time zone):
 *   • one combined DRAFT invoice per client — every person grouped by project, daily hours,
 *     their bill rate (placement → project → client default), exact minutes, night premium as
 *     its own line, due date from the client's payment terms, numbered per client (HAL-0001)
 *   • flags (never blocking): no time on a shift day, over 50 h, activity under 30 %, work
 *     outside shift hours, missing screenshots, missing rates, client without email, manual
 *     time requests waiting, time uploaded after the close, sent invoices that no longer match
 *   • a payroll preview (pay chain, per person)
 * Preparing again is safe: drafts of that week are updated in place (same numbers), sent
 * invoices are never changed. Approval is a separate SQL function (week_close_approve).
 */
const { rest, restAll, rpc, enc } = require('./supa.cjs')
const M = require('./money.cjs')

const FLAG_ORDER = ['missing_rate', 'project_no_client', 'client_no_email', 'invoice_locked', 'late', 'manual_pending', 'no_time', 'over_50h', 'low_activity', 'outside_shift', 'missing_screenshots']
const hmText = s => { const m = Math.round(Math.abs(s) / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
const hoursToHM = s => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }
async function optional(path) { try { return await rest(path) } catch (e) { if (e.status === 404 || e.status === 400) return []; throw e } }
function termsDays(terms) {
  const t = String(terms || '').toLowerCase()
  const m = t.match(/(\d+)/)
  if (/receipt|immediate|due now/.test(t)) return 0
  return m ? Math.min(120, Number(m[1])) : 7
}
function prettyRange(a, b) {
  const f = (d, o) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o })
  return `${f(a, { month: 'short', day: 'numeric' })} – ${f(b, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

/** The last finished Monday–Sunday week, in the business time zone */
function lastWeekStart(now = Date.now(), tz = M.DEFAULT_TZ) {
  const today = M.localParts(now, tz).date
  return M.addDays(M.mondayOf(today), -7)
}

async function loadContext(weekStart) {
  const [settings] = await rest('settings?id=eq.1&select=business_timezone,company_name,usd_to_dop').catch(() => [{}])
  const tz = settings?.business_timezone || M.DEFAULT_TZ
  const weekEnd = M.addDays(weekStart, 6)
  const from = new Date(M.zonedMidnight(weekStart, tz)).toISOString()
  const to = new Date(M.zonedMidnight(M.addDays(weekEnd, 1), tz)).toISOString()
  const [employees, projects, clients, rates, blocks, adjustments, shots, manual, closeRows, timeOff] = await Promise.all([
    rest('employees?select=id,name,email,user_id,role,works_for,pay_rate,premium_enabled,premium_percent,premium_start_time,timezone,default_shift_start,default_shift_end,status'),
    rest('projects?select=id,name,client_id,rate,employee_ids,status'),
    rest('clients?select=id,name,email,address,default_rate,payment_terms'),
    optional('placement_rates?select=employee_id,project_id,position,bill_rate,pay_rate,effective_from'),
    restAll(`tracker_blocks?block_start=gte.${enc(from)}&block_start=lt.${enc(to)}&select=id,employee_id,block_start,project_id,work_type,seconds,active_seconds,first_offset,last_offset,status,created_at`),
    optional(`time_adjustments?day=gte.${weekStart}&day=lte.${weekEnd}&status=eq.applied&select=id,employee_id,project_id,work_type,day,seconds_delta,kind,note,created_at`),
    restAll(`tracker_screenshots?block_start=gte.${enc(from)}&block_start=lt.${enc(to)}&select=id,employee_id,block_start`).catch(e => { if (e.status === 404 || e.status === 400) return []; throw e }),
    optional(`manual_time_requests?status=eq.pending&starts_at=lt.${enc(to)}&ends_at=gt.${enc(from)}&select=id,employee_id,starts_at,ends_at`),
    rest(`week_closes?week_start=eq.${weekStart}&select=*`),
    optional(`time_off_requests?status=eq.approved&start_date=lte.${weekEnd}&end_date=gte.${weekStart}&select=employee_id,start_date,end_date`),
  ])
  return { tz, weekStart, weekEnd, from, to, settings: settings || {}, employees, projects, clients, rates, blocks, adjustments, shots, manual, close: closeRows[0] || null, timeOff }
}

/** Pure: build invoices, flags, payroll preview from loaded rows (unit-testable) */
function buildWeek(ctx) {
  const { tz, weekStart, weekEnd, employees, projects, clients, rates } = ctx
  const empById = Object.fromEntries(employees.map(e => [e.id, e]))
  const projById = Object.fromEntries(projects.map(p => [p.id, p]))
  const clientById = Object.fromEntries(clients.map(c => [c.id, c]))
  const days = Array.from({ length: 7 }, (_, i) => M.addDays(weekStart, i))
  const dayOf = b => M.localParts(Date.parse(b.block_start), tz).date
  const flags = []
  const flag = f => flags.push(f)
  const live = ctx.blocks.filter(b => ['tracked', 'approved'].includes(b.status))
  const firstPrepared = ctx.close?.summary?.firstPreparedAt ? Date.parse(ctx.close.summary.firstPreparedAt) : null

  // ── Invoice lines: client → employee/project/rate → per-day seconds (regular / premium)
  const groups = new Map()
  const lineFor = (clientId, emp, project, day) => {
    const client = clientById[clientId]
    const r = M.resolveRates({ employee: emp, project, client, rates, day })
    const key = `${clientId}|${emp.id}|${project.id}|${r.bill.rate}|${r.pay.rate}`
    let g = groups.get(key)
    if (!g) {
      g = { clientId, emp, project, billRate: r.bill.rate, payRate: r.pay.rate, position: r.position, regular: {}, premium: {} }
      groups.set(key, g)
      if (!r.bill.rate) flag({ kind: 'missing_rate', employeeId: emp.id, employeeName: emp.name, projectId: project.id, message: `${emp.name} has no bill rate on ${project.name} — billed at $0` })
      if (!r.pay.rate) flag({ kind: 'missing_rate', employeeId: emp.id, employeeName: emp.name, projectId: project.id, message: `${emp.name} has no pay rate on ${project.name}` })
    }
    return g
  }
  const noClient = new Map()
  for (const b of live) {
    if (!b.project_id) continue
    const emp = empById[b.employee_id], project = projById[b.project_id]
    if (!emp || !project) continue
    if (!project.client_id || !clientById[project.client_id]) { noClient.set(project.id, (noClient.get(project.id) || 0) + (Number(b.seconds) || 0)); continue }
    const day = dayOf(b)
    const g = lineFor(project.client_id, emp, project, day)
    const prem = M.premiumSeconds(b, emp, tz)
    g.regular[day] = (g.regular[day] || 0) + (Number(b.seconds) || 0) - prem
    if (prem) g.premium[day] = (g.premium[day] || 0) + prem
  }
  for (const a of ctx.adjustments) {
    if (!a.project_id) continue
    const emp = empById[a.employee_id], project = projById[a.project_id]
    if (!emp || !project || !project.client_id || !clientById[project.client_id]) continue
    const g = lineFor(project.client_id, emp, project, a.day)
    const delta = Number(a.seconds_delta) || 0
    if (delta >= 0) { g.regular[a.day] = (g.regular[a.day] || 0) + delta; continue }
    // Removing time: off that day's regular time first, then its night-premium time (never below zero)
    const fromReg = Math.min(g.regular[a.day] || 0, -delta)
    g.regular[a.day] = (g.regular[a.day] || 0) - fromReg
    if (g.premium[a.day]) g.premium[a.day] = Math.max(0, g.premium[a.day] - (-delta - fromReg))
  }
  for (const [pid, sec] of noClient) flag({ kind: 'project_no_client', projectId: pid, seconds: sec, message: `${projById[pid].name} has ${hmText(sec)} of time but no client — not invoiced` })

  const invoices = new Map()
  for (const g of groups.values()) {
    const client = clientById[g.clientId]
    const inv = invoices.get(g.clientId) || { client, items: [], subtotal: 0, seconds: 0, projects: new Set() }
    invoices.set(g.clientId, inv)
    inv.projects.add(g.project.name)
    const pct = g.emp.premium_enabled ? M.num(g.emp.premium_percent) : 0
    // Whole minutes per day: the invoice shows h:mm per day and in total, and the amount is
    // exactly hours shown × rate shown (no hidden seconds or unrounded premium rate)
    const minutes = o => Object.fromEntries(Object.entries(o).map(([d, v]) => [d, Math.max(0, Math.round(v / 60))]).filter(([, m]) => m > 0))
    const regM = minutes(g.regular), premM = minutes(g.premium)
    const sum = o => Object.values(o).reduce((s, v) => s + v, 0)
    const regMin = sum(regM), premMin = sum(premM)
    const daily = o => Object.fromEntries(Object.entries(o).map(([d, m]) => [d, `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`]))
    const premRate = M.round2(g.billRate * (1 + pct / 100))
    const regAmount = M.round2((regMin / 60) * g.billRate), premAmount = M.round2((premMin / 60) * premRate)
    if (regMin > 0) inv.items.push({
      employeeId: g.emp.id, employeeName: g.emp.name, position: [g.position, g.project.name].filter(Boolean).join(' · '),
      hoursTotal: regMin / 60, rate: g.billRate, regularHours: regMin / 60, premiumHours: 0,
      basePayRate: g.payRate, premiumPercent: 0, totalPay: M.round2((regMin / 60) * g.payRate), daily: daily(regM), projectId: g.project.id,
    })
    if (premMin > 0) inv.items.push({
      employeeId: g.emp.id, employeeName: g.emp.name, position: `Night premium +${pct}% · ${g.project.name}`,
      hoursTotal: premMin / 60, rate: premRate, regularHours: 0, premiumHours: premMin / 60,
      basePayRate: g.payRate, premiumPercent: pct, totalPay: M.round2((premMin / 60) * g.payRate * (1 + pct / 100)), daily: daily(premM), projectId: g.project.id,
    })
    inv.subtotal += (regMin > 0 ? regAmount : 0) + (premMin > 0 ? premAmount : 0)
    inv.seconds += (regMin + premMin) * 60
  }
  for (const inv of invoices.values()) {
    inv.subtotal = M.round2(inv.subtotal)
    inv.items.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.position.localeCompare(b.position))
    if (!inv.client.email) flag({ kind: 'client_no_email', clientId: inv.client.id, message: `${inv.client.name} has no email — the invoice can't be emailed` })
  }

  // ── People flags
  const byEmp = new Map()
  for (const b of live) { const l = byEmp.get(b.employee_id) || []; l.push(b); byEmp.set(b.employee_id, l) }
  const adjByEmp = new Map()
  for (const a of ctx.adjustments) adjByEmp.set(a.employee_id, (adjByEmp.get(a.employee_id) || 0) + Number(a.seconds_delta))
  const shotsByEmp = new Map()
  for (const s of ctx.shots) shotsByEmp.set(s.employee_id, (shotsByEmp.get(s.employee_id) || 0) + 1)
  const offDays = new Set()
  for (const t of ctx.timeOff) for (let d = t.start_date; d <= t.end_date; d = M.addDays(d, 1)) offDays.add(`${t.employee_id}|${d}`)
  const activeOnProject = new Set(projects.filter(p => !['completed', 'cancelled', 'archived', 'closed'].includes(String(p.status || '').toLowerCase())).flatMap(p => p.employee_ids || []))

  for (const emp of employees) {
    if (String(emp.status || '').toLowerCase() === 'inactive' || String(emp.status || '').toLowerCase() === 'terminated') continue
    const list = byEmp.get(emp.id) || []
    const total = list.reduce((s, b) => s + (Number(b.seconds) || 0), 0) + (adjByEmp.get(emp.id) || 0)
    const usesApp = !!emp.user_id
    // No time on a shift day (Mon–Fri) for people on the YVA Time app with a shift
    if (usesApp && emp.default_shift_start && emp.default_shift_end && (activeOnProject.has(emp.id) || emp.works_for === 'yva')) {
      const worked = new Set(list.map(dayOf))
      for (const a of ctx.adjustments.filter(x => x.employee_id === emp.id && x.seconds_delta > 0)) worked.add(a.day)
      const missing = days.slice(0, 5).filter(d => !worked.has(d) && !offDays.has(`${emp.id}|${d}`))
      if (missing.length) flag({ kind: 'no_time', employeeId: emp.id, employeeName: emp.name, days: missing,
        message: `${emp.name}: no time on ${missing.map(d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' })).join(', ')}` })
    }
    if (total > 50 * 3600) flag({ kind: 'over_50h', employeeId: emp.id, employeeName: emp.name, seconds: total, message: `${emp.name}: ${hmText(total)} this week (over 50 h)` })
    if (emp.works_for !== 'yva') {
      const measured = list.filter(b => b.active_seconds !== null && b.active_seconds !== undefined)
      const ms = measured.reduce((s, b) => s + b.seconds, 0), act = measured.reduce((s, b) => s + b.active_seconds, 0)
      if (ms >= 3600 && act / ms < 0.3) flag({ kind: 'low_activity', employeeId: emp.id, employeeName: emp.name, message: `${emp.name}: activity ${Math.round((act / ms) * 100)}% (under 30%)` })
      const tracked = list.reduce((s, b) => s + (Number(b.seconds) || 0), 0)
      const expected = Math.floor(tracked / 600)
      const got = shotsByEmp.get(emp.id) || 0
      if (tracked >= 2 * 3600 && got < expected * 0.5) flag({ kind: 'missing_screenshots', employeeId: emp.id, employeeName: emp.name, message: `${emp.name}: ${got} screenshot${got === 1 ? '' : 's'} for ${hmText(tracked)} tracked (expected about ${expected})` })
    }
    if (emp.default_shift_start && emp.default_shift_end && list.length) {
      const s = M.clockMinutes(emp.default_shift_start, null), e = M.clockMinutes(emp.default_shift_end, null)
      if (s !== null && e !== null) {
        const inShift = min => { const lo = s - 30, hi = (e <= s ? e + 1440 : e) + 30; return (min >= lo && min <= hi) || (min + 1440 >= lo && min + 1440 <= hi) }
        const outside = list.filter(b => { const p = M.localParts(Date.parse(b.block_start), M.safeTz(emp.timezone, tz)); return !inShift(p.hour * 60 + p.minute) }).reduce((x, b) => x + (Number(b.seconds) || 0), 0)
        if (outside >= 1800) flag({ kind: 'outside_shift', employeeId: emp.id, employeeName: emp.name, seconds: outside, message: `${emp.name}: ${hmText(outside)} outside shift hours (${emp.default_shift_start} – ${emp.default_shift_end})` })
      }
    }
  }
  for (const r of ctx.manual) {
    const emp = empById[r.employee_id]
    flag({ kind: 'manual_pending', employeeId: r.employee_id, employeeName: emp?.name, message: `${emp?.name || 'Someone'} asked to add missing time — waiting in Time Tracking → Approve` })
  }
  if (firstPrepared) {
    const late = new Map()
    for (const b of ctx.blocks) if (['tracked', 'approved'].includes(b.status) && b.created_at && Date.parse(b.created_at) > firstPrepared) {
      const k = `${b.employee_id}|${b.project_id || ''}|${b.work_type || ''}`
      const l = late.get(k) || { employeeId: b.employee_id, projectId: b.project_id, workType: b.work_type, seconds: 0, byDay: {} }
      l.seconds += Number(b.seconds) || 0; const d = dayOf(b); l.byDay[d] = (l.byDay[d] || 0) + (Number(b.seconds) || 0)
      late.set(k, l)
    }
    // Time YVA already moved to next week ("Move to next week" = defer_out) is no longer late
    for (const a of ctx.adjustments) if (a.kind === 'defer_out' && (!a.created_at || Date.parse(a.created_at) > firstPrepared)) {
      const l = late.get(`${a.employee_id}|${a.project_id || ''}|${a.work_type || ''}`)
      if (!l) continue
      const moved = -Number(a.seconds_delta) || 0
      l.seconds -= moved
      if (l.byDay[a.day]) l.byDay[a.day] = Math.max(0, l.byDay[a.day] - moved)
    }
    for (const l of late.values()) {
      if (l.seconds < 60) continue
      for (const d of Object.keys(l.byDay)) if (l.byDay[d] <= 0) delete l.byDay[d]
      const emp = empById[l.employeeId]
      flag({ kind: 'late', employeeId: l.employeeId, employeeName: emp?.name, projectId: l.projectId, workType: l.workType, seconds: l.seconds, byDay: l.byDay,
        message: `${emp?.name || 'Someone'}: ${hmText(l.seconds)} uploaded after the week closed${l.projectId ? ` (${projById[l.projectId]?.name})` : ''} — included; move it to next week if it belongs there` })
    }
  }

  // ── Payroll preview (pay chain, everything tracked this week incl. YVA work + adjustments)
  const payroll = []
  for (const emp of employees) {
    const list = (byEmp.get(emp.id) || [])
    const adj = ctx.adjustments.filter(a => a.employee_id === emp.id).map(a => ({ block_start: new Date(M.zonedMidnight(a.day, tz) + 12 * 3600_000).toISOString(), seconds: Number(a.seconds_delta), first_offset: null, last_offset: null, project_id: a.project_id, status: 'approved' }))
    if (!list.length && !adj.length) continue
    const m = M.blocksMoney({ blocks: [...list, ...adj], employee: emp, projectsById: projById, clientsById: clientById, rates, kind: 'pay', tz })
    payroll.push({ employeeId: emp.id, employeeName: emp.name, seconds: m.seconds, premiumSeconds: m.premiumSeconds, amount: m.amount,
      missingRate: Object.values(m.byProject).some(g => g.missingRate) })
  }
  payroll.sort((a, b) => a.employeeName.localeCompare(b.employeeName))

  flags.sort((a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind) || String(a.employeeName || '').localeCompare(String(b.employeeName || '')))
  return { invoices: [...invoices.values()], flags, payroll, label: prettyRange(weekStart, weekEnd) }
}

/** Load, build and save a week. by = user id (or null for the Sunday job). */
async function prepareWeek(weekStart, { by = null, now = Date.now() } = {}) {
  if (M.weekdayOf(weekStart) !== 1) throw new Error('A week starts on Monday')
  const ctx = await loadContext(weekStart)
  if (ctx.weekEnd >= M.localParts(now, ctx.tz).date) throw new Error('This week is not over yet')
  const built = buildWeek(ctx)

  // week_closes row first (invoices point at it)
  let close = ctx.close
  const firstPreparedAt = close?.summary?.firstPreparedAt || new Date(now).toISOString()
  if (!close) {
    ;[close] = await rest('week_closes?on_conflict=week_start', { method: 'POST', prefer: 'return=representation,resolution=merge-duplicates',
      body: { week_start: weekStart, week_end: ctx.weekEnd, status: 'preparing', summary: { firstPreparedAt } } })
  }

  const existing = await rest(`invoices?week_close_id=eq.${close.id}&select=id,number,status,client_id,subtotal,auto_generated`)
  const invoiceDate = M.addDays(ctx.weekEnd, 1)
  const kept = new Set()
  const results = []
  for (const inv of built.invoices) {
    const prev = existing.find(e => e.client_id === inv.client.id)
    const projectNames = [...inv.projects].sort()
    const projectIds = [...new Set(inv.items.map(i => i.projectId))]
    const row = {
      date: invoiceDate, due_date: M.addDays(invoiceDate, termsDays(inv.client.payment_terms)),
      client_name: inv.client.name, client_email: inv.client.email || null, client_address: inv.client.address || null,
      billing_start: weekStart, billing_end: ctx.weekEnd,
      project_id: projectIds.length === 1 ? projectIds[0] : null, project_name: projectNames.join(', '),
      subtotal: inv.subtotal, notes: `Hours for the week of ${built.label}.`,
      items: inv.items.map(({ projectId, ...it }) => it),
      client_id: inv.client.id, week_close_id: close.id, auto_generated: true,
    }
    if (prev && prev.status && prev.status !== 'draft') {
      kept.add(prev.id)
      if (Math.abs(Number(prev.subtotal) - inv.subtotal) > 0.009) built.flags.push({ kind: 'invoice_locked', clientId: inv.client.id,
        message: `${prev.number} (${inv.client.name}) was already sent — the hours now add up to $${inv.subtotal.toFixed(2)} instead of $${Number(prev.subtotal).toFixed(2)}` })
      results.push({ id: prev.id, number: prev.number, clientName: inv.client.name, subtotal: Number(prev.subtotal), status: prev.status, locked: true })
      continue
    }
    if (prev) {
      kept.add(prev.id)
      await rest(`invoices?id=eq.${prev.id}`, { method: 'PATCH', body: { ...row, status: 'draft' } })
      results.push({ id: prev.id, number: prev.number, clientName: inv.client.name, subtotal: inv.subtotal, status: 'draft' })
    } else {
      const number = await rpc('next_client_invoice_number', { p_client: inv.client.id })
      const id = require('node:crypto').randomUUID()
      await rest('invoices', { method: 'POST', body: { id, number, status: 'draft', status_history: [{ status: 'draft', changedAt: now }], employee_payments: {}, ...row } })
      kept.add(id)
      results.push({ id, number, clientName: inv.client.name, subtotal: inv.subtotal, status: 'draft' })
    }
  }
  // Drafts of clients that no longer have hours this week
  for (const e of existing) if (!kept.has(e.id) && e.auto_generated && (!e.status || e.status === 'draft')) {
    await rest(`invoices?id=eq.${e.id}&status=eq.draft`, { method: 'DELETE' })
  }

  const summary = {
    firstPreparedAt, label: built.label,
    invoices: results.length, total: M.round2(results.reduce((s, r) => s + r.subtotal, 0)),
    billableSeconds: built.invoices.reduce((s, i) => s + i.seconds, 0),
    people: built.payroll.length, payrollTotal: M.round2(built.payroll.reduce((s, p) => s + p.amount, 0)),
    flags: built.flags.length,
  }
  await rest(`week_closes?id=eq.${close.id}`, { method: 'PATCH', body: {
    status: 'ready', prepared_at: new Date(now).toISOString(), prepared_by: by, summary, flags: built.flags, payroll_preview: built.payroll,
    approved_at: null, approved_by: null,
  } })
  return { weekStart, weekEnd: ctx.weekEnd, closeId: close.id, summary, flags: built.flags, payroll: built.payroll, invoices: results }
}

module.exports = { prepareWeek, buildWeek, loadContext, lastWeekStart, termsDays, hoursToHM }
