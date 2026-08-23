/**
 * Password reset rate-limit UX — TEST 1–4
 * Run: APP_URL=https://ejabashkohu.com node verification/verify-password-reset-rate-limit.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { mapPasswordResetRateLimitError } from '../src/lib/errorMap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const APP = (process.env.APP_URL || 'https://ejabashkohu.com').replace(/\/$/, '')
const PASSWORD = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'password-reset-rate-limit', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const report = { ts, app: APP, outDir: OUT, tests: {} }

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitVerify(sid, timeoutMs = 240000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
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
    await sleep(2500)
  }
  throw new Error('confirm email timeout')
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
      if (match) return match[0].replace(/&amp;/g, '&')
    }
    await sleep(2500)
  }
  return null
}

async function setupConfirmedUser() {
  const fixedEmail = process.env.RESET_TEST_EMAIL
  if (fixedEmail) {
    const c = (await import('@supabase/supabase-js')).createClient(SB, ANON)
    const { error } = await c.auth.signInWithPassword({ email: fixedEmail, password: PASSWORD })
    if (error) throw new Error(`fixed test user login failed: ${error.message}`)
    return { address: fixedEmail, sid: null, fixed: true }
  }

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const inbox = await guerrillaInbox()
    const signupRes = await fetch(`${SB}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inbox.address,
        password: PASSWORD,
        data: { first_name: 'Rate', last_name: 'Limit', age: 28 },
      }),
    })
    const signupText = await signupRes.text()
    if (!signupRes.ok) {
      if (signupText.includes('rate limit') && attempt < 5) {
        console.log(`signup rate limited, waiting 65s (attempt ${attempt})…`)
        await sleep(65000)
        continue
      }
      throw new Error(`signup failed: ${signupText}`)
    }
    const confirm = await waitVerify(inbox.sid)
    await fetch(confirm, { redirect: 'follow' })
    return inbox
  }
  throw new Error('setupConfirmedUser exhausted retries')
}

async function openForgotForm(page) {
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await sleep(1500)
  await page.evaluate(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1200)
  await page.getByRole('button', { name: /^Hyr$/i }).first().click()
  await sleep(600)
  await page.locator('.forgot-link').click()
  await sleep(500)
}

async function backToForgotForm(page) {
  const back = page.locator('button.link-btn')
  if (await back.isVisible().catch(() => false)) await back.click()
  await sleep(400)
  await page.locator('.forgot-link').click()
  await sleep(400)
}

async function submitForgot(page, email) {
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('form button[type="submit"]').click()
  await sleep(2500)
  const authError = (await page.locator('.age-warn').textContent().catch(() => '')) || ''
  const body = await page.locator('body').innerText()
  const btnText = (await page.locator('form button[type="submit"]').textContent().catch(() => '')) || ''
  const btnDisabled = await page.locator('form button[type="submit"]').isDisabled().catch(() => false)
  return {
    authError: authError.trim(),
    forgotSent: body.includes('Nëse ekziston llogaria'),
    btnText: btnText.trim(),
    btnDisabled,
    genericError: authError.includes('Diçka shkoi keq'),
    rateLimitMsg: authError.includes('Ke kërkuar tashmë një link'),
  }
}

async function main() {
  const sampleErr = {
    message: 'For security purposes, you can only request this after 54 seconds.',
    status: 429,
    code: 'over_email_send_rate_limit',
  }
  report.mapErrorSample = mapPasswordResetRateLimitError(sampleErr)
  save('00-mapError-sample.json', report.mapErrorSample)

  console.log('Setting up single confirmed test user…')
  const inbox = await setupConfirmedUser()
  report.inbox = inbox.address
  save('00-inbox.json', { email: inbox.address })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 390, height: 844 })

  // TEST 4 — single request regression (run first on fresh account)
  console.log('TEST 4 — single reset request')
  await openForgotForm(page)
  const test4First = await submitForgot(page, inbox.address)
  const test4Mail = await waitResetEmail(inbox.sid)
  let test4LinkWorks = false
  if (test4Mail) {
    const ctx = await browser.newContext()
    const lp = await ctx.newPage()
    await lp.goto(test4Mail, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await sleep(5000)
    test4LinkWorks = (await lp.getByText('Vendos fjalëkalim të ri').count()) > 0
    await ctx.close()
  }
  report.tests.test4 = {
    first: test4First,
    emailReceived: !!test4Mail,
    linkWorks: test4LinkWorks,
    pass: test4First.forgotSent && !test4First.genericError && !!test4Mail && test4LinkWorks,
  }
  await page.screenshot({ path: path.join(OUT, 'test4-single-request.png'), fullPage: true })
  save('test4.json', report.tests.test4)

  console.log('Waiting 65s before TEST 2 (Supabase email cooldown)…')
  await sleep(65000)

  // TEST 2 — cooldown UI after success
  console.log('TEST 2 — cooldown UI')
  await backToForgotForm(page)
  const test2First = await submitForgot(page, inbox.address)
  await backToForgotForm(page)
  const test2BtnText = (await page.locator('form button[type="submit"]').textContent()) || ''
  const test2BtnDisabled = await page.locator('form button[type="submit"]').isDisabled()
  report.tests.test2 = {
    first: test2First,
    btnText: test2BtnText.trim(),
    btnDisabled: test2BtnDisabled,
    pass: test2First.forgotSent && test2BtnDisabled && /Dërgo pas \d+s/i.test(test2BtnText),
  }
  await page.screenshot({ path: path.join(OUT, 'test2-cooldown.png'), fullPage: true })
  save('test2.json', report.tests.test2)

  // TEST 1 — rate-limit message on immediate second request
  console.log('TEST 1 — rate-limit message')
  await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: inbox.address, redirect_to: APP }),
  })
  await backToForgotForm(page)
  const test1Second = await submitForgot(page, inbox.address)
  report.tests.test1 = {
    second: test1Second,
    pass:
      test1Second.rateLimitMsg &&
      !test1Second.genericError &&
      (test1Second.authError.includes('sekonda') || /\d+/.test(test1Second.authError)),
  }
  await page.screenshot({ path: path.join(OUT, 'test1-rate-limit-message.png'), fullPage: true })
  save('test1.json', report.tests.test1)

  // TEST 3 — after client cooldown expires, new request succeeds
  console.log('TEST 3 — waiting 62s for UI cooldown…')
  await sleep(62000)
  await backToForgotForm(page)
  const test3After = await submitForgot(page, inbox.address)
  report.tests.test3 = {
    afterCooldown: test3After,
    pass: test3After.forgotSent && !test3After.genericError && !test3After.rateLimitMsg,
  }
  await page.screenshot({ path: path.join(OUT, 'test3-after-cooldown.png'), fullPage: true })
  save('test3.json', report.tests.test3)

  await browser.close()

  report.allPass = ['test1', 'test2', 'test3', 'test4'].every((k) => report.tests[k].pass === true)
  save('report.json', report)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
