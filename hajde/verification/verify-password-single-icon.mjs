/**
 * Verify single eye icon per password field (no browser-native duplicate)
 * node verification/verify-password-single-icon.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'password-toggles', `single-icon-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

const APP = process.env.APP_URL || 'https://ejabashkohu.com'
const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()

const report = { ts, outDir: OUT, app: APP, tests: {} }

async function probeWrap(page, scope) {
  return page.evaluate((sel) => {
    const wraps = [...document.querySelectorAll(`${sel} .input-password-wrap`)]
    return wraps.map((wrap) => {
      const input = wrap.querySelector('input')
      const btn = wrap.querySelector('.password-toggle')
      return {
        toggles: wrap.querySelectorAll('.password-toggle').length,
        svgs: wrap.querySelectorAll('svg').length,
        paths: wrap.querySelectorAll('path').length,
        circles: wrap.querySelectorAll('circle').length,
        inputType: input?.type ?? null,
        webkitTextSecurity: input ? getComputedStyle(input).webkitTextSecurity : null,
        btnChildTags: btn ? [...btn.children].map((c) => c.tagName) : [],
      }
    })
  }, scope)
}

async function countToggles(page, scope = '') {
  const sel = scope ? `${scope} .password-toggle` : '.password-toggle'
  return page.locator(sel).count()
}

async function toggleWorks(page, scope) {
  const input = page.locator(`${scope} .input-password-wrap input`).first()
  const btn = page.locator(`${scope} .password-toggle`).first()
  await input.fill('SecretTest123')
  const maskedBefore = await input.evaluate((el) => getComputedStyle(el).webkitTextSecurity)
  await btn.click()
  await page.waitForTimeout(200)
  const maskedAfter = await input.evaluate((el) => getComputedStyle(el).webkitTextSecurity)
  return maskedBefore === 'disc' && maskedAfter !== 'disc'
}

function wrapsOk(wraps, expectedCount) {
  if (wraps.length !== expectedCount) return false
  return wraps.every((w) => w.toggles === 1 && w.svgs === 1 && w.paths === 1 && w.circles === 0)
}

async function loginAsAdmin(page) {
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
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

async function main() {
  let browser
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    report.browser = 'msedge'
  } catch {
    browser = await chromium.launch({ headless: true })
    report.browser = 'chromium'
  }

  const context = await browser.newContext({ locale: 'sq-AL', viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('ejabashkohu-ui-lang', 'sq')
  })
  const page = await context.newPage()

  // Sign-in (masked)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.locator('.landing-nav .btn.ghost.sm').click()
  await page.waitForTimeout(800)
  await page.locator('.ob-card .input-password-wrap input').first().fill('SecretSignIn123')
  const signInWraps = await probeWrap(page, '.ob-card')
  const signInToggleWorks = await toggleWorks(page, '.ob-card')
  await page.locator('.ob-card .input-password-wrap input').first().fill('SecretSignIn123')
  await page.screenshot({ path: path.join(OUT, '01-sign-in-masked.png'), fullPage: true })
  await page.locator('.ob-card .password-toggle').first().click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(OUT, '01-sign-in-visible.png'), fullPage: true })
  report.tests.signIn = {
    toggleCount: await countToggles(page, '.ob-card'),
    wraps: signInWraps,
    toggleWorks: signInToggleWorks,
  }
  report.tests.signIn.pass =
    report.tests.signIn.toggleCount === 1 &&
    wrapsOk(signInWraps, 1) &&
    report.tests.signIn.toggleWorks

  // Registration
  await page.getByRole('button', { name: /Kthehu|back/i }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.waitForTimeout(1500)
  await page.locator('.step-title').waitFor({ timeout: 15000 })
  await page.locator('.onboard-card .input-password-wrap input').first().fill('SecretReg123')
  const regWraps = await probeWrap(page, '.onboard-card')
  await page.screenshot({ path: path.join(OUT, '02-registration.png'), fullPage: true })
  report.tests.registration = {
    toggleCount: await countToggles(page, '.onboard-card'),
    wraps: regWraps,
    toggleWorks: await toggleWorks(page, '.onboard-card'),
  }
  report.tests.registration.pass =
    report.tests.registration.toggleCount === 1 &&
    wrapsOk(regWraps, 1) &&
    report.tests.registration.toggleWorks

  // Change password x3
  await loginAsAdmin(page)
  await openOwnProfile(page)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.change-password-form .input-password-wrap input').nth(0).fill('Current1')
  await page.locator('.change-password-form .input-password-wrap input').nth(1).fill('NewSecret222')
  await page.locator('.change-password-form .input-password-wrap input').nth(2).fill('NewSecret222')
  const changeWraps = await probeWrap(page, '.change-password-form')
  await page.screenshot({ path: path.join(OUT, '03-change-password.png'), fullPage: true })
  const middleToggleWorks = await (async () => {
    const input = page.locator('.change-password-form .input-password-wrap input').nth(1)
    const btn = page.locator('.change-password-form .password-toggle').nth(1)
    const before = await input.evaluate((el) => getComputedStyle(el).webkitTextSecurity)
    await btn.click()
    await page.waitForTimeout(200)
    const after = await input.evaluate((el) => getComputedStyle(el).webkitTextSecurity)
    return before === 'disc' && after !== 'disc'
  })()
  report.tests.changePassword = {
    toggleCount: await countToggles(page, '.change-password-form'),
    wraps: changeWraps,
    toggleWorks: middleToggleWorks,
    pass: false,
  }
  report.tests.changePassword.pass =
    report.tests.changePassword.toggleCount === 3 &&
    wrapsOk(changeWraps, 3) &&
    middleToggleWorks

  // Password recovery (requires hash in URL — use recovery flow UI if available via forgot password note)
  // Skip live recovery unless we can reach it; document as N/A on production without token.
  report.tests.recovery = { skipped: true, reason: 'Requires auth recovery token in URL' }

  report.bundle = await page.evaluate(async () => {
    const scripts = [...document.querySelectorAll('script[src*="/assets/index-"]')].map((s) => s.src)
    const links = [...document.querySelectorAll('link[href*="/assets/index-"]')].map((l) => l.href)
    return { scripts, links }
  })

  report.allPass = Object.values(report.tests).every((t) => t.skipped || t.pass)
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify(report, null, 2))
  if (!report.allPass) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
