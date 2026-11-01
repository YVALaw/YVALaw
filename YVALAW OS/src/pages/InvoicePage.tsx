// Finance → Invoices (redesign 2026-11, design_handoff_yva_os_redesign/designs/Invoices.dc.html).
// List with status tabs + saved views, contextual row actions, bulk status, project grouping,
// Recurring tab, the invoice builder as a full page (blocked on phones), Quick invoice, Record payment.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RecordPaymentModal from '../components/RecordPaymentModal'
import InvoiceBuilder from '../components/InvoiceBuilder'
import RecurringInvoices from '../components/finance/RecurringInvoices'
import { useSavedViews } from '../components/finance/savedViews'
import { Banner, Checkbox, EmptyState, Field, Menu, Modal, PageHeader, Pill, SearchInput, Segmented, Skel, Tabs, useIsMobile, type MenuItem } from '../components/ui'
import { Ic, P } from '../components/Icon'
import { useRole } from '../context/RoleContext'
import type { AppSettings, Client, Invoice, Project, RecurringInvoice } from '../data/types'
import {
  loadInvoices, saveInvoices, loadInvoiceCounter, saveInvoiceCounter, loadSnapshot, loadSettings,
  loadRecurringInvoices, saveRecurringInvoices, logComm,
} from '../services/storage'
import { loadPayments } from '../services/payments'
import { formatMoney } from '../utils/money'
import { buildInvoiceHTML, printInvoice as printInvoiceUtil } from '../utils/invoiceHtml'
import { sendInvoiceEmail, sendReminderEmail } from '../services/invoiceEmail'
import { dateShort } from '../utils/format'
import { localParts } from '../utils/moneyRules'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'partial'
type Tab = 'all' | InvoiceStatus | 'recurring'
type Grouping = 'list' | 'project'
type Filters = { tab: Tab; q: string; project: string; group: Grouping }

const STATUSES: { key: InvoiceStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' }, { key: 'sent', label: 'Sent' }, { key: 'viewed', label: 'Viewed' },
  { key: 'partial', label: 'Partial' }, { key: 'overdue', label: 'Overdue' }, { key: 'paid', label: 'Paid' },
]
const UNPAID = ['sent', 'viewed', 'partial', 'overdue']
const statusOf = (i: Invoice): InvoiceStatus => ((i.status || 'draft').toLowerCase() as InvoiceStatus)
const amountOf = (i: Invoice) => Number(i.subtotal) || 0
const balanceOf = (i: Invoice) => (statusOf(i) === 'paid' ? 0 : Math.max(0, Math.round((amountOf(i) - (Number(i.amountPaid) || 0)) * 100) / 100))
const uid = () => crypto.randomUUID()
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function periodLabel(inv: Invoice): string {
  const a = inv.billingStart, b = inv.billingEnd
  if (!a || !b) return inv.date ? dateShort(inv.date) : '—'
  const da = new Date(`${a}T12:00:00`), db = new Date(`${b}T12:00:00`)
  const sameMonth = da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()
  return `${dateShort(a)} – ${sameMonth ? db.getDate() : dateShort(b)}`
}

function shareInvoice(inv: Invoice, dopRate: number, done: (msg: string) => void) {
  const payload = { inv, dopRate: dopRate > 0 ? dopRate : undefined }
  const b64 = btoa(encodeURIComponent(JSON.stringify(payload)))
  const url = `${window.location.origin}/invoice-view#${b64}`
  navigator.clipboard.writeText(url).then(() => done('Portal link copied to clipboard.'), () => prompt('Copy this link:', url))
}

type QuickForm = { clientName: string; date: string; dueDate: string; subtotal: string; notes: string }
const EMPTY_FORM = (): QuickForm => ({ clientName: '', date: new Date().toISOString().slice(0, 10), dueDate: '', subtotal: '', notes: '' })

