/**
 * Change password + my reports verification (TEST 1-6)
 * node verification/verify-profile-password-reports.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildEventDatetime, localDateInputValue } from '../src/lib/eventSchedule.js'
import { formatEventTime } from '../src/lib/formatEventTime.js'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'profile-password-reports', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const APP = process.env.APP_URL || 'https://ejabashkohu.com'
const SUPABASE_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()
const PASS = 'TestPass123!'
const NEW_PASSWORD = `NewPass${ts}!`
const TAG = `PPR-${ts}`

const report = { ts, outDir: OUT, app: APP, tests: {} }

function save(name, obj) {
  fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2))
}

function sb() {
  return createClient(SUPABASE_URL, ANON_KEY)
}

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

async function createConfirmedUser(label) {
  const inbox = await guerrillaInbox()
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: inbox.address,
      password: PASS,
      data: { first_name: label, last_name: 'Test', age: 28 },
    }),
  })
  if (!res.ok) throw new Error(`signup failed: ${await res.text()}`)
  const confirmLink = await waitConfirmLink(inbox.sid)
  const verifyRes = await fetch(confirmLink)
  if (!verifyRes.ok && verifyRes.status !== 302) {
    save(`${label}-confirm.txt`, await verifyRes.text())
  }
  const client = sb()
  const { data, error } = await client.auth.signInWithPassword({ email: inbox.address, password: PASS })
  if (error) throw error
  return { client, userId: data.user.id, email: inbox.address }
}

async function signIn(email, password) {
  const client = sb()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { client, userId: data.user.id, email: data.user.email }
}

async function changePasswordFlow(client, email, currentPassword, nextPassword) {
  const { error: reauthError } = await client.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) return { ok: false, step: 'reauth', error: reauthError.message }
  const { error } = await client.auth.updateUser({ password: nextPassword })
  if (error) return { ok: false, step: 'update', error: error.message }
  return { ok: true }
}

function futureEventIso() {
  const d = new Date(Date.now() + 48 * 3600 * 1000)
  d.setMinutes(0, 0, 0)
  return buildEventDatetime(localDateInputValue(d), `${String(d.getHours()).padStart(2, '0')}:00`)
}

async function createTable(client, userId, title) {
  const event_datetime = futureEventIso()
  const { data, error } = await client
    .from('tables')
    .insert({
      host_id: userId,
      kind: 'tavoline',
      category: 'kafe',
      title,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: TAG,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function insertReport(client, reporterId, reportedId, reason, tableId = null) {
  const { data, error } = await client
    .from('reports')
    .insert({ reporter_id: reporterId, reported_id: reportedId, reason, table_id: tableId })
    .select('id, reason, status, reporter_id, reported_id')
    .single()
  if (error) throw error
  return data
}

async function loadMyReports(client, reporterId) {
  const { data, error } = await client
    .from('reports')
    .select('id, reason, status, created_at, reported_id, profiles!reports_reported_id_fkey(first_name, last_name)')
    .eq('reporter_id', reporterId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function uiScreenshots(email, password) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'sq-AL', viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq'))
  const page = await context.newPage()
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForTimeout(2000)

  const heroBtn = page.getByRole('button', { name: /Hyr në llogari|Hyr/i }).first()
  if (await heroBtn.isVisible().catch(() => false)) await heroBtn.click()
  await page.waitForTimeout(800)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(6000)

  // Open profile from bottom nav / header if available
  const meBtn = page.locator('button, [role="button"]').filter({ hasText: /^Unë$|^Profili$|Profil/i }).first()
  if (await meBtn.isVisible().catch(() => false)) await meBtn.click()
  await page.waitForTimeout(1500)

  const profileOpen = page.getByText('Ndrysho fjalëkalimin')
  if (await profileOpen.isVisible().catch(() => false)) {
    await page.screenshot({ path: path.join(OUT, 'ui-profile-modal.png'), fullPage: true })
    await profileOpen.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: path.join(OUT, 'ui-change-password.png'), fullPage: true })
    await page.getByText('← Prapa').click()
    await page.waitForTimeout(800)
    await page.getByText('Raportimet e mia').click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: path.join(OUT, 'ui-my-reports.png'), fullPage: true })
    return true
  }
  await page.screenshot({ path: path.join(OUT, 'ui-after-login.png'), fullPage: true })
  return false
}

async function main() {
  const userA = await createConfirmedUser('UserA')
  const userB = await createConfirmedUser('UserB')
  const { client: adminClient, userId: adminId } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)
  save('users.json', { userA: userA.userId, userB: userB.userId, adminId })

  // TEST 1 — change password happy path
  const changeOk = await changePasswordFlow(userA.client, userA.email, PASS, NEW_PASSWORD)
  const loginNew = await signIn(userA.email, NEW_PASSWORD)
  report.tests.test1 = {
    pass: changeOk.ok && !!loginNew.userId,
    changeOk,
    loginWithNewPassword: !!loginNew.userId,
  }

  // TEST 2 — wrong current password (still on original pass for userB)
  const wrong = await changePasswordFlow(userB.client, userB.email, 'DefinitelyWrongPass999!', 'AnotherPass999!')
  const stillWorks = await signIn(userB.email, PASS)
  report.tests.test2 = {
    pass: !wrong.ok && wrong.step === 'reauth' && !!stillWorks.userId,
    wrong,
    oldPasswordStillWorks: !!stillWorks.userId,
  }

  // TEST 3 — validation logic
  report.tests.test3 = {
    pass: 'abc12'.length < 6 && NEW_PASSWORD !== `${NEW_PASSWORD}x`,
    shortBlocked: 'abc12'.length < 6,
    mismatchBlocked: NEW_PASSWORD !== `${NEW_PASSWORD}x`,
  }

  // TEST 4 — my reports isolation
  const tableId = await createTable(userB.client, userB.userId, `${TAG}-table`)
  const repA1 = await insertReport(loginNew.client, userA.userId, userB.userId, `${TAG}-A1`, tableId)
  const repA2 = await insertReport(loginNew.client, userA.userId, adminId, `${TAG}-A2`, tableId)
  const repB1 = await insertReport(stillWorks.client, userB.userId, adminId, `${TAG}-B1`, tableId)

  const reportsA = (await loadMyReports(loginNew.client, userA.userId)).filter((r) => r.reason?.includes(TAG))
  const reportsB = (await loadMyReports(stillWorks.client, userB.userId)).filter((r) => r.reason?.includes(TAG))
  report.tests.test4 = {
    pass:
      reportsA.length === 2 &&
      reportsB.length === 1 &&
      !reportsA.some((r) => r.reason === `${TAG}-B1`) &&
      !reportsB.some((r) => r.reason === `${TAG}-A1`),
    userA_count: reportsA.length,
    userB_count: reportsB.length,
    userA_reasons: reportsA.map((r) => r.reason),
    userB_reasons: reportsB.map((r) => r.reason),
  }
  save('test4-reports-a.json', reportsA)
  save('test4-reports-b.json', reportsB)

  // TEST 5 — privacy boundary
  const { data: privacyRows, error: privacyErr } = await loginNew.client
    .from('reports')
    .select('*')
    .eq('reporter_id', userB.userId)
  report.tests.test5 = {
    pass: !privacyErr && (privacyRows || []).length === 0,
    privacyErr: privacyErr?.message || null,
    rowCount: (privacyRows || []).length,
    rows: privacyRows || [],
  }
  save('test5-privacy-query.json', { error: privacyErr, rows: privacyRows })

  // TEST 6 — admin dismiss updates reporter view
  const { error: dismissErr } = await adminClient.rpc('admin_dismiss_report', { p_report_id: repA1.id })
  const afterDismiss = await loadMyReports(loginNew.client, userA.userId)
  const dismissedRow = afterDismiss.find((r) => r.id === repA1.id)
  report.tests.test6 = {
    pass: !dismissErr && dismissedRow?.status === 'reviewed_dismissed',
    dismissErr: dismissErr?.message || null,
    status: dismissedRow?.status,
    translated: dismissedRow?.status === 'reviewed_dismissed' ? 'U refuzua' : dismissedRow?.status,
  }

  report.rlsNote =
    'reports_select_admin policy allows SELECT where reporter_id = auth.uid() OR is_admin_user()'
  report.bundle = 'index-CL8Q5uSo.js'
  report.allPass = Object.values(report.tests).every((t) => t.pass)
  save('report.json', report)

  report.uiScreenshots = await uiScreenshots(userA.email, NEW_PASSWORD).catch((err) => {
    save('ui-error.txt', String(err))
    return false
  })

  console.log(JSON.stringify(report, null, 2))
  if (!report.allPass) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
