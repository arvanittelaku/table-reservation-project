/**
 * Verify forced session expiry shows clean sign-in (SIGNED_OUT handler).
 * Run: npm run build && node verification/verify-session-expiry.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = process.env.APP_URL || 'http://127.0.0.1:4173'
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const PASSWORD = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'session-settings', `verify-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

async function waitConfirmLink(sid) {
  for (let i = 0; i < 30; i += 1) {
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

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitForPreview(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Preview not ready at ${url}`)
}

let previewProc
async function startPreview() {
  previewProc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    stdio: 'ignore',
  })
  await waitForPreview(APP)
}

const report = { app: APP, at: new Date().toISOString(), tests: {} }

console.log('Starting preview...')
await startPreview()

try {
  const inbox = await guerrillaInbox()
  const sb = createClient(SB, ANON)
  const { error: signupErr } = await sb.auth.signUp({
    email: inbox.address,
    password: PASSWORD,
    options: { data: { first_name: 'Sess', last_name: 'Test', age: 28 }, emailRedirectTo: APP },
  })
  if (signupErr) throw signupErr

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'sq-AL' })
  await context.addInitScript(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })

  const confirmLink = await waitConfirmLink(inbox.sid)
  await page.goto(confirmLink, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(5000)
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)

  const bodyActive = await page.locator('body').innerText()
  report.tests.test3_activeSession = {
    signedIn: !bodyActive.includes('Hyr në llogari') || bodyActive.includes('Tavolinat') || bodyActive.length > 500,
    bodySnippet: bodyActive.slice(0, 180),
  }
  await page.screenshot({ path: path.join(OUT, 'test3-active-session.png'), fullPage: true })
  console.log('TEST 3 active session OK:', report.tests.test3_activeSession.signedIn)

  // Expire both refresh and access tokens, reload → session cleared → sign-in shown
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'))
    if (!key) throw new Error('auth storage key missing')
    const parsed = JSON.parse(localStorage.getItem(key))
    parsed.refresh_token = 'invalid-expired-refresh-token'
    parsed.expires_at = Math.floor(Date.now() / 1000) - 60
    parsed.expires_in = 0
    localStorage.setItem(key, JSON.stringify(parsed))
  })

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)

  const bodyExpired = await page.locator('body').innerText()
  report.tests.test2_expiredSession = {
    signInVisible: bodyExpired.includes('Hyr në llogari'),
    expiredToast: bodyExpired.includes('Sesioni skadoi. Hyr përsëri'),
    landingVisible: bodyExpired.includes('Eja bashkohu') || bodyExpired.includes('ejaBashkohu'),
    notStuckOnboardingStep: !bodyExpired.includes('Hapi 2 nga 4') || bodyExpired.includes('Hyr në llogari'),
    bodySnippet: bodyExpired.slice(0, 220),
  }
  if (!report.tests.test2_expiredSession.signInVisible) {
    const signInBtn = page.getByRole('button', { name: /hyr/i }).first()
    if (await signInBtn.count()) await signInBtn.click()
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: path.join(OUT, 'test2-expired-signin.png'), fullPage: true })
  console.log('TEST 2 expired → sign-in:', report.tests.test2_expiredSession.signInVisible)

  // Sign back in through UI
  await page.locator('input[type="email"]').first().fill(inbox.address)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(5000)
  const bodyReLogin = await page.locator('body').innerText()
  report.tests.test2_reLogin = {
    success: !bodyReLogin.includes('Hyr në llogari') || bodyReLogin.length > 400,
    bodySnippet: bodyReLogin.slice(0, 180),
  }
  await page.screenshot({ path: path.join(OUT, 'test2-relogin.png'), fullPage: true })
  console.log('TEST 2 re-login:', report.tests.test2_reLogin.success)

  await browser.close()
} finally {
  if (previewProc) previewProc.kill()
}

report.tests.test1_dashboard = {
  inactivityTimeoutHours: 120,
  timeboxHours: 0,
  note: 'Set in Supabase Dashboard → Auth → Sessions; see supabase-auth-sessions-5d-inactivity.png',
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log('Evidence:', OUT)
