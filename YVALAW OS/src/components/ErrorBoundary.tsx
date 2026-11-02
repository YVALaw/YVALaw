// Last line of defence: if a screen crashes (or its code can't be loaded), show a message with Reload instead of a
// blank page. A screen file from an older version that's gone after an update reloads the page once by itself
// (lib/lazyPage.ts); this covers everything else.
import { Component, type ReactNode } from 'react'
import { reloadForNewVersion } from '../lib/lazyPage'

type State = { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) {
    console.error('YVA OS screen error:', error)
    if (/dynamically imported module|Importing a module script failed|MIME type|ChunkLoadError/i.test(String(error?.message))) reloadForNewVersion()
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="loading-screen" role="alert">
        <div className="loading-text">Something went wrong loading this page.</div>
        <div className="loading-slow">
          <p>A new version of YVA OS may have just been published. Reloading usually fixes it.</p>
          <div className="loading-slow__actions">
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}
