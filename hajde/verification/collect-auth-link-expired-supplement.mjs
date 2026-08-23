/**
 * Supplement: Test 1 hash before/after + Test 4 confirm expired on live domain.
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
const OUT = path.join(__dirname, 'evidence', 'auth-link-expired-live', '1787427549579')
const SQ_CONFIRM_BODY =
  'Ky link konfirmimi ka skaduar ose është përdorur tashmë. Nëse ridërgove email-in disa herë, vetëm mesazhi më i fundit funksionon.'
const SQ_CONFIRM_CTA = 'Regjistrohu përsëri'

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function listAllEmails(sid) {
  const list = await fetch(
    `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
  ).then((r) => r.json())
  const out = []
  for (const m of list.list || []) {
    const full = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    const html = full.mail_body || full.mail_body_html || ''
    const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
    out.push({
      subject: full.mail_subject,
      ts: full.mail_timestamp,
      href: match ? match[0].replace(/&amp;/g, '&') : null,
      type: match?.[0]?.includes('type=signup') || match?.[0]?.includes('type=email') ? 'signup' : 'other',
    })
  }
  return out
}

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Prove', last_name: 'Live', age: 28 },
    }),
  })
  return res.json()
}

async function recover(email) {
  await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_to: APP }),
  })
}

async function resendConfirm(email) {
  const res = await fetch(`${SB}/auth/v1/resend`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'signup', email, options: { emailRedirectTo: APP } }),
  })
  return { status: res.status, body: await res.text() }
}

async function newPage(browser) {
  const context = await browser.newContext({ locale: 'sq-AL' })
  await context.addInitScript(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  return { page, context }
}

const browser = await chromium.launch({ headless: true })

// TEST 1 supplement — capture hash on redirect from old reset link
console.log('TEST 1 supplement — hash before/after old reset link')
const t1 = {}
try {
  const inbox = await guerrillaInbox()
  await signup(inbox.address)
  await recover(inbox.address)
  await new Promise((r) => setTimeout(r, 8000))
  let emails = await listAllEmails(inbox.sid)
  const mail1 = emails.find((e) => e.href?.includes('type=recovery'))
  await recover(inbox.address)
  await new Promise((r) => setTimeout(r, 8000))
  emails = await listAllEmails(inbox.sid)
  const recoveryEmails = emails.filter((e) => e.href?.includes('type=recovery')).sort((a, b) => a.ts - b.ts)
  const oldLink = recoveryEmails[0]?.href
  const newLink = recoveryEmails[recoveryEmails.length - 1]?.href

  const { page, context } = await newPage(browser)
  const hashLog = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      hashLog.push({ url: frame.url(), hash: new URL(frame.url()).hash, at: Date.now() })
    }
  })

  await page.goto(oldLink, { waitUntil: 'commit', timeout: 90000 })
  await page.waitForTimeout(6000)

  const exactBanner = await page.locator('.reset-expired-banner').innerText().catch(() => null)
  await page.screenshot({ path: path.join(OUT, 'test1-old-reset-banner-retake.png'), fullPage: true })

  t1.oldVerifyLink = oldLink
  t1.newVerifyLink = newLink
  t1.navigationHashLog = hashLog
  t1.urlAfter = page.url()
  t1.hashAfter = await page.evaluate(() => location.hash)
  t1.hashCleared = (await page.evaluate(() => location.hash)) === ''
  t1.exactBannerText = exactBanner?.trim()
  t1.hashBeforeAppClear =
    hashLog.find((h) => h.hash.includes('otp_expired'))?.hash ||
    hashLog.find((h) => h.hash.includes('error'))?.hash ||
    null
  t1.urlBeforeAppClear = hashLog.find((h) => h.hash.includes('otp_expired'))?.url || hashLog[0]?.url
  await context.close()
} catch (e) {
  t1.error = String(e)
}
fs.writeFileSync(path.join(OUT, 'test1-hash-supplement.json'), JSON.stringify(t1, null, 2))
console.log('test1 hash before:', t1.hashBeforeAppClear)
console.log('test1 hash after:', t1.hashAfter)

// TEST 4 — real signup confirm old link
console.log('\nTEST 4 — signup confirmation otp_expired')
const t4 = {}
try {
  const inbox = await guerrillaInbox()
  const signupData = await signup(inbox.address)
  t4.signupAt = new Date().toISOString()
  t4.signupEmail = inbox.address
  t4.signupUserId = signupData.user?.id || signupData.id

  await new Promise((r) => setTimeout(r, 12000))
  let emails = await listAllEmails(inbox.sid)
  t4.emailsAfterSignup = emails

  const firstConfirm = emails.find((e) => e.href && !e.href.includes('type=recovery'))
  if (!firstConfirm?.href) throw new Error('no first confirm email')

  t4.resend1 = await resendConfirm(inbox.address)
  await new Promise((r) => setTimeout(r, 12000))
  t4.resend2 = await resendConfirm(inbox.address)
  await new Promise((r) => setTimeout(r, 15000))

  emails = await listAllEmails(inbox.sid)
  t4.emailsAfterResend = emails
  const confirmEmails = emails.filter((e) => e.href && e.href.includes('redirect_to')).sort((a, b) => a.ts - b.ts)
  const oldConfirmLink = confirmEmails[0]?.href
  const newConfirmLink = confirmEmails[confirmEmails.length - 1]?.href

  const pendingPayload = {
    userId: t4.signupUserId || '00000000-0000-0000-0000-000000000001',
    email: inbox.address,
    firstName: 'Prove',
    lastName: 'Live',
    age: '28',
    savedAt: Date.now(),
  }

  const { page, context } = await newPage(browser)
  await page.addInitScript((payload) => {
    sessionStorage.setItem('ejabashkohu-pending-registration', JSON.stringify(payload))
  }, pendingPayload)

  const hashLog = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      hashLog.push({ url: frame.url(), hash: new URL(frame.url()).hash, at: Date.now() })
    }
  })

  await page.goto(oldConfirmLink, { waitUntil: 'commit', timeout: 90000 })
  await page.waitForTimeout(6000)

  const exactBanner = (await page.locator('.reset-expired-banner').innerText().catch(() => null))?.trim()
  await page.screenshot({ path: path.join(OUT, 'test4-confirm-expired-banner.png'), fullPage: true })

  t4.triggerDescription =
    'Real signup confirmation flow: POST /auth/v1/signup → received first confirm email → POST /auth/v1/resend (type=signup) twice → clicked OLD confirm verify URL (not recovery). Pending registration present in sessionStorage as during live onboarding.'
  t4.firstConfirmLink = oldConfirmLink
  t4.latestConfirmLink = newConfirmLink
  t4.confirmLinksDifferent = oldConfirmLink !== newConfirmLink
  t4.oldLinkType = oldConfirmLink?.includes('type=recovery') ? 'recovery' : 'signup/email'
  t4.navigationHashLog = hashLog
  t4.urlAfterOldConfirmClick = page.url()
  t4.hashAfter = await page.evaluate(() => location.hash)
  t4.hashBeforeAppClear =
    hashLog.find((h) => h.hash.includes('otp_expired'))?.hash ||
    hashLog.find((h) => h.hash.includes('error'))?.hash ||
    null
  t4.hashCleared = (await page.evaluate(() => location.hash)) === ''
  t4.exactBannerText = exactBanner
  t4.expectedBannerBody = SQ_CONFIRM_BODY
  t4.expectedBannerCta = SQ_CONFIRM_CTA
  t4.bannerBodyExactMatch = exactBanner?.includes(SQ_CONFIRM_BODY) ?? false
  t4.bannerCtaExactMatch = exactBanner?.includes(SQ_CONFIRM_CTA) ?? false
  t4.isPasswordResetBanner = exactBanner?.includes('resetim') ?? false

  await context.close()
} catch (e) {
  t4.error = String(e)
  console.error(e)
}

fs.writeFileSync(path.join(OUT, 'test4.json'), JSON.stringify(t4, null, 2))
await browser.close()
console.log('test4 banner match:', t4.bannerBodyExactMatch)
console.log('Done supplement')
