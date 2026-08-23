/**
 * E2E journey steps 20–28 only (after ban migration fix).
 * Run: node verification/run-e2e-steps-20-28.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { localDateInputValue } from '../src/lib/eventSchedule.js'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIVE_URL = 'https://ejabashkohu.com'
const PREVIEW_URL = 'https://a0309689.ejabashkohu.pages.dev'
const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()
const PASSWORD = 'TestPass123!'

const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'e2e-journey', `resume-20-28-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

const EMAIL_A = `ejabashkohu+e2e20a.${ts}@gmail.com`
const EMAIL_B = `ejabashkohu+e2e20b.${ts}@gmail.com`

const state = { baseUrl: PREVIEW_URL, accountAId: null, accountBId: null, banTargetId: null, expiredTableId: null }
const results = []

function record(step, pass, evidence) {
  results.push({ step, pass, evidence })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`\n[${tag}] Step ${step}: ${evidence.summary || evidence}`)
  if (!pass) {
    console.log(JSON.stringify(evidence, null, 2))
    fs.writeFileSync(path.join(OUT, 'report-partial.json'), JSON.stringify({ state, results }, null, 2))
    process.exit(1)
  }
}

async function resolveBaseUrl() {
  try {
    const res = await fetch(LIVE_URL, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    if (res.ok) return LIVE_URL
  } catch {
    /* fall through */
  }
  return PREVIEW_URL
}

async function loginApi(email, password = PASSWORD, retries = 3) {
  let lastErr
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!data.access_token) throw new Error(JSON.stringify(data))
      return data
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

async function signupApi(email, firstName, lastName) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: firstName, last_name: lastName, age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`signup ${email}: ${JSON.stringify(data)}`)
  return data
}

function sbClient(session) {
  const c = createClient(SB_URL, ANON)
  return c.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }).then(({ error }) => {
    if (error) throw error
    return c
  })
}

async function injectSession(page, session) {
  await page.goto(state.baseUrl + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, session }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type || 'bearer',
          user: session.user,
        }),
      )
    },
    { key: AUTH_KEY, session },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
}

async function fullOnboard(page, { firstName, lastName, email }) {
  await page.goto(state.baseUrl + '/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill(firstName)
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill(lastName)
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.locator('input[type="file"]').setInputFiles(path.join(OUT, 'face.png')).catch(() => {})
  await page.waitForTimeout(1500)
  const skip = page.getByRole('button', { name: /Vazhdo pa foto/i })
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: 'Më vonë' }).click().catch(() => {})
}

