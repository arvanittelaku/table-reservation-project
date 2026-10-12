import sq from './locales/sq'

export const STORAGE_KEY = 'ejabashkohu-ui-lang'
export const SUPPORTED = ['sq', 'en', 'de', 'mk'] as const
export type Locale = (typeof SUPPORTED)[number]
export const DEFAULT: Locale = 'sq'

/** A language's texts: nested sections of strings (and a few string lists, e.g. icebreakers). */
export interface Dict { [key: string]: string | readonly string[] | Dict }
/** Values substituted into {{name}} placeholders. */
export type TVars = Record<string, string | number | null | undefined>
export type TFunction = (key: string, vars?: TVars) => string

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (SUPPORTED as readonly string[]).includes(v)

/* Albanian is built in (default language and fallback for any missing key).
 * The others (~110 KB each) are downloaded only for people who use them,
 * instead of every visitor downloading all four languages. */
export const LOCALES: Partial<Record<Locale, Dict>> = { sq }

const LOADERS: Partial<Record<Locale, () => Promise<{ default: Dict }>>> = {
  en: () => import('./locales/en'),
  de: () => import('./locales/de'),
  mk: () => import('./locales/mk'),
}
const pending: Partial<Record<Locale, Promise<void>>> = {}

export function isLocaleLoaded(locale: Locale): boolean {
  return !!LOCALES[locale]
}

/** Make sure a language's texts are available; resolves when ready. */
export function loadLocale(locale: Locale): Promise<void> {
  const loader = LOADERS[locale]
  if (LOCALES[locale] || !loader) return Promise.resolve()
  let p = pending[locale]
  if (!p) {
    p = loader()
      .then((m) => { LOCALES[locale] = m.default })
      .catch((err: unknown) => { delete pending[locale]; throw err })
    pending[locale] = p
  }
  return p
}

function getNestedKey(obj: Dict | undefined, path: string): Dict[string] | undefined {
  let cur: Dict[string] | undefined = obj
  for (const k of path.split('.')) {
    if (!cur || typeof cur === 'string' || Array.isArray(cur)) return undefined
    cur = (cur as Dict)[k]
  }
  return cur
}

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isLocale(stored)) return stored
  const browserLang = navigator.language?.split('-')[0]
  if (isLocale(browserLang)) return browserLang
  return DEFAULT
}

export function persistLocale(locale: Locale) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale)
  }
}

/** The raw value at `key` (a string, a list of strings or a whole section), with Albanian as fallback. */
export function tValue(locale: Locale, key: string): Dict[string] | undefined {
  return getNestedKey(LOCALES[locale] || LOCALES[DEFAULT], key) || getNestedKey(LOCALES[DEFAULT], key)
}

/** The text at `key` with {{vars}} filled in; the key itself when missing. */
export function t(locale: Locale, key: string, vars: TVars = {}): string {
  const found = tValue(locale, key)
  if (!found) return key
  if (typeof found !== 'string') return String(found)
  let str = found
  Object.entries(vars).forEach(([k, v]) => {
    str = str.replaceAll(`{{${k}}}`, String(v))
  })
  return str
}
