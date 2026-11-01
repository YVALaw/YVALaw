// Finance → Expenses: general business expenses (redesign 2026-11 → designs/Expenses.dc.html).
// Month total + last months, category bars, table with receipts (upload to the attachments bucket), add/edit/delete.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Expense } from '../data/types'
import { loadGeneralExpenses, saveGeneralExpenses } from '../services/storage'
import { deleteFile, uploadFile } from '../services/fileStorage'
import { formatMoney } from '../utils/money'
import { dateShort } from '../utils/format'
import { localParts } from '../utils/moneyRules'
import { Banner, Checkbox, EmptyState, Field, Menu, Modal, PageHeader, Pill, Skel, useIsMobile } from '../components/ui'
import { P } from '../components/Icon'

/** Expense + optional receipt (columns from supabase/migrate-redesign-finance.sql) */
type Row = Expense & { receiptUrl?: string | null; receiptPath?: string | null }
type Form = { id?: string; description: string; amount: string; date: string; category: string; recurring: boolean; file: File | null; keepReceipt: boolean }

const CATEGORIES = ['', 'Software', 'Hardware', 'Marketing', 'Office', 'Payroll', 'Legal', 'Accounting', 'Travel', 'Utilities', 'Insurance', 'Other']
const monthLabel = (m: string, opts: Intl.DateTimeFormatOptions = { month: 'long' }) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-US', opts)
const RECEIPT_SQL = 'Receipts need one database update: run supabase/migrate-redesign-finance.sql in Supabase, then try again.'

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
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const fileFor = useRef<Row | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { void loadGeneralExpenses().then(e => { setExpenses(e as Row[]); setLoading(false) }) }, [])
  // Create menu → Add expense
  useEffect(() => {
    if (params.get('create')) { openAdd(); setParams({}, { replace: true }) }
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps

  const today = localParts(Date.now()).date
  const thisMonth = today.slice(0, 7)
  const emptyForm = (): Form => ({ description: '', amount: '', date: today, category: '', recurring: false, file: null, keepReceipt: true })
  function openAdd() { setForm(emptyForm()) }
  function openEdit(e: Row) { setForm({ id: e.id, description: e.description, amount: String(e.amount), date: e.date, category: e.category || '', recurring: !!e.recurring, file: null, keepReceipt: true }) }

  /** Optimistic save, rolled back with the reason if the database refused */
  async function persist(next: Row[], okMsg: string): Promise<boolean> {
    const prev = expenses
    setExpenses(next)
    try { await saveGeneralExpenses(next); setBanner({ tone: 'success', text: okMsg }); return true }
    catch (e) {
      setExpenses(prev)
      const m = (e as Error).message || ''
      setBanner({ tone: 'danger', text: /receipt_(url|path)/.test(m) ? RECEIPT_SQL : `Not saved: ${m}` })
      return false
    }
  }
  async function upload(file: File, expenseId: string): Promise<{ storageUrl: string; storagePath: string } | null> {
    try { return await uploadFile(file, `expenses/${expenseId}`) }
    catch (e) { setBanner({ tone: 'danger', text: `The receipt could not be uploaded: ${(e as Error).message}` }); return null }
  }

  async function saveForm() {
    if (!form || !form.description.trim() || !form.amount) return
    setSaving(true)
    const existing = form.id ? expenses.find(x => x.id === form.id) : undefined
    const id = existing?.id ?? crypto.randomUUID()
    let receipt: { receiptUrl?: string | null; receiptPath?: string | null } = {}
    if (form.file) {
      const up = await upload(form.file, id)
      if (!up) { setSaving(false); return }
      receipt = { receiptUrl: up.storageUrl, receiptPath: up.storagePath }
    } else if (existing && !form.keepReceipt && existing.receiptPath) {
      receipt = { receiptUrl: null, receiptPath: null }
    }
    const fields = { description: form.description.trim(), amount: parseFloat(form.amount) || 0, date: form.date, category: form.category || undefined, recurring: form.recurring || undefined }
    const next = existing
      ? expenses.map(x => x.id === id ? { ...x, ...fields, ...receipt } : x)
      : [{ id, projectId: '', ...fields, ...receipt, createdAt: Date.now() } as Row, ...expenses]
    const done = await persist(next, existing ? 'Expense saved.' : `Expense added${form.file ? ' with its receipt' : ''}.`)
    setSaving(false)
    if (done) {
      setForm(null)
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

  const receiptCell = (e: Row) => e.receiptUrl
    ? <a className="fin-receipt" href={e.receiptUrl} target="_blank" rel="noreferrer">View</a>
    : <button type="button" className="fin-receipt fin-receipt--missing" onClick={() => pickReceipt(e)} title="Upload the receipt">Missing</button>
  const rowMenu = (e: Row) => <Menu items={[
    { label: 'Edit', icon: P.edit, onClick: () => openEdit(e) },
    { label: e.receiptUrl ? 'Replace receipt' : 'Upload receipt', icon: P.upload, onClick: () => pickReceipt(e) },
    { label: 'Remove receipt', icon: P.x, hidden: !e.receiptUrl, onClick: () => void removeReceipt(e) },
    'sep',
    { label: 'Delete', icon: P.trash, danger: true, onClick: () => setConfirmDelete(e) },
  ]} buttonClass="btn btn--icon btn--xs fin-more" />

  return (
    <div className="page">
      <PageHeader title="Expenses" sub="General business expenses. Project costs live on each project."
        actions={<button type="button" className="btn btn--primary" onClick={openAdd}>+ Add expense</button>} />
      {banner && <Banner tone={banner.tone} onClose={() => setBanner(null)}>{banner.text}</Banner>}
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
                <div className="fin-mcard-main"><span className="mcard__title">{e.description}</span><span className="mcard__meta">{dateShort(e.date)} · {e.category || 'Uncategorized'}{e.recurring ? ' · Recurring' : ''}</span></div>
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
                  <td className="t-strong">{e.description}{e.recurring && <Pill tone="info" className="fin-ex-rec">Recurring</Pill>}</td>
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
          return <>
            <Field label="Date"><input className="input" type="date" aria-label="Date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
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
            <Checkbox checked={form.recurring} onChange={v => setForm({ ...form, recurring: v })} label="Recurring expense" />
          </>
        })()}
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete expense?" sub={confirmDelete ? `"${confirmDelete.description}" · ${formatMoney(confirmDelete.amount)}. This cannot be undone.` : undefined}
        footer={<>
          <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Delete</button>
        </>} />
    </div>
  )
}
