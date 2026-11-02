// Toast pop-ups: small cards top-right that confirm the result of a click (sent, saved, copied,
// deleted, failed…) and go away on their own. Situations that stay true (preview mode, setup
// needed, a load error, a form's validation error) stay as a <Banner> on the page instead.
//
//   const toast = useToast()
//   toast.success('Invoice sent.')                 // 4 s
//   toast.error('Could not send: …')               // 6 s, so a failure can be read
//   toast.info('…', { action: { label: 'Open invoice', onClick: () => navigate(…) } })
//
// Hovering (or focusing) a toast pauses its timer; leaving resumes it. At most 3 show at once.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ic, P } from '../components/Icon'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction { label: string; onClick: () => void }
export interface ToastOptions { duration?: number; action?: ToastAction }

export interface Toast {
  id: string
  message: ReactNode
  type: ToastType
  duration: number
  action?: ToastAction
}

type Show = (message: ReactNode, opts?: ToastOptions) => string

export interface ToastContextValue {
  addToast: (message: ReactNode, type?: ToastType, duration?: number, action?: ToastAction) => string
  removeToast: (id: string) => void
  success: Show
  error: Show
  warning: Show
  info: Show
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export const MAX_TOASTS = 3
/** success / info: 4 s · warning / error: 6 s · a toast with a button: 8 s (time to reach it) */
export function defaultDuration(type: ToastType, hasAction = false): number {
  if (hasAction) return 8000
  return type === 'error' || type === 'warning' ? 6000 : 4000
}

let toastIdCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((message: ReactNode, type: ToastType = 'info', duration?: number, action?: ToastAction) => {
    const id = `toast-${++toastIdCounter}`
    const t: Toast = { id, message, type, duration: duration ?? defaultDuration(type, !!action), action }
    // Newest first; keep the 3 newest
    setToasts(prev => [t, ...prev].slice(0, MAX_TOASTS))
    return id
  }, [])

  const value = useMemo<ToastContextValue>(() => {
    const make = (type: ToastType): Show => (message, opts) => addToast(message, type, opts?.duration, opts?.action)
    return { addToast, removeToast, success: make('success'), error: make('error'), warning: make('warning'), info: make('info') }
  }, [addToast, removeToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

/** The same object on every render (the list of toasts lives in the provider), so it is safe in effect deps. */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ── Toast stack ────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="toast-stack" aria-label="Notifications">
      {toasts.map(t => <ToastItem key={t.id} toast={t} onRemove={onRemove} />)}
    </div>,
    document.body,
  )
}

const ICON: Record<ToastType, string> = { success: P.check, error: P.alert, warning: P.alert, info: P.info }

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const remaining = useRef(toast.duration)
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [paused, setPaused] = useState(false)

  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const start = () => {
    stop()
    startedAt.current = Date.now()
    timer.current = setTimeout(() => onRemove(toast.id), Math.max(0, remaining.current))
  }
  const pause = () => {
    if (!timer.current) return
    stop()
    remaining.current -= Date.now() - startedAt.current
    setPaused(true)
  }
  const resume = () => { setPaused(false); start() }

  useEffect(() => { start(); return stop }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const urgent = toast.type === 'error'
  return (
    <div
      className={`toast toast--${toast.type}`}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      data-paused={paused ? 'true' : undefined}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume() }}
    >
      <span className="toast__icon"><Ic d={ICON[toast.type]} size={16} stroke={2.2} /></span>
      <div className="toast__body">{toast.message}</div>
      {toast.action && (
        <button type="button" className="toast__action" onClick={() => { toast.action!.onClick(); onRemove(toast.id) }}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast__close" onClick={() => onRemove(toast.id)} aria-label="Dismiss notification">
        <Ic d={P.x} size={14} />
      </button>
    </div>
  )
}
