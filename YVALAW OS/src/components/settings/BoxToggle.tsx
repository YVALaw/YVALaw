import { Ic, P } from '../Icon'

/** The square navy check box from the mockup (Notifications, Permissions). Works with getByLabel/check(). */
export default function BoxToggle({ checked, onChange, label, disabled, small }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean; small?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} title={label} disabled={disabled}
      className={`set-box${small ? ' set-box--sm' : ''}`} onClick={onChange}>
      {checked && <Ic d={P.check} size={small ? 12 : 13} stroke={3} />}
    </button>
  )
}
