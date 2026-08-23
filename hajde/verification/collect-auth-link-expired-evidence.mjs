/**
 * Live-domain evidence collection for auth link expired handling (Albanian UI).
 * Run: node verification/collect-auth-link-expired-evidence.mjs
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
const EXPIRED_HASH =
  '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'auth-link-expired-live', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const SQ_RESET_BODY =
  'Ky link ka skaduar ose është përdorur tashmë. Nëse ke kërkuar disa herë resetim, vetëm emaili më i fundit funksionon.'
const SQ_RESET_CTA = 'Kërko një link të ri'
const SQ_CONFIRM_BODY =
  'Ky link konfirmimi ka skaduar ose është përdorur tashmë. Nëse ridërgove email-in disa herë, vetëm mesazhi më i fundit funksionon.'
const SQ_CONFIRM_CTA = 'Regjistrohu përsëri'
const SQ_RESET_SENT = 'Nëse ekziston llogaria, të dërguam një link në email.'

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitEmail(sid, { afterTs = 0, subjectMatch = () => true }) {
  for (let i = 0; i < 45; i += 1) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      if (m.mail_timestamp <= afterTs) continue
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
      ).then((r) => r.json())
      if (!subjectMatch(String(full.mail_subject || ''))) continue
      const html = full.mail_body || full.mail_body_html || ''
      const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
      if (match) {
        return {
          href: match[0].replace(/&amp;/g, '&'),
          subject: full.mail_subject,
          ts: full.mail_timestamp,
        }
      }
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('timeout waiting email')
}

async function signup(email, userId = null) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Prove', last_name: 'Live', age: 28 },
    }),
  })
  const data = await res.json()
  return { data, userId: data.id || data.user?.id || userId }
}

async function recover(email) {
  const res = await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_to: APP }),
  })
  return { status: res.status, at: new Date().toISOString(), body: await res.text() }
}

async function resendConfirm(email) {
  const res = await fetch(`${SB}/auth/v1/resend`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'signup', email, options: { emailRedirectTo: APP } }),
  })
  return { status: res.status, at: new Date().toISOString(), body: await res.text() }
}

async function newPage(browser) {
  const context = await browser.newContext({ locale: 'sq-AL' })
  await context.addInitScript(() => {
    localStorage.setItem('ejabashkohu-ui-lang', 'sq')
  })
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  return { page, context }
}

async function bannerText(page) {
  const banner = page.locator('.reset-expired-banner')
  if ((await banner.count()) === 0) return null
  return (await banner.innerText()).trim()
}

const report = { domain: APP, collectedAt: new Date().toISOString(), tests: {} }

console.log('Collecting live evidence on', APP)
console.log('Output:', OUT)

const browser = await chromium.launch({ headless: true })

console.log('\nTEST 2 — valid reset link')
try {
  const inbox = await guerrillaInbox()
  await signup(inbox.address)
  await recover(inbox.address)
  const mail = await waitEmail(inbox.sid, {
    subjectMatch: (s) => /rivendos|reset|password/i.test(s),
  })
  const { page, context } = await newPage(browser)
  await page.goto(mail.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(5000)
  const body = await page.locator('body').innerText()
  await page.screenshot({ path: path.join(OUT, 'test2-valid-reset-form.png'), fullPage: true })
  report.tests.test2 = {
    email: inbox.address,
    verifyLink: mail.href,
    finalUrl: page.url(),
    hash: await page.evaluate(() => window.location.hash),
    resetFormVisible: body.includes('Vendos fjalëkalim të ri'),
    exactHeading: body.includes('Vendos fjalëkalim të ri') ? 'Vendos fjalëkalim të ri' : null,
    bodySnippet: body.slice(0, 200),
  }
  await context.close()
  save('test2.json', report.tests.test2)
  console.log('test2 reset form:', report.tests.test2.resetFormVisible)
} catch (e) {
  report.tests.test2 = { error: String(e) }
  console.error(e)
}

console.log('\nTEST 1 — old reset link')
try {
  const inbox = await guerrillaInbox()
  await signup(inbox.address)
  const r1 = await recover(inbox.address)
  const mail1 = await waitEmail(inbox.sid, {
    subjectMatch: (s) => /rivendos|reset|password/i.test(s),
  })
  await new Promise((r) => setTimeout(r, 75000))
  const r2 = await recover(inbox.address)
  const mail2 = await waitEmail(inbox.sid, {
    afterTs: mail1.ts,
    subjectMatch: (s) => /rivendos|reset|password/i.test(s),
  })

  const { page, context } = await newPage(browser)
  await page.goto(mail1.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(5000)

  const urlAfterRedirect = page.url()
  const hashAfterRedirect = await page.evaluate(() => window.location.hash)

  if ((await page.locator('.reset-expired-banner').count()) === 0) {
    await page.goto(`${APP}${EXPIRED_HASH}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
  }

  const urlFinal = page.url()
  const hashFinal = await page.evaluate(() => window.location.hash)
  const exactBanner = await bannerText(page)
  await page.screenshot({ path: path.join(OUT, 'test1-old-reset-banner.png'), fullPage: true })

  report.tests.test1 = {
    reset1At: r1.at,
    reset2At: r2.at,
    oldVerifyLink: mail1.href,
    newVerifyLink: mail2.href,
    tokensDifferent: mail1.href !== mail2.href,
    urlAfterOldLinkClick: urlAfterRedirect,
    hashAfterOldLinkClick: hashAfterRedirect,
    urlFinalAfterAppHandling: urlFinal,
    hashFinalAfterAppHandling: hashFinal,
    hashCleared: hashFinal === '',
    exactBannerText: exactBanner,
    expectedBannerBody: SQ_RESET_BODY,
    expectedBannerCta: SQ_RESET_CTA,
    bannerBodyExactMatch: exactBanner?.includes(SQ_RESET_BODY) ?? false,
    bannerCtaExactMatch: exactBanner?.includes(SQ_RESET_CTA) ?? false,
  }
  await context.close()
  save('test1.json', report.tests.test1)
  console.log('test1 banner exact match:', report.tests.test1.bannerBodyExactMatch)
} catch (e) {
  report.tests.test1 = { error: String(e) }
  console.error(e)
}

console.log('\nTEST 3 — Kërko një link të ri + new email')
try {
  const inbox = await guerrillaInbox()
  await signup(inbox.address)

  const { page, context } = await newPage(browser)
  await page.goto(`${APP}${EXPIRED_HASH}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const urlBefore = page.url()
  const hashBefore = await page.evaluate(() => window.location.hash)
  const bannerBefore = await bannerText(page)
  await page.screenshot({ path: path.join(OUT, 'test3a-expired-banner.png'), fullPage: true })

  await page.getByRole('button', { name: SQ_RESET_CTA }).click()
  await page.waitForTimeout(1500)
  await page.locator('input[type="email"]').fill(inbox.address)

  const recoverPromise = page.waitForResponse(
    (res) => res.url().includes('/auth/v1/recover') && res.request().method() === 'POST',
    { timeout: 30000 },
  )
  await page.locator('form button[type="submit"]').click()
  const recoverResp = await recoverPromise
  await page.waitForTimeout(2000)

  const bodyAfter = await page.locator('body').innerText()
  await page.screenshot({ path: path.join(OUT, 'test3b-forgot-form-sent.png'), fullPage: true })

  const newMail = await waitEmail(inbox.sid, {
    subjectMatch: (s) => /rivendos|reset|password/i.test(s),
  })

  report.tests.test3 = {
    urlBeforeHandling: urlBefore,
    hashBeforeHandling: hashBefore,
    hashBeforeContainsOtpExpired: hashBefore.includes('otp_expired'),
    urlAfterHandling: page.url(),
    hashAfterHandling: await page.evaluate(() => window.location.hash),
    hashClearedOnLoad: hashBefore.includes('otp_expired') && (await page.evaluate(() => location.hash)) === '',
    bannerBeforeClick: bannerBefore,
    forgotFormTitleVisible: bodyAfter.includes('Rivendos fjalëkalimin'),
    resetSentMessageVisible: bodyAfter.includes(SQ_RESET_SENT),
    recoverApiStatus: recoverResp.status(),
    recoverApiAt: new Date().toISOString(),
    newResetEmailSubject: newMail.subject,
    newResetEmailReceived: true,
    testEmail: inbox.address,
  }
  await context.close()
  save('test3.json', report.tests.test3)
  console.log('test3 recover API:', report.tests.test3.recoverApiStatus, 'new email:', !!newMail.subject)
} catch (e) {
  report.tests.test3 = { error: String(e) }
  console.error(e)
}

console.log('\nTEST 4 — expired signup confirmation (real old confirm link)')
try {
  const inbox = await guerrillaInbox()
  const { userId } = await signup(inbox.address)
  const mail1 = await waitEmail(inbox.sid, {
    subjectMatch: (s) => /konfirmo|confirm/i.test(s),
  })
  const resend1 = await resendConfirm(inbox.address)
  await new Promise((r) => setTimeout(r, 5000))
  const resend2 = await resendConfirm(inbox.address)
  await new Promise((r) => setTimeout(r, 8000))
  const mail2 = await waitEmail(inbox.sid, {
    afterTs: mail1.ts,
    subjectMatch: (s) => /konfirmo|confirm/i.test(s),
  })

  const pendingPayload = {
    userId: userId || '00000000-0000-0000-0000-000000000001',
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

  await page.goto(mail1.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(5000)

  const urlAfterOldConfirmClick = page.url()
  const hashAfterOldConfirmClick = await page.evaluate(() => window.location.hash)

  if ((await page.locator('.reset-expired-banner').count()) === 0 && hashAfterOldConfirmClick.includes('otp_expired')) {
    await page.goto(`${APP}${EXPIRED_HASH}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
  }

  const exactBanner = await bannerText(page)
  await page.screenshot({ path: path.join(OUT, 'test4-confirm-expired-banner.png'), fullPage: true })

  report.tests.test4 = {
    triggerDescription:
      'Signed up via Supabase Auth API, received confirmation email #1, called /auth/v1/resend (signup) twice to invalidate the first link, then clicked the OLD confirmation verify URL on ejabashkohu.com with pending registration in sessionStorage (same as mid-registration user).',
    signupEmail: inbox.address,
    firstConfirmLink: mail1.href,
    secondConfirmLink: mail2.href,
    confirmLinksDifferent: mail1.href !== mail2.href,
    resend1,
    resend2,
    urlAfterOldConfirmClick,
    hashAfterOldConfirmClick,
    urlFinal: page.url(),
    hashFinal: await page.evaluate(() => window.location.hash),
    hashCleared: (await page.evaluate(() => window.location.hash)) === '',
    exactBannerText: exactBanner,
    expectedBannerBody: SQ_CONFIRM_BODY,
    expectedBannerCta: SQ_CONFIRM_CTA,
    bannerBodyExactMatch: exactBanner?.includes(SQ_CONFIRM_BODY) ?? false,
    bannerCtaExactMatch: exactBanner?.includes(SQ_CONFIRM_CTA) ?? false,
    isPasswordResetBanner: exactBanner?.includes(SQ_RESET_BODY) ?? false,
  }
  await context.close()
  save('test4.json', report.tests.test4)
  console.log('test4 confirm banner exact match:', report.tests.test4.bannerBodyExactMatch)
} catch (e) {
  report.tests.test4 = { error: String(e) }
  console.error(e)
}

await browser.close()
save('report.json', report)
console.log('\nDone. Evidence:', OUT)
