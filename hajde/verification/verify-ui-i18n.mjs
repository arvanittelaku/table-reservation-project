/**
 * Verify Phase 1+2 UI i18n: landing, sign-in, deactivated gate, persistence.
 * Run: node verification/verify-ui-i18n.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const PASS = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'ui-i18n', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const LOCALES = [
  { code: 'sq', heroHint: 'Sonte', signInTitle: 'Hyr në llogari' },
  { code: 'en', heroHint: 'Tonight', signInTitle: 'Sign in to your account' },
  { code: 'de', heroHint: 'Heute Abend', signInTitle: 'In dein Konto einloggen' },
  { code: 'mk', heroHint: 'Вечерва', signInTitle: 'Најави се на сметката', cyrillic: true },
]

async function setLocale(page, code) {
  await page.evaluate((c) => localStorage.setItem('ejabashkohu-ui-lang', c), code)
}

async function clickLocale(page, code) {
  await page.locator('.lang-switcher button', { hasText: code.toUpperCase() }).click()
  await page.waitForTimeout(400)
}

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASS,
      data: { first_name: 'I18n', last_name: 'Gate', age: 28 },
    }),
  })
  return res.json()
}

;(async () => {
  const report = { base: BASE, ts, tests: {} }
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // TEST 1 + 2 — switcher + 4 landing screenshots
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  report.tests.test1 = { pass: false, details: [] }
  report.tests.test2 = { pass: true, locales: [] }

  for (const loc of LOCALES) {
    await setLocale(page, loc.code)
    await page.reload({ waitUntil: 'networkidle' })
    await clickLocale(page, loc.code)
    const heroText = await page.locator('.landing-h1').innerText()
    const rawKeyVisible = await page.locator('text=landing.heroTitle').count()
    const ok = heroText.includes(loc.heroHint) && rawKeyVisible === 0
    report.tests.test2.locales.push({ code: loc.code, heroText: heroText.slice(0, 80), ok })
    if (!ok) report.tests.test2.pass = false
    await page.screenshot({ path: path.join(OUT, `landing-${loc.code}.png`), fullPage: true })
  }

  await setLocale(page, 'en')
  await page.reload({ waitUntil: 'networkidle' })
  await clickLocale(page, 'en')
  await page.locator('.landing-nav .btn.ghost').click()
  await page.waitForTimeout(500)
  const signInTitle = await page.locator('.ob-q').innerText()
  const forgot = await page.locator('.forgot-link').innerText()
  report.tests.test3 = {
    pass: signInTitle.includes('Sign in') && forgot.toLowerCase().includes('forgot'),
    signInTitle,
    forgot,
  }
  await page.screenshot({ path: path.join(OUT, 'signin-en.png') })

  // persistence
  await page.reload({ waitUntil: 'networkidle' })
  const persisted = await page.evaluate(() => localStorage.getItem('ejabashkohu-ui-lang'))
  const heroAfterReload = await page.locator('.landing-h1').innerText()
  report.tests.test1 = {
    pass: persisted === 'en' && heroAfterReload.includes('Tonight'),
    persisted,
    heroAfterReload: heroAfterReload.slice(0, 60),
  }

  // TEST 4 — deactivated gate in German
  const deactEmail = `ejabashkohu+i18ngate.${ts}@gmail.com`
  const su = await signup(deactEmail)
  const uid = su.user?.id
  if (!uid) throw new Error('signup failed for gate test: ' + JSON.stringify(su))
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (adminKey) {
    const admin = createClient(SB, adminKey)
    await admin.from('profiles').update({ deactivated_at: new Date().toISOString() }).eq('id', uid)
    const loginRes = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: deactEmail, password: PASS }),
    }).then((r) => r.json())

    await setLocale(page, 'de')
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.evaluate(({ key, session }) => {
      localStorage.setItem(
        'sb-upxxfhvgbmddhyebaiug-auth-token',
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer',
          user: session.user,
        }),
      )
    }, { key: 'sb-upxxfhvgbmddhyebaiug-auth-token', session: loginRes })
    await page.reload({ waitUntil: 'networkidle' })
    await clickLocale(page, 'de')
    await page.waitForTimeout(1500)
    const gateTitle = await page.locator('.reactivate-title').innerText().catch(() => '')
    const gateBtn = await page.locator('.reactivate-card .btn.primary').innerText().catch(() => '')
    report.tests.test4 = {
      pass: gateTitle.includes('deaktiviert') && gateBtn.includes('Neues Konto'),
      gateTitle,
      gateBtn,
    }
    await page.screenshot({ path: path.join(OUT, 'gate-de.png') })
  } else {
    report.tests.test4 = { pass: null, skipped: 'SUPABASE_SERVICE_ROLE_KEY not set' }
  }

  // TEST 5 — feed stays Albanian after EN on landing
  if (adminKey && su.user?.id) {
    const activeEmail = `ejabashkohu+i18nfeed.${ts}@gmail.com`
    await signup(activeEmail)
    const loginRes = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeEmail, password: PASS }),
    }).then((r) => r.json())
    await setLocale(page, 'en')
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.evaluate(({ session }) => {
      localStorage.setItem(
        'sb-upxxfhvgbmddhyebaiug-auth-token',
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer',
          user: session.user,
        }),
      )
    }, { session: loginRes })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    const bodyText = await page.locator('body').innerText()
    const hasAlbanianFeed = /Kërko|tavolin|Hap|Vazhdo|Regjistr/i.test(bodyText)
    const hasEnglishLanding = /Tonight, someone in your city/.test(bodyText)
    report.tests.test5 = {
      pass: hasAlbanianFeed && !hasEnglishLanding,
      hasAlbanianFeed,
      hasEnglishLanding,
      sample: bodyText.slice(0, 250),
    }
    await page.screenshot({ path: path.join(OUT, 'feed-albanian-en-locale.png') })
  } else {
    report.tests.test5 = { pass: null, skipped: 'needs service key + onboarding skip' }
  }

  // TEST 6 — MK cyrillic check
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await setLocale(page, 'mk')
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.landing-h1').waitFor({ timeout: 15000 })
  await clickLocale(page, 'mk')
  const mkHero = await page.locator('.landing-h1').innerText()
  const hasCyrillic = /[\u0400-\u04FF]/.test(mkHero)
  const mojibake = mkHero.includes('�')
  report.tests.test6 = { pass: hasCyrillic && !mojibake, mkHero: mkHero.slice(0, 100) }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
  const failed = Object.values(report.tests).some((t) => t.pass === false)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
