import {
  detectSourceLang,
  normalizeLangCode,
  resolveDraftTarget,
  resolveTranslateTarget,
} from '../lib/langCodes'

export { detectSourceLang, normalizeLangCode, resolveDraftTarget, resolveTranslateTarget }

type MyMemoryResponse = { responseStatus?: number; responseDetails?: string; responseData?: { translatedText?: string } }

export interface TranslateOptions { target?: string; source?: string; viewerLangs?: string[] | null; tableLangs?: string[] | null; browserLocale?: string }

async function myMemoryTranslate(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const langPair = `${sourceLang}|${targetLang}`
  const response = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=${langPair}`,
  )
  const data = (await response.json()) as MyMemoryResponse
  if (data.responseStatus !== 200 || !data.responseData?.translatedText) {
    throw new Error(data.responseDetails || 'MyMemory error')
  }
  return data.responseData.translatedText
}

async function libreTranslate(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const response = await fetch('https://libretranslate.com/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text.trim(),
      source: sourceLang,
      target: targetLang,
      format: 'text',
    }),
  })
  if (!response.ok) throw new Error('LibreTranslate unavailable')
  const data = (await response.json()) as { translatedText?: string }
  if (!data.translatedText) throw new Error('Empty LibreTranslate response')
  return data.translatedText
}

/**
 * Translate text into the reader's language (never hardcoded sq↔en toggle).
 */
export async function translateText(text: string, options: TranslateOptions = {}): Promise<string> {
  if (!text?.trim()) throw new Error('Message cannot be empty')

  const targetLang =
    normalizeLangCode(options.target) ||
    resolveTranslateTarget({
      viewerLangs: options.viewerLangs,
      tableLangs: options.tableLangs,
      browserLocale: options.browserLocale,
    })

  const sourceLang = normalizeLangCode(options.source) || detectSourceLang(text)

  if (sourceLang === targetLang) {
    throw new Error('Message is already in your language')
  }

  try {
    return await myMemoryTranslate(text, sourceLang, targetLang)
  } catch {
    try {
      return await libreTranslate(text, sourceLang, targetLang)
    } catch {
      throw new Error('Translation failed. Try again.')
    }
  }
}
