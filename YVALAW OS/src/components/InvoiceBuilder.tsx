import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadRatesForInvoicing, rateClient, rateEmployee, rateProject, type PlacementRate } from '../services/rates'
import { localParts, resolveRates } from '../utils/moneyRules'
import type { AppSettings, Client, Employee, Invoice, InvoiceItem, InvoiceTemplate, Project } from '../data/types'
import {
  loadInvoiceCounter, loadInvoices, loadSettings,
  loadSnapshot, saveInvoiceCounter, saveInvoices,
  loadProjects, saveProjects,
  loadInvoiceTemplates, saveInvoiceTemplates,
} from '../services/storage'
import { computePayrollBreakdown, computePremiumAdjustedAmount, employeePremiumConfig } from '../utils/payroll'
import { Ic, P } from './Icon'
import { Banner, Field, Menu, Modal } from './ui'
import { printInvoice } from '../utils/invoiceHtml'
import { hoursToHM, loadTrackerEntriesForProject } from '../services/trackerStorage'

function projectPrefix(name: string): string {
  return name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 5)
}

function parseInvoiceSequence(value?: string): number {
  if (!value) return 0
  const match = value.match(/(\d+)(?!.*\d)/)
  return match ? parseInt(match[1], 10) : 0
}

function uid() { return crypto.randomUUID() }

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  if (!start || !end) return dates
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end   + 'T12:00:00')
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return dates
  const cur = new Date(s)
  while (cur <= e && dates.length < 31) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

function dateLabel(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()]
  return `${day} ${dt.getDate()}`
}

/** Parse hours from various formats: "8", "8.5", "8,5", "8:30" → decimal */
function parseHours(val: string): number {
  if (!val) return 0
  const v = val.trim().replace(',', '.')
  if (v.includes(':')) {
    const [h, m] = v.split(':')
    return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60
  }
  const minuteStyle = v.match(/^(\d+)\.(\d{2})$/)
  if (minuteStyle) {
    const hours = parseInt(minuteStyle[1], 10) || 0
    const minutes = parseInt(minuteStyle[2], 10) || 0
    if (minutes < 60) return hours + minutes / 60
  }
  return parseFloat(v) || 0
}

type BuilderRow = {
  _id: string
  employeeId?: string
  employeeName: string
  position: string
  rate: string
  hoursManual: string       // used when no date range
  shiftStart: string
  shiftEnd: string
  daily: Record<string, string>
}

function rowHours(row: BuilderRow, dates: string[]): number {
  if (dates.length > 0) {
    return dates.reduce((s, d) => s + parseHours(row.daily[d] || ''), 0)
  }
  return parseHours(row.hoursManual)
}

function rowAmount(row: BuilderRow, dates: string[]): number {
  return rowHours(row, dates) * (parseFloat(row.rate) || 0)
}

function emptyRow(): BuilderRow {
  return { _id: uid(), employeeId: undefined, employeeName: '', position: '', rate: '', hoursManual: '', shiftStart: '', shiftEnd: '', daily: {} }
}

type Props = {
  /** send = the person pressed "Save & send" (the page emails it and marks it sent) */
  onCreated: (inv: Invoice, send: boolean) => void
  onCancel: () => void
  initialProjectId?: string
  editInvoice?: Invoice
}

