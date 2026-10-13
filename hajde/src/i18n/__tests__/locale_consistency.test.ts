/**
 * Locale consistency tests
 *
 * 1. Every locale group (folder) must have sq/en/de/mk files
 * 2. Non-Albanian locales (en/de/mk) must not contain Albanian ë except
 *    inside known proper nouns / city names
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const LOCALES_DIR = join(__dirname, '..', 'locales')
const REQUIRED_LANGS = ['sq', 'en', 'de', 'mk'] as const

function findLocaleGroups(dir: string): string[] {
  const groups: string[] = []
  function scan(d: string) {
    const entries = readdirSync(d)
    const hasLang = REQUIRED_LANGS.some(l => entries.includes(`${l}.ts`))
    if (hasLang) groups.push(d)
    for (const e of entries) {
      const full = join(d, e)
      try { if (statSync(full).isDirectory()) scan(full) } catch {}
    }
  }
  scan(dir)
  return groups
}

// Albanian ë must not appear in non-Albanian locales except in these proper nouns
const PROPER_NOUNS = [
  'ejaBashkohu', 'Gjakovë', 'Mitrovicë', 'Ferizaj', 'Gjilan',
  'Prishtinë', 'Prizren', 'Vushtrri', 'Podujevë', 'Klinë',
  'Malishevë', 'Kamenicë', 'Deçan', 'Fushë Kosovë', 'Mamushë',
  'Graçanicë', 'Shtërpcë', 'Novobërdë', 'Mitrovicë e Veriut',
]

function leakedAlbanianE(filePath: string): string[] {
  try {
    const src = readFileSync(filePath, 'utf-8')
    const leaks: string[] = []
    for (const m of src.matchAll(/['"`]([^'"`\n]{2,}?)['"`]/g)) {
      const s = m[1]
      if (!s.includes('ë')) continue
      let cleaned = s
      for (const pn of PROPER_NOUNS) cleaned = cleaned.split(pn).join('')
      if (cleaned.includes('ë')) leaks.push(s.substring(0, 100))
    }
    return leaks
  } catch {
    return []
  }
}

const groups = findLocaleGroups(LOCALES_DIR)

describe('All locale groups have all 4 language files', () => {
  for (const group of groups) {
    const rel = group.replace(LOCALES_DIR, '').replace(/^\//, '') || 'root'
    for (const lang of REQUIRED_LANGS) {
      it(`${rel}/${lang}.ts exists`, () => {
        expect(() => readFileSync(join(group, `${lang}.ts`))).not.toThrow()
      })
    }
  }
})

describe('Non-Albanian locales have no leaked Albanian ë', () => {
  for (const group of groups) {
    const rel = group.replace(LOCALES_DIR, '').replace(/^\//, '') || 'root'
    for (const lang of (['en', 'de', 'mk'] as const)) {
      it(`${rel}/${lang}.ts: no Albanian ë in UI strings`, () => {
        const leaks = leakedAlbanianE(join(group, `${lang}.ts`))
        expect(
          leaks,
          `Found Albanian ë in ${rel}/${lang}.ts:\n  ${leaks.join('\n  ')}`
        ).toHaveLength(0)
      })
    }
  }
})
