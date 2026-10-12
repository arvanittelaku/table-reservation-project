import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { detectLocale, isLocaleLoaded, loadLocale, persistLocale, t as translateFn, tValue, type Dict, type Locale, type TFunction } from './index'

export interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TFunction
  /** Non-string entries (e.g. the icebreaker list). */
  tList: (key: string) => string[]
}

const I18nContext = createContext<I18nValue | null>(null)

const asList = (v: Dict[string] | undefined): string[] => (Array.isArray(v) ? [...v] : [])

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)
  // re-render once a lazily loaded language arrives
  const [, setLoadedTick] = useState(0)

  useEffect(() => {
    if (isLocaleLoaded(locale)) return
    let alive = true
    loadLocale(locale).then(() => { if (alive) setLoadedTick((n) => n + 1) }).catch(() => {})
    return () => { alive = false }
  }, [locale])

  const setLocale = (newLocale: Locale) => {
    persistLocale(newLocale)
    // switch only when the texts are there, so the screen never flashes another language
    loadLocale(newLocale).then(() => setLocaleState(newLocale)).catch(() => setLocaleState(newLocale))
  }

  const translate: TFunction = (key, vars) => translateFn(locale, key, vars)
  const tList = (key: string) => asList(tValue(locale, key))

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translate, tList }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