export default function InvoicePage() {
  const { userId } = useRole()
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<AppSettings>({ usdToDop: 0 })
  const [recurring, setRecurring] = useState<RecurringInvoice[]>([])
  const [collected, setCollected] = useState<number | null>(null)
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null)

  // List filters (a saved view is a snapshot of these)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('list')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<InvoiceStatus>('sent')
  const { views, save: saveView, remove: removeView } = useSavedViews<Filters>('invoices', userId)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [viewName, setViewName] = useState('')

  // Builder (full page) + overlays
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderProjectId, setBuilderProjectId] = useState<string | undefined>()
  const [editingInvoice, setEditingInvoice] = useState<Invoice | undefined>()
  const [payingInv, setPayingInv] = useState<Invoice | null>(null)
  const [pickPayment, setPickPayment] = useState(false)
  const [pickQ, setPickQ] = useState('')
  const [quickModal, setQuickModal] = useState(false)
  const [quickProjectId, setQuickProjectId] = useState<string | undefined>()
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM())
  const [statusFor, setStatusFor] = useState<Invoice | null>(null)
  const [newStatus, setNewStatus] = useState<InvoiceStatus>('draft')
  const [newAmountPaid, setNewAmountPaid] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null)
  const [previewInv, setPreviewInv] = useState<Invoice | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const ok = (text: string) => setBanner({ tone: 'success', text })
  const fail = (text: string) => setBanner({ tone: 'danger', text })

  useEffect(() => {
    void loadSnapshot().then(snap => {
      setInvoices(snap.invoices); setClients(snap.clients); setAllProjects(snap.projects); setLoading(false)
    })
    void loadSettings().then(setSettings)
    void loadRecurringInvoices().then(setRecurring)
    const today = localParts(Date.now()).date
    void loadPayments({ from: `${today.slice(0, 8)}01`, to: today }).then(r => setCollected(r.error ? null : r.rows.reduce((s, p) => s + p.amount, 0)))
  }, [])

  // Deep links: ?create=invoice | ?create=payment | ?open=<id> | ?edit=<id> | ?q=<text> (Reports)
  useEffect(() => {
    if (loading) return
    const create = params.get('create'), open = params.get('open'), edit = params.get('edit'), q = params.get('q')
    if (!create && !open && !edit && !q) return
    if (create === 'invoice') openBuilder(params.get('project') || undefined)
    if (create === 'payment') { setPickQ(''); setPickPayment(true) }
    if (open) { const inv = invoices.find(i => i.id === open); if (inv) setPreviewInv(inv); else fail('That invoice was not found — it may have been deleted.') }
    if (edit) { const inv = invoices.find(i => i.id === edit); if (inv) openEditInvoice(inv) }
    if (q) { setSearch(q); setTab('all'); setExpanded(new Set(invoices.map(i => i.projectId || i.projectName || '__unassigned__'))) }
    setParams({}, { replace: true })
  }, [loading, params])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Optimistic save: show it, write it, roll back with the reason if the database refused */
  async function persist(next: Invoice[], okMsg?: string): Promise<boolean> {
    const prev = invoices
    setInvoices(next)
    try { await saveInvoices(next); if (okMsg) ok(okMsg); return true } catch (e) { setInvoices(prev); fail(`Not saved: ${(e as Error).message}`); return false }
  }
  async function persistRec(next: RecurringInvoice[], okMsg?: string): Promise<boolean> {
    const prev = recurring
    setRecurring(next)
    try { await saveRecurringInvoices(next); if (okMsg) ok(okMsg); return true } catch (e) { setRecurring(prev); fail(`Not saved: ${(e as Error).message}`); return false }
  }
  const clientIdOf = (inv: Invoice) => inv.clientId || clients.find(c => c.name === inv.clientName)?.id
  const htmlOpts = (rate = 0) => ({ rate, companyName: settings.companyName, companyAddress: settings.companyAddress, companyEmail: settings.companyEmail, companyPhone: settings.companyPhone })
  const printInvoice = (inv: Invoice) => printInvoiceUtil(inv, htmlOpts(0))

  // ── Builder ─────────────────────────────────────────────────────────────
  function openBuilder(projectId?: string) { setEditingInvoice(undefined); setBuilderProjectId(projectId); setBuilderOpen(true); window.scrollTo?.(0, 0) }
  function openEditInvoice(inv: Invoice) { setEditingInvoice(inv); setBuilderProjectId(inv.projectId || undefined); setBuilderOpen(true); window.scrollTo?.(0, 0) }
  async function closeBuilder(inv?: Invoice, send = false) {
    const fresh = await loadInvoices()
    setInvoices(fresh)
    setBuilderOpen(false); setBuilderProjectId(undefined); setEditingInvoice(undefined)
    if (!inv) return
    const saved = fresh.find(i => i.id === inv.id) ?? inv
    if (send) await sendDraft(saved, fresh)
    else ok(statusOf(saved) === 'draft' ? `${saved.number} saved as a draft.` : `${saved.number} saved.`)
  }

  // ── Sending ─────────────────────────────────────────────────────────────
  /** Email a draft and mark it sent (no email on file → mark sent by hand, as before) */
  async function sendDraft(inv: Invoice, list = invoices) {
    const cId = clientIdOf(inv)
    const markSent = () => list.map(i => i.id === inv.id ? { ...i, status: 'sent' as const, statusHistory: [...(i.statusHistory || []), { status: 'sent', changedAt: Date.now() }] } : i)
    if (!inv.clientEmail) {
      if (!window.confirm(`${inv.number}: no client email on file. Mark it as sent anyway?`)) return
      if (await persist(markSent(), `${inv.number} marked as sent.`) && cId) void logComm(cId, `Invoice ${inv.number} marked as sent`, 'system')
      return
    }
    setBusy(`send-${inv.id}`)
    try {
      const r = await sendInvoiceEmail(inv, settings)
      if (r.mode === 'failed') { fail(`${inv.number} was not sent: ${r.fallbackReason}`); return }
      const msg = r.mode === 'gmail' ? `${inv.number} sent to ${inv.clientEmail}.` : `${inv.number} opened in your email app for ${inv.clientEmail} and marked as sent.`
      if (await persist(markSent(), msg) && cId) void logComm(cId, `Invoice ${inv.number} emailed (${formatMoney(amountOf(inv))})`, 'email')
    } finally { setBusy(null) }
  }
  async function emailAgain(inv: Invoice) {
    const r = await sendInvoiceEmail(inv, settings)
    if (r.mode === 'failed') { fail(`${inv.number} was not sent: ${r.fallbackReason}`); return }
    ok(`Invoice ${inv.number} emailed to ${inv.clientEmail}.`)
    const cId = clientIdOf(inv); if (cId) void logComm(cId, `Invoice ${inv.number} emailed (${formatMoney(amountOf(inv))})`, 'email')
  }
  async function remind(inv: Invoice) {
    const r = await sendReminderEmail(inv, settings)
    if (r.mode === 'failed') { fail(`Reminder for ${inv.number} was not sent: ${r.fallbackReason}`); return }
    ok(`Payment reminder sent to ${inv.clientEmail}.`)
    const cId = clientIdOf(inv); if (cId) void logComm(cId, `Payment reminder sent for Invoice ${inv.number}`, 'email')
  }
  async function remindAll() {
    const seen = new Set<string>()
    for (const inv of invoices.filter(i => ['overdue', 'sent', 'partial'].includes(statusOf(i)) && i.clientEmail)) {
      if (seen.has(inv.clientEmail!)) continue
      seen.add(inv.clientEmail!)
      const r = await sendReminderEmail(inv, settings)
      if (r.mode === 'failed') { fail(`Stopped after ${seen.size - 1} reminder${seen.size === 2 ? '' : 's'}: ${r.fallbackReason}`); return }
      const cId = clientIdOf(inv); if (cId) void logComm(cId, `Payment reminder sent for Invoice ${inv.number}`, 'email')
    }
    ok(`Reminders sent to ${seen.size} client${seen.size !== 1 ? 's' : ''}.`)
  }

  // ── Quick invoice ───────────────────────────────────────────────────────
  function openQuickForProject(projectId?: string) {
    const proj = allProjects.find(p => p.id === projectId)
    const client = proj ? clients.find(c => c.id === proj.clientId) : undefined
    setForm({ ...EMPTY_FORM(), clientName: client?.name || '' })
    setQuickProjectId(projectId); setQuickModal(true)
  }
  async function saveQuick() {
    if (!form.clientName.trim() || !form.subtotal) return
    const counter = await loadInvoiceCounter()
    const client = clients.find(c => c.name === form.clientName)
    const proj = allProjects.find(p => p.id === quickProjectId)
    const inv: Invoice = {
      id: uid(), number: `INV-${String(counter).padStart(3, '0')}`, date: form.date, dueDate: form.dueDate || undefined,
      clientName: form.clientName, clientEmail: client?.email, projectId: proj?.id || null, projectName: proj?.name || undefined,
      subtotal: parseFloat(form.subtotal) || 0, notes: form.notes || undefined, status: 'sent', items: [],
      statusHistory: [{ status: 'sent', changedAt: Date.now() }], createdAt: Date.now(), updatedAt: Date.now(),
    }
    setQuickModal(false); setQuickProjectId(undefined)
    if (!await persist([inv, ...invoices], `${inv.number} created.`)) return
    void saveInvoiceCounter(counter + 1)
    if (inv.clientEmail) {
      const r = await sendInvoiceEmail(inv, settings)
      if (r.mode === 'failed') { setBanner({ tone: 'warning', text: `${inv.number} was created but not emailed: ${r.fallbackReason}` }); return }
      ok(`${inv.number} created and emailed to ${inv.clientEmail}.`)
      if (client?.id) void logComm(client.id, `Invoice ${inv.number} emailed (${formatMoney(inv.subtotal || 0)})`, 'email')
    } else if (client?.id) {
      void logComm(client.id, `Invoice ${inv.number} created (${formatMoney(inv.subtotal || 0)})`, 'system')
    }
  }

  // ── Status, duplicate, delete, bulk ─────────────────────────────────────
  function openStatusEdit(inv: Invoice) { setStatusFor(inv); setNewStatus(statusOf(inv)); setNewAmountPaid(inv.amountPaid != null ? String(inv.amountPaid) : '') }
  async function saveStatus() {
    const target = statusFor
    if (!target) return
    const amtPaid = newStatus === 'partial' ? (parseFloat(newAmountPaid) || 0) : undefined
    setStatusFor(null)
    const done = await persist(invoices.map(inv => inv.id !== target.id ? inv
      : { ...inv, status: newStatus, amountPaid: amtPaid, updatedAt: Date.now(), statusHistory: [...(inv.statusHistory || []), { status: newStatus, changedAt: Date.now() }] }),
    `${target.number} is now ${label(newStatus)}.`)
    const cId = clientIdOf(target)
    if (done && cId) void logComm(cId, `Invoice ${target.number} status changed to ${newStatus}`, 'system')
  }
  async function applyBulk() {
    const ids = selected
    const targets = invoices.filter(i => ids.has(i.id))
    const done = await persist(invoices.map(inv => !ids.has(inv.id) ? inv
      : { ...inv, status: bulkStatus, amountPaid: bulkStatus === 'partial' ? inv.amountPaid : undefined, updatedAt: Date.now(), statusHistory: [...(inv.statusHistory || []), { status: bulkStatus, changedAt: Date.now() }] }),
    `${ids.size} invoice${ids.size === 1 ? '' : 's'} set to ${label(bulkStatus)}.`)
    if (done) { setSelected(new Set()); for (const t of targets) { const cId = clientIdOf(t); if (cId) void logComm(cId, `Invoice ${t.number} status changed to ${bulkStatus}`, 'system') } }
  }
  async function duplicateInvoice(inv: Invoice) {
    const counter = await loadInvoiceCounter()
    const dup: Invoice = { ...inv, id: uid(), number: `INV-${String(counter).padStart(3, '0')}`, status: 'draft', amountPaid: undefined,
      date: new Date().toISOString().slice(0, 10), createdAt: Date.now(), updatedAt: Date.now() }
    if (await persist([dup, ...invoices], `${inv.number} duplicated as ${dup.number} (draft).`)) void saveInvoiceCounter(counter + 1)
  }
  async function doDelete(inv: Invoice) { setConfirmDelete(null); await persist(invoices.filter(i => i.id !== inv.id), `${inv.number} deleted.`) }

  // ── Filtering ───────────────────────────────────────────────────────────
  const today = localParts(Date.now()).date
  const pastDue = (i: Invoice) => !!i.dueDate && i.dueDate < today && UNPAID.includes(statusOf(i))
  const base = invoices.filter(inv =>
    `${inv.number} ${inv.clientName} ${inv.projectName}`.toLowerCase().includes(search.toLowerCase()) &&
    (!projectFilter || (projectFilter === '__none__' ? !inv.projectId && !inv.projectName : inv.projectId === projectFilter || allProjects.find(p => p.id === projectFilter)?.name === inv.projectName)))
  const shown = tab === 'all' || tab === 'recurring' ? base : base.filter(i => statusOf(i) === tab)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: base.length }
    for (const s of STATUSES) c[s.key] = base.filter(i => statusOf(i) === s.key).length
    return c
  }, [base])
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; projectId: string | null; invoices: Invoice[] }>()
    for (const inv of shown) {
      const key = inv.projectId || inv.projectName || '__unassigned__'
      if (!map.has(key)) {
        const proj = allProjects.find(p => p.id === inv.projectId || p.name === inv.projectName)
        map.set(key, { key, label: proj?.name || inv.projectName || 'Unassigned', projectId: proj?.id || null, invoices: [] })
      }
      map.get(key)!.invoices.push(inv)
    }
    return [...map.values()].sort((a, b) => a.key === '__unassigned__' ? 1 : b.key === '__unassigned__' ? -1 : a.label.localeCompare(b.label))
  }, [shown, allProjects])

  const openTotal = invoices.filter(i => UNPAID.includes(statusOf(i))).reduce((s, i) => s + balanceOf(i), 0)
  const overdueTotal = invoices.filter(i => statusOf(i) === 'overdue' || pastDue(i)).reduce((s, i) => s + balanceOf(i), 0)
  const monthName = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { month: 'long' })
  const canRemindAll = invoices.some(i => ['overdue', 'sent', 'partial'].includes(statusOf(i)) && i.clientEmail)
  const filters: Filters = { tab, q: search, project: projectFilter, group: grouping }
  const activeView = views.find(v => JSON.stringify(v.filters) === JSON.stringify(filters))
  function applyView(f: Filters) { setTab(f.tab); setSearch(f.q); setProjectFilter(f.project); setGrouping(f.group); setSelected(new Set()) }

  // ── Row actions (mockup: Draft Edit/Send · Overdue PDF/Remind/Payment · open PDF/Payment · Paid PDF) ──
  type Act = { label: string; onClick: () => void; primary?: boolean }
  function actionsFor(inv: Invoice): Act[] {
    const s = statusOf(inv)
    if (s === 'draft') return [{ label: 'Edit', onClick: () => openEditInvoice(inv) }, { label: busy === `send-${inv.id}` ? 'Sending…' : 'Send', primary: true, onClick: () => void sendDraft(inv) }]
    if (s === 'paid') return [{ label: 'PDF', onClick: () => printInvoice(inv) }]
    const late = s === 'overdue' || pastDue(inv)
    return [
      { label: 'PDF', onClick: () => printInvoice(inv) },
      ...(late && inv.clientEmail ? [{ label: 'Remind', onClick: () => void remind(inv) }] : []),
      { label: 'Payment', primary: true, onClick: () => setPayingInv(inv) },
    ]
  }
  function menuFor(inv: Invoice): MenuItem[] {
    const s = statusOf(inv)
    return [
      { label: 'Preview', icon: P.eye, onClick: () => setPreviewInv(inv) },
      { label: 'Download PDF', icon: P.printer, onClick: () => printInvoice(inv), hidden: s !== 'draft' },
      { label: 'Email invoice', icon: P.mail, onClick: () => void emailAgain(inv), hidden: !inv.clientEmail || s === 'draft' },
      { label: 'Payment reminder', icon: P.bell, onClick: () => void remind(inv), hidden: !inv.clientEmail || !['overdue', 'sent', 'partial'].includes(s) },
      { label: 'Payments received', icon: P.cash, onClick: () => setPayingInv(inv), hidden: s === 'draft' },
      { label: 'Copy portal link', icon: P.link, onClick: () => shareInvoice(inv, settings.usdToDop, ok) },
      { label: 'Duplicate', icon: P.copy, onClick: () => void duplicateInvoice(inv) },
      { label: 'Edit invoice', icon: P.edit, onClick: () => openEditInvoice(inv), hidden: s === 'draft' },
      { label: 'Change status', icon: P.refresh, onClick: () => openStatusEdit(inv) },
      'sep',
      { label: 'Delete', icon: P.trash, danger: true, onClick: () => setConfirmDelete(inv) },
    ]
  }
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleGroup = (key: string) => setExpanded(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })

  // ── Builder view ────────────────────────────────────────────────────────
  if (builderOpen) {
    return (
      <div className="page">
        {mobile ? (
          <>
            <button type="button" className="back-link" onClick={() => setBuilderOpen(false)}><Ic d={P.chevL} size={15} /> Invoices</button>
            <div className="card fin-phone-block">
              <h2 className="fin-phone-block__title">The invoice builder needs a bigger screen</h2>
              <p className="fin-phone-block__text">The daily hours grid doesn't fit on a phone. Open YVA OS on a computer or tablet to build invoices. You can still send, record payments and download PDFs from the list.</p>
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => setBuilderOpen(false)}>Back to invoices</button>
            </div>
          </>
        ) : (
          <InvoiceBuilder onCreated={(inv, send) => void closeBuilder(inv, send)} onCancel={() => void closeBuilder()} initialProjectId={builderProjectId} editInvoice={editingInvoice} />
        )}
      </div>
    )
  }

  // ── Rows ────────────────────────────────────────────────────────────────
  const statusCell = (inv: Invoice) => (
    <span className="fin-status">
      <Pill status={statusOf(inv)} />
      {statusOf(inv) === 'partial' && inv.amountPaid != null && <span className="fin-status__paid">{formatMoney(inv.amountPaid)} paid</span>}
    </span>
  )
  const row = (inv: Invoice) => {
    const bal = balanceOf(inv)
    const late = statusOf(inv) === 'overdue' || pastDue(inv)
    return (
      <tr key={inv.id} className={selected.has(inv.id) ? 'fin-row--sel' : undefined}>
        <td className="fin-col-check"><Checkbox ariaLabel={`Select ${inv.number}`} checked={selected.has(inv.id)} onChange={() => toggleSel(inv.id)} /></td>
        <td>
          <button type="button" className="fin-num mono" onClick={() => setPreviewInv(inv)}>{inv.number}</button>
          {inv.autoGenerated && <span className="fin-tag-wc">Weekly close</span>}
        </td>
        <td><span className="t-strong">{inv.clientName || '—'}</span><span className="t-sub">{inv.projectName || 'No project'}</span></td>
        <td className="muted">{periodLabel(inv)}</td>
        <td className={late ? 't-danger' : 'muted'}>{inv.dueDate ? dateShort(inv.dueDate) : '—'}</td>
        <td>{statusCell(inv)}</td>
        <td className="t-num fin-strong">{formatMoney(amountOf(inv))}
          {settings.usdToDop > 0 && <span className="t-sub">RD${(amountOf(inv) * settings.usdToDop).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>}</td>
        <td className={`t-num ${bal ? '' : 't-success'}`}>{bal ? formatMoney(bal) : 'Paid'}</td>
        <td className="t-actions">
          <span className="fin-acts">
            {actionsFor(inv).map(a => <button key={a.label} type="button" className={`btn btn--xs${a.primary ? ' btn--primary' : ''}`} onClick={a.onClick}>{a.label}</button>)}
            <Menu items={menuFor(inv)} buttonClass="btn btn--icon btn--xs fin-more" />
          </span>
        </td>
      </tr>
    )
  }
  const card = (inv: Invoice) => (
    <div key={inv.id} className="mcard">
      <div className="mcard__top">
        <div className="fin-mcard-main">
          <span className="mcard__title">{inv.clientName || '—'}</span>
          <span className="mcard__meta"><span className="mono">{inv.number}</span> · due {inv.dueDate ? dateShort(inv.dueDate) : '—'}{inv.autoGenerated ? ' · Weekly close' : ''}</span>
        </div>
        <div className="fin-mcard-right"><span className="fin-strong num">{formatMoney(amountOf(inv))}</span>{statusCell(inv)}</div>
      </div>
      <div className="mcard__actions">
        {actionsFor(inv).slice(-2).map(a => <button key={a.label} type="button" className={`btn${a.primary ? ' btn--primary' : ''}`} onClick={a.onClick}>{a.label}</button>)}
        <Menu items={menuFor(inv)} buttonClass="btn btn--icon fin-more" />
      </div>
    </div>
  )
  const tableHead = (
    <thead><tr>
      <th className="fin-col-check"><Checkbox ariaLabel="Select all shown" checked={shown.length > 0 && shown.every(i => selected.has(i.id))} onChange={v => setSelected(v ? new Set(shown.map(i => i.id)) : new Set())} /></th>
      <th>Invoice</th><th>Client</th><th>Period</th><th>Due</th><th>Status</th><th className="t-right">Amount</th><th className="t-right">Balance</th><th />
    </tr></thead>
  )
  const groupHead = (g: typeof groups[number], asRow: boolean) => {
    const total = g.invoices.reduce((s, i) => s + amountOf(i), 0)
    const unpaid = g.invoices.filter(i => ['sent', 'overdue', 'partial'].includes(statusOf(i))).length
    const open = expanded.has(g.key)
    const inner = (
      <div className="fin-group">
        <button type="button" className="fin-group__toggle" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
          <Ic d={open ? P.chevD : P.chevR} size={14} /><span className="fin-group__name">{g.label}</span>
          <span className="fin-group__meta">{g.invoices.length} invoice{g.invoices.length !== 1 ? 's' : ''} · {formatMoney(total)}{settings.usdToDop > 0 ? ` · RD$${(total * settings.usdToDop).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}</span>
          {unpaid > 0 && <Pill tone="danger">{unpaid} unpaid</Pill>}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn--xs" onClick={() => openQuickForProject(g.projectId || undefined)}>+ Quick</button>
        <button type="button" className="btn btn--xs" onClick={() => openBuilder(g.projectId || undefined)}>+ Invoice</button>
      </div>
    )
    return asRow ? <tr key={`g-${g.key}`} className="fin-group-row"><td colSpan={9}>{inner}</td></tr> : <div key={`g-${g.key}`} className="card fin-group-card">{inner}</div>
  }

  const openInvoices = invoices.filter(i => UNPAID.includes(statusOf(i)))
    .filter(i => `${i.number} ${i.clientName}`.toLowerCase().includes(pickQ.toLowerCase()))

  return (
    <div className="page">
      <PageHeader title="Invoices"
        sub={<>{formatMoney(openTotal)} open · <span className={overdueTotal ? 't-danger' : undefined}>{formatMoney(overdueTotal)} overdue</span>{collected != null ? ` · ${formatMoney(collected)} collected in ${monthName}` : ''}</>}
        actions={<>
          <SearchInput value={search} onChange={setSearch} placeholder="Number, client, project" label="Search invoices" width={mobile ? '100%' : 220} />
          <Menu label="More invoice actions" items={[
            { label: 'Quick invoice', icon: P.zap, onClick: () => openQuickForProject(undefined) },
            { label: 'Record payment', icon: P.cash, onClick: () => { setPickQ(''); setPickPayment(true) } },
            { label: 'Remind all unpaid', icon: P.mail, onClick: () => void remindAll(), hidden: !canRemindAll },
          ]} />
          <button type="button" className="btn btn--primary" onClick={() => openBuilder()}>+ New invoice</button>
        </>} />

      <div className="fin-tabs-row">
        <Tabs<Tab> label="Invoice status" value={tab} onChange={t => { setTab(t); setSelected(new Set()) }} tabs={[
          { value: 'all', label: 'All', count: counts.all },
          ...STATUSES.map(s => ({ value: s.key as Tab, label: s.label, count: counts[s.key] })),
          { value: 'recurring', label: 'Recurring', badge: recurring.filter(r => r.active).length || null },
        ]} />
        {tab !== 'recurring' && (
          <div className="fin-views">
            {views.map(v => (
              <span key={v.id} className={`chip chip--sm fin-view${activeView?.id === v.id ? ' chip--on' : ''}`}>
                <button type="button" className="fin-view__name" onClick={() => applyView(v.filters)}>{v.name}</button>
                <button type="button" className="fin-view__x" aria-label={`Remove view ${v.name}`} onClick={() => removeView(v.id)}>×</button>
              </span>
            ))}
            <button type="button" className="link fin-save-view" onClick={() => { setViewName(''); setSaveViewOpen(true) }}>+ Save view</button>
          </div>
        )}
      </div>

      {banner && <Banner tone={banner.tone} onClose={() => setBanner(null)}>{banner.text}</Banner>}

      {tab === 'recurring' ? (
        <RecurringInvoices recurring={recurring} clients={clients} projects={allProjects} persist={persistRec} />
      ) : (
        <>
          <div className="fin-toolbar">
            <select className="select select--sm fin-project-filter" aria-label="Project" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
              <option value="">All projects</option>
              {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__none__">No project</option>
            </select>
            <Segmented<Grouping> label="Group invoices" value={grouping} onChange={setGrouping} options={[{ value: 'list', label: 'List' }, { value: 'project', label: 'By project' }]} />
            {selected.size > 0 && (
              <div className="fin-bulk" role="region" aria-label="Bulk status">
                <span className="fin-bulk__count">{selected.size} selected</span>
                <select className="select select--sm" aria-label="New status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value as InvoiceStatus)}>
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button type="button" className="btn btn--sm btn--primary" onClick={() => void applyBulk()}>Apply to selected</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="table-card fin-skel">{[0, 1, 2, 3, 4].map(i => <div key={i} className="fin-skel__row"><Skel w={110} /><Skel w="30%" /><Skel w={90} /><Skel w={70} /><Skel w={90} /></div>)}</div>
          ) : shown.length === 0 ? (
            <EmptyState>{search || projectFilter || tab !== 'all' ? 'No invoices match these filters.' : 'No invoices yet. Click "+ New invoice" to get started.'}</EmptyState>
          ) : mobile ? (
            <div className="mcards">
              {grouping === 'project'
                ? groups.map(g => [groupHead(g, false), ...(expanded.has(g.key) ? g.invoices.map(card) : [])])
                : shown.map(card)}
            </div>
          ) : (
            <div className="table-card">
              <table className="table fin-inv-table">
                {tableHead}
                <tbody>
                  {grouping === 'project'
                    ? groups.map(g => [groupHead(g, true), ...(expanded.has(g.key) ? g.invoices.map(row) : [])])
                    : shown.map(row)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Save view */}
      <Modal open={saveViewOpen} onClose={() => setSaveViewOpen(false)} title="Save view" sub="Keeps this tab, search, project filter and grouping on this browser, for you only."
        footer={<>
          <button type="button" className="btn" onClick={() => setSaveViewOpen(false)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!viewName.trim()} onClick={() => { saveView(viewName, filters); setSaveViewOpen(false); ok(`View "${viewName.trim()}" saved.`) }}>Save view</button>
        </>}>
        <Field label="Name"><input className="input" aria-label="View name" autoFocus value={viewName} onChange={e => setViewName(e.target.value)} placeholder="e.g. Overdue · Halavi" /></Field>
      </Modal>

      {/* Quick invoice */}
      <Modal open={quickModal} onClose={() => setQuickModal(false)} title="Quick invoice" sub="A fixed amount. It's marked Sent and emailed to the client."
        footer={<>
          <button type="button" className="btn" onClick={() => setQuickModal(false)}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => void saveQuick()} disabled={!form.clientName || !form.subtotal}>Create</button>
        </>}>
        <div className="form-grid form-grid--2">
          <Field label="Client *" full>
            <select className="select" aria-label="Client" value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })}>
              <option value="">— Select client —</option>
              {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Invoice date"><input className="input" type="date" aria-label="Invoice date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Due date"><input className="input" type="date" aria-label="Due date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label="Amount ($) *" full><input className="input" type="number" placeholder="0.00" aria-label="Amount ($)" value={form.subtotal} onChange={e => setForm({ ...form, subtotal: e.target.value })} /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional message to client…" /></Field>
        </div>
      </Modal>

      {/* Change status */}
      <Modal open={!!statusFor} onClose={() => setStatusFor(null)} title="Change status" sub={statusFor ? `${statusFor.number} · ${statusFor.clientName || ''}` : undefined}
        footer={<>
          <button type="button" className="btn" onClick={() => setStatusFor(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => void saveStatus()}>Save</button>
        </>}>
        <Field label="Status">
          <select className="select" aria-label="Status" value={newStatus} onChange={e => setNewStatus(e.target.value as InvoiceStatus)}>
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        {newStatus === 'partial' && (
          <Field label="Amount paid ($)" hint="How much has been received so far.">
            <input className="input" type="number" placeholder="0.00" aria-label="Amount paid ($)" value={newAmountPaid} onChange={e => setNewAmountPaid(e.target.value)} />
          </Field>
        )}
        {(statusFor?.statusHistory || []).length > 0 && (
          <div className="fin-history">
            <span className="section-label">Status history</span>
            {[...(statusFor?.statusHistory || [])].reverse().slice(0, 6).map((h, i) => (
              <div key={i} className="fin-history__row"><Pill status={h.status} /><span className="muted">{new Date(h.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
            ))}
          </div>
        )}
      </Modal>

      {/* Delete */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete invoice?" sub={confirmDelete ? `${confirmDelete.number} · ${confirmDelete.clientName || ''}. This cannot be undone.` : undefined}
        footer={<>
          <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Delete</button>
        </>} />

      {/* Record payment: pick an open invoice (Create menu → Record payment) */}
      <Modal open={pickPayment} onClose={() => setPickPayment(false)} title="Record payment" sub="Pick the invoice the payment is for.">
        <SearchInput value={pickQ} onChange={setPickQ} placeholder="Number or client" label="Find invoice" />
        <div className="fin-pick">
          {openInvoices.length === 0 && <div className="muted fin-pick__empty">No open invoices{pickQ ? ' match' : ''}.</div>}
          {openInvoices.map(i => (
            <button key={i.id} type="button" className="fin-pick__row" onClick={() => { setPickPayment(false); setPayingInv(i) }}>
              <span className="fin-pick__main"><span className="t-strong">{i.clientName || '—'}</span><span className="mono muted">{i.number}</span></span>
              <span className="fin-pick__right"><span className="fin-strong num">{formatMoney(balanceOf(i))}</span><Pill status={statusOf(i)} /></span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Preview / open */}
      <Modal open={!!previewInv} onClose={() => setPreviewInv(null)} size="xl" title={previewInv ? `Invoice ${previewInv.number}` : ''}
        sub={previewInv ? <>{previewInv.clientName} · {formatMoney(amountOf(previewInv))} · <Pill status={statusOf(previewInv)} /></> : undefined}
        footer={previewInv ? <>
          <button type="button" className="btn" onClick={() => { const inv = previewInv; setPreviewInv(null); openStatusEdit(inv) }}>Change status</button>
          {statusOf(previewInv) !== 'draft' && <button type="button" className="btn" onClick={() => { setPayingInv(previewInv); setPreviewInv(null) }}>Payments</button>}
          {!mobile && <button type="button" className="btn" onClick={() => { const inv = previewInv; setPreviewInv(null); openEditInvoice(inv) }}>Edit</button>}
          <button type="button" className="btn btn--primary" onClick={() => printInvoice(previewInv)}><Ic d={P.printer} size={15} /> Print / PDF</button>
        </> : undefined}>
        {previewInv && <iframe className="fin-preview" srcDoc={buildInvoiceHTML(previewInv, htmlOpts(0))} sandbox="" title="Invoice preview" />}
      </Modal>

      {payingInv && <RecordPaymentModal invoice={{ ...payingInv, subtotal: amountOf(payingInv) }} onClose={() => setPayingInv(null)}
        onChanged={s => { setInvoices(list => list.map(i => i.id === payingInv.id ? { ...i, amountPaid: s.amountPaid, status: s.status } : i)); void loadInvoices().then(setInvoices) }} />}
    </div>
  )
}
