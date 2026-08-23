/**
 * Password toggle verification (TEST 1-3)
 * node verification/verify-password-toggles.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'password-toggles', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const APP = process.env.APP_URL || 'https://ejabashkohu.com'
const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()

const report = { ts, outDir: OUT, app: APP, tests: {} }

function save(name, obj) {
  fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2))
}

async function screenshotField(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
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

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'sq-AL', viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('ejabashkohu-ui-lang', 'sq')
  })
  const page = await context.newPage()

  // TEST 1a — Sign-in password toggle
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.locator('.landing-nav .btn.ghost.sm').click()
  await page.waitForTimeout(800)
  const signInPass = page.locator('.input-password-wrap input').first()
  await signInPass.fill('SecretSignIn123')
  await page.locator('.input-password-wrap .password-toggle').first().click()
  await page.waitForTimeout(400)
  const signInVisible = (await signInPass.getAttribute('type')) === 'text'
  await screenshotField(page, 'test1-sign-in-visible')
  report.tests.test1_signIn = { pass: signInVisible, inputType: await signInPass.getAttribute('type') }

  // TEST 1b — Registration step 1 password toggle
  await page.getByRole('button', { name: /Kthehu|back/i }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.waitForTimeout(1500)
  await page.locator('.step-title').waitFor({ timeout: 15000 })
  const regPass = page.locator('.onboard-card .input-password-wrap input').first()
  await regPass.fill('SecretReg123')
  await page.locator('.onboard-card .password-toggle').first().click()
  await page.waitForTimeout(400)
  const regVisible = (await regPass.getAttribute('type')) === 'text'
  await screenshotField(page, 'test1-registration-visible')
  report.tests.test1_registration = { pass: regVisible, inputType: await regPass.getAttribute('type') }

  // Change password screen — login first
  await loginAsAdmin(page)
  await openOwnProfile(page)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(1000)

  const changeInputs = page.locator('.change-password-form .input-password-wrap input')
  const changeToggles = page.locator('.change-password-form .password-toggle')
  await changeInputs.nth(0).fill('CurrentSecret1')
  await changeInputs.nth(1).fill('NewSecret222')
  await changeInputs.nth(2).fill('NewSecret222')

  // TEST 1c — current field toggle
  await changeToggles.nth(0).click()
  await page.waitForTimeout(300)
  report.tests.test1_changeCurrent = {
    pass: (await changeInputs.nth(0).getAttribute('type')) === 'text',
    inputType: await changeInputs.nth(0).getAttribute('type'),
  }
  await screenshotField(page, 'test1-change-current-visible')

  // Reset toggles by re-navigating
  await page.getByText('← Prapa').click()
  await page.waitForTimeout(800)
  await openOwnProfile(page)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(800)
  await changeInputs.nth(0).fill('CurrentSecret1')
  await changeInputs.nth(1).fill('NewSecret222')
  await changeInputs.nth(2).fill('NewSecret222')

  // TEST 1d — new password toggle
  await changeToggles.nth(1).click()
  await page.waitForTimeout(300)
  report.tests.test1_changeNew = {
    pass: (await changeInputs.nth(1).getAttribute('type')) === 'text',
    inputType: await changeInputs.nth(1).getAttribute('type'),
  }
  await screenshotField(page, 'test1-change-new-visible')

  await page.getByText('← Prapa').click()
  await page.waitForTimeout(800)
  await openOwnProfile(page)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(800)
  await changeInputs.nth(0).fill('CurrentSecret1')
  await changeInputs.nth(1).fill('NewSecret222')
  await changeInputs.nth(2).fill('NewSecret222')

  // TEST 1e — confirm field toggle
  await changeToggles.nth(2).click()
  await page.waitForTimeout(300)
  report.tests.test1_changeConfirm = {
    pass: (await changeInputs.nth(2).getAttribute('type')) === 'text',
    inputType: await changeInputs.nth(2).getAttribute('type'),
  }
  await screenshotField(page, 'test1-change-confirm-visible')

  // TEST 2 — independent toggles (only middle field visible)
  await page.getByText('← Prapa').click()
  await page.waitForTimeout(800)
  await openOwnProfile(page)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(800)
  await changeInputs.nth(0).fill('CurrentSecret1')
  await changeInputs.nth(1).fill('NewSecret222')
  await changeInputs.nth(2).fill('NewSecret222')
  await changeToggles.nth(1).click()
  await page.waitForTimeout(300)
  const types = await Promise.all([
    changeInputs.nth(0).getAttribute('type'),
    changeInputs.nth(1).getAttribute('type'),
    changeInputs.nth(2).getAttribute('type'),
  ])
  report.tests.test2_independent = {
    pass: types[0] === 'password' && types[1] === 'text' && types[2] === 'password',
    types,
  }
  await screenshotField(page, 'test2-independent-middle-only')

  // TEST 3 — navigate away and back, fields empty + toggles hidden
  await page.getByText('← Prapa').click()
  await page.waitForTimeout(800)
  await openOwnProfile(page)
  await page.getByRole('button', { name: 'Ndrysho fjalëkalimin' }).click()
  await page.waitForTimeout(800)
  const values = await Promise.all([
    changeInputs.nth(0).inputValue(),
    changeInputs.nth(1).inputValue(),
    changeInputs.nth(2).inputValue(),
  ])
  const typesAfter = await Promise.all([
    changeInputs.nth(0).getAttribute('type'),
    changeInputs.nth(1).getAttribute('type'),
    changeInputs.nth(2).getAttribute('type'),
  ])
  const toggleCount = await changeToggles.count()
  report.tests.test3_reset = {
    pass:
      values.every((v) => v === '') &&
      typesAfter.every((t) => t === 'password') &&
      toggleCount === 3,
    values,
    typesAfter,
    toggleCount,
  }
  await screenshotField(page, 'test3-reset-hidden')

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
