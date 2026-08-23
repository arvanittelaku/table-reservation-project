import sq from './locales/sq.js'
import en from './locales/en.js'
import de from './locales/de.js'
import mk from './locales/mk.js'

export const STORAGE_KEY = 'ejabashkohu-ui-lang'
export const SUPPORTED = ['sq', 'en', 'de', 'mk']
export const DEFAULT = 'sq'

export const LOCALES = { sq, en, de, mk }

function getNestedKey(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

export function detectLocale() {
  if (typeof window === 'undefined') return DEFAULT
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && SUPPORTED.includes(stored)) return stored
  const browserLang = navigator.language?.split('-')[0]
  if (SUPPORTED.includes(browserLang)) return browserLang
  return DEFAULT
}

export function persistLocale(locale) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale)
  }
}

export function t(locale, key, vars = {}) {
  const dict = LOCALES[locale] || LOCALES[DEFAULT]
  let str = getNestedKey(dict, key) || getNestedKey(LOCALES[DEFAULT], key) || key
  if (typeof str !== 'string') return str
  Object.entries(vars).forEach(([k, v]) => {
    str = str.replaceAll(`{{${k}}}`, String(v))
  })
  return str
}
