import React from 'react'
import ReactDOM from 'react-dom/client'
import './HajdeApp.css'
import HajdeApp from './HajdeApp'
import { I18nProvider } from './i18n/I18nContext.jsx'
import { detectLocale, loadLocale } from './i18n/index.js'

const render = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <HajdeApp />
  </I18nProvider>,
)

// Non-Albanian visitors: fetch their language before the first paint (no flash
// of Albanian). If it fails (offline), render anyway with the Albanian fallback.
loadLocale(detectLocale()).then(render, render)
