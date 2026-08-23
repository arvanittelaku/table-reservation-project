/**
 * Focused re-run: Test 1 (90s between resets) + Test 4 (60s resend cooldown).
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

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function listRecoveryLinks(sid) {
  const list = await fetch(
    `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
  ).then((r) => r.json())
  const links = []
  for (const m of list.list || []) {
    const full = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    const html = full.mail_body || full.mail_body_html || ''
    const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
    if (match && match[0].includes('type=recovery')) {
      links.push({ href: match[0].replace(/&amp;/g, '&'), ts: Number(full.mail_timestamp), subject: full.mail_subject })
    }
  }
  return links.sort((a, b) => a.ts - b.ts)
}

async function listConfirmLinks(sid) {
  const list = await fetch(
    `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
  ).then((r) => r.json())
  const links = []
  for (const m of list.list || []) {
    const full = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    const html = full.mail_body || full.mail_body_html || ''
    const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
    if (match && match[0].includes('type=signup')) {
      links.push({ href: match[0].replace(/&amp;/g, '&'), ts: Number(full.mail_timestamp), subject: full.mail_subject })
    }
  }
  return links.sort((a, b) => a.ts - b.ts)
}

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, data: { first_name: 'Prove', last_name: 'Live', age: 28 } }),
  })
  return res.json()
}

async function recover(email) {
  const res = await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_to: APP }),
  })
  return { status: res.status, at: new Date().toISOString() }
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
  await context.addInitScript(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  return { page, context }
}

const browser = await chromium.launch({ headless: true })

// TEST 1 final
console.log('TEST 1 final — 90s gap, no fallback')
const t1 = {}
try {
  const inbox = await guerrillaInbox()
  await signup(inbox.address)
  t1.reset1 = await recover(inbox.address)
  await new Promise((r) => setTimeout(r, 15000))
  let links = await listRecoveryLinks(inbox.sid)
  t1.reset1Link = links[0]?.href
  console.log('waiting 90s before second reset...')
  await new Promise((r) => setTimeout(r, 90000))
  t1.reset2 = await recover(inbox.address)
  await new Promise((r) => setTimeout(r, 15000))
  links = await listRecoveryLinks(inbox.sid)
  t1.allRecoveryLinks = links
  const oldLink = links[0]?.href
  const newLink = links[links.length - 1]?.href
  t1.tokensDifferent = oldLink !== newLink

  const { page, context } = await newPage(browser)
  const hashLog = []
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) hashLog.push({ url: f.url(), hash: new URL(f.url()).hash, at: new Date().toISOString() })
  })
  await page.goto(oldLink, { waitUntil: 'commit', timeout: 90000 })
  await page.waitForTimeout(7000)
  t1.navigationHashLog = hashLog
  t1.urlAfter = page.url()
  t1.hashAfter = await page.evaluate(() => location.hash)
  t1.hashBefore = hashLog.find((h) => h.hash.includes('otp_expired'))?.hash || null
  t1.urlBefore = hashLog.find((h) => h.hash.includes('otp_expired'))?.url || hashLog[0]?.url
  t1.exactBannerText = (await page.locator('.reset-expired-banner').innerText().catch(() => null))?.trim()
  t1.bannerShown = !!t1.exactBannerText
  await page.screenshot({ path: path.join(OUT, 'test1-old-reset-banner.png'), fullPage: true })
  await context.close()
} catch (e) {
  t1.error = String(e)
}
fs.writeFileSync(path.join(OUT, 'test1-final.json'), JSON.stringify(t1, null, 2))
console.log('test1 tokensDifferent:', t1.tokensDifferent, 'otp_expired hash:', !!t1.hashBefore, 'banner:', t1.bannerShown)

// TEST 4 final
console.log('\nTEST 4 final — 65s resend cooldown')
const t4 = {}
try {
  const inbox = await guerrillaInbox()
  const signupData = await signup(inbox.address)
  t4.signupEmail = inbox.address
  t4.signupUserId = signupData.user?.id
  t4.signupAt = new Date().toISOString()
  await new Promise((r) => setTimeout(r, 15000))
  let confirms = await listConfirmLinks(inbox.sid)
  t4.firstConfirmAt = new Date().toISOString()
  t4.firstConfirmLink = confirms[0]?.href
  console.log('waiting 65s before resend...')
  await new Promise((r) => setTimeout(r, 65000))
  t4.resend1 = await resendConfirm(inbox.address)
  await new Promise((r) => setTimeout(r, 15000))
  confirms = await listConfirmLinks(inbox.sid)
  t4.confirmEmailsAfterResend = confirms
  t4.confirmLinksDifferent = confirms.length >= 2 && confirms[0].href !== confirms[confirms.length - 1].href
  const oldConfirm = confirms[0]?.href

  const pending = {
    userId: t4.signupUserId,
    email: inbox.address,
    firstName: 'Prove',
    lastName: 'Live',
    age: '28',
    savedAt: Date.now(),
  }
  const { page, context } = await newPage(browser)
  await page.addInitScript((p) => sessionStorage.setItem('ejabashkohu-pending-registration', JSON.stringify(p)), pending)
  const hashLog = []
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) hashLog.push({ url: f.url(), hash: new URL(f.url()).hash, at: new Date().toISOString() })
  })
  await page.goto(oldConfirm, { waitUntil: 'commit', timeout: 90000 })
  await page.waitForTimeout(7000)
  t4.navigationHashLog = hashLog
  t4.urlAfter = page.url()
  t4.hashAfter = await page.evaluate(() => location.hash)
  t4.hashBefore = hashLog.find((h) => h.hash.includes('otp_expired'))?.hash || null
  t4.exactBannerText = (await page.locator('.reset-expired-banner').innerText().catch(() => null))?.trim()
  t4.linkType = 'signup (type=signup in verify URL, NOT recovery)'
  t4.triggerDescription =
    'POST /auth/v1/signup → first confirm email (type=signup) → waited 65s → POST /auth/v1/resend type=signup → clicked OLD confirm verify URL with pending registration in sessionStorage.'
  await page.screenshot({ path: path.join(OUT, 'test4-confirm-expired-banner.png'), fullPage: true })
  await context.close()
} catch (e) {
  t4.error = String(e)
}
fs.writeFileSync(path.join(OUT, 'test4-final.json'), JSON.stringify(t4, null, 2))
console.log('test4 otp_expired hash:', !!t4.hashBefore, 'banner:', t4.exactBannerText?.slice(0, 40))

await browser.close()
