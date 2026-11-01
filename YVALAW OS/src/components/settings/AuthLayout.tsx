import type { ReactNode } from 'react'

/** Shared frame for the sign-in pages: centred card on --bg with the YVA logo */
export default function AuthLayout({ title, sub, children, foot, icon, center, brand = 'YVA OS' }: {
  title: ReactNode; sub?: ReactNode; children?: ReactNode; foot?: ReactNode; icon?: ReactNode; center?: boolean; brand?: string
}) {
  return (
    <main className="set-auth">
      <div className="set-auth__wrap">
        <div className="set-auth__brand">
          <img className="set-auth__logo" src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA Staffing"
            onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
          <span className="set-auth__name">{brand}</span>
        </div>
        <section className={`set-auth__card${center ? ' set-auth__center' : ''}`}>
          {icon}
          <div className="set-auth__head">
            <h1 className="set-auth__title">{title}</h1>
            {sub && <p className="set-auth__sub">{sub}</p>}
          </div>
          {children}
        </section>
        {foot && <div className="set-auth__foot">{foot}</div>}
      </div>
    </main>
  )
}
