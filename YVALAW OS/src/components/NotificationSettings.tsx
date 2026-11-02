import { useEffect, useState } from 'react'
import {
  disablePush, enablePush, loadNotificationPrefs, pushState, PushSetupError, saveNotificationPref, sendNotificationsNow,
  type NotificationPref, type PushSetupErrorCode, type PushState,
} from '../services/notifications'
import { Ic, P } from './Icon'
import BoxToggle from './settings/BoxToggle'
import { useToast } from '../context/ToastContext'

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
  const toast = useToast()
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
    try { await saveNotificationPref(next) } catch (e) { setPrefs(before); toast.error((e as Error).message) }
  }
  async function saveEmailTo() {
    try { await saveNotificationPref({ ...pref('*'), emailTo: emailTo.trim() || null }); toast.success(t.saved) }
    catch (e) { toast.error((e as Error).message) }
  }
  async function device(on: boolean) {
    setBusy(true)
    try { if (on) await enablePush(); else await disablePush() } catch (e) { toast.error(e instanceof PushSetupError ? t.pushErr[e.code] : (e as Error).message) }
    setState(await pushState()); setBusy(false)
  }
  async function test() {
    setBusy(true)
    try {
      const r = await sendNotificationsNow(true)
      const text = t.testOk(r.emailed, r.pushed) + (r.emailProblem ? ` ${t.emailProblem}${r.emailProblem}` : '')
      if (r.emailProblem) toast.error(text); else toast.success(text)
    } catch (e) { toast.error((e as Error).message) }
    setBusy(false)
  }

  const deviceText = state === 'on' ? t.on : state === 'denied' ? t.denied : state === 'unsupported' ? t.unsupported : state === 'needs-install' ? t.install : t.deviceSub

  return (
    <div className="set-ns">
      <div className="set-ns__device">
        <div className="set-ns__device-text">
          <span className="set-ns__device-title">{t.device}</span>
          <span className={`set-ns__device-sub${state === 'on' ? ' set-ns__device-sub--on' : ''}`}>{deviceText}</span>
        </div>
        {state === 'on'
          ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void device(false)}>{t.turnOff}</button>
          : (state === 'off') && <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void device(true)}>{t.turnOn}</button>}
      </div>

      <div className="stack">
        <span className="section-label">{t.what}</span>
        <div className="set-ns__table" role="table" aria-label={t.what}>
          <div className="set-ns__grid set-ns__grid--head" role="row">
            <span role="columnheader">{lang === 'es' ? 'Evento' : 'Event'}</span>
            <span role="columnheader">{t.email}</span>
            <span role="columnheader">{t.push}</span>
          </div>
          {kinds.map(k => {
            const name = lang === 'es' && k.labelEs ? k.labelEs : k.label
            return (
              <div key={k.kind} className="set-ns__grid set-ns__grid--row" role="row">
                <span role="cell">{name}</span>
                <BoxToggle small label={`${t.email}: ${k.label}`} checked={pref(k.kind).email} onChange={() => void toggle(k.kind, 'email')} />
                <BoxToggle small label={`${t.push}: ${k.label}`} checked={pref(k.kind).push} onChange={() => void toggle(k.kind, 'push')} />
              </div>
            )
          })}
        </div>
        <span className="set-ns__bell">{t.bell}</span>
      </div>

      <div className="field">
        <span className="field__label">{t.sendTo}</span>
        <div className="set-ns__sendto">
          <input className="input" type="email" aria-label={t.sendTo} value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="name@example.com" />
          <button type="button" className="btn" onClick={() => void saveEmailTo()}>{t.save}</button>
        </div>
        <span className="field__hint">{t.sendToSub}</span>
      </div>

      <div className="set-ns__foot">
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void test()}>
          <Ic d={P.send} size={14} /> {busy ? t.testing : t.test}
        </button>
      </div>
    </div>
  )
}
