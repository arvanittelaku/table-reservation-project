import sq from './locales/sq.js'

export const STORAGE_KEY = 'ejabashkohu-ui-lang'
export const SUPPORTED = ['sq', 'en', 'de', 'mk']
export const DEFAULT = 'sq'

/* Albanian is built in (default language and fallback for any missing key).
 * The others (~110 KB each) are downloaded only for people who use them,
 * instead of every visitor downloading all four languages. */
export const LOCALES = { sq }

const LOADERS = {
  en: () => import('./locales/en.js'),
  de: () => import('./locales/de.js'),
  mk: () => import('./locales/mk.js'),
}
const pending = {}

export function isLocaleLoaded(locale) {
  return !!LOCALES[locale]
}

/** Make sure a language's texts are available; resolves when ready. */
export function loadLocale(locale) {
  if (LOCALES[locale] || !LOADERS[locale]) return Promise.resolve()
  if (!pending[locale]) {
    pending[locale] = LOADERS[locale]()
      .then((m) => { LOCALES[locale] = m.default })
      .catch((err) => { delete pending[locale]; throw err })
  }
  return pending[locale]
}

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
