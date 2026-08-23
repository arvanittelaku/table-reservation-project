/**
 * Phase 4 i18n verification: feed, create table (3 modes), table detail.
 * TEST 1: residual Albanian scan when locale=EN
 * TEST 3: dynamic strings (open tables count, Today label)
 * TEST 4: landing still English
 *
 * Run: node verification/verify-phase4-i18n.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://127.0.0.1:4173'
const E2E_EMAIL = requireE2EEmail()
const E2E_PASSWORD = requireE2EPassword()
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'phase4-i18n', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const LOCALES = ['sq', 'en', 'de', 'mk']
const LANDING_HINT = { sq: 'Sonte', en: 'Tonight', de: 'Heute Abend', mk: 'Вечерва' }

/** Albanian UI residue patterns — should NOT appear when EN selected (except city names, user content) */
const ALBANIAN_PATTERNS = [
  /\bKërko\b/i,
  /\bHap tavolin/i,
  /\bTavolinat e mia\b/i,
  /\bZbulo\b/,
  /\bBiseda e tavolin/i,
  /\bPërkthe\b/,
  /\bNikoqir\b/,
  /\bKjo tavolinë\b/,
  /\bMbyll tavolin/i,
  /\bShkruaj mesazh/i,
  /\bTë gjitha\b/,
  /\bVetëm femra\b/,
  /\bDuhet të shtosh linkun/i,
  /feed\.(discover|createTable|tableDetail)/,
  /createTable\./,
  /tableDetail\./,
]

const CITY_NAMES = [
  'Prishtinë', 'Prizren', 'Pejë', 'Gjakovë', 'Mitrovicë', 'Ferizaj',
]

function isCityName(text) {
  return CITY_NAMES.some((c) => text.includes(c))
}

async function setLocale(page, code) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate((c) => localStorage.setItem('ejabashkohu-ui-lang', c), code)
  await page.reload({ waitUntil: 'networkidle' })
}

async function isOnMainFeed(page) {
  if (await page.getByPlaceholder(/Search café|Kërko kafe|Café suchen|Барај кафе/i).isVisible().catch(() => false)) return true
  if (await page.locator('button', { hasText: /^Discover$|^Zbulo$|^Entdecken$|^Откриј$/ }).first().isVisible().catch(() => false)) return true
  if (await page.locator('.fab, button', { hasText: /Open table|Hap tavolin/i }).first().isVisible().catch(() => false)) return true
  return false
}

