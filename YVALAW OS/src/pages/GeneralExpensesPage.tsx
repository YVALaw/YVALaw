// Finance → Expenses: general business expenses (redesign 2026-11 → designs/Expenses.dc.html).
// Month total + last months, category bars, table with receipts (upload to the attachments bucket), add/edit/delete.
// Repeating expenses (2026-11): "Repeats" in the form makes the entry the first of a series; its copies are added
// automatically (this page catches up on load, the daily `expenses-recurring` function does the same — rules in
// utils/recurringExpenses.ts, SQL migrate-expenses-recurring-fees.sql). "Repeating expenses" card lists series + Stop.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Expense } from '../data/types'
import { loadGeneralExpenses, saveGeneralExpenses } from '../services/storage'
import { deleteFile, uploadFile } from '../services/fileStorage'
import { formatMoney } from '../utils/money'
import { dateShort } from '../utils/format'
import { localParts } from '../utils/moneyRules'
import { Banner, Card, Checkbox, EmptyState, Field, Menu, Modal, PageHeader, Pill, Skel, useIsMobile } from '../components/ui'
import { catchUpRecurringExpenses, isRecurrenceSetupError, RECURRENCE_SQL } from '../services/expenseSeries'
import { everyLabel, frequencyLabel, isFrequency, nextOccurrence, restartThrough, type Frequency } from '../utils/recurringExpenses'
import { P } from '../components/Icon'
import { useToast } from '../context/ToastContext'

/** Expense + optional receipt (columns from supabase/migrate-redesign-finance.sql) */
type Row = Expense & { receiptUrl?: string | null; receiptPath?: string | null }
type Repeats = 'none' | Frequency
type Form = { id?: string; description: string; amount: string; date: string; category: string; repeats: Repeats; ends: string; file: File | null; keepReceipt: boolean }

