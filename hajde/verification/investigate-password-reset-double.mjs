/**
 * Diagnostic: double password-reset request flow.
 * Run: node verification/investigate-password-reset-double.mjs
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
const OUT = path.join(__dirname, 'evidence', 'password-reset-double', String(ts))
fs.mkdirSync(OUT, { recursive: true })

function save(name, data) {
  const p = path.join(OUT, name)
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  return p
}

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  if (!init.email_addr || !init.sid_token) throw new Error(`guerrilla init failed: ${JSON.stringify(init)}`)
  return { address: init.email_addr, sidToken: init.sid_token }
}

async function waitForGuerrillaMessage(sidToken, { afterTs = 0, subjectIncludes = null, timeoutMs = 120000 }) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sidToken)}`,
    ).then((r) => r.json())
    const msgs = list.list || []
    for (const m of msgs) {
      if (m.mail_timestamp <= afterTs) continue
      if (subjectIncludes && !String(m.mail_subject || '').toLowerCase().includes(subjectIncludes.toLowerCase())) continue
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sidToken)}`,
      ).then((r) => r.json())
      return full
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Timeout waiting for email${subjectIncludes ? ` (${subjectIncludes})` : ''}`)
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
    resetMsgs.push({
      subject: full.mail_subject,
      createdAt: new Date((full.mail_timestamp || 0) * 1000).toISOString(),
      mailTimestamp: full.mail_timestamp,
      links: extractLinks(full.mail_body || full.mail_body_html || ''),
    })
  }
  resetMsgs.sort((a, b) => a.mailTimestamp - b.mailTimestamp)
  return resetMsgs
}

async function mailTmAccount() {
  // Deprecated — kept for reference; guerrillaInbox used instead.
  throw new Error('use guerrillaInbox')
}

function extractLinks(html) {
  const hrefs = [...String(html || '').matchAll(/href="([^"]+)"/gi)].map((m) => m[1])
  return hrefs.filter((h) => h.includes('supabase.co/auth/v1/verify') || h.includes(APP.replace('https://', '')) || h.includes('#'))
}

function extractRecoveryHash(link) {
  const hashIdx = link.indexOf('#')
  if (hashIdx >= 0) return link.slice(hashIdx)
  return null
}

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Reset', last_name: 'Diag', age: 28 },
    }),
  })
  return res.json()
}

async function recover(email) {
  const res = await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_to: APP }),
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

async function clickLink(page, link, label) {
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  const url = page.url()
  const hash = await page.evaluate(() => window.location.hash)
  const search = await page.evaluate(() => window.location.search)
  const bodyText = (await page.locator('body').innerText()).slice(0, 600)
  const resetForm = await page.getByText('Vendos fjalëkalim të ri').count()
  const signInHero = await page.locator('.hero-login').count()
  const landing = await page.locator('.landing-host').count()
  const mainFeed = await page.locator('.sidebar').count()
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true })
  return {
    url,
    hash,
    search,
    resetFormVisible: resetForm > 0,
    signInHeroVisible: signInHero > 0,
    landingVisible: landing > 0,
    mainFeedVisible: mainFeed > 0,
    bodySnippet: bodyText,
    hasOtpExpired: hash.includes('otp_expired') || search.includes('otp_expired') || bodyText.toLowerCase().includes('expired'),
    hasAccessDenied: hash.includes('access_denied') || search.includes('access_denied'),
  }
}

async function main() {
  const report = { ts, app: APP, steps: {} }

  console.log('Setting up disposable inbox…')
  const inbox = await guerrillaInbox()
  report.inbox = { address: inbox.address, provider: 'guerrillamail' }
  save('00-inbox.json', report.inbox)

  console.log('Registering test user…', inbox.address)
  const signupRes = await signup(inbox.address)
  save('01-signup.json', signupRes)
  const userId = signupRes.user?.id || signupRes.id
  if (!userId) throw new Error(`Signup failed: ${JSON.stringify(signupRes)}`)

  console.log('Waiting for confirmation email…')
  const confirmMsg = await waitForGuerrillaMessage(inbox.sidToken, { subjectIncludes: 'confirm' })
  save('02-confirm-email-subject.txt', confirmMsg.mail_subject || '')
  const confirmLinks = extractLinks(confirmMsg.mail_body || confirmMsg.mail_body_html || '')
  save('02-confirm-links.json', confirmLinks)
  const confirmLink = confirmLinks.find((l) => l.includes('/auth/v1/verify')) || confirmLinks[0]
  if (!confirmLink) throw new Error('No confirmation link in email')

  const browser = await chromium.launch({ headless: true })
  const confirmPage = await browser.newPage()
  await confirmPage.setViewportSize({ width: 390, height: 844 })
  await confirmPage.goto(confirmLink, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await confirmPage.waitForTimeout(4000)
  await confirmPage.screenshot({ path: path.join(OUT, '02-after-confirm.png'), fullPage: true })
  await confirmPage.close()

  const reset1At = new Date().toISOString()
  console.log('Reset request #1 at', reset1At)
  const reset1Res = await recover(inbox.address)
  report.steps.reset1 = { at: reset1At, api: reset1Res }
  save('03-reset1.json', report.steps.reset1)

  await new Promise((r) => setTimeout(r, 60000)) // 60s between requests

  const reset2At = new Date().toISOString()
  console.log('Reset request #2 at', reset2At)
  const reset2Res = await recover(inbox.address)
  report.steps.reset2 = { at: reset2At, api: reset2Res }
  save('04-reset2.json', report.steps.reset2)

  console.log('Collecting reset emails…')
  const resetMsgs = await listGuerrillaResetMessages(inbox.sidToken)
  save('05-reset-emails.json', resetMsgs)
  report.steps.emails = {
    count: resetMsgs.length,
    subjects: resetMsgs.map((m) => ({ at: m.createdAt, subject: m.subject, linkCount: m.links.length })),
  }

  if (resetMsgs.length < 2) {
    report.error = `Expected 2 reset emails, got ${resetMsgs.length}`
    save('report.json', report)
    await browser.close()
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const email1 = resetMsgs[0]
  const email2 = resetMsgs[resetMsgs.length - 1]
  const link1 = email1.links.find((l) => l.includes('/auth/v1/verify')) || email1.links[0]
  const link2 = email2.links.find((l) => l.includes('/auth/v1/verify')) || email2.links[0]
  report.steps.linkComparison = {
    email1At: email1.createdAt,
    email2At: email2.createdAt,
    linksIdentical: link1 === link2,
    link1Snippet: link1?.slice(0, 120),
    link2Snippet: link2?.slice(0, 120),
    hash1: extractRecoveryHash(link1),
    hash2: extractRecoveryHash(link2),
  }
  save('06-link-comparison.json', report.steps.linkComparison)

  // Test A: second (newest) link in fresh incognito context
  console.log('Clicking SECOND reset link (fresh context)…')
  const ctxFresh = await browser.newContext()
  const pageFresh = await ctxFresh.newPage()
  await pageFresh.setViewportSize({ width: 390, height: 844 })
  report.steps.clickSecondFresh = await clickLink(pageFresh, link2, '07-click-second-fresh')
  save('07-click-second-fresh.json', report.steps.clickSecondFresh)
  await ctxFresh.close()

  // Test B: first (older) link in fresh context — expect invalid/expired
  console.log('Clicking FIRST reset link (fresh context, should be superseded)…')
  const ctxOld = await browser.newContext()
  const pageOld = await ctxOld.newPage()
  await pageOld.setViewportSize({ width: 390, height: 844 })
  report.steps.clickFirstFresh = await clickLink(pageOld, link1, '08-click-first-fresh')
  save('08-click-first-fresh.json', report.steps.clickFirstFresh)
  await ctxOld.close()

  // Test C: same browser session — click first link, then second link in same context
  console.log('Same-session test: first link then second link…')
  const ctxSame = await browser.newContext()
  const pageSame = await ctxSame.newPage()
  await pageSame.setViewportSize({ width: 390, height: 844 })
  report.steps.clickFirstSameSession = await clickLink(pageSame, link1, '09a-click-first-same-session')
  report.steps.clickSecondSameSession = await clickLink(pageSame, link2, '09b-click-second-same-session')
  save('09-same-session.json', {
    first: report.steps.clickFirstSameSession,
    second: report.steps.clickSecondSameSession,
  })
  await ctxSame.close()

  // Test D: UI double-request without clicking first link (simulate user flow on production)
  console.log('UI flow: trigger reset twice via forgot-password form…')
  const inbox2 = await guerrillaInbox()
  await signup(inbox2.address)
  const confirm2 = await waitForGuerrillaMessage(inbox2.sidToken, { subjectIncludes: 'confirm' })
  const confirm2Link = extractLinks(confirm2.mail_body || confirm2.mail_body_html || '').find((l) => l.includes('/auth/v1/verify'))
  const ctxUi = await browser.newContext()
  const pageUi = await ctxUi.newPage()
  await pageUi.setViewportSize({ width: 390, height: 844 })
  await pageUi.goto(confirm2Link, { waitUntil: 'domcontentloaded' })
  await pageUi.waitForTimeout(3000)
  await pageUi.goto(APP, { waitUntil: 'domcontentloaded' })
  await pageUi.waitForTimeout(2000)
  // open sign in
  await pageUi.getByRole('button', { name: /Sign in|Hyr/i }).first().click()
  await pageUi.waitForTimeout(1000)
  await pageUi.locator('.forgot-link').click()
  await pageUi.waitForTimeout(500)
  await pageUi.locator('input[type="email"]').fill(inbox2.address)
  const uiReset1At = new Date().toISOString()
  await pageUi.locator('form button[type="submit"]').click()
  await pageUi.waitForTimeout(3000)
  await pageUi.locator('.forgot-link').click().catch(() => {})
  await pageUi.waitForTimeout(500)
  await pageUi.locator('input[type="email"]').fill(inbox2.address)
  const uiReset2At = new Date().toISOString()
  await pageUi.locator('form button[type="submit"]').click()
  await pageUi.waitForTimeout(3000)
  report.steps.uiDoubleRequest = { reset1At: uiReset1At, reset2At: uiReset2At, email: inbox2.address }

  const uiResetMsgs = await listGuerrillaResetMessages(inbox2.sidToken)
  const uiLink2 = uiResetMsgs.at(-1)?.links?.find((l) => l.includes('/auth/v1/verify'))
  if (uiLink2) {
    report.steps.uiClickSecond = await clickLink(pageUi, uiLink2, '10-ui-click-second')
    save('10-ui-click-second.json', report.steps.uiClickSecond)
  }
  await ctxUi.close()

  await browser.close()
  save('report.json', report)
  console.log('\n=== DIAGNOSTIC REPORT ===')
  console.log(JSON.stringify(report, null, 2))
  console.log('\nEvidence:', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
