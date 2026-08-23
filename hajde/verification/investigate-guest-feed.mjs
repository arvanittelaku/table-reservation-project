/**
 * Investigate guest feed debug finding:
 * - Test-only incomplete session injection vs real login + refresh
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { localDateInputValue } from '../src/lib/eventSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://a0309689.ejabashkohu.pages.dev'
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const PW = 'TestPass123!'
const PHOTO = path.join(__dirname, 'evidence', 'guest-feed-investigation', 'face.png')
const OUT = path.dirname(PHOTO)

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(
  PHOTO,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const ts = Date.now()
const report = { ts, base: BASE, tests: [] }

function log(name, data) {
  report.tests.push({ name, ...data })
  console.log(`\n=== ${name} ===`)
  console.log(JSON.stringify(data, null, 2))
}

async function signupApi(email, fn, ln) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PW,
      data: { first_name: fn, last_name: ln, age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`signup ${email}: ${JSON.stringify(data)}`)
  return data
}

async function setAge(page, target) {
  const ageBig = page.locator('.age-big')
  await ageBig.waitFor({ timeout: 15000 })
  let current = parseInt(await ageBig.textContent(), 10) || 24
  const dec = page.getByRole('button', { name: 'Zvogëlo' })
  const inc = page.getByRole('button', { name: 'Rrit' })
  while (current > target) {
    await dec.click()
    current = parseInt(await ageBig.textContent(), 10)
  }
  while (current < target) {
    await inc.click()
    current = parseInt(await ageBig.textContent(), 10)
  }
}

async function fullOnboard(page, email, fn, ln) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill(fn)
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill(ln)
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PW)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.waitForTimeout(2000)
  await setAge(page, 28)
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.locator('input[type="file"]').setInputFiles(PHOTO)
  await page.waitForTimeout(2000)
  const skip = page.getByRole('button', { name: /Vazhdo pa foto/i })
  if (await skip.isVisible().catch(() => false)) await skip.click()
  else await page.locator('.step-body').getByRole('button', { name: 'Vazhdo' }).click().catch(() => skip.click())
  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Më vonë' }).click().catch(() => {})
}

async function feedState(page) {
  const onMain = await page.locator('.hdr-user').isVisible().catch(() => false)
  const onOnboard = await page.getByText(/Eja bashkohu|Hapi \d nga 4/i).first().isVisible().catch(() => false)
  const count = await page.locator('.count').textContent().catch(() => '')
  const loading = await page.locator('[aria-busy="true"]').isVisible().catch(() => false)
  const feedErr = await page.locator('.feed-error-state').isVisible().catch(() => false)
  const authInPage = await page.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? !!JSON.parse(raw).access_token : false
    } catch {
      return false
    }
  }, AUTH_KEY)
  return { onMain, onOnboard, count, loading, feedErr, authInPage }
}

async function injectSession(page, session, minimal = false) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, session, minimal }) => {
      const payload = minimal
        ? {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            user: session.user,
            token_type: 'bearer',
          }
        : {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: session.expires_at,
            token_type: session.token_type || 'bearer',
            user: session.user,
          }
      localStorage.setItem(key, JSON.stringify(payload))
    },
    { key: AUTH_KEY, session, minimal },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(5000)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('dialog', (d) => d.accept())

  const hostEmail = `ejabashkohu+gfhost.${ts}@gmail.com`
  const guestApiEmail = `ejabashkohu+gfapi.${ts}@gmail.com`
  const guestOnboardEmail = `ejabashkohu+gflive.${ts}@gmail.com`
  const title = `GuestFeed-${ts}`

  // Create host table via API
  const hostSess = await signupApi(hostEmail, 'Host', 'Feed')
  const hostClient = createClient(SB, ANON)
  await hostClient.auth.setSession({
    access_token: hostSess.access_token,
    refresh_token: hostSess.refresh_token,
  })
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(20, 0, 0, 0)
  const { data: table } = await hostClient
    .from('tables')
    .insert({
      kind: 'tavoline',
      category: 'kafe',
      title,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: 'Nesër',
      event_datetime: tomorrow.toISOString(),
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'guest feed test',
      host_id: hostSess.user.id,
    })
    .select('id')
    .single()

  const guestSess = await signupApi(guestApiEmail, 'Guest', 'ApiOnly')
  const guestClient = createClient(SB, ANON)
  await guestClient.auth.setSession({
    access_token: guestSess.access_token,
    refresh_token: guestSess.refresh_token,
  })
  const { data: apiFeed } = await guestClient.from('tables').select('id,title').eq('id', table.id)

  // TEST A — original debug pattern (minimal localStorage, API-only guest, no onboarding)
  await injectSession(page, guestSess, true)
  let stateA = await feedState(page)
  const hasTitleA = await page.getByText(title).first().isVisible().catch(() => false)
  await page.screenshot({ path: path.join(OUT, 'test-a-minimal-inject.png'), fullPage: true })
  log('A_minimal_inject_api_only_guest', {
    apiFeedCount: apiFeed?.length ?? 0,
    ...stateA,
    hasTitleInUi: hasTitleA,
    verdict: 'test-artifact if onOnboard && authInPage',
  })

  // TEST B — full session object (E2E injectSession style), still API-only guest
  await injectSession(page, guestSess, false)
  let stateB = await feedState(page)
  const hasTitleB = await page.getByText(title).first().isVisible().catch(() => false)
  await page.screenshot({ path: path.join(OUT, 'test-b-full-inject.png'), fullPage: true })
  log('B_full_inject_api_only_guest', { ...stateB, hasTitleInUi: hasTitleB })

  // TEST C — real UI onboarding guest + refresh (session restore)
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await fullOnboard(page, guestOnboardEmail, 'Guest', 'Live')
  let stateC1 = await feedState(page)
  const hasTitleC1 = await page.getByText(title).first().isVisible().catch(() => false)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(5000)
  await page.getByRole('button', { name: 'Më vonë' }).click().catch(() => {})
  let stateC2 = await feedState(page)
  const hasTitleC2 = await page.getByText(title).first().isVisible().catch(() => false)
  await page.screenshot({ path: path.join(OUT, 'test-c-refresh.png'), fullPage: true })
  log('C_real_onboard_then_refresh', {
    beforeRefresh: { ...stateC1, hasTitleInUi: hasTitleC1 },
    afterRefresh: { ...stateC2, hasTitleInUi: hasTitleC2 },
    refreshOk: stateC2.onMain && hasTitleC2,
  })

  // TEST D — real UI sign-in (not inject) for API-only account
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Hyr$/ }).first().click()
  await page.getByPlaceholder('Email-i yt').fill(guestApiEmail)
  await page.getByPlaceholder('Fjalëkalimi').fill(PW)
  await page.getByRole('button', { name: 'Hyr' }).click()
  await page.waitForTimeout(4000)
  let stateD = await feedState(page)
  const hasTitleD = await page.getByText(title).first().isVisible().catch(() => false)
  await page.screenshot({ path: path.join(OUT, 'test-d-signin-api-only.png'), fullPage: true })
  log('D_signin_api_only_guest', { ...stateD, hasTitleInUi: hasTitleD })

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()

  const realUserBug = report.tests.find((t) => t.name === 'C_real_onboard_then_refresh')?.refreshOk === false
  console.log('\n=== CONCLUSION ===')
  console.log(
    realUserBug
      ? 'REAL USER BUG: feed broken after refresh'
      : 'Guest feed issue appears TEST-ONLY (incomplete inject / API-only account without onboarding)',
  )
  process.exit(realUserBug ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
