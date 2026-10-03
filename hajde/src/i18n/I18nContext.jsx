import { createContext, useContext, useEffect, useState } from 'react'
import { detectLocale, isLocaleLoaded, loadLocale, persistLocale, t as translateFn } from './index.js'

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale)
  // re-render once a lazily loaded language arrives
  const [, setLoadedTick] = useState(0)

  useEffect(() => {
    if (isLocaleLoaded(locale)) return
    let alive = true
    loadLocale(locale).then(() => { if (alive) setLoadedTick((n) => n + 1) }).catch(() => {})
    return () => { alive = false }
  }, [locale])

  const setLocale = (newLocale) => {
    persistLocale(newLocale)
    // switch only when the texts are there, so the screen never flashes another language
    loadLocale(newLocale).then(() => setLocaleState(newLocale)).catch(() => setLocaleState(newLocale))
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
