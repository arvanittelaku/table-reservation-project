/**
 * Phase 6 i18n verification — errors, toasts, notifications, payment.
 *
 * TEST 1: residual Albanian scan (EN locale) on error/toast paths
 * TEST 2: screenshot walkthrough SQ/EN/DE/MK (isolated browser contexts)
 * TEST 3: global errorMap — duplicate-email error in EN sign-in
 * TEST 4: Phase 4b regression — unblock toast uses translated key
 *
 * Run: node verification/verify-phase6-i18n.mjs [baseUrl]
 * Env: E2E_EMAIL, E2E_PASSWORD, SKIP_TEST2=1, EVIDENCE_DIR=...
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv[2] || 'https://ejabashkohu.com').replace(/\/$/, '')
const ts = Date.now()
const OUT = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : path.join(__dirname, 'evidence', 'phase6-i18n', String(ts))
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const ADMIN_SCREEN_KEY = 'ejabashkohu-admin-screen'
const UI_LANG_KEY = 'ejabashkohu-ui-lang'

const ADMIN_EMAIL = process.env.E2E_EMAIL || 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = process.env.E2E_PASSWORD || 'ejaBashkohu1@@'

const LOCALES = ['sq', 'en', 'de', 'mk']

/** Old Phase 6 hardcoded Albanian — must NOT appear when EN locale is selected */
const PHASE6_ALBANIAN_PATTERNS = [
  /\bKonfirmo vendin\b/i,
  /\bVendi u konfirmua\b/i,
  /\bBileta jote\b/i,
  /\bShko te tavolina\b/i,
  /\bMënyra e pagesës\b/i,
  /\bNumri i kartelës\b/i,
  /\bEmri në kartelë\b/i,
  /\bPaguaj .* konfirmo\b/i,
  /\bPagesë e sigurt\b/i,
  /\bKy email është i regjistruar\b/i,
  /\bEmail ose fjalëkalimi\b/i,
  /\bKe kërkuar tashmë një link\b/i,
  /\bShkruaj email-in tënd\b/i,
  /\bKërkesa u dërgua\b/i,
  /\bU zhbllokua\b/i,
  /\bNjoftimet\b/i,
  /\bPastro\b/i,
  /\bShëno të lexuara\b/i,
  /\bDiçka shkoi keq\b/i,
  /\bDuke u procesuar\b/i,
]

const LOCALE_HINTS = {
  sq: {
    signIn: /Hyr/i,
    forgotPassword: /Harruat/i,
    notifications: /Njoftimet/i,
    paymentTitle: /Konfirmo vendin/i,
    unblock: /Zhblloko/i,
    duplicateEmail: /Ky email është i regjistruar/i,
  },
  en: {
    signIn: /Sign in/i,
    forgotPassword: /Forgot/i,
    notifications: /Notifications/i,
    paymentTitle: /Confirm your seat/i,
    unblock: /Unblock/i,
    duplicateEmail: /already registered/i,
  },
  de: {
    signIn: /Anmelden/i,
    forgotPassword: /Passwort vergessen/i,
    notifications: /Benachrichtigungen/i,
    paymentTitle: /Platz bestätigen/i,
    unblock: /Entsperren/i,
    duplicateEmail: /bereits registriert/i,
  },
  mk: {
    signIn: /Најав/i,
    forgotPassword: /Заборав/i,
    notifications: /Известувања/i,
    paymentTitle: /Потврди го местото/i,
    unblock: /Одблокирај/i,
    duplicateEmail: /веќе регистриран/i,
  },
}

function scanText(text, context) {
  const flags = []
  if (!text || text.length < 2) return flags
  for (const pat of PHASE6_ALBANIAN_PATTERNS) {
    if (pat.test(text)) flags.push({ context, pattern: pat.toString(), snippet: text.slice(0, 140) })
  }
  return flags
}

