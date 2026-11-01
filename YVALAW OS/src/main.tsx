import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import './styles/ds.css'
import './styles/shell.css'
import './styles/home.css'
import './styles/finance.css'
import './styles/crm.css'
import './styles/ops.css'
import './styles/people.css'
import './styles/settings.css'
import './styles/portal.css'
import './styles/me.css'

// Notifications service worker (push + tapping a notification). No page caching.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(err => console.warn('service worker', err)) })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/os">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
