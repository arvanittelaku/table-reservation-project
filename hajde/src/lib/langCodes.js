/** ISO 639-1 codes used across the app (matches HajdeApp LANGUAGES). */
export const LANG_CODES = {
  sq: 'sq',
  en: 'en',
  de: 'de',
  it: 'it',
  fr: 'fr',
  tr: 'tr',
  sr: 'sr',
  es: 'es',
  mk: 'mk',
}

const ALIASES = {
  shqip: 'sq',
  albanian: 'sq',
  english: 'en',
  deutsch: 'de',
  german: 'de',
  italiano: 'it',
  italian: 'it',
  français: 'fr',
  french: 'fr',
  türkçe: 'tr',
  turkish: 'tr',
  српски: 'sr',
  serbian: 'sr',
  español: 'es',
  spanish: 'es',
  македонски: 'mk',
  macedonian: 'mk',
}

/** Normalize profile label, code, or browser locale fragment to ISO 639-1. */
export function normalizeLangCode(input) {
  if (input == null || input === '') return null
  const raw = String(input).trim()
  const lower = raw.toLowerCase()
  if (LANG_CODES[lower]) return lower
  if (ALIASES[lower]) return ALIASES[lower]
  const fromLabel = Object.entries(ALIASES).find(([label]) => label === lower)
  if (fromLabel) return fromLabel[1]
  const two = lower.slice(0, 2)
  if (LANG_CODES[two]) return two
  return null
}

/** Reader's preferred language for incoming chat translations. */
export function resolveTranslateTarget({
  viewerLangs,
  tableLangs,
  browserLocale,
} = {}) {
  const langs = viewerLangs || []
  const isOnlyDefaultSq =
    langs.length === 1 && normalizeLangCode(langs[0]) === 'sq'

  if (!isOnlyDefaultSq) {
    const fromViewer = langs.map(normalizeLangCode).find(Boolean)
    if (fromViewer) return fromViewer
  }

  const fromBrowser = normalizeLangCode(
    typeof browserLocale === 'string' ? browserLocale.split(/[-_]/)[0] : null,
  )
  if (fromBrowser) return fromBrowser

  const fromTable = (tableLangs || []).map(normalizeLangCode).find(Boolean)
  return fromTable || 'sq'
}

/** Target for translating an outgoing draft to another table language. */
export function resolveDraftTarget(text, { viewerLangs, tableLangs } = {}) {
  const source = detectSourceLang(text)
  const candidates = [...(tableLangs || []), ...(viewerLangs || [])]
    .map(normalizeLangCode)
    .filter(Boolean)
  const unique = [...new Set(candidates)]
  const other = unique.find((code) => code !== source)
  if (other) return other
  return source === 'sq' ? 'en' : 'sq'
}

/** Lightweight heuristic — MyMemory needs an explicit source, not "auto". */
export function detectSourceLang(text) {
  if (!text?.trim()) return 'sq'
  const isAlbanian =
    /[ëçËÇ]/.test(text) ||
    /\b(dhe|në|të|që|një|me|për|nga|është|si|po|jo|kur|unë|ty|ju|mirë|faleminderit)\b/i.test(text)
  if (isAlbanian) return 'sq'

  if (/\b(hello|how|are|you|the|and|thanks|please|good|morning|evening)\b/i.test(text)) return 'en'
  if (/\b(hallo|guten|danke|bitte|wie|geht)\b/i.test(text)) return 'de'
  if (/\b(ciao|grazie|buon|come|stai)\b/i.test(text)) return 'it'
  if (/\b(bonjour|merci|comment|allez)\b/i.test(text)) return 'fr'
  if (/\b(merhaba|teşekkür|nasılsın|günaydın)\b/i.test(text)) return 'tr'

  return 'en'
}