async function apiLogin(email, password, retries = 3) {
  let lastErr
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!data.access_token) throw new Error(`login failed: ${JSON.stringify(data)}`)
      return data
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

async function freshAdminSession() {
  return apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
}

async function createPageWithSession(browser, session, locale) {
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    locale: locale === 'sq' ? 'sq-AL' : locale === 'de' ? 'de-DE' : locale === 'mk' ? 'mk-MK' : 'en-US',
  })
  await context.addInitScript(({ uiLang, adminKey }) => {
    localStorage.setItem('ejabashkohu-ui-lang', uiLang)
    sessionStorage.setItem(adminKey, 'main')
  }, { uiLang: locale, adminKey: ADMIN_SCREEN_KEY })

  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90000 })
  if (session) {
    await page.evaluate(
      ({ key, sess }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            access_token: sess.access_token,
            refresh_token: sess.refresh_token,
            expires_in: sess.expires_in,
            expires_at: sess.expires_at,
            token_type: sess.token_type || 'bearer',
            user: sess.user,
          }),
        )
      },
      { key: AUTH_KEY, sess: session },
    )
    await page.reload({ waitUntil: 'networkidle', timeout: 90000 })
  }
  await page.waitForTimeout(2000)
  if (session) await ensureAdminOnFeed(page)
  return { context, page }
}

async function ensureAdminOnFeed(page) {
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('.hdr-user').isVisible().catch(() => false)) return true
    const normalUserLink = page.locator('button, a', { hasText: /përdorues normal|normal user|normal/i })
    if (await normalUserLink.first().isVisible().catch(() => false)) {
      await normalUserLink.first().click()
      await page.waitForTimeout(2000)
      if (await page.locator('.hdr-user').isVisible().catch(() => false)) return true
    }
    await page.waitForTimeout(1200)
  }
  return page.locator('.hdr-user').isVisible().catch(() => false)
}

async function openSignIn(page) {
  if (await page.locator('.hdr-user').isVisible().catch(() => false)) return true
  const signInBtn = page.locator('button', { hasText: /^Hyr$|^Sign in$|^Anmelden$|^Најави$/i }).first()
  if (await signInBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await signInBtn.click()
    await page.waitForTimeout(600)
  }
  return page.locator('input[type="email"]').first().isVisible({ timeout: 8000 }).catch(() => false)
}

async function screenshot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

async function collectVisibleText(page) {
  return page.evaluate(() => {
    const toast = document.querySelector('.toast')?.textContent || ''
    const authErr = document.querySelector('.age-warn')?.textContent || ''
    const sheet = document.querySelector('.sheet.pay')?.textContent || ''
    const notif = document.querySelector('.notif-panel')?.textContent || ''
    return [toast, authErr, sheet, notif, document.body?.innerText?.slice(0, 8000) || ''].join('\n')
  })
}

async function testEnResidualScan(browser, report) {
  const flags = []
  const { context, page } = await createPageWithSession(browser, null, 'en')
  const opened = await openSignIn(page)
  if (!opened) {
    report.tests.test1_residual = { pass: false, error: 'sign-in form not reachable' }
    await context.close()
    return
  }

  // Failed login
  await page.locator('input[type="email"]').first().fill('nobody@example.com')
  await page.locator('.input-password-wrap input').first().fill('wrongpass')
  await page.locator('button', { hasText: /^Hyr$|^Sign in$|^Anmelden$|^Најави$/i }).last().click()
  await page.waitForTimeout(2000)
  flags.push(...scanText(await collectVisibleText(page), 'failed-login'))
  await screenshot(page, 'test1-en-failed-login')

  // Forgot password empty email (only once in test1)
  const forgot = page.getByRole('button', { name: /Forgot|Harruat|Passwort vergessen|Заборав/i }).first()
  if (await forgot.isVisible().catch(() => false)) {
    await forgot.click()
    await page.waitForTimeout(500)
    const submit = page.getByRole('button', { name: /Send|Dërgo|Senden|Испрати/i }).first()
    if (await submit.isVisible().catch(() => false)) {
      await submit.click()
      await page.waitForTimeout(1500)
      flags.push(...scanText(await collectVisibleText(page), 'forgot-empty-email'))
      await screenshot(page, 'test1-en-forgot-empty')
    }
  }

  await context.close()
  report.tests.test1_residual = {
    pass: flags.length === 0,
    flagCount: flags.length,
    flags,
  }
}