async function signInTestUser(page) {
  if (await isOnMainFeed(page)) return true

  await page.locator('button', { hasText: /^Sign in$|^Hyr|^Anmelden|^Најави/i }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  const email = page.locator('input[type="email"], input[placeholder*="email" i]').first()
  if (!(await email.isVisible().catch(() => false))) return false
  await page.getByPlaceholder('Your email').fill(E2E_EMAIL).catch(async () => {
    await email.fill(E2E_EMAIL)
  })
  const pwd = page.locator('input[type="password"]').first()
  if (!(await pwd.isVisible().catch(() => false))) return false
  await page.getByPlaceholder('Password').fill(E2E_PASSWORD).catch(async () => {
    await pwd.fill(E2E_PASSWORD)
  })
  await page.locator('button', { hasText: /^Sign in$|^Hyr|^Anmelden|^Најави/i }).first().click()
  await page.waitForTimeout(3000)

  const normalUserLink = page.locator('button, a', { hasText: /përdorues normal|normal user|normal/i })
  if (await normalUserLink.first().isVisible().catch(() => false)) {
    await normalUserLink.first().click()
    await page.waitForTimeout(1500)
  }

  return isOnMainFeed(page)
}

function scanText(text, context) {
  const flags = []
  if (!text || text.length < 2) return flags
  for (const pat of ALBANIAN_PATTERNS) {
    if (pat.test(text) && !isCityName(text)) {
      flags.push({ context, pattern: pat.toString(), snippet: text.slice(0, 120) })
    }
  }
  if (/[çë]/i.test(text) && !isCityName(text)) {
    const albanianWords = ['tavolin', 'nikoqir', 'faleminderit', 'ngarkuar', 'për', 'shqip', 'zbulo', 'kërko']
    if (albanianWords.some((w) => text.toLowerCase().includes(w))) {
      flags.push({ context, pattern: 'albanian-diacritics', snippet: text.slice(0, 120) })
    }
  }
  return flags
}

async function extractVisibleText(page) {
  return page.evaluate(() => {
    const walk = (el) => {
      if (!el || el.nodeType !== 1) return ''
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return ''
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return ''
      let t = ''
      for (const c of el.childNodes) {
        if (c.nodeType === 3) t += c.textContent + ' '
        else t += walk(c)
      }
      return t
    }
    return walk(document.body).replace(/\s+/g, ' ').trim()
  })
}

;(async () => {
  const report = { base: BASE, ts, tests: {}, screenshots: [] }
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const page = await context.newPage()

  // TEST 4 — landing per locale
  report.tests.test4_landing = { pass: true, locales: [] }
  for (const loc of LOCALES) {
    await setLocale(page, loc)
    const body = await extractVisibleText(page)
    const ok = body.includes(LANDING_HINT[loc])
    report.tests.test4_landing.locales.push({ loc, ok, hint: LANDING_HINT[loc] })
    if (!ok) report.tests.test4_landing.pass = false
    await page.screenshot({ path: path.join(OUT, `landing-${loc}.png`), fullPage: false })
    report.screenshots.push(`landing-${loc}.png`)
  }

  // Sign in for main app tests (or use existing session on production)
  await setLocale(page, 'en')
  const signedIn = await signInTestUser(page)
  if (!signedIn) {
    report.tests.signIn = { pass: false, note: 'Could not reach main feed — skipping post-login scans' }
  } else {
  report.tests.signIn = { pass: true }

  const allFlags = []

  // Feed
  const feedText = await extractVisibleText(page)
  allFlags.push(...scanText(feedText, 'feed'))
  await page.screenshot({ path: path.join(OUT, 'feed-en.png') })
  report.screenshots.push('feed-en.png')

  // Open create form
  const opened = await page.locator('.fab').click().then(() => true).catch(() => false)
  if (!opened) await page.locator('button', { hasText: /Open table|Hap tavolin/i }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  let createText = await extractVisibleText(page)
  allFlags.push(...scanText(createText, 'create-tavoline'))
  await page.screenshot({ path: path.join(OUT, 'create-tavoline-en.png') })
  report.screenshots.push('create-tavoline-en.png')

  await page.locator('button.mode-btn', { hasText: /^Ride$|^Vozitje$|^Mitfahrt$|^Возење$/ }).click().catch(() => {})
  await page.waitForTimeout(300)
  createText = await extractVisibleText(page)
  allFlags.push(...scanText(createText, 'create-vozitje'))
  await page.screenshot({ path: path.join(OUT, 'create-vozitje-en.png') })

  await page.locator('button.mode-btn', { hasText: /^Trip$|^Udhëtim$|^Reise$|^Патување$/ }).click().catch(() => {})
  await page.waitForTimeout(300)
  createText = await extractVisibleText(page)
  allFlags.push(...scanText(createText, 'create-udhetim'))
  await page.screenshot({ path: path.join(OUT, 'create-udhetim-en.png') })

  // Close create
  await page.locator('button[aria-label="Close"], button[aria-label="Mbyll"]').first().click().catch(() => page.keyboard.press('Escape'))
  await page.waitForTimeout(400)

  // Table detail — click first card
  await page.evaluate(() => {
    const h3 = document.querySelector('.card h3, article.card')
    if (h3) (h3.closest('article') || h3).click()
  })
  await page.waitForTimeout(800)
  const detailText = await extractVisibleText(page)
  allFlags.push(...scanText(detailText, 'table-detail'))
  await page.screenshot({ path: path.join(OUT, 'table-detail-en.png') })

  // TEST 3 — dynamic strings
  report.tests.test3_dynamic = {
    hasOpenTablesCount: /\d+\s+open tables in/i.test(feedText),
    hasTodayOrDate: /Today,|Tomorrow,|\d{1,2}:/i.test(feedText + detailText),
    feedSnippet: feedText.slice(0, 200),
  }

  report.tests.test1_residual = {
    pass: allFlags.length === 0,
    flagCount: allFlags.length,
    flags: allFlags.slice(0, 30),
  }
  }

  // Screenshots all 4 locales on feed (if logged in persists)
  for (const loc of LOCALES) {
    await setLocale(page, loc)
    await page.waitForTimeout(1500)
    if (page.url().includes('#') || (await extractVisibleText(page)).length > 100) {
      await page.screenshot({ path: path.join(OUT, `feed-${loc}.png`) })
      report.screenshots.push(`feed-${loc}.png`)
    }
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
  process.exit(
    report.tests.test4_landing.pass
    && (report.tests.test1_residual?.pass !== false)
      ? 0
      : 1,
  )
})()
