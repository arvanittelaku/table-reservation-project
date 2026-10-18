import { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './HajdeApp.css'
import HajdeApp from './HajdeApp'
import { I18nProvider } from './i18n/I18nContext'
import { detectLocale, loadLocale } from './i18n/index'
import { queryClient } from './lib/queryClient'
import { DialogHost } from './components/ui/Dialog'

/* One app shell for every path; HajdeApp reads the route (useLocation):
 *   /            feed / landing
 *   /t/:code     share link of a table (opens it; signed-out visitors see a preview)
 *   anything else is served index.html by the host and shows the app as on "/".
 * Auth e-mail and Google/Apple returns land on these paths with a #fragment
 * (#access_token=… / #error=…) that backendClient and lib/authHashError consume. */
const router = createBrowserRouter([
  {
    element: <HajdeApp />,
    children: [
      { index: true },
      { path: 't/:code' },
      { path: '*' },
    ],
  },
])

// Developer-facing fallback shown only if rendering crashes (intentionally not translated).
const CRASH_TITLE = 'Something went wrong'
const CRASH_RELOAD = 'Reload'

/* A render crash used to leave a blank page; show the error (and a reload button) instead. */
class CrashBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('[ejaBashkohu] render crash:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', background: '#080810', color: '#F2F1FA', padding: 24, fontFamily: 'Manrope, system-ui, sans-serif' }}>
        <h2 style={{ color: '#FF4FD8' }}>{CRASH_TITLE}</h2>
        <pre style={{ whiteSpace: 'pre-wrap', opacity: .8, fontSize: 13 }}>{String(this.state.error.stack || this.state.error.message)}</pre>
        <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '10px 18px', borderRadius: 12, border: 0, background: '#FF4FD8', color: '#0B0B14', fontWeight: 700, cursor: 'pointer' }}>{CRASH_RELOAD}</button>
      </div>
    )
  }
}

const render = () => ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <CrashBoundary><RouterProvider router={router} /><DialogHost /></CrashBoundary>
    </I18nProvider>
  </QueryClientProvider>,
)

// Non-Albanian visitors: fetch their language before the first paint (no flash
// of Albanian). If it fails (offline), render anyway with the Albanian fallback.
loadLocale(detectLocale()).then(render, render)
