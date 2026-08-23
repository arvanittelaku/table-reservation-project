/**
 * Password reset ×5 rapid requests — rate limit + link validity investigation.
 * Run: node verification/investigate-password-reset-quintuple.mjs
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
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 3000)
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'password-reset-quintuple', String(ts))
fs.mkdirSync(OUT, { recursive: true })

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  if (!init.email_addr || !init.sid_token) throw new Error(`guerrilla init failed: ${JSON.stringify(init)}`)
  return { address: init.email_addr, sidToken: init.sid_token }
}

function extractLinks(html) {
  const hrefs = [...String(html || '').matchAll(/href="([^"]+)"/gi)].map((m) => m[1])
  return hrefs.filter((h) => h.includes('/auth/v1/verify') || h.includes(APP.replace('https://', '')))
}

async function waitForGuerrillaMessage(sidToken, { afterTs = 0, subjectIncludes = null, timeoutMs = 180000 }) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sidToken)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      if (m.mail_timestamp <= afterTs) continue
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sidToken)}`,
      ).then((r) => r.json())
      const html = full.mail_body || full.mail_body_html || ''
      const subj = String(full.mail_subject || m.mail_subject || '')
      if (subjectIncludes && !subj.toLowerCase().includes(subjectIncludes.toLowerCase())) continue
      return full
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
  throw new Error(`Timeout waiting for email${subjectIncludes ? ` (${subjectIncludes})` : ''}`)
}

async function waitForVerifyEmail(sidToken, { afterTs = 0, timeoutMs = 180000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sidToken)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      if (m.mail_timestamp <= afterTs) continue
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sidToken)}`,
      ).then((r) => r.json())
      const html = full.mail_body || full.mail_body_html || ''
      const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
      if (match) return { ...full, verifyLink: match[0].replace(/&amp;/g, '&') }
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
  throw new Error('Timeout waiting for verify email')
}

async function listGuerrillaResetMessages(sidToken) {
  const list = await fetch(
    `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sidToken)}`,
  ).then((r) => r.json())
  const resetMsgs = []
  for (const m of list.list || []) {
    const subj = String(m.mail_subject || '').toLowerCase()
    if (!subj.includes('reset') && !subj.includes('rivendos') && !subj.includes('password')) continue
    const full = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sidToken)}`,
    ).then((r) => r.json())
    const links = extractLinks(full.mail_body || full.mail_body_html || '')
    resetMsgs.push({
      subject: full.mail_subject,
      createdAt: new Date((full.mail_timestamp || 0) * 1000).toISOString(),
      mailTimestamp: full.mail_timestamp,
      verifyLink: links.find((l) => l.includes('/auth/v1/verify')) || links[0] || null,
      links,
    })
  }
  resetMsgs.sort((a, b) => a.mailTimestamp - b.mailTimestamp)
  return resetMsgs
}

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Reset5', last_name: 'Diag', age: 28 },
    }),
  })
  return { status: res.status, body: await res.json().catch(async () => ({ raw: await res.text() })) }
}

async function recover(email) {
  const res = await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_to: APP }),
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return {
    status: res.status,
    statusText: res.statusText,
    body,
    rateLimited: res.status === 429 || String(text).toLowerCase().includes('rate limit'),
    ok: res.ok,
  }
}

async function pageState(page) {
  const body = await page.locator('body').innerText()
  const authError = await page.locator('.age-warn').textContent().catch(() => '')
  return {
    url: page.url(),
    hash: await page.evaluate(() => window.location.hash),
    search: await page.evaluate(() => window.location.search),
    resetFormVisible: (await page.getByText('Vendos fjalëkalim të ri').count()) > 0,
    resetExpiredBanner: (await page.locator('.reset-expired-banner').count()) > 0,
    resetExpiredText:
      body.includes('Ky link ka skaduar') ||
      body.includes('link has expired') ||
      body.includes('link ka skaduar'),
    forgotSentVisible:
      body.includes('Nëse ekziston llogaria') ||
      body.includes('Kontrollo email-in') ||
      body.includes('Check your email'),
    forgotFormVisible: body.includes('Rivendos fjalëkalimin'),
    signInHeroVisible: (await page.locator('.hero-login').count()) > 0,
    landingVisible: (await page.locator('.landing-host').count()) > 0,
    authError: (authError || '').trim(),
    bodySnippet: body.slice(0, 700),
    hasOtpExpired:
      (await page.evaluate(() => window.location.hash)).includes('otp_expired') ||
      body.toLowerCase().includes('otp_expired'),
  }
}

async function clickLink(page, link, label) {
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(6000)
  const state = await pageState(page)
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true })
  save(`${label}.json`, state)
  return state
}

async function uiForgotPasswordSubmit(page, email, attempt) {
  if (attempt === 1) {
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForTimeout(2000)
    await page.evaluate(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
    const signInBtn = page.getByRole('button', { name: /Hyr|Sign in/i }).first()
    if (await signInBtn.isVisible().catch(() => false)) await signInBtn.click()
    await page.waitForTimeout(800)
  }

  // Return to forgot-password form (after success screen or sign-in)
  const backToSignIn = page.locator('button.link-btn', { hasText: /Kthehu|Sign in|Hyr/i })
  if (await backToSignIn.isVisible().catch(() => false)) {
    await backToSignIn.click()
    await page.waitForTimeout(400)
  }
  await page.locator('.forgot-link').click()
  await page.waitForTimeout(500)

  await page.locator('input[type="email"]').first().fill(email)
  const at = new Date().toISOString()
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(2500)
  const state = await pageState(page)
  await page.screenshot({ path: path.join(OUT, `ui-request-${attempt}.png`), fullPage: true })
  return { at, ...state }
}

async function main() {
  const report = {
    ts,
    app: APP,
    requestGapMs: REQUEST_GAP_MS,
    step1: {},
    step2: {},
    step3: {},
    diagnosis: {},
  }

  console.log('Setting up disposable inbox…')
  const inbox = await guerrillaInbox()
  report.inbox = { address: inbox.address, provider: 'guerrillamail' }
  save('00-inbox.json', report.inbox)

  console.log('Registering + confirming user…', inbox.address)
  const signupRes = await signup(inbox.address)
  save('01-signup.json', signupRes)

  const confirmMsg = await waitForVerifyEmail(inbox.sidToken)
  save('02-confirm-email-subject.txt', confirmMsg.mail_subject || '')
  const confirmLink = confirmMsg.verifyLink
  if (!confirmLink) throw new Error('No confirmation link')

  const browser = await chromium.launch({ headless: true })

  // STEP 1 — 5 consecutive API recover requests (few seconds apart)
  console.log(`\n=== STEP 1: 5 API recover requests (${REQUEST_GAP_MS}ms apart) ===`)
  const apiRequests = []
  for (let i = 1; i <= 5; i += 1) {
    const at = new Date().toISOString()
    const res = await recover(inbox.address)
    apiRequests.push({ attempt: i, at, ...res })
    console.log(
      `#${i} status=${res.status} ok=${res.ok} rateLimited=${res.rateLimited}`,
      typeof res.body === 'object' ? JSON.stringify(res.body) : res.body,
    )
    if (i < 5) await new Promise((r) => setTimeout(r, REQUEST_GAP_MS))
  }
  report.step1.apiRequests = apiRequests
  report.step1.summary = {
    successCount: apiRequests.filter((r) => r.ok).length,
    rateLimitedCount: apiRequests.filter((r) => r.rateLimited).length,
    errorCount: apiRequests.filter((r) => !r.ok).length,
    firstRateLimitAtAttempt: apiRequests.find((r) => r.rateLimited)?.attempt ?? null,
    statuses: apiRequests.map((r) => ({ attempt: r.attempt, status: r.status, message: r.body?.msg || r.body?.message || r.body?.error_description || r.body })),
  }
  save('step1-api-requests.json', report.step1)

  // UI mirror — 5 rapid forgot-password submits on production app
  console.log('\n=== STEP 1b: 5 UI forgot-password submits ===')
  const confirmPage = await browser.newPage()
  await confirmPage.setViewportSize({ width: 390, height: 844 })
  await confirmPage.goto(confirmLink, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await confirmPage.waitForTimeout(3000)
  await confirmPage.close()

  const uiPage = await browser.newPage()
  await uiPage.setViewportSize({ width: 390, height: 844 })
  const uiRequests = []
  for (let i = 1; i <= 5; i += 1) {
    const result = await uiForgotPasswordSubmit(uiPage, inbox.address, i)
    uiRequests.push({ attempt: i, ...result })
    console.log(
      `UI #${i} forgotSent=${result.forgotSentVisible} authError="${result.authError}"`,
    )
    if (i < 5) await new Promise((r) => setTimeout(r, REQUEST_GAP_MS))
  }
  report.step1.uiRequests = uiRequests
  report.step1.uiSummary = {
    showsSuccessAfterEach: uiRequests.filter((r) => r.forgotSentVisible).length,
    showsRateLimitError: uiRequests.filter((r) =>
      /shumë përpjekje|rate limit|prit disa minuta/i.test(r.authError || r.bodySnippet || ''),
    ).length,
    authErrors: uiRequests.map((r) => ({ attempt: r.attempt, authError: r.authError, forgotSent: r.forgotSentVisible })),
  }
  save('step1-ui-requests.json', report.step1.uiSummary)
  await uiPage.close()

  // Wait for emails to arrive
  console.log('\nWaiting 20s for reset emails to arrive…')
  await new Promise((r) => setTimeout(r, 20000))

  const resetEmails = await listGuerrillaResetMessages(inbox.sidToken)
  report.step2.inbox = {
    resetEmailCount: resetEmails.length,
    emails: resetEmails.map((m, idx) => ({
      index: idx + 1,
      at: m.createdAt,
      subject: m.subject,
      hasVerifyLink: !!m.verifyLink,
      linkSnippet: m.verifyLink?.slice(0, 100) ?? null,
    })),
  }
  save('step2-emails.json', report.step2.inbox)

  const lastEmail = resetEmails.at(-1)
  const firstEmail = resetEmails[0]

  // STEP 2 — click most recent email link
  console.log('\n=== STEP 2: click LAST reset email ===')
  if (lastEmail?.verifyLink) {
    const ctxLast = await browser.newContext()
    const pageLast = await ctxLast.newPage()
    await pageLast.setViewportSize({ width: 390, height: 844 })
    report.step2.clickLast = await clickLink(pageLast, lastEmail.verifyLink, 'step2-click-last')
    report.step2.clickLast.pass =
      report.step2.clickLast.resetFormVisible && !report.step2.clickLast.resetExpiredBanner
    await ctxLast.close()
  } else {
    report.step2.clickLast = { error: 'No reset email with verify link received' }
  }

  // STEP 3 — click OLDEST email if we got 2+
  console.log('\n=== STEP 3: click OLDEST reset email (if any) ===')
  if (firstEmail?.verifyLink && resetEmails.length >= 2 && firstEmail.verifyLink !== lastEmail?.verifyLink) {
    const ctxOld = await browser.newContext()
    const pageOld = await ctxOld.newPage()
    await pageOld.setViewportSize({ width: 390, height: 844 })
    report.step3.clickOldest = await clickLink(pageOld, firstEmail.verifyLink, 'step3-click-oldest')
    report.step3.clickOldest.pass =
      report.step3.clickOldest.resetExpiredBanner ||
      report.step3.clickOldest.resetExpiredText ||
      report.step3.clickOldest.hasOtpExpired
    await ctxOld.close()
  } else if (resetEmails.length >= 2 && firstEmail?.verifyLink === lastEmail?.verifyLink) {
    report.step3.clickOldest = { skipped: 'Only one unique link across emails' }
  } else {
    report.step3.clickOldest = { skipped: `Only ${resetEmails.length} reset email(s) received` }
  }

  // Diagnosis
  const apiRateLimited = report.step1.summary.rateLimitedCount > 0
  const uiSilentSuccess =
    report.step1.uiSummary.showsSuccessAfterEach > report.step2.inbox.resetEmailCount
  report.diagnosis = {
    supabaseRateLimitsAfterN: report.step1.summary.firstRateLimitAtAttempt,
    apiRateLimited,
    emailsActuallySent: report.step2.inbox.resetEmailCount,
    apiSuccessResponses: report.step1.summary.successCount,
    uiShowsRateLimitClearly: report.step1.uiSummary.showsRateLimitError > 0,
    uiSilentFalseSuccess: uiSilentSuccess,
    lastLinkWorks: !!report.step2.clickLast?.resetFormVisible,
    lastLinkGenericLanding:
      !report.step2.clickLast?.resetFormVisible &&
      (report.step2.clickLast?.landingVisible || report.step2.clickLast?.signInHeroVisible),
    oldestLinkShowsExpired:
      !!report.step3.clickOldest?.resetExpiredBanner ||
      !!report.step3.clickOldest?.resetExpiredText ||
      !!report.step3.clickOldest?.hasOtpExpired,
    recommendedFix: null,
  }

  if (apiRateLimited && uiSilentSuccess) {
    report.diagnosis.recommendedFix =
      '(a) Surface Supabase rate-limit error in forgot-password UI so users stop spam-clicking resend'
  } else if (!report.step2.clickLast?.resetFormVisible) {
    report.diagnosis.recommendedFix =
      '(b) Recovery link routing broken at higher volumes — investigate redirect/session handling'
  } else if (report.step3.clickOldest?.landingVisible && !report.step3.clickOldest?.resetExpiredBanner) {
    report.diagnosis.recommendedFix =
      '(b) Old reset links still land on generic page instead of expired banner'
  } else {
    report.diagnosis.recommendedFix = 'No new fix needed beyond existing rate-limit + expired-link handling'
  }

  await browser.close()
  save('report.json', report)
  console.log('\n=== FINAL REPORT ===')
  console.log(JSON.stringify(report, null, 2))
  console.log('\nEvidence:', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
