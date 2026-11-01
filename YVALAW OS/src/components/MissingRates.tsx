import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Employee, Project } from '../data/types'
import { usePermission } from '../context/RoleContext'
import { loadPlacementRates, rateClient, rateEmployee, rateProject, type PlacementRate } from '../services/rates'
import { localParts, resolveRates } from '../utils/moneyRules'
import { Banner } from './ui'

export type MissingRate = { project: Project; employee: Employee; bill: boolean; pay: boolean }

export function findMissingRates(projects: Project[], employees: Employee[], clients: Client[], rates: PlacementRate[]): MissingRate[] {
  const day = localParts(Date.now()).date
  const out: MissingRate[] = []
  for (const p of projects) {
    if (p.status && ['completed', 'cancelled', 'archived', 'closed'].includes(String(p.status).toLowerCase())) continue
    const client = clients.find(c => c.id === p.clientId)
    for (const id of p.employeeIds ?? []) {
      const e = employees.find(x => x.id === id)
      if (!e) continue
      const r = resolveRates({ employee: rateEmployee(e), project: rateProject(p), client: client ? rateClient(client) : null, rates, day })
      if (!r.bill.rate || !r.pay.rate) out.push({ project: p, employee: e, bill: !r.bill.rate, pay: !r.pay.rate })
    }
  }
  return out
}

/** All placement rate rows, or null without rates.manage (the permission arrives after the first render for non-CEO roles) */
export function usePlacementRateRows(): PlacementRate[] | null {
  const allowed = usePermission()
  const canRates = allowed('rates.manage')
  const [rates, setRates] = useState<PlacementRate[] | null>(null)
  useEffect(() => { if (canRates) void loadPlacementRates().then(r => setRates(r.rows)); else setRates(null) }, [canRates])
  return canRates ? rates : null
}

const what = (m: MissingRate) => (m.bill && m.pay ? 'bill + pay' : m.bill ? 'bill' : 'pay')

/** Red "missing rates" banner (Projects page): nobody should be invoiced or paid at $0.
 *  Pass `rates` when the page already loaded them; otherwise the banner loads them itself. */
export default function MissingRates({ projects, employees, clients, rates: given }: { projects: Project[]; employees: Employee[]; clients: Client[]; rates?: PlacementRate[] | null }) {
  const allowed = usePermission()
  const navigate = useNavigate()
  const [own, setOwn] = useState<PlacementRate[] | null>(null)
  const [open, setOpen] = useState(false)
  const canRates = allowed('rates.manage')
  useEffect(() => { if (canRates && given === undefined) void loadPlacementRates().then(r => setOwn(r.rows)) }, [canRates, given])
  const rates = given === undefined ? own : given
  if (!canRates || !rates) return null
  const missing = findMissingRates(projects, employees, clients, rates)
  if (missing.length === 0) return null
  const named = missing.slice(0, 3).map(m => `${m.employee.name} (${m.project.name}, ${what(m)})`)
  const list = named.length > 1 ? `${named.slice(0, -1).join(', ')}${missing.length > 3 ? ', ' : ' and '}${named[named.length - 1]}` : named[0]
  const first = missing[0]
  return (
    <div className="ops-missing">
      <Banner tone="danger" action={
        <div className="ops-missing__actions">
          {missing.length > 3 && <button type="button" className="btn btn--sm btn--ghost ops-missing__more" onClick={() => setOpen(o => !o)}>{open ? 'Hide list' : 'Show all'}</button>}
          <button type="button" className="btn btn--sm ops-btn-danger" onClick={() => navigate(`/projects/${first.project.id}?tab=rates`)}>Set rates</button>
        </div>
      }>
        <b>{missing.length} placement{missing.length === 1 ? ' has' : 's have'} no rate.</b>{' '}
        {list}{missing.length > 3 ? ` and ${missing.length - 3} more` : ''}. Weekly close and payroll would use $0 for {missing.length === 1 ? 'it' : 'them'}.
      </Banner>
      {open && (
        <div className="card ops-missing__list">
          {missing.map(m => (
            <button key={`${m.project.id}-${m.employee.id}`} type="button" className="list-row ops-row-btn" onClick={() => navigate(`/projects/${m.project.id}?tab=rates`)}>
              <span className="list-row__main">
                <span className="list-row__title">{m.employee.name} on {m.project.name}</span>
                <span className="list-row__meta t-danger">No {[m.bill && 'bill rate', m.pay && 'pay rate'].filter(Boolean).join(' or ')}</span>
              </span>
              <span className="link">Set rates →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
