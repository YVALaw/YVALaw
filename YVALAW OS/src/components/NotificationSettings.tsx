import { useEffect, useState } from 'react'
import {
  disablePush, enablePush, loadNotificationPrefs, pushState, PushSetupError, saveNotificationPref, sendNotificationsNow,
  type NotificationPref, type PushSetupErrorCode, type PushState,
} from '../services/notifications'

type Kind = { kind: string; label: string; labelEs?: string }

const T = {
  en: {
    device: 'Phone & computer notifications', deviceSub: 'Get a notification on this device, even when YVA OS is closed.',
    on: 'On for this device', turnOn: 'Turn on for this device', turnOff: 'Turn off', denied: 'Blocked — allow notifications for this site in your browser or phone settings.',
    unsupported: 'This browser cannot show notifications.', install: 'On iPhone: tap Share → "Add to Home Screen", open YVA OS from the new icon, then turn this on here.',
    what: 'What to tell me about', email: 'Email', push: 'Phone', sendTo: 'Send my notification emails to', sendToSub: 'Leave empty to use your login email.',
    save: 'Save', saved: 'Saved', test: 'Send me a test', testing: 'Sending…', testOk: (e: number, p: number) => `Test sent${e ? ' · email ✓' : ''}${p ? ' · phone ✓' : ''}.`,
    emailProblem: 'Email not sent: ', bell: 'Everything always shows in the bell.',
    pushErr: { ios_install: 'On iPhone: tap Share → "Add to Home Screen", open YVA OS from the new icon, then turn this on.', unsupported: 'This browser does not support notifications.',
      not_allowed: 'Notifications were not allowed. You can allow them in your browser or phone settings.', not_configured: 'Phone notifications are not set up on the server yet.',
      signed_out: 'You are not signed in. Sign in again and try once more.', other_account: 'This device is registered to another YVA account. Sign out there first.' } as Record<PushSetupErrorCode, string>,
  },
  es: {
    device: 'Notificaciones en el teléfono y la computadora', deviceSub: 'Recibe un aviso en este dispositivo, aunque YVA OS esté cerrado.',
    on: 'Activadas en este dispositivo', turnOn: 'Activar en este dispositivo', turnOff: 'Desactivar', denied: 'Bloqueadas — permite las notificaciones de este sitio en la configuración del navegador o del teléfono.',
    unsupported: 'Este navegador no puede mostrar notificaciones.', install: 'En iPhone: toca Compartir → "Agregar a pantalla de inicio", abre YVA OS desde el nuevo ícono y actívalas aquí.',
    what: 'Avisarme sobre', email: 'Correo', push: 'Teléfono', sendTo: 'Enviar mis correos de aviso a', sendToSub: 'Déjalo vacío para usar tu correo de inicio de sesión.',
    save: 'Guardar', saved: 'Guardado', test: 'Enviarme una prueba', testing: 'Enviando…', testOk: (e: number, p: number) => `Prueba enviada${e ? ' · correo ✓' : ''}${p ? ' · teléfono ✓' : ''}.`,
    emailProblem: 'Correo no enviado: ', bell: 'Todo aparece siempre en la campana.',
    pushErr: { ios_install: 'En iPhone: toca Compartir → "Agregar a pantalla de inicio", abre YVA OS desde el nuevo ícono y actívalas aquí.', unsupported: 'Este navegador no admite notificaciones.',
      not_allowed: 'No se permitieron las notificaciones. Puedes permitirlas en la configuración del navegador o del teléfono.', not_configured: 'Las notificaciones al teléfono aún no están configuradas en el servidor.',
      signed_out: 'No has iniciado sesión. Vuelve a iniciar sesión e inténtalo otra vez.', other_account: 'Este dispositivo está registrado con otra cuenta de YVA. Cierra sesión allí primero.' } as Record<PushSetupErrorCode, string>,
  },
}

/** Per-person notification choices + this device's push switch (staff Settings and My workspace) */
export default function NotificationSettings({ kinds, lang = 'en' }: { kinds: Kind[]; lang?: 'en' | 'es' }) {
  const t = T[lang]
  const [prefs, setPrefs] = useState<NotificationPref[]>([])
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [emailTo, setEmailTo] = useState('')

  useEffect(() => {
    void loadNotificationPrefs().then(p => { setPrefs(p); setEmailTo(p.find(x => x.kind === '*')?.emailTo ?? '') })
    void pushState().then(setState)
  }, [])

  const pref = (kind: string): NotificationPref => prefs.find(p => p.kind === kind) ?? { kind, email: true, push: true, emailTo: null }
  async function toggle(kind: string, field: 'email' | 'push') {
    const next = { ...pref(kind), [field]: !pref(kind)[field] }
    const before = prefs
    setPrefs(list => [...list.filter(p => p.kind !== kind), next])
    try { await saveNotificationPref(next) } catch (e) { setPrefs(before); setMsg({ ok: false, text: (e as Error).message }) }
  }
  async function saveEmailTo() {
    try { await saveNotificationPref({ ...pref('*'), emailTo: emailTo.trim() || null }); setMsg({ ok: true, text: t.saved }) }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  async function device(on: boolean) {
    setBusy(true); setMsg(null)
    try { if (on) await enablePush(); else await disablePush() } catch (e) { setMsg({ ok: false, text: e instanceof PushSetupError ? t.pushErr[e.code] : (e as Error).message }) }
    setState(await pushState()); setBusy(false)
  }
  async function test() {
    setBusy(true); setMsg(null)
    try {
      const r = await sendNotificationsNow(true)
      setMsg({ ok: !r.emailProblem, text: t.testOk(r.emailed, r.pushed) + (r.emailProblem ? ` ${t.emailProblem}${r.emailProblem}` : '') })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-info">
          <div className="settings-row-label">{t.device}</div>
          <div className="settings-row-sub">
            {state === 'on' ? t.on : state === 'denied' ? t.denied : state === 'unsupported' ? t.unsupported : state === 'needs-install' ? t.install : t.deviceSub}
          </div>
        </div>
        {state === 'on'
          ? <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void device(false)}>{t.turnOff}</button>
          : (state === 'off') && <button className="btn-primary btn-sm" disabled={busy} onClick={() => void device(true)}>{t.turnOn}</button>}
      </div>

      <div>
        <div className="settings-row-label" style={{ marginBottom: 6 }}>{t.what}</div>
        <div className="table-wrap">
          <table className="perm-table">
            <thead><tr><th></th><th style={{ width: 70 }}>{t.email}</th><th style={{ width: 70 }}>{t.push}</th></tr></thead>
            <tbody>
              {kinds.map(k => (
                <tr key={k.kind}>
                  <td>{lang === 'es' && k.labelEs ? k.labelEs : k.label}</td>
                  <td><input type="checkbox" aria-label={`${t.email}: ${k.label}`} checked={pref(k.kind).email} onChange={() => void toggle(k.kind, 'email')} /></td>
                  <td><input type="checkbox" aria-label={`${t.push}: ${k.label}`} checked={pref(k.kind).push} onChange={() => void toggle(k.kind, 'push')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{t.bell}</div>
      </div>

      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">{t.sendTo}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="form-input" type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="name@example.com" style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
          <button className="btn-ghost btn-sm" onClick={() => void saveEmailTo()}>{t.save}</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{t.sendToSub}</div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void test()}>{busy ? t.testing : t.test}</button>
        {msg && <span style={{ fontSize: 13, color: msg.ok ? '#15803d' : '#dc2626' }}>{msg.text}</span>}
      </div>
    </div>
  )
}
