/**
 * delete-staff-login — POST, CEO only. Settings → Team access → ⋯ → "Delete login".
 * Removes someone's access to YVA OS completely: their sign-in (Supabase auth user), their role row, their phone/email
 * notification settings, and the link from their staff profile (employees.user_id). The employee record and every
 * history row stay (history keeps the actor id and email). The action is written to the change history as the CEO.
 *
 * Scope: staff logins (CEO, Admin, Accounting, Recruiter, Lead Generator) and pending sign-ups only. Client portal
 * logins and employee (My workspace / YVA Time) logins are refused — they are managed from the client / employee page.
 * Refuses deleting yourself and the last CEO.
 *
 * Body: { userId } → { ok, email, role, unlinkedEmployee: string | null }
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const { STAFF_ROLES, rest, enc, authAdmin, callerFromEvent, roleOf, json } = require('./_lib/supa.cjs')

const DELETABLE = [...STAFF_ROLES, 'pending']
const ROLE_LABEL = { ceo: 'CEO', admin: 'Admin', accounting: 'Accounting', recruiter: 'Recruiter', lead_gen: 'Lead Generator', pending: 'pending sign-up' }

/** Optional tables (may not exist yet): ignore "no such table" */
const optional = p => p.catch(e => { if (e.status === 404 || e.status === 400) return null; throw e })

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const caller = await callerFromEvent(event)
    if (!caller) return json(401, { error: 'Please sign in again.' })
    if ((await roleOf(caller.id)) !== 'ceo') return json(403, { error: 'Only the CEO can delete logins.' })

    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
    const userId = String(body.userId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(400, { error: 'userId is required' })
    if (userId === caller.id) return json(400, { error: "You can't delete your own login. Ask another CEO to do it." })

    const target = (await rest(`user_roles?user_id=eq.${enc(userId)}&select=user_id,email,role&limit=1`))[0]
    if (!target) return json(404, { error: 'That login is not in the Team access list (it may already be deleted).' })
    const role = target.role
    if (role === 'client') return json(400, { error: 'This is a client portal login. Remove portal access from the client’s page instead.' })
    if (role === 'employee') return json(400, { error: 'This is an employee (My workspace / YVA Time) login. Manage it from the employee’s page instead.' })
    if (!DELETABLE.includes(role)) return json(400, { error: `Logins with the role "${role}" can't be deleted here.` })
    if (role === 'ceo') {
      const ceos = await rest('user_roles?role=eq.ceo&select=user_id')
      if (ceos.filter(r => r.user_id !== userId).length === 0) return json(400, { error: "That's the last CEO login — YVA OS always needs one. Make someone else CEO first." })
    }

    // 1. The sign-in itself. Already gone (404) is fine — finish the clean-up.
    let email = target.email || ''
    try {
      const u = await authAdmin(`users/${enc(userId)}`)
      email = email || u.email || ''
      await authAdmin(`users/${enc(userId)}`, { method: 'DELETE' })
    } catch (e) {
      if (!/\(404\)/.test(e.message)) throw e
    }

    // 2. Their role row (this is what lists them in Team access) and their notification settings / phones
    await rest(`user_roles?user_id=eq.${enc(userId)}`, { method: 'DELETE' })
    await Promise.all([
      optional(rest(`notification_prefs?user_id=eq.${enc(userId)}`, { method: 'DELETE' })),
      optional(rest(`push_subscriptions?user_id=eq.${enc(userId)}`, { method: 'DELETE' })),
    ])

    // 3. Keep the staff profile, just unlink it from the deleted login
    const unlinked = await rest(`employees?user_id=eq.${enc(userId)}&select=id,name`, { method: 'PATCH', prefer: 'return=representation', body: { user_id: null } })
    const unlinkedEmployee = unlinked?.[0]?.name || null

    // 4. Who did it, in the change history (as the signed-in CEO, so the database stamps the actor)
    const h = event.headers || {}
    await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/log_action`, {
      method: 'POST',
      headers: { Authorization: h.authorization || h.Authorization, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_kind: 'staff_login_deleted',
        p_label: `Deleted the login of ${email || 'a team member'} (${ROLE_LABEL[role] || role})${unlinkedEmployee ? ` — profile ${unlinkedEmployee} kept` : ''}`,
        p_table: 'user_roles', p_record: userId,
        p_details: { email: email || null, role, employee: unlinkedEmployee, employee_id: unlinked?.[0]?.id || null },
      }),
    }).catch(() => {})

    return json(200, { ok: true, email, role, unlinkedEmployee })
  } catch (e) {
    console.error('delete-staff-login:', e.message)
    return json(500, { error: `Could not delete the login: ${String(e.message || e).slice(0, 200)}` })
  }
}
