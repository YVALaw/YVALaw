// My workspace strings (Spanish / English). The employee picks the language (saved on this device);
// first visit follows the phone/computer language. YVA OS itself stays in English.
import { useState } from 'react'

export type Lang = 'en' | 'es'
const KEY = 'yva_me_lang'

export function useMeLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'es') return s } catch { /* private mode */ }
    return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
  })
  return [lang, (l: Lang) => { setLang(l); try { localStorage.setItem(KEY, l) } catch { /* ignore */ } }]
}

const en = {
  workspace: 'My workspace', signOut: 'Sign out', loading: 'Loading your workspace…', language: 'Language', dockLabel: 'Workspace',
  loadError: 'Could not load your profile.', networkError: 'Network error — could not load your profile. Check your connection and reload.',
  greeting: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  staff: { viewing: (name: string) => `Viewing ${name}'s workspace as staff`, back: 'Back to YVA OS' },
  nav: { home: 'Home', time: 'My time', pay: 'My pay', requests: 'Requests', client: 'My client', more: 'More',
    screenshots: 'My screenshots', company: 'Company', documents: 'Documents', profile: 'Profile' },
  backToMore: 'More',
  status: { approved: 'approved', waiting: 'not approved yet' },
  home: {
    trackingNow: 'Tracking now', notTracking: 'Not tracking right now', lastActive: 'Last active', lastOn: 'on', today: 'Today',
    payday: 'Next payday', hoursWeek: 'Hours this week', ofTarget: (target: string) => `of ${target} target`,
    nextHoliday: 'Next holiday', noHoliday: 'None coming up', requestsWaiting: 'Requests waiting', noneWaiting: 'Nothing waiting',
    notices: 'Notices', getApp: 'Download YVA Time for Windows',
    appHint: 'Install it, open it and click "Sign in with YVA OS".', noApp: 'The YVA Time app for Windows is coming soon.',
    screenshotsOn: 'While you track time, the app takes a screenshot about every 10 minutes and records activity % (keyboard/mouse use — never what you type). You can delete a screenshot within 2 minutes.',
    screenshotsOff: 'As part of the YVA team, screenshots are off for you.',
    earningsError: 'Could not load your tracking status.',
  },
  time: {
    thisWeek: 'This week', lastWeek: 'Last week', weekToggle: 'Week', approvedBy: 'approved by YVA',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], sub: 'From the YVA Time app — YVA approves your hours each week.',
    changes: 'Changes made by YVA', changesSub: 'When YVA adjusts your time, you see it here with the reason.',
  },
  adjust: { none: 'YVA has not changed any of your time.', moved: 'Moved to next week', movedIn: 'Moved in from last week', added: 'Added', removed: 'Removed', late: 'Late time added' },
  pay: {
    thisPeriod: 'This pay period', paidOn: 'paid', today: 'Today', night: 'night premium', perHour: '/hr',
    missing: 'Your pay rate is not set yet — YVA will add it.', none: 'No tracked time in this pay period yet.', updated: 'Updated',
    explain: 'Not approved yet = tracked, YVA has not approved the hours. Approved = YVA approved the hours. Payslips appear below once YVA pays you.',
    error: 'Could not load your pay.',
    payslips: 'Payslips', payslip: 'Payslip', noSlips: 'No payments yet. Your payslips appear here after YVA pays you.',
    adjustments: 'Bonuses and deductions', noAdjustments: 'No bonuses or deductions yet.', bonus: 'Bonus', deduction: 'Deduction',
  },
  shots: { sub: 'What YVA sees — your screenshots and activity, by day (kept 60 days).' },
  requests: {
    askOff: 'Ask for time off', askOffSub: 'Vacation, sick or personal days — YVA approves.', kind: 'Type', kinds: { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', other: 'Other' },
    from: 'From', to: 'To', note: 'Reason (optional)', halfDay: 'Half day', send: 'Send request', sending: 'Sending…', sent: 'Sent. You will get a notification when YVA answers.',
    mine: 'My requests', cancel: 'Cancel', none: 'No requests yet.', timeOff: 'Time off', missingTime: 'Missing time',
    status: { pending: 'Waiting', approved: 'Approved', declined: 'Declined', rejected: 'Rejected', cancelled: 'Cancelled' },
    badDates: 'The end date must be on or after the start date.',
    tooLong: 'One request can cover at most 61 days. Send longer leave as two requests.', tooOld: 'The start date can be at most 30 days ago. Contact YVA for older dates.',
  },
  manual: {
    title: 'Add missing time', sub: 'Forgot to start the timer, or worked offline? Ask YVA to add it.',
    off: 'Adding time by hand is not enabled for your account. Ask YVA if you need it.',
    day: 'Date', from: 'From', to: 'To', workedOn: 'Worked on', why: 'Reason', whyPh: 'e.g. Power cut — worked on paper and called clients from my phone',
    send: 'Send request', sending: 'Sending…', sent: 'Sent. YVA will approve or reject it — you will see the answer in Requests.', seeRequests: 'See my requests',
    noTarget: "You're not assigned to a project yet, so there's nothing to add time to.", pick: 'Pick what you worked on.', endAfter: 'The end time must be after the start time.',
    max12: 'One request can cover at most 12 hours.', future: "You can't request time in the future.", old: 'Requests can only go back 14 days. Contact YVA for older time.',
    reason: 'Tell YVA briefly why the time is missing.', added: 'min added', yva: 'YVA', project: 'Project',
  },
  client: { none: "You're not assigned to a client project yet.", yvaTeam: 'You work for YVA directly.',
    supervisor: 'Supervisor', noSupervisor: 'No supervisor set yet — ask YVA.', instructions: 'Instructions', noInstructions: 'No instructions yet.',
    shift: 'My shift', noShift: 'No shift set yet — ask YVA.', weekdays: 'Mon–Fri', email: 'Email', call: 'Call', whatsapp: 'WhatsApp' },
  more: { companySub: 'Notices and holidays', profileSub: 'Details and notifications', screenshotsSub: 'What YVA sees', documentsSub: 'Contract and files' },
  docs: { none: 'No documents yet.', download: 'Download', categories: { contract: 'Contract', policy: 'Policy', tax: 'Tax', id: 'ID', other: 'Other' } },
  company: { announcements: 'Announcements', none: 'No announcements yet.', holidays: 'Holidays', noHolidays: 'No upcoming holidays.', paid: 'Paid', pinned: 'Pinned' },
  profile: { details: 'My details', detailsSub: "Ask YVA to update anything that's wrong.", notifications: 'Notifications', notificationsSub: 'Phone notifications and emails from YVA.',
    name: 'Name', number: 'Employee number', position: 'Position', email: 'Email', phone: 'Phone', timezone: 'Time zone', shift: 'Shift', team: 'Team',
    clientTeam: 'Client team', yvaTeam: 'YVA team', app: 'YVA Time app' },
}
export type Dict = typeof en
const es: Dict = {
  workspace: 'Mi espacio', signOut: 'Cerrar sesión', loading: 'Cargando tu espacio…', language: 'Idioma', dockLabel: 'Mi espacio',
  loadError: 'No se pudo cargar tu perfil.', networkError: 'Error de red — no se pudo cargar tu perfil. Revisa tu conexión y recarga la página.',
  greeting: { morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches' },
  staff: { viewing: (name: string) => `Viendo el espacio de ${name} como personal`, back: 'Volver a YVA OS' },
  nav: { home: 'Inicio', time: 'Mi tiempo', pay: 'Mi pago', requests: 'Solicitudes', client: 'Mi cliente', more: 'Más',
    screenshots: 'Mis capturas', company: 'Empresa', documents: 'Documentos', profile: 'Perfil' },
  backToMore: 'Más',
  status: { approved: 'aprobadas', waiting: 'sin aprobar' },
  home: {
    trackingNow: 'Registrando ahora', notTracking: 'No estás registrando tiempo', lastActive: 'Última actividad', lastOn: 'en', today: 'Hoy',
    payday: 'Próximo pago', hoursWeek: 'Horas esta semana', ofTarget: (target: string) => `de ${target} de meta`,
    nextHoliday: 'Próximo feriado', noHoliday: 'Ninguno próximo', requestsWaiting: 'Solicitudes pendientes', noneWaiting: 'Nada pendiente',
    notices: 'Avisos', getApp: 'Descargar YVA Time para Windows',
    appHint: 'Instálalo, ábrelo y haz clic en "Sign in with YVA OS".', noApp: 'La app YVA Time para Windows estará disponible pronto.',
    screenshotsOn: 'Mientras registras tiempo, la app toma una captura cada 10 minutos aprox. y registra el % de actividad (uso de teclado/ratón — nunca lo que escribes). Puedes borrar una captura dentro de 2 minutos.',
    screenshotsOff: 'Como parte del equipo YVA, las capturas están desactivadas para ti.',
    earningsError: 'No se pudo cargar tu estado de registro.',
  },
  time: {
    thisWeek: 'Esta semana', lastWeek: 'Semana pasada', weekToggle: 'Semana', approvedBy: 'aprobadas por YVA',
    days: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], sub: 'Desde la app YVA Time — YVA aprueba tus horas cada semana.',
    changes: 'Cambios hechos por YVA', changesSub: 'Cuando YVA ajusta tu tiempo, lo ves aquí con el motivo.',
  },
  adjust: { none: 'YVA no ha cambiado tu tiempo.', moved: 'Movido a la próxima semana', movedIn: 'Movido desde la semana pasada', added: 'Agregado', removed: 'Quitado', late: 'Tiempo tardío agregado' },
  pay: {
    thisPeriod: 'Este período de pago', paidOn: 'se paga el', today: 'Hoy', night: 'prima nocturna', perHour: '/h',
    missing: 'Tu tarifa aún no está configurada — YVA la agregará.', none: 'Aún no hay tiempo registrado en este período.', updated: 'Actualizado',
    explain: 'Sin aprobar = registrado, YVA aún no aprobó las horas. Aprobadas = YVA aprobó las horas. Los volantes aparecen abajo cuando YVA te paga.',
    error: 'No se pudo cargar tu pago.',
    payslips: 'Volantes de pago', payslip: 'Volante de pago', noSlips: 'Aún no hay pagos. Tus volantes aparecen aquí cuando YVA te paga.',
    adjustments: 'Bonos y descuentos', noAdjustments: 'Aún no hay bonos ni descuentos.', bonus: 'Bono', deduction: 'Descuento',
  },
  shots: { sub: 'Lo que ve YVA — tus capturas y actividad por día (se guardan 60 días).' },
  requests: {
    askOff: 'Pedir días libres', askOffSub: 'Vacaciones, enfermedad o días personales — YVA aprueba.', kind: 'Tipo', kinds: { vacation: 'Vacaciones', sick: 'Enfermedad', personal: 'Personal', other: 'Otro' },
    from: 'Desde', to: 'Hasta', note: 'Motivo (opcional)', halfDay: 'Medio día', send: 'Enviar solicitud', sending: 'Enviando…', sent: 'Enviada. Recibirás una notificación cuando YVA responda.',
    mine: 'Mis solicitudes', cancel: 'Cancelar', none: 'Aún no hay solicitudes.', timeOff: 'Días libres', missingTime: 'Tiempo faltante',
    status: { pending: 'Pendiente', approved: 'Aprobada', declined: 'Rechazada', rejected: 'Rechazada', cancelled: 'Cancelada' },
    badDates: 'La fecha final debe ser igual o posterior a la inicial.',
    tooLong: 'Una solicitud puede cubrir como máximo 61 días. Envía una ausencia más larga en dos solicitudes.', tooOld: 'La fecha de inicio puede ser como máximo de hace 30 días. Contacta a YVA para fechas anteriores.',
  },
  manual: {
    title: 'Agregar tiempo faltante', sub: '¿Olvidaste iniciar el temporizador o trabajaste sin conexión? Pide a YVA que lo agregue.',
    off: 'Agregar tiempo a mano no está activado para tu cuenta. Pregunta a YVA si lo necesitas.',
    day: 'Fecha', from: 'Desde', to: 'Hasta', workedOn: 'Trabajé en', why: 'Motivo', whyPh: 'p. ej. Se fue la luz — trabajé en papel y llamé a clientes desde mi teléfono',
    send: 'Enviar solicitud', sending: 'Enviando…', sent: 'Enviada. YVA la aprobará o rechazará — verás la respuesta en Solicitudes.', seeRequests: 'Ver mis solicitudes',
    noTarget: 'Aún no estás asignado a un proyecto, así que no hay dónde agregar tiempo.', pick: 'Elige en qué trabajaste.', endAfter: 'La hora final debe ser después de la inicial.',
    max12: 'Una solicitud puede cubrir como máximo 12 horas.', future: 'No puedes solicitar tiempo en el futuro.', old: 'Solo puedes solicitar hasta 14 días atrás. Contacta a YVA para tiempo más antiguo.',
    reason: 'Explica brevemente a YVA por qué falta el tiempo.', added: 'min agregados', yva: 'YVA', project: 'Proyecto',
  },
  client: { none: 'Aún no estás asignado a un proyecto de cliente.', yvaTeam: 'Trabajas directamente para YVA.',
    supervisor: 'Supervisor(a)', noSupervisor: 'Aún no hay supervisor(a) — pregunta a YVA.', instructions: 'Instrucciones', noInstructions: 'Aún no hay instrucciones.',
    shift: 'Mi horario', noShift: 'Aún no tienes horario — pregunta a YVA.', weekdays: 'Lun–Vie', email: 'Correo', call: 'Llamar', whatsapp: 'WhatsApp' },
  more: { companySub: 'Avisos y feriados', profileSub: 'Datos y notificaciones', screenshotsSub: 'Lo que ve YVA', documentsSub: 'Contrato y archivos' },
  docs: { none: 'Aún no hay documentos.', download: 'Descargar', categories: { contract: 'Contrato', policy: 'Política', tax: 'Impuestos', id: 'Identificación', other: 'Otro' } },
  company: { announcements: 'Avisos', none: 'Aún no hay avisos.', holidays: 'Feriados', noHolidays: 'No hay feriados próximos.', paid: 'Pagado', pinned: 'Fijado' },
  profile: { details: 'Mis datos', detailsSub: 'Pide a YVA que corrija cualquier dato incorrecto.', notifications: 'Notificaciones', notificationsSub: 'Notificaciones en el teléfono y correos de YVA.',
    name: 'Nombre', number: 'Número de empleado', position: 'Cargo', email: 'Correo', phone: 'Teléfono', timezone: 'Zona horaria', shift: 'Horario', team: 'Equipo',
    clientTeam: 'Equipo del cliente', yvaTeam: 'Equipo YVA', app: 'App YVA Time' },
}
export const DICT: Record<Lang, Dict> = { en, es }
export const locale = (l: Lang) => (l === 'es' ? 'es-DO' : 'en-US')
/** "2026-11-06" → "Fri, Nov 6" in the employee's language (noon avoids the UTC-midnight day shift) */
export const dateLabel = (d: string, lang: Lang, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(locale(lang), o)
/** seconds → "7h 05m" */
export const hm = (s: number) => { const m = Math.round(Math.abs(s) / 60); return `${s < 0 ? '−' : ''}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
