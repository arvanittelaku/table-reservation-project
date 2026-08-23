/**
 * Password toggle icon-only verification
 * node verification/verify-password-toggle-icons.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'password-toggles', `icons-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

const APP = process.env.APP_URL || 'https://ejabashkohu.com'
const ADMIN_EMAIL = 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = 'ejaBashkohu1@@'

const report = { ts, outDir: OUT, app: APP, tests: {} }

function save(name, obj) {
  fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2))
}

async function toggleLabels(page, scope = '') {
  const sel = scope ? `${scope} .password-toggle` : '.password-toggle'
  return page.locator(sel).evaluateAll((btns) =>
    btns.map((b) => ({
      text: b.textContent?.trim() || '',
      hasSvg: !!b.querySelector('svg'),
      aria: b.getAttribute('aria-label'),
    })),
  )
}

async function loginAsAdmin(page) {
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForTimeout(1500)
  await page.locator('.landing-nav .btn.ghost.sm').click()
  await page.waitForTimeout(800)
  await page.locator('input[type="email"]').first().fill(ADMIN_EMAIL)
  await page.locator('.ob-card .input-password-wrap input').first().fill(ADMIN_PASSWORD)
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(8000)
  const viewAsUser = page.locator('button.btn.ghost', { hasText: 'Shiko si përdorues normal' })
  if (await viewAsUser.isVisible().catch(() => false)) {
    await viewAsUser.click()
    await page.waitForTimeout(4000)
  }
  await page.evaluate(() => document.querySelector('.admin-return-badge')?.remove())
}

async function openOwnProfile(page) {
  await page.evaluate(() => document.querySelector('.admin-return-badge')?.remove())
  await page.locator('.hdr-user').click({ force: true })
}

function iconOnlyOk(labels) {
  return labels.every(
    (l) => l.hasSvg && l.text === '' && !/^(Shfaq|Fshih|Show|Hide)$/i.test(l.text),
  )
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'sq-AL', viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('ejabashkohu-ui-lang', 'sq')
  })
  const page = await context.newPage()

  // Sign-in
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.locator('.landing-nav .btn.ghost.sm').click()
  await page.waitForTimeout(800)
  const signInLabels = await toggleLabels(page, '.ob-card')
  report.tests.signIn = { pass: iconOnlyOk(signInLabels), labels: signInLabels }
  await page.screenshot({ path: path.join(OUT, 'sign-in-toggle.png'), fullPage: true })

  // Registration
  await page.getByRole('button', { name: /Kthehu|back/i }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.waitForTimeout(1500)
  await page.locator('.step-title').waitFor({ timeout: 15000 })
  const regLabels = await toggleLabels(page, '.onboard-card')
  report.tests.registration = { pass: iconOnlyOk(regLabels), labels: regLabels }
  await page.screenshot({ path: path.join(OUT, 'registration-toggle.png'), fullPage: true })

  // Change password (3 fields)
  await loginAsAdmin(page)
  await openOwnProfile(page)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(1000)
  const changeLabels = await toggleLabels(page, '.change-password-form')
  report.tests.changePassword = {
    pass: iconOnlyOk(changeLabels) && changeLabels.length === 3,
    labels: changeLabels,
    count: changeLabels.length,
  }
  await page.screenshot({ path: path.join(OUT, 'change-password-toggles.png'), fullPage: true })

  report.allPass = Object.values(report.tests).every((t) => t.pass)
  save('report.json', report)
  await browser.close()
  console.log(JSON.stringify(report, null, 2))
  if (!report.allPass) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