const CATEGORIES = ['', 'Software', 'Hardware', 'Marketing', 'Office', 'Payroll', 'Legal', 'Accounting', 'Travel', 'Utilities', 'Insurance', 'Other']
const monthLabel = (m: string, opts: Intl.DateTimeFormatOptions = { month: 'long' }) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-US', opts)
const RECEIPT_SQL = 'Receipts need one database update: run supabase/migrate-redesign-finance.sql in Supabase, then try again.'
const REPEATS: { value: Repeats; label: string }[] = [
  { value: 'none', label: "Doesn't repeat" }, { value: 'monthly', label: 'Every month' }, { value: 'weekly', label: 'Every week' }, { value: 'yearly', label: 'Every year' },
]
const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
/** "A copy is added automatically on the 31st of every month (the last day in shorter months)." */
function repeatsHint(freq: Frequency, date: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const day = Number(date.slice(8, 10))
  const when = freq === 'weekly' ? `every ${dayName(date)}`
    : freq === 'yearly' ? `every year on ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : `on the ${ordinal(day)} of every month${day > 28 ? ' (the last day in shorter months)' : ''}`
  return `A copy is added automatically ${when}.${date < today ? ' Copies from the first date up to today are added right away.' : ''}`
}

export default function GeneralExpensesPage() {
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const [expenses, setExpenses] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [setupNote, setSetupNote] = useState<string | null>(null)   // the receipt / repeat columns are missing: a setup step, stays as a banner
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<Row | null>(null)
  const toast = useToast()
  const fileFor = useRef<Row | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { void loadGeneralExpenses().then(e => { setExpenses(e as Row[]); setLoading(false); void catchUp(e as Row[]) }) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  // Create menu → Add expense
  useEffect(() => {
    if (params.get('create')) { openAdd(); setParams({}, { replace: true }) }
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps

  const today = localParts(Date.now()).date
  const thisMonth = today.slice(0, 7)
  const emptyForm = (): Form => ({ description: '', amount: '', date: today, category: '', repeats: 'none', ends: '', file: null, keepReceipt: true })
  function openAdd() { setFormError(null); setForm(emptyForm()) }
  function openEdit(e: Row) {
    setFormError(null)
    setForm({ id: e.id, description: e.description, amount: String(e.amount), date: e.date, category: e.category || '', repeats: isFrequency(e.recurrence) ? e.recurrence : 'none', ends: e.recurrenceEnd || '', file: null, keepReceipt: true })
  }

  /** Add the copies of repeating expenses that are due (safe with other windows open — see services/expenseSeries.ts) */
  async function catchUp(rows: Row[]) {
    if (!rows.some(r => r.recurrence)) return
    try {
      const added = await catchUpRecurringExpenses(rows, today)
      if (added > 0) {
        setExpenses(await loadGeneralExpenses() as Row[])
        toast.info(`${added} repeating expense${added === 1 ? ' was' : 's were'} added automatically.`)
      }
    } catch (e) {
      const m = (e as Error).message || ''
      if (isRecurrenceSetupError(m)) setSetupNote(RECURRENCE_SQL)
      else toast.warning(`Repeating expenses could not be added: ${m}`)
    }
  }

  /** Optimistic save, rolled back with the reason if the database refused */
  async function persist(next: Row[], okMsg: string): Promise<boolean> {
    const prev = expenses
    setExpenses(next)
    try { await saveGeneralExpenses(next); toast.success(okMsg); return true }
    catch (e) {
      setExpenses(prev)
      const m = (e as Error).message || ''
      if (/receipt_(url|path)/.test(m)) setSetupNote(RECEIPT_SQL)
      else if (isRecurrenceSetupError(m)) setSetupNote(RECURRENCE_SQL)
      else toast.error(`Not saved: ${m}`)
      return false
    }
  }
  async function upload(file: File, expenseId: string): Promise<{ storageUrl: string; storagePath: string } | null> {
    try { return await uploadFile(file, `expenses/${expenseId}`) }
    catch (e) { toast.error(`The receipt could not be uploaded: ${(e as Error).message}`); return null }
  }

  async function saveForm() {
    if (!form || !form.description.trim() || !form.amount) return
    const existing = form.id ? expenses.find(x => x.id === form.id) : undefined
    const repeats: Repeats = existing?.seriesId ? 'none' : form.repeats
    if (repeats !== 'none' && form.ends && form.ends < form.date) { setFormError('The end date is before the first date.'); return }
    setFormError(null)
    setSaving(true)
    const id = existing?.id ?? crypto.randomUUID()
    let receipt: { receiptUrl?: string | null; receiptPath?: string | null } = {}
    if (form.file) {
      const up = await upload(form.file, id)
      if (!up) { setSaving(false); return }
      receipt = { receiptUrl: up.storageUrl, receiptPath: up.storagePath }
    } else if (existing && !form.keepReceipt && existing.receiptPath) {
      receipt = { receiptUrl: null, receiptPath: null }
    }
    // Series settings: only sent when it repeats or used to (a database without the repeat columns can still save)
    const ends = form.ends || null
    const through = repeats !== 'none' ? restartThrough(existing, ends, today) : undefined
    const series: Partial<Row> = repeats !== 'none'
      ? { recurrence: repeats, recurrenceEnd: ends, recurring: true, ...(through ? { recurrenceThrough: through } : {}) }
      : existing?.recurrence ? { recurrence: null, recurrenceEnd: null, recurring: false } : {}
    const fields = { description: form.description.trim(), amount: parseFloat(form.amount) || 0, date: form.date, category: form.category || undefined, ...series }
    const next = existing
      ? expenses.map(x => x.id === id ? { ...x, ...fields, ...receipt } : x)
      : [{ id, projectId: '', ...fields, ...receipt, createdAt: Date.now() } as Row, ...expenses]
    const done = await persist(next, existing ? 'Expense saved.' : `Expense added${form.file ? ' with its receipt' : ''}.`)
    setSaving(false)
    if (done) {
      setForm(null)
      if (repeats !== 'none') void catchUp(next)
      // The old file is no longer referenced once the new one is saved
      if (existing?.receiptPath && (form.file || !form.keepReceipt)) void deleteFile(existing.receiptPath)
    } else if (receipt.receiptPath) void deleteFile(receipt.receiptPath)
  }

  function pickReceipt(e: Row) { fileFor.current = e; fileInput.current?.click() }
  async function onReceiptChosen(file: File | undefined) {
    const target = fileFor.current
    fileFor.current = null
    if (fileInput.current) fileInput.current.value = ''
    if (!file || !target) return
    const up = await upload(file, target.id)
    if (!up) return
    const done = await persist(expenses.map(x => x.id === target.id ? { ...x, receiptUrl: up.storageUrl, receiptPath: up.storagePath } : x), `Receipt attached to "${target.description}".`)
    if (done && target.receiptPath) void deleteFile(target.receiptPath)
    if (!done) void deleteFile(up.storagePath)
  }
  async function removeReceipt(e: Row) {
    if (!window.confirm(`Remove the receipt from "${e.description}"?`)) return
    if (await persist(expenses.map(x => x.id === e.id ? { ...x, receiptUrl: null, receiptPath: null } : x), 'Receipt removed.') && e.receiptPath) void deleteFile(e.receiptPath)
  }
  async function doStop(e: Row) {
    setConfirmStop(null)
    // Copies dated today or earlier are already there; none after today
    await persist(expenses.map(x => x.id === e.id ? { ...x, recurrenceEnd: today } : x), `"${e.description}" stopped repeating. Entries already added stay.`)
  }
  async function doDelete(e: Row) {
    setConfirmDelete(null)
    if (await persist(expenses.filter(x => x.id !== e.id), 'Expense deleted.') && e.receiptPath) void deleteFile(e.receiptPath)
  }

  // ── Numbers ──────────────────────────────────────────────────────────
  const filtered = expenses.filter(e => (!filterMonth || e.date.startsWith(filterMonth)) && (!filterCat || e.category === filterCat))
    .sort((a, b) => b.date.localeCompare(a.date))
  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0)
  const allTotal = expenses.reduce((s, e) => s + e.amount, 0)
  const focusMonth = filterMonth || thisMonth
  const monthRows = expenses.filter(e => e.date.startsWith(focusMonth))
  const monthTotal = monthRows.reduce((s, e) => s + e.amount, 0)
  const yearTotal = expenses.filter(e => e.date.startsWith(focusMonth.slice(0, 4))).reduce((s, e) => s + e.amount, 0)
  const monthlyMap = new Map<string, number>()
  for (const e of expenses) monthlyMap.set(e.date.slice(0, 7), (monthlyMap.get(e.date.slice(0, 7)) || 0) + e.amount)
  const monthlyArr = [...monthlyMap.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 6)
  const monthMax = Math.max(1, ...monthlyArr.map(([, v]) => v))
  const catMap = new Map<string, number>()
  for (const e of monthRows) catMap.set(e.category || 'Uncategorized', (catMap.get(e.category || 'Uncategorized') || 0) + e.amount)
  const catArr = [...catMap.entries()].sort(([, a], [, b]) => b - a)
  const catMax = Math.max(1, ...catArr.map(([, v]) => v))
  const months = [...new Set(expenses.map(e => e.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a))
  /** Still has entries to add (stopped today = nothing more to add) */
  const running = (e: Row) => nextOccurrence(e, today) !== null
  const series = expenses.filter(e => isFrequency(e.recurrence))
    .sort((a, b) => Number(running(b)) - Number(running(a)) || a.description.localeCompare(b.description))
  const activeSeries = series.filter(e => running(e))
  const seriesById = new Map(series.map(e => [e.id, e]))
  /** Badge for a row of a series: the first entry says how often, copies say they were added automatically */
  const repeatTag = (e: Row): { text: string; tone: 'info' | 'neutral' } | null =>
    isFrequency(e.recurrence) ? (running(e) ? { text: `Repeats ${frequencyLabel(e.recurrence).toLowerCase()}`, tone: 'info' } : { text: 'Repeat ended', tone: 'neutral' })
    : e.seriesId ? { text: `Auto · ${frequencyLabel(seriesById.get(e.seriesId)?.recurrence).toLowerCase() || 'repeat'}`, tone: 'neutral' }
    : e.recurring ? { text: 'Recurring', tone: 'info' } : null

  const receiptCell = (e: Row) => e.receiptUrl
    ? <a className="fin-receipt" href={e.receiptUrl} target="_blank" rel="noreferrer">View</a>
    : <button type="button" className="fin-receipt fin-receipt--missing" onClick={() => pickReceipt(e)} title="Upload the receipt">Missing</button>
  const rowMenu = (e: Row) => <Menu items={[
    { label: 'Edit', icon: P.edit, onClick: () => openEdit(e) },
    { label: e.receiptUrl ? 'Replace receipt' : 'Upload receipt', icon: P.upload, onClick: () => pickReceipt(e) },
    { label: 'Remove receipt', icon: P.x, hidden: !e.receiptUrl, onClick: () => void removeReceipt(e) },
    { label: 'Stop repeating', icon: P.x, hidden: !(isFrequency(e.recurrence) && running(e)), onClick: () => setConfirmStop(e) },
    'sep',
    { label: 'Delete', icon: P.trash, danger: true, onClick: () => setConfirmDelete(e) },
  ]} buttonClass="btn btn--icon btn--xs fin-more" />

  return (
    <div className="page">
      <PageHeader title="Expenses" sub="General business expenses. Project costs live on each project."
        actions={<button type="button" className="btn btn--primary" onClick={openAdd}>+ Add expense</button>} />
      {setupNote && <Banner tone="danger" onClose={() => setSetupNote(null)}>{setupNote}</Banner>}
      <input ref={fileInput} type="file" className="sr-only" aria-label="Receipt file" accept="image/*,application/pdf" onChange={e => void onReceiptChosen(e.target.files?.[0])} />

      <div className="fin-ex-top">
        <section className="card card--pad fin-ex-month">
          <span className="fin-ex-month__label">{monthLabel(focusMonth, { month: 'long', year: focusMonth.slice(0, 4) === thisMonth.slice(0, 4) ? undefined : 'numeric' })}</span>
          <span className="fin-ex-month__value num">{loading ? <Skel w={140} h={30} /> : formatMoney(monthTotal)}</span>
          <span className="fin-ex-month__note">{focusMonth.slice(0, 4)} so far: {formatMoney(yearTotal)} · all time {formatMoney(allTotal)} · {expenses.length} entr{expenses.length === 1 ? 'y' : 'ies'}</span>
          {monthlyArr.length > 1 && (
            <div className="fin-ex-months" aria-label="Last months">
              {[...monthlyArr].reverse().map(([m, v]) => (
                <button key={m} type="button" className={`fin-ex-months__col${m === focusMonth ? ' fin-ex-months__col--on' : ''}`} title={`${monthLabel(m, { month: 'long', year: 'numeric' })}: ${formatMoney(v)}`} onClick={() => setFilterMonth(m === filterMonth ? '' : m)}>
                  <span className="fin-ex-months__bar" style={{ height: `${Math.max(6, Math.round(v / monthMax * 100))}%` }} />
                  <span className="fin-ex-months__lbl">{monthLabel(m, { month: 'short' })}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="card card--pad fin-ex-cats">
          <h2 className="card__title">By category <span className="muted fin-ex-cats__when">· {monthLabel(focusMonth)}</span></h2>
          {catArr.length === 0 && <span className="muted">No expenses in {monthLabel(focusMonth)}.</span>}
          {catArr.map(([c, v]) => (
            <button key={c} type="button" className={`fin-ex-cat${filterCat === c ? ' fin-ex-cat--on' : ''}`} onClick={() => setFilterCat(filterCat === c || c === 'Uncategorized' ? '' : c)}>
              <span className="fin-ex-cat__name">{c}</span>
              <span className="fin-ex-cat__track"><span className="fin-ex-cat__fill" style={{ width: `${Math.round(v / catMax * 100)}%` }} /></span>
              <span className="fin-ex-cat__val num">{formatMoney(v)}</span>
            </button>
          ))}
        </section>
      </div>

      {series.length > 0 && (
        <Card className="fin-ex-series" title="Repeating expenses" meta={`${activeSeries.length} active · about ${formatMoney(activeSeries.reduce((s, e) => s + e.amount * (e.recurrence === 'weekly' ? 52 / 12 : e.recurrence === 'yearly' ? 1 / 12 : 1), 0))} a month`}>
          <div className="fin-ex-series__list">
            {series.map(e => {
              const next = nextOccurrence(e, today)
              const active = next !== null
              return (
                <div key={e.id} className={`list-row fin-ex-series__row${active ? '' : ' fin-ex-series__row--ended'}`}>
                  <span className="list-row__main">
                    <span className="list-row__title">{e.description}</span>
                    <span className="list-row__meta">{frequencyLabel(e.recurrence)}{e.category ? ` · ${e.category}` : ''} · {next
                      ? `next ${dateShort(next)}${e.recurrenceEnd ? ` · ends ${dateShort(e.recurrenceEnd)}` : ''}`
                      : (e.recurrenceEnd || '') >= today ? `last entry added · ends ${dateShort(e.recurrenceEnd || '')}` : `ended ${dateShort(e.recurrenceEnd || '')}`}</span>
                  </span>
                  <span className="fin-strong num">{formatMoney(e.amount)}</span>
                  <span className="fin-ex-series__actions">
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => openEdit(e)}>Edit</button>
                    {active && <button type="button" className="btn btn--sm" onClick={() => setConfirmStop(e)}>Stop</button>}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <div className="fin-toolbar">
        <span className="fin-toolbar__count">{filtered.length} expense{filtered.length !== 1 ? 's' : ''} · {formatMoney(filteredTotal)}</span>
        <span className="spacer" />
        <select className="select select--sm fin-project-filter" aria-label="Month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m, { month: 'long', year: 'numeric' })}</option>)}
        </select>
        <select className="select select--sm fin-project-filter" aria-label="Category" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.slice(1).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filterMonth || filterCat) && <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setFilterMonth(''); setFilterCat('') }}>Clear</button>}
      </div>

      {loading ? (
        <div className="table-card fin-skel">{[0, 1, 2, 3].map(i => <div key={i} className="fin-skel__row"><Skel w={60} /><Skel w="40%" /><Skel w={80} /><Skel w={70} /></div>)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState action={expenses.length === 0 ? <button type="button" className="btn btn--primary" onClick={openAdd}>+ Add expense</button> : undefined}>
          {expenses.length === 0 ? 'No expenses logged yet.' : 'No expenses match the current filters.'}
        </EmptyState>
      ) : mobile ? (
        <div className="mcards">
          {filtered.map(e => (
            <div key={e.id} className="mcard">
              <div className="mcard__top">
                <div className="fin-mcard-main"><span className="mcard__title">{e.description}</span><span className="mcard__meta">{dateShort(e.date)} · {e.category || 'Uncategorized'}{repeatTag(e) ? ` · ${repeatTag(e)!.text}` : ''}</span></div>
                <div className="fin-mcard-right"><span className="fin-strong num">{formatMoney(e.amount)}</span>{receiptCell(e)}</div>
              </div>
              <div className="mcard__actions"><button type="button" className="btn" onClick={() => openEdit(e)}>Edit</button>{rowMenu(e)}</div>
            </div>
          ))}
          <div className="fin-ex-total"><span>{filterMonth || filterCat ? 'Filtered total' : 'Total'}</span><span className="num">{formatMoney(filteredTotal)}</span></div>
        </div>
      ) : (
        <div className="table-card">
          <table className="table fin-ex-table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="t-right">Amount</th><th>Receipt</th><th /></tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="muted">{dateShort(e.date)}</td>
                  <td className="t-strong">{e.description}{repeatTag(e) && <Pill tone={repeatTag(e)!.tone} className="fin-ex-rec">{repeatTag(e)!.text}</Pill>}</td>
                  <td><Pill tone="neutral">{e.category || 'Uncategorized'}</Pill></td>
                  <td className="t-num fin-strong">{formatMoney(e.amount)}</td>
                  <td>{receiptCell(e)}</td>
                  <td className="t-actions">{rowMenu(e)}</td>
                </tr>
              ))}
              <tr className="fin-ex-total-row"><td colSpan={3}>{filterMonth || filterCat ? 'Filtered total' : 'Total'}</td><td className="t-num">{formatMoney(filteredTotal)}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit expense' : 'Add expense'}
        footer={form ? <>
          <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={saving || !form.description.trim() || !form.amount} onClick={() => void saveForm()}>{saving ? 'Saving…' : 'Save'}</button>
        </> : undefined}>
        {form && (() => {
          const existing = form.id ? expenses.find(x => x.id === form.id) : undefined
          const isCopy = !!existing?.seriesId
          const parent = isCopy ? seriesById.get(existing!.seriesId!) : undefined
          const restarting = form.repeats !== 'none' && !!restartThrough(existing, form.ends || null, today)
          return <>
            {formError && <Banner tone="danger">{formError}</Banner>}
            <Field label={form.repeats !== 'none' && !isCopy ? 'First date' : 'Date'}><input className="input" type="date" aria-label="Date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Description"><input className="input" aria-label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Zoom subscription, office supplies…" /></Field>
            <Field label="Category">
              <select className="select" aria-label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c || '— None —'}</option>)}
              </select>
            </Field>
            <Field label="Amount ($)"><input className="input" type="number" step="0.01" aria-label="Amount ($)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></Field>
            <Field label="Receipt (upload)" hint={existing?.receiptUrl && !form.file ? (form.keepReceipt ? 'A receipt is attached. Choose a file to replace it.' : 'The receipt will be removed.') : 'Image or PDF. Optional.'}>
              <input className="input fin-file" type="file" aria-label="Receipt (upload)" accept="image/*,application/pdf" onChange={e => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
            </Field>
            {existing?.receiptUrl && !form.file && <Checkbox checked={form.keepReceipt} onChange={v => setForm({ ...form, keepReceipt: v })} label="Keep the attached receipt" />}
            {isCopy ? (
              <p className="fin-ex-note">Added automatically from a repeating expense{parent ? ` (“${parent.description}”, ${everyLabel(parent.recurrence)})` : ''}. Changes here only affect this entry.</p>
            ) : (
              <div className="fin-ex-repeat">
                <Field label="Repeats" hint={form.repeats !== 'none' ? repeatsHint(form.repeats, form.date, today)
                  : existing?.recurring ? 'Marked “Recurring” before repeats were automatic. Choose how often to have it add itself.' : undefined}>
                  <select className="select" aria-label="Repeats" value={form.repeats} onChange={e => setForm({ ...form, repeats: e.target.value as Repeats })}>
                    {REPEATS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </Field>
                {form.repeats !== 'none' && (
                  <Field label="Ends (optional)" hint={restarting ? 'Starting again: nothing is added for the time it was stopped.' : 'Leave empty to keep it going. You can stop it any time.'}>
                    <input className="input" type="date" aria-label="Ends on" value={form.ends} min={form.date} onChange={e => setForm({ ...form, ends: e.target.value })} />
                  </Field>
                )}
                {existing?.recurrence && form.repeats !== 'none' && <p className="fin-ex-note">Changes to the description, amount and category also apply to the entries added from now on.</p>}
              </div>
            )}
          </>
        })()}
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete expense?" sub={confirmDelete ? `"${confirmDelete.description}" · ${formatMoney(confirmDelete.amount)}. ${
          isFrequency(confirmDelete.recurrence) && running(confirmDelete) ? 'This is the first entry of a repeating expense: deleting it also stops the automatic copies (the ones already added stay). '
          : confirmDelete.seriesId ? 'Only this entry is deleted; the expense keeps repeating and this one is not added again. ' : ''}This cannot be undone.` : undefined}
        footer={<>
          <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Delete</button>
        </>} />

      <Modal open={!!confirmStop} onClose={() => setConfirmStop(null)} title="Stop repeating?" sub={confirmStop ? `"${confirmStop.description}" won't be added again after today. Entries already added stay; you can start it again from Edit.` : undefined}
        footer={<>
          <button type="button" className="btn" onClick={() => setConfirmStop(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => confirmStop && void doStop(confirmStop)}>Stop repeating</button>
        </>} />
    </div>
  )
}
