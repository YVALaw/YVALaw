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
  workspace: 'My workspace', hi: 'Hi', signOut: 'Sign out', loading: 'Loading your workspace…', more: 'More',
  loadError: 'Could not load your profile.', networkError: 'Network error — could not load your profile. Check your connection and reload.',
  nav: { home: 'Home', time: 'My time', pay: 'My pay', screenshots: 'My screenshots', requests: 'Requests', client: 'My client', documents: 'Documents', company: 'Company', profile: 'Profile' },
  home: {
    trackingNow: 'Tracking now', notTracking: 'Not tracking', lastActive: 'Last active', today: 'Today', week: 'This week', target: 'of', targetSuffix: 'target',
    notices: 'Notices', nextHoliday: 'Next holiday', pendingRequests: 'requests waiting for YVA', getApp: 'Download YVA Time for Windows',
    appHint: 'Install it, open it and click "Sign in with YVA OS".', noApp: 'The YVA Time app for Windows is coming soon.',
    screenshotsOn: 'While you track time, the app takes a screenshot about every 10 minutes and records activity % (keyboard/mouse use — never what you type). You can delete a screenshot within 2 minutes.',
    screenshotsOff: 'As part of the YVA team, screenshots are off for you.',
  },
  time: { title: 'My hours', sub: 'From the YVA Time app — YVA approves them each week', changes: 'Changes made by YVA', changesSub: 'When YVA adjusts your time, you see it here with the reason',
    thisWeek: 'This week', lastWeek: 'Last week', weekTotal: 'Week total', approvedBy: 'approved by YVA', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  pay: { title: 'My pay', sub: 'Live earnings — updates every minute while you track', payslips: 'Payslips' },
  shots: { title: 'My screenshots', sub: 'What YVA sees — your screenshots and activity, by day (kept 60 days)' },
  requests: {
    timeOff: 'Time off', timeOffSub: 'Vacation, sick or personal days — YVA approves', kind: 'Type', kinds: { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', other: 'Other' },
    from: 'From', to: 'To', note: 'Note (optional)', halfDay: 'Half day', send: 'Send request', sending: 'Sending…', sent: 'Sent. You will get a notification when YVA answers.',
    mine: 'My requests', cancel: 'Cancel', status: { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' }, none: 'No requests yet.',
    badDates: 'The end date must be on or after the start date.', missing: 'Add missing time', missingSub: 'Forgot to start the timer, or worked offline? Ask YVA to add it',
    missingOff: 'Adding time by hand is not enabled for your account. Ask YVA if you need it.',
    tooLong: 'One request can cover at most 61 days. Send longer leave as two requests.', tooOld: 'The start date can be at most 30 days ago. Contact YVA for older dates.',
  },
  manual: { day: 'Day', from: 'From', to: 'To', workedOn: 'Worked on', why: 'Why is this time missing?', whyPh: 'e.g. Power cut — worked on paper and called clients from my phone',
    send: 'Send to YVA for approval', sending: 'Sending…', sent: 'Sent. YVA will approve or reject it — you will see the answer here.', mine: 'My requests', cancel: 'Cancel',
    noTarget: "You're not assigned to a project yet, so there's nothing to add time to.", pick: 'Pick what you worked on.', endAfter: 'The end time must be after the start time.',
    max12: 'One request can cover at most 12 hours.', future: "You can't request time in the future.", old: 'Requests can only go back 14 days. Contact YVA for older time.',
    reason: 'Tell YVA briefly why the time is missing.', added: 'min added', yva: 'YVA', project: 'Project', status: { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' } },
  client: { title: 'My client', sub: 'Who you work for, your supervisor and instructions', none: "You're not assigned to a client project yet.", yvaTeam: 'You work for YVA directly.',
    supervisor: 'Supervisor', instructions: 'Instructions', noInstructions: 'No instructions yet.' },
  docs: { title: 'Documents', sub: 'Your contract and other files from YVA', none: 'No documents yet.', open: 'Open', categories: { contract: 'Contract', policy: 'Policy', tax: 'Tax', id: 'ID', other: 'Other' } },
  company: { title: 'Company', sub: 'Announcements and holidays', announcements: 'Announcements', none: 'No announcements yet.', holidays: 'Holidays', noHolidays: 'No upcoming holidays.', paid: 'paid', pinned: 'Pinned' },
  profile: { title: 'Profile', details: 'My details', detailsSub: "Ask YVA to update anything that's wrong", notifications: 'Notifications', notificationsSub: 'Phone notifications and emails from YVA',
    language: 'Language', name: 'Name', number: 'Employee number', position: 'Position', email: 'Email', phone: 'Phone', timezone: 'Time zone', shift: 'Shift', app: 'YVA Time app' },
}
export type Dict = typeof en
const es: Dict = {
  workspace: 'Mi espacio', hi: 'Hola', signOut: 'Cerrar sesión', loading: 'Cargando tu espacio…', more: 'Más',
  loadError: 'No se pudo cargar tu perfil.', networkError: 'Error de red — no se pudo cargar tu perfil. Revisa tu conexión y recarga la página.',
  nav: { home: 'Inicio', time: 'Mi tiempo', pay: 'Mi pago', screenshots: 'Mis capturas', requests: 'Solicitudes', client: 'Mi cliente', documents: 'Documentos', company: 'Empresa', profile: 'Perfil' },
  home: {
    trackingNow: 'Registrando ahora', notTracking: 'Sin registrar', lastActive: 'Última actividad', today: 'Hoy', week: 'Esta semana', target: 'de', targetSuffix: 'meta',
    notices: 'Avisos', nextHoliday: 'Próximo feriado', pendingRequests: 'solicitudes esperando respuesta de YVA', getApp: 'Descargar YVA Time para Windows',
    appHint: 'Instálalo, ábrelo y haz clic en "Sign in with YVA OS".', noApp: 'La app YVA Time para Windows estará disponible pronto.',
    screenshotsOn: 'Mientras registras tiempo, la app toma una captura cada 10 minutos aprox. y registra el % de actividad (uso de teclado/ratón — nunca lo que escribes). Puedes borrar una captura dentro de 2 minutos.',
    screenshotsOff: 'Como parte del equipo YVA, las capturas están desactivadas para ti.',
  },
  time: { title: 'Mis horas', sub: 'Desde la app YVA Time — YVA las aprueba cada semana', changes: 'Cambios hechos por YVA', changesSub: 'Cuando YVA ajusta tu tiempo, lo ves aquí con el motivo',
    thisWeek: 'Esta semana', lastWeek: 'Semana pasada', weekTotal: 'Total de la semana', approvedBy: 'aprobadas por YVA', days: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] },
  pay: { title: 'Mi pago', sub: 'Ganancias en vivo — se actualiza cada minuto mientras registras', payslips: 'Comprobantes de pago' },
  shots: { title: 'Mis capturas', sub: 'Lo que ve YVA — tus capturas y actividad por día (se guardan 60 días)' },
  requests: {
    timeOff: 'Días libres', timeOffSub: 'Vacaciones, enfermedad o días personales — YVA aprueba', kind: 'Tipo', kinds: { vacation: 'Vacaciones', sick: 'Enfermedad', personal: 'Personal', other: 'Otro' },
    from: 'Desde', to: 'Hasta', note: 'Nota (opcional)', halfDay: 'Medio día', send: 'Enviar solicitud', sending: 'Enviando…', sent: 'Enviada. Recibirás una notificación cuando YVA responda.',
    mine: 'Mis solicitudes', cancel: 'Cancelar', status: { pending: 'En espera', approved: 'Aprobada', declined: 'Rechazada', cancelled: 'Cancelada' }, none: 'Aún no hay solicitudes.',
    badDates: 'La fecha final debe ser igual o posterior a la inicial.', missing: 'Agregar tiempo faltante', missingSub: '¿Olvidaste iniciar el temporizador o trabajaste sin conexión? Pide a YVA que lo agregue',
    missingOff: 'Agregar tiempo a mano no está activado para tu cuenta. Pregunta a YVA si lo necesitas.',
    tooLong: 'Una solicitud puede cubrir como máximo 61 días. Envía una ausencia más larga en dos solicitudes.', tooOld: 'La fecha de inicio puede ser como máximo de hace 30 días. Contacta a YVA para fechas anteriores.',
  },
  manual: { day: 'Día', from: 'Desde', to: 'Hasta', workedOn: 'Trabajé en', why: '¿Por qué falta este tiempo?', whyPh: 'p. ej. Se fue la luz — trabajé en papel y llamé a clientes desde mi teléfono',
    send: 'Enviar a YVA para aprobación', sending: 'Enviando…', sent: 'Enviada. YVA la aprobará o rechazará — verás la respuesta aquí.', mine: 'Mis solicitudes', cancel: 'Cancelar',
    noTarget: 'Aún no estás asignado a un proyecto, así que no hay dónde agregar tiempo.', pick: 'Elige en qué trabajaste.', endAfter: 'La hora final debe ser después de la inicial.',
    max12: 'Una solicitud puede cubrir como máximo 12 horas.', future: 'No puedes solicitar tiempo en el futuro.', old: 'Solo puedes solicitar hasta 14 días atrás. Contacta a YVA para tiempo más antiguo.',
    reason: 'Explica brevemente a YVA por qué falta el tiempo.', added: 'min agregados', yva: 'YVA', project: 'Proyecto', status: { pending: 'En espera', approved: 'Aprobada', rejected: 'Rechazada', cancelled: 'Cancelada' } },
  client: { title: 'Mi cliente', sub: 'Para quién trabajas, tu supervisor e instrucciones', none: 'Aún no estás asignado a un proyecto de cliente.', yvaTeam: 'Trabajas directamente para YVA.',
    supervisor: 'Supervisor', instructions: 'Instrucciones', noInstructions: 'Aún no hay instrucciones.' },
  docs: { title: 'Documentos', sub: 'Tu contrato y otros archivos de YVA', none: 'Aún no hay documentos.', open: 'Abrir', categories: { contract: 'Contrato', policy: 'Política', tax: 'Impuestos', id: 'Identificación', other: 'Otro' } },
  company: { title: 'Empresa', sub: 'Anuncios y feriados', announcements: 'Anuncios', none: 'Aún no hay anuncios.', holidays: 'Feriados', noHolidays: 'No hay feriados próximos.', paid: 'pagado', pinned: 'Fijado' },
  profile: { title: 'Perfil', details: 'Mis datos', detailsSub: 'Pide a YVA que corrija cualquier dato incorrecto', notifications: 'Notificaciones', notificationsSub: 'Notificaciones en el teléfono y correos de YVA',
    language: 'Idioma', name: 'Nombre', number: 'Número de empleado', position: 'Cargo', email: 'Correo', phone: 'Teléfono', timezone: 'Zona horaria', shift: 'Turno', app: 'App YVA Time' },
}
export const DICT: Record<Lang, Dict> = { en, es }
export const locale = (l: Lang) => (l === 'es' ? 'es-DO' : 'en-US')
