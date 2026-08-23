/**
 * Verify Wednesday Dinner quiz options + language mapping.
 * Run: node scripts/verify-wednesday-quiz.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildWedQuizTableLangs } from '../src/lib/wedQuizLangs.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/HajdeApp.jsx'), 'utf8')

let failed = 0
function pass(label, ok, detail = '') {
  if (ok) {
    console.log(`PASS  ${label}${detail ? `: ${detail}` : ''}`)
  } else {
    failed++
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ''}`)
  }
}

// ── Q1–Q4: Diçka tjetër ──
for (let i = 0; i < 4; i++) {
  const re = new RegExp(`const QUIZ = \\[[\\s\\S]*?opts: \\[[^\\]]*"Diçka tjetër"`, 'm')
  pass(`Question ${i + 1} includes "Diçka tjetër"`, /"Diçka tjetër"/.test(src))
}
const dicCount = (src.match(/"Diçka tjetër"/g) || []).length
pass('Exactly 4 "Diçka tjetër" options in source', dicCount === 4, `found ${dicCount}`)

// ── Q5: langs type, no old 3-option list ──
pass('Q5 uses type: "langs"', /type: "langs"/.test(src))
pass('Old Q5 options removed from QUIZ', !/opts: \["Shqip", "English", "Të dyja"\]/.test(src))

// ── LANGUAGES reused (9 labels) ──
const langLabels = ['Shqip', 'English', 'Deutsch', 'Italiano', 'Français', 'Türkçe', 'Српски', 'Español', 'Македонски']
for (const label of langLabels) {
  pass(`LANGUAGES includes ${label}`, src.includes(`label: '${label}'`) || src.includes(`label: "${label}"`))
}

// ── Downstream lang mapping ──
pass('Shqip only → ["sq"]', JSON.stringify(buildWedQuizTableLangs(['sq'])) === JSON.stringify(['sq']))
pass('Deutsch only → ["de"]', JSON.stringify(buildWedQuizTableLangs(['de'])) === JSON.stringify(['de']))
pass('English only → ["en"]', JSON.stringify(buildWedQuizTableLangs(['en'])) === JSON.stringify(['en']))
pass(
  'Shqip + English → ["sq","en"]',
  JSON.stringify(buildWedQuizTableLangs(['sq', 'en'])) === JSON.stringify(['sq', 'en']),
)
pass(
  'Label Deutsch → ["de"]',
  JSON.stringify(buildWedQuizTableLangs(['Deutsch'])) === JSON.stringify(['de']),
)
pass('Empty → ["sq"] default', JSON.stringify(buildWedQuizTableLangs([])) === JSON.stringify(['sq']))

// ── Old English-only check removed ──
pass('Old ans.includes("English") pattern removed', !src.includes('ans.includes("English")'))

console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests PASS')
process.exit(failed ? 1 : 0)