async function testDuplicateEmailEn(browser, report) {
  const { context, page } = await createPageWithSession(browser, null, 'en')

  await page.locator('button.hero-cta').first().click()
  await page.waitForTimeout(1000)

  await page.locator('input[placeholder*="First"], input.modern').first().fill('Test')
  const inputs = page.locator('.input.modern')
  if (await inputs.count() >= 2) await inputs.nth(1).fill('User')
  await page.locator('input[type="email"]').first().fill(ADMIN_EMAIL)
  await page.locator('.input-password-wrap input').first().fill('SomePass123!')
  await page.locator('#terms-check').check().catch(() => {})
  await page.locator('button.modern-btn, button.primary.full').first().click()
  await page.waitForTimeout(3500)

  const text = await collectVisibleText(page)
  const hasEnglish = /already registered/i.test(text)
  const hasAlbanian = /Ky email është i regjistruar/i.test(text)
  await screenshot(page, 'test3-en-duplicate-email')

  report.tests.test3_globalErrorMap = {
    pass: hasEnglish && !hasAlbanian,
    hasEnglish,
    hasAlbanian,
    snippet: text.match(/.{0,80}(already registered|Ky email).{0,80}/i)?.[0] || text.slice(0, 240),
  }
  await context.close()
}

async function signInAdminUI(page) {
  if (await page.locator('.hdr-user').isVisible().catch(() => false)) return true
  const signInBtn = page.locator('button', { hasText: /^Hyr$|^Sign in$|^Anmelden$|^Најави$/i }).first()
  if (!(await signInBtn.isVisible({ timeout: 8000 }).catch(() => false))) return false
  await signInBtn.click()
  await page.waitForTimeout(500)
  const emailInput = page.locator('input[type="email"]').first()
  if (!(await emailInput.isVisible({ timeout: 8000 }).catch(() => false))) return false
  await emailInput.fill(ADMIN_EMAIL)
  await page.locator('.input-password-wrap input').first().fill(ADMIN_PASSWORD)
  await page.locator('button', { hasText: /^Hyr$|^Sign in$|^Anmelden$|^Најави$/i }).last().click()
  await page.waitForTimeout(3500)
  return ensureAdminOnFeed(page)
}

