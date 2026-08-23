/**
 * Real Supabase inactivity timeout test on live ejabashkohu.com.
 * Prerequisite: temp settings via Management API:
 *   sessions_inactivity_timeout ≈ 0.0333h (~2 min), jwt_exp = 120s
 * Run: node verification/verify-real-inactivity-timeout.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = 'https://ejabashkohu.com'
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const PASSWORD = 'TestPass123!'
const WAIT_MS = 3 * 60 * 1000 + 15000 // 3m15s idle (no open browser)
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'session-settings', `real-inactivity-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitConfirmLink(sid) {
  for (let i = 0; i < 40; i += 1) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
      ).then((r) => r.json())
      const html = full.mail_body || full.mail_body_html || ''
      const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
      if (match) return match[0].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('confirm email timeout')
}

async function signupAndConfirm(email, sid) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Idle', last_name: 'Test', age: 28 },
    }),
  })
  if (!res.ok) throw new Error(`signup failed: ${await res.text()}`)
  return waitConfirmLink(sid)
}

async function tryRefresh(refreshToken) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  const text = await res.text()
  return { status: res.status, body: text.slice(0, 400) }
}

const report = {
  app: APP,
  startedAt: new Date().toISOString(),
  waitMs: WAIT_MS,
  note: 'Real Supabase inactivity — browser closed during idle; no token corruption',
}

console.log('Real inactivity test on', APP)
console.log('Output:', OUT)

const inbox = await guerrillaInbox()
report.testEmail = inbox.address
console.log('Creating test user:', inbox.address)
const confirmLink = await signupAndConfirm(inbox.address, inbox.sid)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ locale: 'sq-AL' })
await context.addInitScript(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
const page = await context.newPage()
await page.setViewportSize({ width: 390, height: 844 })

await page.goto(confirmLink, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForTimeout(4000)
await page.goto(APP, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

const authSnapshot = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.includes('auth-token'))
  if (!key) return { key: null }
  const raw = JSON.parse(localStorage.getItem(key))
  return {
    key,
    value: localStorage.getItem(key),
    refresh_token: raw?.refresh_token,
    expires_at: raw?.expires_at,
    userEmail: raw?.user?.email,
  }
})

report.authStorageKey = authSnapshot.key
report.sessionBeforeWait = {
  hasRefreshToken: !!authSnapshot.refresh_token,
  expires_at: authSnapshot.expires_at,
  userEmail: authSnapshot.userEmail,
}

const bodyBeforeWait = await page.locator('body').innerText()
report.loggedInBeforeWait = authSnapshot.userEmail && !bodyBeforeWait.includes('Hyr në llogari')
await page.screenshot({ path: path.join(OUT, '01-logged-in-before-wait.png'), fullPage: true })
console.log('Logged in before wait:', report.loggedInBeforeWait)

if (!report.loggedInBeforeWait) {
  await page.locator('input[type="email"]').first().fill(inbox.address)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(5000)
  const retry = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'))
    const raw = key ? JSON.parse(localStorage.getItem(key)) : null
    return { key, refresh_token: raw?.refresh_token, userEmail: raw?.user?.email }
  })
  authSnapshot.key = retry.key
  authSnapshot.value = retry.key ? await page.evaluate((k) => localStorage.getItem(k), retry.key) : null
  authSnapshot.refresh_token = retry.refresh_token
  report.loggedInBeforeWait = !!retry.userEmail
}

// Close browser during idle so supabase-js cannot auto-refresh and reset inactivity.
await browser.close()

report.waitStartedAt = new Date().toISOString()
console.log(`Waiting ${Math.round(WAIT_MS / 1000)}s with browser closed (no auto-refresh)...`)
await new Promise((r) => setTimeout(r, WAIT_MS))
report.waitEndedAt = new Date().toISOString()

report.directRefreshAfterIdle = await tryRefresh(authSnapshot.refresh_token)
console.log('Direct refresh after idle:', report.directRefreshAfterIdle.status)

const browser2 = await chromium.launch({ headless: true })
const context2 = await browser2.newContext({ locale: 'sq-AL' })
await context2.addInitScript(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
if (authSnapshot.key && authSnapshot.value) {
  await context2.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value)
    },
    { key: authSnapshot.key, value: authSnapshot.value },
  )
}
const page2 = await context2.newPage()
await page2.setViewportSize({ width: 390, height: 844 })

await page2.goto(APP, { waitUntil: 'networkidle' })
await page2.waitForTimeout(5000)
await page2.reload({ waitUntil: 'networkidle' })
await page2.waitForTimeout(4000)

const bodyAfter = await page2.locator('body').innerText()
report.sessionAfterReload = await page2.evaluate((key) => {
  if (!key) return { present: false }
  const raw = localStorage.getItem(key)
  if (!raw) return { present: false }
  try {
    const parsed = JSON.parse(raw)
    return {
      present: true,
      hasRefreshToken: !!parsed?.refresh_token,
      userEmail: parsed?.user?.email,
    }
  } catch {
    return { present: true, parseError: true }
  }
}, authSnapshot.key)

report.signInVisible = bodyAfter.includes('Hyr në llogari')
report.expiredToast = bodyAfter.includes('Sesioni skadoi')
report.landingVisible = bodyAfter.includes('Eja bashkohu') || bodyAfter.includes('ejaBashkohu')
report.forcedSignOut =
  report.signInVisible && (!report.sessionAfterReload?.userEmail || report.directRefreshAfterIdle.status >= 400)
report.bodyAfterSnippet = bodyAfter.slice(0, 240)

await page2.screenshot({ path: path.join(OUT, '02-after-reload.png'), fullPage: true })

console.log('After reload — sign-in visible:', report.signInVisible)
console.log('Session cleared:', !report.sessionAfterReload?.userEmail)
console.log('PASS:', report.forcedSignOut || (report.signInVisible && !report.sessionAfterReload?.present))

await browser2.close()
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log('Evidence:', OUT)
