import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Employee, Project } from '../data/types'
import { usePermission } from '../context/RoleContext'
import { loadPlacementRates, rateClient, rateEmployee, rateProject, type PlacementRate } from '../services/rates'
import { localParts, resolveRates } from '../utils/moneyRules'

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

/** "Missing rates" warning (Projects page): nobody should be invoiced or paid at $0 */
export default function MissingRates({ projects, employees, clients }: { projects: Project[]; employees: Employee[]; clients: Client[] }) {
  const allowed = usePermission()
  const navigate = useNavigate()
  const [rates, setRates] = useState<PlacementRate[] | null>(null)
  const [open, setOpen] = useState(false)
  // Permissions load after the first render for non-CEO roles: re-run when the permission arrives
  const canRates = allowed('rates.manage')
  useEffect(() => { if (canRates) void loadPlacementRates().then(r => setRates(r.rows)) }, [canRates])
  if (!canRates || rates === null) return null
  const missing = findMissingRates(projects, employees, clients, rates)
  if (missing.length === 0) return null
  return (
    <div className="data-card" style={{ borderLeft: '4px solid #dc2626', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong>{missing.length} placement{missing.length === 1 ? '' : 's'} without a rate</strong>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>They would be invoiced or paid at $0.</span>
        <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {missing.map(m => (
            <button key={`${m.project.id}-${m.employee.id}`} className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => navigate(`/projects/${m.project.id}`)}>
              <strong>{m.employee.name}</strong>&nbsp;on {m.project.name} — no {[m.bill && 'bill rate', m.pay && 'pay rate'].filter(Boolean).join(' or ')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