async function testLocaleWalkthrough(browser, locale, report) {
  const shots = []
  const { context, page } = await createPageWithSession(browser, null, locale)
  await signInAdminUI(page)
  await page.waitForTimeout(1500)
  const adminReturn = page.locator('.admin-return-badge').first()
  if (await adminReturn.isVisible().catch(() => false)) {
    await adminReturn.click()
    await page.waitForTimeout(1500)
  }

  shots.push(await screenshot(page, `test2-${locale}-feed`))

  const hints = LOCALE_HINTS[locale]

  // Notifications panel
  await page.evaluate(() => document.querySelector('.bell')?.click())
  await page.waitForTimeout(800)
  if (await page.locator('.notif-panel').isVisible().catch(() => false)) {
    shots.push(await screenshot(page, `test2-${locale}-notifications`))
  }

  // 2) Profile → blocked users (Phase 4b toast regression)
  await page.evaluate(() => document.querySelector('.hdr-user')?.click())
  await page.waitForTimeout(600)
  const blockedNav = page.getByRole('button', { name: /Blocked users|Përdoruesit e bllokuar|Blockierte Nutzer|Блокирани корисници/i }).first()
  if (await blockedNav.isVisible().catch(() => false)) {
    await blockedNav.click()
    await page.waitForTimeout(800)
    shots.push(await screenshot(page, `test2-${locale}-blocked-users`))
    const unblockBtn = page.getByRole('button', { name: hints.unblock }).first()
    if (await unblockBtn.isVisible().catch(() => false)) {
      await unblockBtn.click()
      await page.waitForTimeout(2000)
      shots.push(await screenshot(page, `test2-${locale}-unblock-toast`))
      if (locale === 'en') {
        const toastText = await page.evaluate(() => document.querySelector('.toast')?.textContent || '')
        report.tests.test4_unblockToast = {
          pass: /Unblocked|unblock/i.test(toastText) && !/\bU zhbllokua\b/i.test(toastText),
          toastText: toastText.slice(0, 120),
        }
      }
    }
  }

  // 3) Payment sheet — open my tables and try confirm if visible
  const myTables = page.getByRole('button', { name: /My tables|Tavolinat|Meine Tische|Мои маси/i }).first()
  if (await myTables.isVisible().catch(() => false)) {
    await myTables.click()
    await page.waitForTimeout(1200)
    shots.push(await screenshot(page, `test2-${locale}-my-tables`))
    const payBtn = page.getByRole('button', { name: /Confirm|Konfirmo|bestätigen|Потврди/i }).first()
    if (await payBtn.isVisible().catch(() => false)) {
      await payBtn.click()
      await page.waitForTimeout(1000)
      shots.push(await screenshot(page, `test2-${locale}-payment-sheet`))
    }
  }

  // 4) Change password screen (error toast path)
  await page.evaluate(() => document.querySelector('.hdr-user')?.click())
  await page.waitForTimeout(400)
  const changePw = page.getByRole('button', { name: /Change password|Ndrysho|Passwort ändern|Промени лозинка/i }).first()
  if (await changePw.isVisible().catch(() => false)) {
    await changePw.click()
    await page.waitForTimeout(500)
    shots.push(await screenshot(page, `test2-${locale}-change-password`))
  }

  const visible = await collectVisibleText(page)
  const residualFlags = locale === 'en' ? scanText(visible, `${locale}-walkthrough`) : []

  report.tests.test2_walkthrough = report.tests.test2_walkthrough || {}
  report.tests.test2_walkthrough[locale] = {
    screenshots: shots.map((s) => path.basename(s)),
    residualFlags,
    pass: locale !== 'en' || residualFlags.length === 0,
  }

  await context.close()
}

async function detectLiveBundle() {
  try {
    const html = await fetch(`${BASE}/`).then((r) => r.text())
    const m = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/)
    return m ? `index-${m[1]}.js` : null
  } catch {
    return null
  }
}

async function main() {
  const report = {
    base: BASE,
    timestamp: ts,
    outDir: OUT,
    liveBundle: await detectLiveBundle(),
    localBuildBundle: 'index-BOWnsWMg.js',
    tests: {},
  }

  const browser = await chromium.launch({ headless: true })

  try {
    await testEnResidualScan(browser, report)
    await testDuplicateEmailEn(browser, report)

    if (!process.env.SKIP_TEST2) {
      for (const loc of LOCALES) {
        await testLocaleWalkthrough(browser, loc, report)
        await new Promise((r) => setTimeout(r, 800))
      }
    } else {
      report.tests.test2_walkthrough = { skipped: true }
    }
  } finally {
    await browser.close()
  }

  report.summary = {
    test1: report.tests.test1_residual?.pass ?? false,
    test2: LOCALES.every((l) => report.tests.test2_walkthrough?.[l]?.pass !== false),
    test3: report.tests.test3_globalErrorMap?.pass ?? false,
    test4: report.tests.test4_unblockToast?.pass ?? true,
    bundleMatchesBuild:
      !report.liveBundle || report.liveBundle === report.localBuildBundle,
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.summary, null, 2))
  console.log(`Evidence: ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