export default function InvoiceBuilder({ onCreated, onCancel, initialProjectId, editInvoice }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [settings,  setSettings]  = useState<AppSettings>({ usdToDop: 0, companyName: '', companyEmail: '', emailSignature: '' })

  useEffect(() => {
    void loadSnapshot().then(snap => {
      setEmployees(snap.employees)
      setClients(snap.clients)
      setProjects(snap.projects)
      setInvoices(snap.invoices)
    })
    void loadInvoiceTemplates().then(setTemplates)
    void loadSettings().then(setSettings)
    void loadRatesForInvoicing().then(setPlacementRates)   // without rates.manage: bill rates + positions only
  }, [])
  const [placementRates, setPlacementRates] = useState<PlacementRate[]>([])

  const [clientId,     setClientId]     = useState('')
  const [projectId,    setProjectId]    = useState(initialProjectId || '')

  // Once projects load, auto-set clientId from initialProjectId
  useEffect(() => {
    if (initialProjectId && projects.length > 0 && !clientId) {
      const proj = projects.find(p => p.id === initialProjectId)
      if (proj?.clientId) setClientId(proj.clientId)
    }
  }, [projects])

  // Populate all fields when editing an existing invoice
  const editLoaded = useRef(false)
  useEffect(() => {
    if (!editInvoice || editLoaded.current || clients.length === 0) return
    editLoaded.current = true
    setDate(editInvoice.date || new Date().toISOString().slice(0, 10))
    setDueDate(editInvoice.dueDate || '')
    setBillingStart(editInvoice.billingStart || '')
    setBillingEnd(editInvoice.billingEnd || '')
    setNotes(editInvoice.notes || '')
    if (editInvoice.projectId) setProjectId(editInvoice.projectId)
    const client = clients.find(c => c.name === editInvoice.clientName)
    if (client) setClientId(client.id)
    if (editInvoice.items && editInvoice.items.length > 0) {
      setRows(editInvoice.items.map(it => ({
        _id: uid(),
        employeeId: it.employeeId,
        employeeName: it.employeeName,
        position: it.position || '',
        rate: String(it.rate),
        hoursManual: String(it.hoursTotal),
        shiftStart: it.shiftStart || '',
        shiftEnd: it.shiftEnd || '',
        daily: it.daily ? { ...it.daily } : {},
      })))
    }
  }, [clients.length, editInvoice])
  const [date,         setDate]         = useState(new Date().toISOString().slice(0, 10))
  const [dueDate,      setDueDate]      = useState('')

  function handleClientChange(newClientId: string) {
    setClientId(newClientId)
    // Auto-select first project linked to this client
    const clientProjects = projects.filter(p => p.clientId === newClientId)
    setProjectId(clientProjects.length > 0 ? clientProjects[0].id : '')
    // Auto-fill due date from payment terms (e.g. "Net 30" → +30 days)
    if (!dueDate) {
      const client = clients.find(c => c.id === newClientId)
      const match = (client?.paymentTerms || '').match(/(\d+)/)
      if (match) {
        const d = new Date()
        d.setDate(d.getDate() + parseInt(match[1]))
        setDueDate(d.toISOString().slice(0, 10))
      }
    }
  }
  const [billingStart, setBillingStart] = useState('')
  const [billingEnd,   setBillingEnd]   = useState('')
  const [notes,        setNotes]        = useState('')
  const [rows,         setRows]         = useState<BuilderRow[]>([emptyRow()])
  const [saving,       setSaving]       = useState(false)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [loadTemplateModal, setLoadTemplateModal] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dates = useMemo(() => generateDateRange(billingStart, billingEnd), [billingStart, billingEnd])

  const selectedClient  = clients.find(c => c.id === clientId)
  const selectedProject = projects.find(p => p.id === projectId)
  const projectEmployees = selectedProject?.employeeIds?.length
    ? employees.filter(e => selectedProject.employeeIds!.includes(e.id))
    : employees

  function nextProjectInvoiceSeq(project: Project, allInvoices: Invoice[]): number {
    const maxExisting = allInvoices.reduce((max, invoice) => {
      const belongsToProject = invoice.projectId === project.id || invoice.projectName === project.name
      if (!belongsToProject) return max
      const seq = parseInvoiceSequence(invoice.number)
      return Number.isFinite(seq) ? Math.max(max, seq) : max
    }, 0)
    if (maxExisting > 0) return maxExisting + 1
    return Math.max(project.nextInvoiceSeq ?? 1, 1)
  }

  /** Bill rate (client) and pay rate (employee) for this person on the selected project — two chains that never cross */
  function ratesFor(emp: Employee | undefined) {
    return resolveRates({
      employee: emp ? rateEmployee(emp) : null,
      project: selectedProject ? rateProject(selectedProject) : null,
      client: selectedClient ? rateClient(selectedClient) : null,
      rates: placementRates,
      day: billingStart || localParts(Date.now()).date,
    })
  }

  /** The row's employee, with the pay rate that applies on this project (placement → dated → base) */
  function rowEmployee(row: BuilderRow) {
    const emp = employees.find(e => e.id === row.employeeId) || employees.find(e => e.name === row.employeeName)
    if (!emp) return emp
    const pay = ratesFor(emp).pay.rate
    return pay ? { ...emp, payRate: pay } : emp
  }

  function effectiveShift(row: BuilderRow) {
    const employee = rowEmployee(row)
    if (employee?.defaultShiftStart && employee?.defaultShiftEnd) {
      return { shiftStart: employee.defaultShiftStart, shiftEnd: employee.defaultShiftEnd, linked: true }
    }
    return { shiftStart: '', shiftEnd: '', linked: false }
  }

  function rowComp(row: BuilderRow, currentDates: string[]) {
    const employee = rowEmployee(row)
    const premiumConfig = employeePremiumConfig(employee)
    const shift = effectiveShift(row)
    const rate = parseFloat(row.rate) || 0

    if (currentDates.length > 0) {
      return currentDates.reduce((acc, day) => {
        const hours = parseHours(row.daily[day] || '')
        const payroll = computePayrollBreakdown(hours, employee, shift.shiftStart, shift.shiftEnd)
        const billing = computePremiumAdjustedAmount(
          hours,
          rate,
          premiumConfig.percent,
          premiumConfig.enabled && shift.linked,
          shift.shiftStart,
          shift.shiftEnd,
          premiumConfig.startTime,
        )
        acc.hours += hours
        acc.regularHours += payroll.regularHours
        acc.premiumHours += payroll.premiumHours
        acc.billAmount += billing.totalAmount
        acc.payrollAmount += payroll.totalPay
        return acc
      }, {
        hours: 0,
        regularHours: 0,
        premiumHours: 0,
        billAmount: 0,
        payrollAmount: 0,
        basePayRate: Number(employee?.payRate || 0) || 0,
        premiumPercent: premiumConfig.percent,
        shift,
        premiumEnabled: premiumConfig.enabled && shift.linked,
      })
    }

    const hours = rowHours(row, currentDates)
    const payroll = computePayrollBreakdown(hours, employee, shift.shiftStart, shift.shiftEnd)
    const billing = computePremiumAdjustedAmount(
      hours,
      rate,
      premiumConfig.percent,
      premiumConfig.enabled && shift.linked,
      shift.shiftStart,
      shift.shiftEnd,
      premiumConfig.startTime,
    )
    return {
      hours,
      regularHours: payroll.regularHours,
      premiumHours: payroll.premiumHours,
      billAmount: billing.totalAmount,
      payrollAmount: payroll.totalPay,
      basePayRate: payroll.basePayRate,
      premiumPercent: payroll.premiumPercent,
      shift,
      premiumEnabled: premiumConfig.enabled && shift.linked,
    }
  }

  const grandTotal = rows.reduce((s, r) => s + rowComp(r, dates).billAmount, 0)

  function updateRow(id: string, patch: Partial<BuilderRow>) {
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r))
  }

  function updateDaily(rowId: string, date: string, val: string) {
    setRows(prev => prev.map(r => r._id === rowId ? { ...r, daily: { ...r.daily, [date]: val } } : r))
  }

  function handleEmpSelect(rowId: string, name: string) {
    const emp = employees.find(e => e.name === name)
    // Client bill rate: placement → project → client default. Never the employee's pay rate
    // (that would invoice the client at cost); empty = type one in.
    const r = ratesFor(emp)
    updateRow(rowId, {
      employeeId: emp?.id,
      employeeName: name,
      rate: r.bill.rate ? String(r.bill.rate) : '',
      position: r.position,
      shiftStart: emp?.defaultShiftStart || '',
      shiftEnd: emp?.defaultShiftEnd || '',
    })
  }

  // ── Import approved YVA Time hours into the daily grid ──
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string; label?: string } | null>(null)
  async function importTrackerHours() {
    if (!projectId || dates.length === 0) return
    const entries = await loadTrackerEntriesForProject(projectId, dates[0], dates[dates.length - 1])
    if (entries.length === 0) {
      setImportMsg({ ok: false, text: 'No approved YVA Time hours for this project in this period (approve them in Time Tracking → Approve).' })
      return
    }
    const byEmployee = new Map<string, { name: string; daily: Record<string, number> }>()
    for (const e of entries) {
      const g = byEmployee.get(e.employeeId) ?? { name: e.employeeName, daily: {} }
      g.daily[e.date] = (g.daily[e.date] ?? 0) + e.hours
      byEmployee.set(e.employeeId, g)
    }
    const overwrites = rows.some(r => r.employeeId && byEmployee.has(r.employeeId) &&
      Object.keys(byEmployee.get(r.employeeId)!.daily).some(d => (r.daily[d] || '').trim() !== ''))
    if (overwrites && !window.confirm('Some of these days already have hours typed in. Replace them with the approved YVA Time hours?')) return

    setRows(prev => {
      const next = prev.filter(r => r.employeeId || r.employeeName.trim())
      for (const [employeeId, g] of byEmployee) {
        let row = next.find(r => r.employeeId === employeeId)
        if (!row) {
          const emp = employees.find(e => e.id === employeeId)
          row = {
            ...emptyRow(), employeeId, employeeName: emp?.name ?? g.name, position: ratesFor(emp).position,
            rate: ratesFor(emp).bill.rate ? String(ratesFor(emp).bill.rate) : '',
            shiftStart: emp?.defaultShiftStart || '', shiftEnd: emp?.defaultShiftEnd || '',
          }
          next.push(row)
        }
        const daily = { ...row.daily }
        for (const [day, h] of Object.entries(g.daily)) daily[day] = hoursToHM(h)
        const idx = next.findIndex(r => r._id === row!._id)
        next[idx] = { ...row, daily }
      }
      return next.length ? next : [emptyRow()]
    })
    const total = entries.reduce((s, e) => s + e.hours, 0)
    setImportMsg({ ok: true, label: `✓ Imported ${hoursToHM(total)} from YVA Time`, text: `Imported ${hoursToHM(total)} (h:mm) of approved hours for ${byEmployee.size} team member${byEmployee.size === 1 ? '' : 's'}. Check the grid before creating the invoice.` })
  }

  function addRow() { setRows(prev => [...prev, emptyRow()]) }
  function removeRow(id: string) { setRows(prev => prev.filter(r => r._id !== id)) }

  function loadTemplate(t: InvoiceTemplate) {
    setClientId(t.clientId ?? '')
    setProjectId(t.projectId ?? '')
    setBillingStart(t.billingStart ?? '')
    setBillingEnd(t.billingEnd ?? '')
    setNotes(t.notes ?? '')
    setRows(t.rows.map(r => ({ ...emptyRow(), ...r, _id: uid() })))
    setLoadTemplateModal(false)
  }

  function saveTemplate() {
    if (!templateName.trim()) return
    const t: InvoiceTemplate = {
      id: uid(),
      name: templateName.trim(),
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      billingStart: billingStart || undefined,
      billingEnd: billingEnd || undefined,
      notes: notes || undefined,
      rows: rows.map(({ _id: _, ...rest }) => rest),
      createdAt: Date.now(),
    }
    const next = [t, ...templates]
    void saveInvoiceTemplates(next)
    setTemplates(next)
    setTemplateName('')
    setSaveTemplateModal(false)
    setNotice(`Template "${t.name}" saved.`)
  }

  function deleteTemplate(id: string) {
    const next = templates.filter(t => t.id !== id)
    void saveInvoiceTemplates(next)
    setTemplates(next)
  }

  function buildItems(): InvoiceItem[] {
    return rows
        .filter(r => r.employeeName.trim())
        .map(r => {
          const employee = employees.find(e => e.id === r.employeeId) || employees.find(e => e.name === r.employeeName)
          const totals = rowComp(r, dates)
          return {
            employeeId: employee?.id,
            employeeName: r.employeeName,
            position:     r.position || undefined,
            hoursTotal:   totals.hours,
            rate:         parseFloat(r.rate) || 0,
            shiftStart:   totals.shift.shiftStart || undefined,
            shiftEnd:     totals.shift.shiftEnd || undefined,
            regularHours: totals.regularHours,
            premiumHours: totals.premiumHours,
            basePayRate:  totals.basePayRate,
            premiumPercent: totals.premiumPercent,
            totalPay:     totals.payrollAmount,
            daily:        dates.length > 0 ? { ...r.daily } : undefined,
          }
        })
  }

  /** Preview PDF of what's on screen — nothing is saved */
  function previewPdf() {
    const inv: Invoice = {
      id: editInvoice?.id || 'preview', number: editInvoice?.number || nextNumberLabel || 'DRAFT', date, dueDate: dueDate || undefined,
      clientName: selectedClient?.name || editInvoice?.clientName || '', clientEmail: selectedClient?.email || '', clientAddress: selectedClient?.address || '',
      billingStart: billingStart || undefined, billingEnd: billingEnd || undefined, projectId: selectedProject?.id || null, projectName: selectedProject?.name || '',
      status: editInvoice?.status || 'draft', subtotal: grandTotal, notes: notes || undefined, items: buildItems(),
    }
    printInvoice(inv, { rate: 0, companyName: settings.companyName, companyAddress: settings.companyAddress, companyEmail: settings.companyEmail, companyPhone: settings.companyPhone })
  }

  function createInvoice(send: boolean) {
    if (!selectedClient && !rows.some(r => r.employeeName)) return
    setSaving(true); setSaveError(null)
    void (async () => {
     try {
      const items = buildItems()

      if (editInvoice) {
        // Update existing invoice
        const inv: Invoice = {
          ...editInvoice,
          date,
          dueDate:       dueDate || undefined,
          clientName:    selectedClient?.name    || editInvoice.clientName || '',
          clientEmail:   selectedClient?.email   || editInvoice.clientEmail || '',
          clientAddress: selectedClient?.address || editInvoice.clientAddress || '',
          billingStart:  billingStart || undefined,
          billingEnd:    billingEnd   || undefined,
          projectId:     selectedProject?.id   ?? editInvoice.projectId ?? null,
          projectName:   selectedProject?.name ?? editInvoice.projectName ?? '',
          subtotal:      grandTotal,
          notes:         notes || undefined,
          items,
          updatedAt:     Date.now(),
        }
        const existing = await loadInvoices()
        await saveInvoices(existing.map(i => i.id === inv.id ? inv : i))
        setSaving(false)
        onCreated(inv, send)
        return
      }

      // Create new invoice
      let invNumber: string
      if (selectedProject) {
        const existingInvoices = await loadInvoices()
        const allProjects = await loadProjects()
        const projIdx = allProjects.findIndex(p => p.id === selectedProject.id)
        const proj = projIdx >= 0 ? allProjects[projIdx] : selectedProject
        const seq = nextProjectInvoiceSeq(proj, existingInvoices)
        const prefix = projectPrefix(selectedProject.name)
        invNumber = `${prefix}${String(seq).padStart(4, '0')}`
        if (projIdx >= 0) {
          allProjects[projIdx] = { ...proj, nextInvoiceSeq: seq + 1 }
          await saveProjects(allProjects)
        }
      } else {
        const counter = await loadInvoiceCounter()
        invNumber = `INV-${String(counter).padStart(3, '0')}`
        await saveInvoiceCounter(counter + 1)
      }

      const inv: Invoice = {
        id:            uid(),
        number:        invNumber,
        date,
        dueDate:       dueDate || undefined,
        clientName:    selectedClient?.name    || '',
        clientEmail:   selectedClient?.email   || '',
        clientAddress: selectedClient?.address || '',
        billingStart:  billingStart || undefined,
        billingEnd:    billingEnd   || undefined,
        projectId:     selectedProject?.id   || null,
        projectName:   selectedProject?.name || '',
        status:        'draft',
        subtotal:      grandTotal,
        notes:         notes || undefined,
        items,
        createdAt:     Date.now(),
        updatedAt:     Date.now(),
      }

      const existing = await loadInvoices()
      await saveInvoices([inv, ...existing])
      setInvoices([inv, ...existing])
      setSaving(false)
      onCreated(inv, send)
     } catch (e) {
      setSaving(false)
      setSaveError(`The invoice was not saved: ${(e as Error).message}`)
     }
    })()
  }

  const nextNumberLabel = editInvoice?.number
    || (selectedProject ? `${projectPrefix(selectedProject.name)}${String(nextProjectInvoiceSeq(selectedProject, invoices)).padStart(4, '0')}` : '')
  const totalHours = rows.reduce((s, r) => s + rowComp(r, dates).hours, 0)
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const canSave = !saving && grandTotal !== 0 && !!clientId
  const saveHint = !clientId ? 'Pick a client first' : grandTotal === 0 ? 'Add hours and a rate first' : undefined
  const canImport = dates.length > 0 && !!projectId
  const isDraftEdit = !editInvoice || (editInvoice.status || 'draft') === 'draft'

  function removeButton(row: BuilderRow) {
    if (rows.length <= 1) return null
    return <button type="button" className="btn btn--ghost btn--icon btn--sm fin-builder__remove" aria-label={`Remove ${row.employeeName || 'row'}`} onClick={() => removeRow(row._id)}><Ic d={P.trash} size={15} /></button>
  }
  function employeeSelect(row: BuilderRow) {
    return (
      <select className="select select--sm" aria-label="Employee" value={row.employeeName} onChange={e => handleEmpSelect(row._id, e.target.value)}>
        <option value="">— Select —</option>
        {projectEmployees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
      </select>
    )
  }
  function premiumNote(row: BuilderRow, colSpan: number) {
    const employee = rowEmployee(row)
    const premiumConfig = employeePremiumConfig(employee)
    if (!employee || !premiumConfig.enabled) return null
    const comp = rowComp(row, dates)
    return (
      <tr className="fin-grid__note"><td colSpan={colSpan}>
        {comp.shift.linked
          ? `Using saved employee shift ${comp.shift.shiftStart} to ${comp.shift.shiftEnd}. `
          : 'No saved shift on the employee profile, so this row is using the regular rate only. '}
        Premium split: {comp.regularHours.toFixed(2)}h regular + {comp.premiumHours.toFixed(2)}h at +{premiumConfig.percent}% after {premiumConfig.startTime}. Bill: ${comp.billAmount.toFixed(2)}. Payroll: ${comp.payrollAmount.toFixed(2)}.
      </td></tr>
    )
  }

  return (
    <div className="fin-builder">
      <div className="fin-builder__bar">
        <button type="button" className="back-link" onClick={onCancel}><Ic d={P.chevL} size={15} /> Invoices</button>
        <span className="spacer" />
        <Menu label="Templates" buttonClass="btn" trigger={<>Templates <Ic d={P.chevD} size={14} /></>} items={[
          { label: 'Load template…', onClick: () => setLoadTemplateModal(true), icon: P.file },
          { label: 'Save as template…', onClick: () => setSaveTemplateModal(true), icon: P.copy },
        ]} />
        <button type="button" className="btn" onClick={previewPdf}>Preview PDF</button>
        <button type="button" className="btn" disabled={!canSave} title={saveHint} onClick={() => createInvoice(false)}>{saving ? 'Saving…' : editInvoice ? 'Save changes' : 'Save draft'}</button>
        {isDraftEdit && <button type="button" className="btn btn--primary" disabled={!canSave} title={saveHint} onClick={() => createInvoice(true)}>Save &amp; send</button>}
      </div>

      {saveError && <Banner tone="danger" onClose={() => setSaveError(null)}>{saveError}</Banner>}
      {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      <div className="fin-builder__grid">
        <div className="fin-builder__main">
          <section className="card card--pad fin-builder__head">
            <h2 className="fin-builder__title">{editInvoice ? 'Edit invoice' : 'New invoice'} {nextNumberLabel && <span className="mono fin-builder__num">{nextNumberLabel}</span>}</h2>
            <div className="fin-builder__fields">
              <Field label="Client *">
                <select className="select" aria-label="Client" value={clientId} onChange={e => handleClientChange(e.target.value)}>
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Project">
                <select className="select" aria-label="Project" value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">— No project —</option>
                  {projects.filter(p => !clientId || p.clientId === clientId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Billing start"><input className="input" type="date" aria-label="Billing start" value={billingStart} onChange={e => setBillingStart(e.target.value)} /></Field>
              <Field label="Billing end"><input className="input" type="date" aria-label="Billing end" value={billingEnd} onChange={e => setBillingEnd(e.target.value)} /></Field>
              <Field label="Invoice date"><input className="input" type="date" aria-label="Invoice date" value={date} onChange={e => setDate(e.target.value)} /></Field>
              <Field label="Due date"><input className="input" type="date" aria-label="Due date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
              <Field label="Terms"><input className="input fin-readonly" readOnly tabIndex={-1} value={selectedClient?.paymentTerms || '—'} /></Field>
              <Field label="Send to"><input className="input fin-readonly" readOnly tabIndex={-1} value={selectedClient?.email || (selectedClient ? 'No email on file' : '—')} /></Field>
            </div>
            {billingStart && billingEnd && dates.length === 0 && <Banner tone="danger">Invalid date range.</Banner>}
          </section>

          <section className="card fin-builder__hours">
            <div className="card__head">
              <div className="fin-builder__hours-title">
                <h2 className="card__title">{dates.length > 0 ? 'Daily hours' : 'Hours'}</h2>
                <span className="card__meta">{dates.length > 0
                  ? `${dates.length}-day billing period · type hours as h:mm (7:15 = 7 h 15 min), or 7.25`
                  : 'Total hours per person. Set a billing start and end for a day-by-day grid.'}</span>
              </div>
              <button type="button" className="btn btn--sm btn--soft-gold" disabled={!canImport}
                title={canImport ? 'Fills the grid with approved hours for this project and period' : 'Pick a project and a billing period first'}
                onClick={() => void importTrackerHours()}>{importMsg?.label ?? 'Import YVA Time hours'}</button>
            </div>
            {importMsg && <div className="fin-builder__msg"><Banner tone={importMsg.ok ? 'success' : 'warning'} onClose={() => setImportMsg(null)}>{importMsg.text}</Banner></div>}

            <div className="fin-grid-wrap">
              {dates.length > 0 ? (
                <table className="fin-grid" style={{ minWidth: 360 + dates.length * 66 }}>
                  <thead>
                    <tr>
                      <th className="fin-grid__emp">Employee</th>
                      {dates.map(d => <th key={d} className="fin-grid__day">{dateLabel(d)}</th>)}
                      <th className="t-right">Total</th>
                      <th className="t-right">Rate</th>
                      <th className="t-right">Amount</th>
                      <th aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const comp = rowComp(row, dates)
                      return [
                        <tr key={row._id}>
                          <td className="fin-grid__emp">
                            {employeeSelect(row)}
                            <input className="input input--sm fin-grid__pos" aria-label="Position" value={row.position} onChange={e => updateRow(row._id, { position: e.target.value })} placeholder="Position" />
                          </td>
                          {dates.map(d => (
                            <td key={d} className="fin-grid__day">
                              <input className="fin-cell mono" type="text" inputMode="decimal" aria-label={`${row.employeeName || 'Row'} ${d}`} value={row.daily[d] || ''} onChange={e => updateDaily(row._id, d, e.target.value)} placeholder="—" />
                            </td>
                          ))}
                          <td className="t-right mono fin-grid__total">{comp.hours > 0 ? hoursToHM(comp.hours) : '—'}</td>
                          <td className="t-right"><input className="input input--sm fin-grid__rate" type="number" aria-label="Rate" value={row.rate} onChange={e => updateRow(row._id, { rate: e.target.value })} placeholder="0" /></td>
                          <td className="t-right fin-grid__amt">{comp.billAmount > 0 ? money(comp.billAmount) : '—'}</td>
                          <td>{removeButton(row)}</td>
                        </tr>,
                        <PremiumRow key={`${row._id}-p`}>{premiumNote(row, dates.length + 5)}</PremiumRow>,
                      ]
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="fin-grid fin-grid--simple">
                  <thead>
                    <tr><th className="fin-grid__emp">Employee</th><th>Position</th><th className="t-right">Rate/hr</th><th className="t-right">Total hrs</th><th className="t-right">Bill amount</th><th className="t-right">Payroll est.</th><th aria-label="Remove" /></tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const comp = rowComp(row, dates)
                      return [
                        <tr key={row._id}>
                          <td className="fin-grid__emp">{employeeSelect(row)}</td>
                          <td><input className="input input--sm" aria-label="Position" value={row.position} onChange={e => updateRow(row._id, { position: e.target.value })} placeholder="Role / position" /></td>
                          <td className="t-right"><input className="input input--sm fin-grid__rate" type="number" aria-label="Rate" value={row.rate} onChange={e => updateRow(row._id, { rate: e.target.value })} placeholder="0" /></td>
                          <td className="t-right"><input className="input input--sm fin-grid__rate mono" type="text" inputMode="decimal" aria-label="Total hours" value={row.hoursManual} onChange={e => updateRow(row._id, { hoursManual: e.target.value })} placeholder="0" /></td>
                          <td className="t-right fin-grid__amt">{comp.billAmount > 0 ? money(comp.billAmount) : '—'}</td>
                          <td className="t-right muted">{comp.payrollAmount > 0 ? money(comp.payrollAmount) : '—'}</td>
                          <td>{removeButton(row)}</td>
                        </tr>,
                        <PremiumRow key={`${row._id}-p`}>{premiumNote(row, 7)}</PremiumRow>,
                      ]
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <button type="button" className="fin-builder__add" onClick={addRow}>+ Add employee row</button>
          </section>
        </div>

        <aside className="card card--pad fin-builder__summary">
          <h2 className="card__title">Summary</h2>
          <div className="fin-sum-line"><span>Hours</span><span className="mono">{hoursToHM(totalHours)}</span></div>
          <div className="fin-sum-line"><span>Subtotal</span><span className="num">{money(grandTotal)}</span></div>
          <div className="fin-sum-line fin-sum-line--total"><span>Total due</span><span className="num">{money(grandTotal)}</span></div>
          {settings.usdToDop > 0 && <div className="fin-sum-dop">RD${(grandTotal * settings.usdToDop).toLocaleString('en-US', { maximumFractionDigits: 0 })} at RD${settings.usdToDop} (internal only, never on the client's invoice)</div>}
          <div className="fin-billto">
            <div className="fin-billto__col">
              <span className="info__label">From</span>
              <span className="fin-billto__name">{settings.companyName || 'YVA Staffing'}</span>
              <span className="fin-billto__meta">{settings.companyAddress || 'Santo Domingo, Dominican Republic'}</span>
              <span className="fin-billto__meta">{settings.companyEmail || 'Contact@yvastaffing.net'}</span>
              <span className="fin-billto__meta">{settings.companyPhone || '+1 (717) 281-8676'}</span>
            </div>
            <div className="fin-billto__col">
              <span className="info__label">Bill to</span>
              {selectedClient ? <>
                <span className="fin-billto__name">{selectedClient.name}</span>
                {selectedClient.email && <span className="fin-billto__meta">{selectedClient.email}</span>}
                {selectedClient.address && <span className="fin-billto__meta">{selectedClient.address}</span>}
              </> : <span className="fin-billto__meta">Select a client</span>}
            </div>
          </div>
          <Field label="Notes on invoice">
            <textarea className="textarea" rows={3} aria-label="Notes on invoice" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Payment instructions, thank you note, or any additional info…" />
          </Field>
          <span className="fin-sum-help">Payroll for these hours uses each person's pay rate. Bill rates come from placement → project → client default.</span>
        </aside>
      </div>

      <Modal open={saveTemplateModal} onClose={() => setSaveTemplateModal(false)} title="Save as template"
        sub="Saves the client, project, billing period, notes and every employee row (without daily hours)."
        footer={<>
          <button type="button" className="btn" onClick={() => setSaveTemplateModal(false)}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={saveTemplate} disabled={!templateName.trim()}>Save template</button>
        </>}>
        <Field label="Template name *"><input className="input" aria-label="Template name" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Standard Law Assist Invoice" autoFocus /></Field>
      </Modal>

      <Modal open={loadTemplateModal} onClose={() => setLoadTemplateModal(false)} title="Load template"
        footer={<button type="button" className="btn" onClick={() => setLoadTemplateModal(false)}>Close</button>}>
        {templates.length === 0 ? <div className="muted">No templates saved yet.</div> : (
          <div className="fin-list">
            {templates.map(t => (
              <div key={t.id} className="list-row">
                <div className="list-row__main">
                  <span className="list-row__title">{t.name}</span>
                  <span className="list-row__meta">{t.rows.length} employee{t.rows.length !== 1 ? 's' : ''} · {new Date(t.createdAt).toLocaleDateString()}</span>
                </div>
                <button type="button" className="btn btn--sm" onClick={() => loadTemplate(t)}>Load</button>
                <Menu items={[{ label: 'Delete template', danger: true, icon: P.trash, onClick: () => { if (window.confirm(`Delete the template "${t.name}"?`)) deleteTemplate(t.id) } }]} />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

/** A premium explanation row only when there is one (keeps the tbody free of empty rows) */
function PremiumRow({ children }: { children: ReactNode }) { return <>{children}</> }
