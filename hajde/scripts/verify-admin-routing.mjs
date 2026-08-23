/**
 * Verify admin role-based login routing (TEST 1-4).
 * Run: node scripts/verify-admin-routing.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const BASE = process.env.VERIFY_URL || 'https://45e270c5.ejabashkohu.pages.dev'
const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const ADMIN_SCREEN_KEY = 'ejabashkohu-admin-screen'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ejaBashkohu1@@'

const SHOT_DIR = join('scripts', 'screenshots', 'admin-routing')
mkdirSync(SHOT_DIR, { recursive: true })

async function signup(email, firstName, lastName) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass123!',
      data: { first_name: firstName, last_name: lastName, age: 25 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`signup failed: ${JSON.stringify(data)}`)
  return data
}

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`login failed: ${JSON.stringify(data)}`)
  return data
}

async function injectSession(page, session, sessionStorageData = {}) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, session, sessionStorageData }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type || 'bearer',
          user: session.user,
        }),
      )
      for (const [k, v] of Object.entries(sessionStorageData)) {
        sessionStorage.setItem(k, v)
      }
    },
    { key: AUTH_KEY, session, sessionStorageData },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
}

async function domCounts(page) {
  return page.evaluate(() => ({
    adminLink: document.querySelectorAll('.admin-link').length,
    adminPanel: document.querySelectorAll('.admin-panel').length,
    adminTitle: document.querySelectorAll('.admin-title').length,
    statistikaTab: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Statistika')).length,
    feedFab: document.querySelectorAll('.fab').length,
    feedHdr: document.querySelectorAll('.hdr').length,
    viewAsUser: [...document.querySelectorAll('button')].filter((b) =>
      b.textContent.includes('Shiko si përdorues normal'),
    ).length,
    returnBadge: document.querySelectorAll('.admin-return-badge').length,
    adminWordButtons: [...document.querySelectorAll('button')].filter((b) => /\bAdmin\b/.test(b.textContent)).length,
  }))
}

async function main() {
  const results = {}
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const ts = Date.now()

  console.log(`\nVerify URL: ${BASE}\n`)

  // TEST 1 — non-admin login lands on feed, no admin UI
  try {
    const userSess = await signup(`route-nonadmin-${ts}@test.local`, 'Regular', 'User')
    await injectSession(page, userSess)
    const dom = await domCounts(page)
    const bodyText = await page.locator('body').innerText()
    const adminMatches = (bodyText.match(/\bAdmin\b/g) || []).length
    await page.screenshot({ path: join(SHOT_DIR, 'test1-nonadmin-feed.png'), fullPage: true })
    results.test1 = {
      pass:
        dom.adminPanel === 0 &&
        dom.adminLink === 0 &&
        dom.returnBadge === 0 &&
        dom.viewAsUser === 0 &&
        adminMatches === 0 &&
        (dom.feedFab > 0 || dom.feedHdr > 0),
      dom,
      adminTextMatches: adminMatches,
    }
    console.log('TEST 1:', JSON.stringify(results.test1, null, 2))
  } catch (e) {
    results.test1 = { pass: false, error: String(e) }
    console.log('TEST 1 FAIL:', e)
  }

  // TEST 2 — admin login redirects to panel
  try {
    const adminSess = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
    await injectSession(page, adminSess)
    const dom = await domCounts(page)
    const bodyText = await page.locator('body').innerText()
    await page.screenshot({ path: join(SHOT_DIR, 'test2-admin-panel.png'), fullPage: true })
    results.test2 = {
      pass:
        dom.adminPanel > 0 &&
        dom.statistikaTab > 0 &&
        dom.viewAsUser > 0 &&
        dom.feedFab === 0 &&
        dom.adminLink === 0 &&
        /Statistika/.test(bodyText),
      dom,
      bodySnippet: bodyText.slice(0, 300),
    }
    console.log('TEST 2:', JSON.stringify(results.test2, null, 2))
  } catch (e) {
    results.test2 = { pass: false, error: String(e) }
    console.log('TEST 2 FAIL:', e)
  }

  // TEST 3 — admin switches to normal view and back
  try {
    const adminSess = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
    await injectSession(page, adminSess)
    await page.getByRole('button', { name: /Shiko si përdorues normal/ }).click()
    await page.waitForTimeout(1500)
    let dom = await domCounts(page)
    await page.screenshot({ path: join(SHOT_DIR, 'test3-admin-as-user.png'), fullPage: true })
    const onFeed = dom.adminPanel === 0 && dom.returnBadge > 0 && (dom.feedFab > 0 || dom.feedHdr > 0)
    await page.locator('.admin-return-badge').click()
    await page.waitForTimeout(1500)
    dom = await domCounts(page)
    await page.screenshot({ path: join(SHOT_DIR, 'test3-back-to-admin.png'), fullPage: true })
    results.test3 = {
      pass: onFeed && dom.adminPanel > 0 && dom.statistikaTab > 0,
      afterSwitchToFeed: onFeed,
      afterReturnToAdmin: dom.adminPanel > 0,
      domAfterReturn: dom,
    }
    console.log('TEST 3:', JSON.stringify(results.test3, null, 2))
  } catch (e) {
    results.test3 = { pass: false, error: String(e) }
    console.log('TEST 3 FAIL:', e)
  }

  // TEST 4 — session restore keeps last admin view (feed after switch)
  try {
    const adminSess = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
    await injectSession(page, adminSess, { [ADMIN_SCREEN_KEY]: 'main' })
    const dom = await domCounts(page)
    await page.screenshot({ path: join(SHOT_DIR, 'test4-refresh-on-feed.png'), fullPage: true })
    results.test4 = {
      pass:
        dom.adminPanel === 0 &&
        dom.returnBadge > 0 &&
        (dom.feedFab > 0 || dom.feedHdr > 0),
      behavior: 'refresh/session-restore returns to last admin view (feed when sessionStorage=main)',
      dom,
    }
    console.log('TEST 4:', JSON.stringify(results.test4, null, 2))
  } catch (e) {
    results.test4 = { pass: false, error: String(e) }
    console.log('TEST 4 FAIL:', e)
  }

  await browser.close()

  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'}`)
  }

  const allPass = Object.values(results).every((r) => r.pass)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
