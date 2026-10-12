import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './HajdeApp.css'
import HajdeApp from './HajdeApp'
import { I18nProvider } from './i18n/I18nContext'
import { detectLocale, loadLocale } from './i18n/index'
import { queryClient } from './lib/queryClient'

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

const render = () => ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </QueryClientProvider>,
)

// Non-Albanian visitors: fetch their language before the first paint (no flash
// of Albanian). If it fails (offline), render anyway with the Albanian fallback.
loadLocale(detectLocale()).then(render, render)
