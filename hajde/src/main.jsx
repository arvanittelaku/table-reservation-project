import React from 'react'
import ReactDOM from 'react-dom/client'
import './HajdeApp.css'
import HajdeApp from './HajdeApp'
import { I18nProvider } from './i18n/I18nContext.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <HajdeApp />
  </I18nProvider>,
)
