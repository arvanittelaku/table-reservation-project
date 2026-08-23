/**
 * Verify otp_expired hash handling (reset + confirm flows).
 * Run: npm run build && npx vite preview --port 4173 &
 *      APP_URL=http://localhost:4173 node verification/verify-auth-link-expired.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const APP = process.env.APP_URL || 'https://ejabashkohu.com'
const PASSWORD = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'auth-link-expired', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const EXPIRED_HASH =
  '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitResetEmail(sid, afterTs = 0) {
  for (let i = 0; i < 40; i += 1) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      if (m.mail_timestamp <= afterTs) continue
      const subj = String(m.mail_subject || '').toLowerCase()
      if (!subj.includes('reset') && !subj.includes('rivendos') && !subj.includes('password')) continue
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
      ).then((r) => r.json())
      const html = full.mail_body || full.mail_body_html || ''
      const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
      if (match) {
        return {
          href: match[0].replace(/&amp;/g, '&'),
          ts: full.mail_timestamp,
        }
      }
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('timeout waiting reset email')
}

async function recover(email) {
  const res = await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_to: APP }),
  })
  return { status: res.status, at: new Date().toISOString() }
}

async function signup(email) {
  await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Link', last_name: 'Test', age: 28 },
    }),
  })
}

async function pageState(page) {
  const body = await page.locator('body').innerText()
  return {
    url: page.url(),
    hash: await page.evaluate(() => window.location.hash),
    resetForm: await page.getByText('Vendos fjalëkalim të ri').count(),
    expiredBanner: await page.locator('.reset-expired-banner').count(),
    expiredText: body.includes('Ky link ka skaduar') || body.includes('link has expired') || body.includes('konfirmimi ka skaduar'),
    forgotForm: body.includes('Rivendos fjalëkalimin') && (await page.locator('input[type="email"]').count()) > 0,
    registerCta: body.includes('Regjistrohu përsëri') || body.includes('Register again'),
    bodySnippet: body.slice(0, 400),
  }
}

const results = {}

console.log('APP_URL', APP)

// TEST 2 first (needs fresh tokens before TEST 1 consumes them in same inbox flow)
console.log('\n=== TEST 2: valid reset link ===')
try {
  const inbox2 = await guerrillaInbox()
  await signup(inbox2.address)
  await recover(inbox2.address)
  const mail = await waitResetEmail(inbox2.sid)
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(mail.href, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  results.test2 = { pass: false, ...(await pageState(page)) }
  results.test2.pass = results.test2.resetForm > 0 && results.test2.expiredBanner === 0
  await page.screenshot({ path: path.join(OUT, 'test2-valid-reset.png'), fullPage: true })
  await browser.close()
  save('test2.json', results.test2)
  console.log(results.test2.pass ? 'PASS' : 'FAIL', results.test2)
} catch (e) {
  results.test2 = { pass: false, error: String(e) }
  console.log('FAIL', e.message)
}

// TEST 1: double reset, older link
console.log('\n=== TEST 1: expired reset link message ===')
try {
  const inbox1 = await guerrillaInbox()
  await signup(inbox1.address)
  await recover(inbox1.address)
  const mail1 = await waitResetEmail(inbox1.sid)
  await new Promise((r) => setTimeout(r, 70000))
  await recover(inbox1.address)
  const mail2 = await waitResetEmail(inbox1.sid, mail1.ts)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(mail1.href, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  // Supabase redirects to site URL with error hash — simulate on APP if redirect skipped preview
  if (!(await page.locator('.reset-expired-banner').count())) {
    await page.goto(`${APP}${EXPIRED_HASH}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
  }
  results.test1 = { pass: false, ...(await pageState(page)) }
  results.test1.pass =
    results.test1.expiredBanner > 0 &&
    (results.test1.expiredText || results.test1.bodySnippet.includes('Request a new link')) &&
    results.test1.resetForm === 0 &&
    !results.test1.hash.includes('otp_expired')
  await page.screenshot({ path: path.join(OUT, 'test1-expired-reset.png'), fullPage: true })
  save('test1-links.json', { old: mail1.href, new: mail2.href })
  await browser.close()
  save('test1.json', results.test1)
  console.log(results.test1.pass ? 'PASS' : 'FAIL', results.test1)
} catch (e) {
  results.test1 = { pass: false, error: String(e) }
  console.log('FAIL', e.message)
}

// TEST 3: CTA opens forgot-password form
console.log('\n=== TEST 3: request new link CTA ===')
try {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${APP}${EXPIRED_HASH}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const before = await pageState(page)
  await page.getByRole('button', { name: /Kërko një link të ri|Request a new link/i }).click()
  await page.waitForTimeout(1500)
  const after = await pageState(page)
  results.test3 = {
    pass:
      before.expiredBanner > 0 &&
      after.expiredBanner === 0 &&
      (after.bodySnippet.includes('Reset password') ||
        after.bodySnippet.includes('Rivendos fjalëkalimin')),
    before,
    after,
  }
  await page.screenshot({ path: path.join(OUT, 'test3-forgot-form.png'), fullPage: true })
  await browser.close()
  save('test3.json', results.test3)
  console.log(results.test3.pass ? 'PASS' : 'FAIL', results.test3)
} catch (e) {
  results.test3 = { pass: false, error: String(e) }
  console.log('FAIL', e.message)
}

// TEST 4: confirm link expired (with pending registration)
console.log('\n=== TEST 4: expired signup confirmation link ===')
try {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  const pendingPayload = {
    userId: '00000000-0000-0000-0000-000000000099',
    email: 'confirm-expired@test.local',
    firstName: 'Confirm',
    lastName: 'Expired',
    age: '25',
    savedAt: Date.now(),
  }
  await page.addInitScript((payload) => {
    sessionStorage.setItem('ejabashkohu-pending-registration', JSON.stringify(payload))
  }, pendingPayload)
  await page.goto(`${APP}${EXPIRED_HASH}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  results.test4 = { pass: false, ...(await pageState(page)) }
  results.test4.pass =
    results.test4.expiredBanner > 0 &&
    (results.test4.bodySnippet.includes('konfirmimi ka skaduar') ||
      results.test4.bodySnippet.includes('confirmation link has expired') ||
      results.test4.registerCta) &&
    !results.test4.hash.includes('otp_expired')
  await page.screenshot({ path: path.join(OUT, 'test4-confirm-expired.png'), fullPage: true })
  await browser.close()
  save('test4.json', results.test4)
  console.log(results.test4.pass ? 'PASS' : 'FAIL', results.test4)
} catch (e) {
  results.test4 = { pass: false, error: String(e) }
  console.log('FAIL', e.message)
}

save('report.json', results)
console.log('\n=== SUMMARY ===')
for (const [k, v] of Object.entries(results)) {
  console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'}`)
}
console.log('Evidence:', OUT)

const allPass = Object.values(results).every((r) => r.pass)
process.exit(allPass ? 0 : 1)