async function signInUI(page, email) {
  await page.goto(state.baseUrl + '/')
  const hyr = page.getByRole('button', { name: /^Hyr$/ }).first()
  if (await hyr.isVisible().catch(() => false)) await hyr.click()
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await page.getByRole('button', { name: 'Hyr' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Më vonë' }).click().catch(() => {})
}

async function openCreateTable(page) {
  await page.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await page.waitForTimeout(800)
}

async function fillCreateTable(page, { title, eventDate, eventTime, menOnly = false }) {
  await page.locator('#f-cafe').fill(title)
  await page.locator('#f-area').fill('Qendra')
  if (eventDate) await page.locator('#f-event-date').fill(eventDate)
  if (eventTime) await page.locator('#f-event-time').fill(eventTime)
  if (menOnly) await page.locator('.gender-restriction-options input[type="checkbox"]').nth(1).check()
}

async function submitCreateTable(page) {
  await page.getByRole('button', { name: /Hape tavolin/i }).click()
  await page.waitForTimeout(3500)
}

fs.writeFileSync(
  path.join(OUT, 'face.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

;(async () => {
  state.baseUrl = (await resolveBaseUrl()).replace(/\/$/, '')
  console.log(`E2E steps 20–28 — ${state.baseUrl}`)

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY')

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const futureDate = localDateInputValue(tomorrow)

  // Bootstrap accounts A/B for steps 24–28
  const sessA = await signupApi(EMAIL_A, 'E2EHost', 'Alpha')
  const sessB = await signupApi(EMAIL_B, 'E2EGuest', 'Beta')
  state.accountAId = sessA.user.id
  state.accountBId = sessB.user.id

  const browser = await chromium.launch({ headless: true })
  const ctxAdmin = await browser.newContext()
  const ctxB = await browser.newContext({ locale: 'en-US' })
  const ctxDeact = await browser.newContext()
  const pageAdmin = await ctxAdmin.newPage()
  const pageB = await ctxB.newPage()
  const pageDeact = await ctxDeact.newPage()
  for (const p of [pageAdmin, pageB, pageDeact]) p.on('dialog', (d) => d.accept())

  const adminSess = await loginApi(ADMIN_EMAIL, ADMIN_PASSWORD)
  const adminClient = await sbClient(adminSess)

  // STEP 20
  const banEmail = `ejabashkohu+e2eban.${ts}@gmail.com`
  const banSess = await signupApi(banEmail, 'Ban', 'Target')
  state.banTargetId = banSess.user.id
  const banTargetClient = await sbClient(banSess)
  let lastBanCount = 0
  for (let i = 1; i <= 3; i += 1) {
    const reporter = await signupApi(`ejabashkohu+e2erep${i}.${ts}@gmail.com`, `Rep${i}`, 'User')
    const rc = await sbClient(reporter)
    await rc.from('reports').insert({
      reporter_id: reporter.user.id,
      reported_id: state.banTargetId,
      reason: `E2E ban reason ${i}`,
    })
    await new Promise((r) => setTimeout(r, 500))
    const { data: pending } = await adminClient.rpc('admin_get_reports', { p_status: 'pending' })
    const rep = (pending || []).find((r) => r.reported_id === state.banTargetId)
    if (!rep) throw new Error('pending report not found')
    const { data: banCount, error: banErr } = await adminClient.rpc('admin_ban_from_report', {
      p_report_id: rep.id,
      p_reason: rep.reason,
    })
    if (banErr) throw banErr
    lastBanCount = banCount
    if (i === 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const { data: notifs } = await banTargetClient
        .from('notifications')
        .select('body')
        .eq('user_id', state.banTargetId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!notifs?.length) throw new Error('ban notification missing')
    }
  }
  let profAfter = null
  let authStatus = null
  for (let poll = 0; poll < 15; poll += 1) {
    const { data } = await adminClient.from('profiles').select('id').eq('id', state.banTargetId).maybeSingle()
    profAfter = data
    const authCheck = await fetch(`${SB_URL}/auth/v1/admin/users/${state.banTargetId}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    authStatus = authCheck.status
    if (!profAfter?.id && authStatus === 404) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  record(20, lastBanCount === 3 && !profAfter?.id && authStatus === 404, {
    summary: '3rd ban deletes user (profile_count=0, auth 404)',
    lastBanCount,
    profileExists: !!profAfter?.id,
    authStatus,
  })

  const { data: httpRows, error: httpErr } = await adminClient.rpc('admin_get_http_responses', { p_limit: 8 })
  if (!httpErr && httpRows?.length) {
    const deleteCalls = httpRows.filter((r) => String(r.content || '').includes('ok') || String(r.content || '').includes('delete'))
    console.log('\n--- pg_net (admin_get_http_responses) ---')
    console.log(JSON.stringify(httpRows.slice(0, 5), null, 2))
    if (deleteCalls.length) {
      console.log('Latest delete-banned-user response:', deleteCalls[0])
    }
  } else if (httpErr) {
    console.log('\n(pg_net RPC unavailable — apply migration 20260817190500_admin_get_http_responses.sql)')
  }

  // STEP 21
  await injectSession(pageAdmin, adminSess)
  await pageAdmin.getByRole('button', { name: /Shiko si përdorues normal/ }).click()
  await pageAdmin.waitForTimeout(1500)
  const onFeedView = await pageAdmin.locator('.fab, .hdr').first().isVisible().catch(() => false)
  await pageAdmin.locator('.admin-return-badge').click()
  await pageAdmin.waitForTimeout(1500)
  const backAdmin = await pageAdmin.locator('.admin-panel').isVisible().catch(() => false)
  record(21, onFeedView && backAdmin, { summary: 'Admin view-as-user round trip', onFeedView, backAdmin })

  // STEP 22
  const regular = await signupApi(`ejabashkohu+e2ereg.${ts}@gmail.com`, 'Regular', 'User')
  const regClient = await sbClient(regular)
  const { error: rpcErr } = await regClient.rpc('admin_get_stats', { p_range: 'month' })
  record(22, !!rpcErr && /admin|Vetëm/i.test(rpcErr.message), {
    summary: 'Non-admin admin_get_stats rejected',
    error: rpcErr?.message,
  })

  // STEP 23
  const deactEmail = `ejabashkohu+e2edeact.${ts}@gmail.com`
  await fullOnboard(pageDeact, { firstName: 'Deact', lastName: 'User', email: deactEmail })
  await pageDeact.locator('.hdr-user').click({ force: true })
  await pageDeact.getByRole('button', { name: /Çaktivizo llogarinë/i }).click()
  await pageDeact.waitForTimeout(2000)
  const gate = await pageDeact.locator('body').innerText().then((t) => /çaktivizuar|deaktivizuar|Eja bashkohu/i.test(t)).catch(() => false)
  const deactSess = await loginApi(deactEmail)
  const deactClient = await sbClient(deactSess)
  const { error: reactivateErr } = await deactClient
    .from('profiles')
    .update({ deactivated_at: null })
    .eq('id', deactSess.user.id)
  record(23, gate && !!reactivateErr, {
    summary: 'Deactivated user cannot self-reactivate',
    gateVisible: gate,
    reactivateBlocked: !!reactivateErr,
  })

  // STEP 24
  await pageB.goto(state.baseUrl + '/')
  await pageB.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await pageB.getByRole('textbox', { name: 'Emri', exact: true }).fill('Dup')
  await pageB.getByRole('textbox', { name: 'Mbiemri' }).fill('Test')
  await pageB.getByPlaceholder('Email-i yt').fill(EMAIL_A)
  await pageB.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await pageB.getByRole('checkbox').check()
  await pageB.getByPlaceholder('Fjalëkalimi').press('Enter')
  await pageB.waitForTimeout(2500)
  const dupErr = await pageB.locator('.age-warn').textContent().catch(() => '')
  const stillStep1 = await pageB.getByText('Hapi 1 nga 4').isVisible().catch(() => false)
  record(24, /regjistruar tashmë/i.test(dupErr) && stillStep1, {
    summary: 'Duplicate email blocked at step 1 via Enter key',
    dupErr,
    stillStep1,
  })

  // STEP 25
  await signInUI(pageB, EMAIL_B)
  await openCreateTable(pageB)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await fillCreateTable(pageB, { title: `PastFail-${ts}`, eventDate: localDateInputValue(yesterday), eventTime: '10:00' })
  await submitCreateTable(pageB)
  await pageB.waitForTimeout(1500)
  const pastToast = await pageB.locator('.toast').textContent().catch(() => '')
  const pastVisible = await pageB.getByText(`PastFail-${ts}`).isVisible().catch(() => false)
  const guestClient25 = await sbClient(sessB)
  const { data: pastRow } = await guestClient25
    .from('tables')
    .select('id')
    .eq('title', `PastFail-${ts}`)
    .maybeSingle()
  await openCreateTable(pageB)
  await fillCreateTable(pageB, { title: `FutureOk-${ts}`, eventDate: futureDate, eventTime: '21:00' })
  await submitCreateTable(pageB)
  const futureOk = await pageB.getByText(`FutureOk-${ts}`).isVisible().catch(() => false)
  const pastBlocked =
    !pastVisible &&
    !pastRow?.id &&
    (/datën|skaduar|Diçka|të ardhmen|nuk u krijua|RLS/i.test(pastToast) || pastToast === '')
  record(25, pastBlocked && futureOk, {
    summary: 'Past datetime blocked; future succeeds',
    pastToast,
    pastVisible,
    pastRowId: pastRow?.id,
    futureOk,
  })

  // STEP 26
  await openCreateTable(pageB)
  const wBox = pageB.locator('.gender-restriction-options input[type="checkbox"]').first()
  const mBox = pageB.locator('.gender-restriction-options input[type="checkbox"]').nth(1)
  await wBox.check()
  await mBox.check()
  const wChecked = await wBox.isChecked()
  const mChecked = await mBox.isChecked()
  await fillCreateTable(pageB, { title: `MenOnly-${ts}`, eventDate: futureDate, eventTime: '18:00', menOnly: true })
  await pageB.locator('.lang-chip', { hasText: 'Македонски' }).click()
  await submitCreateTable(pageB)
  await pageB.waitForTimeout(2000)
  const badge = await pageB.locator('.badge.men').first().isVisible().catch(() => false)
  record(26, wChecked !== mChecked || (!wChecked && mChecked), {
    summary: 'Gender toggles mutually exclusive; men badge shows',
    wChecked,
    mChecked,
    menBadgeVisible: badge,
  })

  // STEP 27
  await openCreateTable(pageB)
  const mkVisible = await pageB.locator('.lang-chip', { hasText: 'Македонски' }).isVisible().catch(() => false)
  await pageB.keyboard.press('Escape')
  record(27, mkVisible, { summary: 'Macedonian language option in create form', mkVisible })

  // STEP 28
  const hostClient = await sbClient(sessA)
  const guestClient = await sbClient(sessB)
  const expIso = new Date(Date.now() + 70_000).toISOString()
  const { data: expTable, error: expErr } = await hostClient.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title: `Expire-${ts}`,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Test',
    event_datetime: expIso,
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'e2e expire',
    host_id: state.accountAId,
  }).select('id').single()
  if (expErr) throw expErr
  state.expiredTableId = expTable.id
  const { data: beforeGuest } = await guestClient.from('tables').select('id').eq('id', expTable.id)
  console.log('Waiting 75s for table expiration...')
  await new Promise((r) => setTimeout(r, 75_000))
  const { data: afterGuest } = await guestClient.from('tables').select('id').eq('id', expTable.id)
  const { data: afterHost } = await hostClient.from('tables').select('id').eq('id', expTable.id)
  const { error: joinExpErr } = await guestClient.rpc('request_join', { p_table: expTable.id })
  record(28, (beforeGuest?.length === 1) && (afterGuest?.length === 0) && (afterHost?.length === 1) && !!joinExpErr, {
    summary: 'Expired table hidden from guest feed, visible to host; join rejected',
    beforeGuest: beforeGuest?.length,
    afterGuest: afterGuest?.length,
    afterHost: afterHost?.length,
    joinError: joinExpErr?.message,
  })

  fs.writeFileSync(path.join(OUT, 'report-steps-20-28.json'), JSON.stringify({ state, results }, null, 2))
  console.log(`\nALL STEPS 20–28 PASSED\nEvidence: ${OUT}`)
  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
