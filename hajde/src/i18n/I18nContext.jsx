import { createContext, useContext, useState } from 'react'
import { detectLocale, persistLocale, t as translateFn } from './index.js'

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale)

  const setLocale = (newLocale) => {
    setLocaleState(newLocale)
    persistLocale(newLocale)
  }

  const translate = (key, vars) => translateFn(locale, key, vars)

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translate }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
