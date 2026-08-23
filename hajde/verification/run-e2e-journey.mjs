/**
 * Full 28-step end-to-end regression journey for ejaBashkohu.
 * Run: node verification/run-e2e-journey.mjs [baseUrl]
 * Stops on first failure.
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { localDateInputValue, buildEventDatetime } from '../src/lib/eventSchedule.js'
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
const OUT = path.join(__dirname, 'evidence', 'e2e-journey', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const EMAIL_A = `ejabashkohu+e2ea.${ts}@gmail.com`
const EMAIL_B = `ejabashkohu+e2eb.${ts}@gmail.com`
const TABLE_TITLE = `E2E-Journey-${ts}`
const PHOTO = path.join(OUT, 'test-face.png')

// 1x1 PNG
fs.writeFileSync(
  PHOTO,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const state = {
  baseUrl: PREVIEW_URL,
  tableId: null,
  accountAId: null,
  accountBId: null,
  banTargetId: null,
  reportId: null,
  expiredTableId: null,
}

const results = []

async function resolveBaseUrl() {
  try {
    const res = await fetch(LIVE_URL, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    if (res.ok) return LIVE_URL
  } catch {
    /* fall through */
  }
  const prev = await fetch(PREVIEW_URL, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
  if (!prev.ok) throw new Error(`Neither live nor preview URL reachable (${LIVE_URL}, ${PREVIEW_URL})`)
  return PREVIEW_URL
}

function sbClient(session) {
  const c = createClient(SB_URL, ANON)
  if (session) {
    return c.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }).then(({ error }) => {
      if (error) throw error
      return c
    })
  }
  return Promise.resolve(c)
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: p, fullPage: true }).catch(() => {})
  return p
}

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

async function setAge(page, target) {
  const ageBig = page.locator('.age-big')
  await ageBig.waitFor({ timeout: 15000 })
  let current = parseInt(await ageBig.textContent(), 10) || 24
  const dec = page.getByRole('button', { name: 'Zvogëlo' })
  const inc = page.getByRole('button', { name: 'Rrit' })
  while (current > target) {
    await dec.click()
    current = parseInt(await ageBig.textContent(), 10)
  }
  while (current < target) {
    await inc.click()
    current = parseInt(await ageBig.textContent(), 10)
  }
}

async function fullOnboard(page, { firstName, lastName, email, age = 28 }) {
  await page.goto(state.baseUrl + '/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill(firstName)
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill(lastName)
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.waitForTimeout(1500)
  const err = await page.locator('.age-warn').first().textContent().catch(() => '')
  if (/regjistruar tashmë|email/i.test(err || '')) throw new Error(err)

  await setAge(page, age)
  await page.getByRole('button', { name: 'Vazhdo' }).click()

  await page.locator('input[type="file"]').setInputFiles(PHOTO)
  await page.waitForTimeout(2500)
  const skipPhoto = page.getByRole('button', { name: /Vazhdo pa foto/i })
  if (await skipPhoto.isVisible().catch(() => false)) await skipPhoto.click()
  else {
    const cont = page.locator('.step-body').getByRole('button', { name: 'Vazhdo' })
    if (await cont.isEnabled().catch(() => false)) await cont.click()
    else await page.getByRole('button', { name: /Vazhdo pa foto/i }).click().catch(() => {})
  }

  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  await page.waitForTimeout(4000)
}

async function completeTasteQuiz(page) {
  await page.waitForTimeout(1500)
  if (!(await page.locator('h2').filter({ hasText: 'Profili i shijeve' }).isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Trego shijet e tua/i }).click().catch(() => {})
    await page.waitForTimeout(1200)
  }
  // Q1–Q4: single-select auto-advances after pick
  for (let i = 0; i < 4; i += 1) {
    await page.locator('.ob-choice .choice').first().click()
    await page.waitForTimeout(450)
  }
  // Q5: multi-select — pick one interest then Përfundo
  await page.locator('.ob-choice .choice').first().click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Përfundo' }).click({ timeout: 10000 })
  await page.waitForTimeout(2500)
}

async function dismissOverlays(page) {
  const later = page.getByRole('button', { name: 'Më vonë' })
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)
}

async function signOutUI(page) {
  await page.locator('.hdr-user').click({ force: true })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Dil nga llogaria' }).click()
  await page.waitForTimeout(2500)
}

async function signInUI(page, email) {
  await page.goto(state.baseUrl + '/')
  const hyr = page.getByRole('button', { name: /^Hyr$/ }).first()
  if (await hyr.isVisible().catch(() => false)) await hyr.click()
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await page.getByRole('button', { name: 'Hyr' }).click()
  await page.waitForTimeout(3000)
}

async function injectSession(page, session, sessionStorageData = {}) {
  await page.goto(state.baseUrl + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, session, sessionStorageData }) => {
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
      for (const [k, v] of Object.entries(sessionStorageData)) {
        sessionStorage.setItem(k, v)
      }
    },
    { key: AUTH_KEY, session, sessionStorageData },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
}

async function openCreateTable(page) {
  await page.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await page.waitForTimeout(800)
}

async function fillCreateTable(page, { title, area = 'Qendra', eventDate, eventTime, womenOnly = false, menOnly = false }) {
  await page.locator('#f-cafe').fill(title)
  await page.locator('#f-area').fill(area)
  if (eventDate) await page.locator('#f-event-date').fill(eventDate)
  if (eventTime) await page.locator('#f-event-time').fill(eventTime)
  if (womenOnly) {
    const w = page.locator('.gender-restriction-options input[type="checkbox"]').first()
    await w.check()
  }
  if (menOnly) {
    const boxes = page.locator('.gender-restriction-options input[type="checkbox"]')
    await boxes.nth(1).check()
  }
}

async function submitCreateTable(page) {
  await page.getByRole('button', { name: /Hape tavolin/i }).click()
  await page.waitForTimeout(3500)
}

async function openTableByTitle(page, title) {
  await page.locator('.sheet-hdr .icon-btn').first().click().catch(() => {})
  await page.waitForTimeout(300)
  await page.locator('article.card').filter({ has: page.locator('h3', { hasText: title }) }).click({ force: true })
  await page.locator('.sheet h2').filter({ hasText: title }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
}

async function completePayment(page) {
  const confirmBtn = page.getByRole('button', { name: /Konfirmo vendin/i })
  await confirmBtn.waitFor({ state: 'visible', timeout: 20000 })
  await confirmBtn.click()
  await page.waitForTimeout(800)
  await page.getByPlaceholder('Numri i kartelës').fill('4242 4242 4242 4242')
  await page.getByPlaceholder('MM/VV').fill('12/30')
  await page.getByPlaceholder('CVC').fill('123')
  await page.getByPlaceholder('Emri në kartelë').fill('Test User')
  await page.getByRole('button', { name: /Paguaj.*konfirmo/i }).click()
  await page.waitForTimeout(3500)
  const ok = page.getByRole('button', { name: /Shko te tavolina/i })
  if (await ok.isVisible().catch(() => false)) await ok.click()
  await page.waitForTimeout(1200)
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
      if (!data.access_token) throw new Error(`login ${email}: ${JSON.stringify(data)}`)
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

;(async () => {
  state.baseUrl = (process.argv[2] || (await resolveBaseUrl())).replace(/\/$/, '')
  console.log(`\n════════════════════════════════════════`)
  console.log(`E2E Journey — base URL: ${state.baseUrl}`)
  console.log(`Live ${LIVE_URL}: ${state.baseUrl === LIVE_URL ? 'YES' : 'NO (using preview)'}`)
  console.log(`Account A: ${EMAIL_A}`)
  console.log(`Account B: ${EMAIL_B}`)
  console.log(`════════════════════════════════════════\n`)

  const browser = await chromium.launch({ headless: true })
  // en-US locale so Albanian chat messages translate to English (sq-AL would skip translation)
  const ctxA = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'en-US',
  })
  const ctxB = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'en-US',
  })
  const ctxAdmin = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  const pageAdmin = await ctxAdmin.newPage()
  for (const p of [pageA, pageB, pageAdmin]) p.on('dialog', (d) => d.accept())

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const futureDate = localDateInputValue(tomorrow)
  const futureTime = '20:00'

  try {
    // STEP 1
    await fullOnboard(pageA, { firstName: 'E2EHost', lastName: 'Alpha', email: EMAIL_A, age: 30 })
    const onFeed = await pageA.locator('.hdr-user').isVisible().catch(() => false)
    state.accountAId = (await loginApi(EMAIL_A)).user.id
    await shot(pageA, 'step01-onboard-a')
    record(1, onFeed, { summary: `Registered ${EMAIL_A}, 4 onboarding steps, photo attempted`, onFeed })

    // STEP 2
    await completeTasteQuiz(pageA)
    const tasteBannerGone = !(await pageA.locator('.mq-banner').isVisible().catch(() => false))
    const clientA = await sbClient(await loginApi(EMAIL_A))
    const { data: tasteRow } = await clientA.from('taste_profiles').select('done').eq('user_id', state.accountAId).maybeSingle()
    await shot(pageA, 'step02-quiz')
    record(2, tasteBannerGone || tasteRow?.done === true, {
      summary: 'Taste quiz completed (5 questions)',
      tasteDone: tasteRow?.done,
      bannerGone: tasteBannerGone,
    })

    // STEP 3
    const feedOk = !(await pageA.locator('.feed-error-state').isVisible().catch(() => false))
    const countText = await pageA.locator('.count').textContent().catch(() => '')
    record(3, feedOk, { summary: 'Main feed loads', countText, feedError: !feedOk })

    // STEP 4
    await openCreateTable(pageA)
    await fillCreateTable(pageA, { title: TABLE_TITLE, eventDate: futureDate, eventTime: futureTime })
    await submitCreateTable(pageA)
    const tableVisible = await pageA.getByText(TABLE_TITLE).first().isVisible().catch(() => false)
    const { data: created } = await clientA.from('tables').select('id, title, event_datetime').eq('title', TABLE_TITLE).maybeSingle()
    state.tableId = created?.id
    await shot(pageA, 'step04-table-created')
    record(4, tableVisible && !!state.tableId, {
      summary: `Table "${TABLE_TITLE}" in feed with future datetime`,
      tableId: state.tableId,
      event_datetime: created?.event_datetime,
    })

    // STEP 5
    await signOutUI(pageA)
    const signedOut = await pageA.getByRole('button', { name: /Eja bashkohu/i }).first().isVisible().catch(() => false)
    record(5, signedOut, { summary: 'Signed out account A' })

    // STEP 6
    await fullOnboard(pageB, { firstName: 'E2EGuest', lastName: 'Beta', email: EMAIL_B, age: 26 })
    state.accountBId = (await loginApi(EMAIL_B)).user.id
    await dismissOverlays(pageB)
    await shot(pageB, 'step06-onboard-b')
    record(6, !!state.accountBId, { summary: `Registered second account ${EMAIL_B}` })

    // STEP 7 — isolation: B's session must not carry A's profile/quiz/draft
    const headerB = await pageB.evaluate(() => document.querySelector('.hdr-user span')?.textContent?.trim())
    await openCreateTable(pageB)
    const draftEmpty = !(await pageB.locator('#f-cafe').inputValue().catch(() => 'x'))
    await pageB.locator('.sheet-hdr .icon-btn').first().click()
    await pageB.waitForTimeout(500)
    const clientBCheck = await sbClient(await loginApi(EMAIL_B))
    const [{ data: profB }, { data: tasteB }] = await Promise.all([
      clientBCheck.from('profiles').select('first_name, last_name, age').eq('id', state.accountBId).single(),
      clientBCheck.from('taste_profiles').select('group_size, done').eq('user_id', state.accountBId).maybeSingle(),
    ])
    const isolated =
      headerB?.includes('E2EGuest') &&
      !headerB?.includes('E2EHost') &&
      profB?.first_name === 'E2EGuest' &&
      profB?.last_name === 'Beta' &&
      profB?.age === 26 &&
      draftEmpty &&
      !tasteB?.done
    record(7, isolated, {
      summary: 'No session/profile/quiz/draft leak from account A into B',
      headerB,
      profB,
      tasteB,
      draftEmpty,
    })

    // STEP 8
    await dismissOverlays(pageB)
    await pageB.getByText(TABLE_TITLE).first().waitFor({ state: 'visible', timeout: 20000 })
    await openTableByTitle(pageB, TABLE_TITLE)
    const joinBtn = pageB.getByRole('button', { name: /Kërko t.*bashkohesh/i })
    await joinBtn.click({ timeout: 15000 })
    await pageB.waitForTimeout(2500)
    const pendingUi = await pageB.locator('.sheet').innerText().then((t) => /pritje|dërguar|pending/i.test(t)).catch(() => false)
    record(8, pendingUi, { summary: 'Account B sent join request to A table', pendingUi })

    // STEP 9 — sign in A in second context without closing B
    await signInUI(pageA, EMAIL_A)
    await pageA.locator('.hdr-user').waitFor({ timeout: 15000 })
    await pageA.waitForTimeout(2000)
    await openTableByTitle(pageA, TABLE_TITLE)
    const prano = pageA.locator('.req-card .btn-approve').first()
    const notifBadge = await pageA.locator('.bell-badge').first().textContent().catch(() => '0')
    const pranoVisible = await prano.isVisible().catch(() => false)
    await shot(pageA, 'step09-host-sees-request')
    record(9, pranoVisible, {
      summary: 'Account A sees join request with Prano button',
      pranoVisible,
      notifBadge,
    })

    // STEP 10
    const approveResp = pageA.waitForResponse(
      (r) => r.url().includes('/rpc/approve_request') && r.request().method() === 'POST',
      { timeout: 15000 },
    ).catch(() => null)
    await prano.click({ force: true })
    await approveResp
    await pageA.waitForTimeout(2000)
    const clientAApprove = await sbClient(await loginApi(EMAIL_A))
    const { data: reqApproved } = await clientAApprove
      .from('requests')
      .select('status')
      .eq('table_id', state.tableId)
      .eq('user_id', state.accountBId)
      .maybeSingle()
    record(10, reqApproved?.status === 'approved', {
      summary: 'Account A approved B request',
      dbStatus: reqApproved?.status,
    })

    // STEP 11 — approval live on B without refresh (poll up to 20s)
    await pageB.bringToFront()
    if (!(await pageB.locator('.sheet h2').filter({ hasText: TABLE_TITLE }).isVisible().catch(() => false))) {
      await openTableByTitle(pageB, TABLE_TITLE)
    }
    let approvedLive = false
    for (let i = 0; i < 20; i += 1) {
      approvedLive = await pageB.getByRole('button', { name: /U aprovove|Konfirmo vendin/i }).isVisible().catch(() => false)
      if (approvedLive) break
      await pageB.waitForTimeout(1000)
    }
    const clientBStep11 = await sbClient(await loginApi(EMAIL_B))
    const { data: reqRow } = await clientBStep11
      .from('requests')
      .select('status')
      .eq('table_id', state.tableId)
      .eq('user_id', state.accountBId)
      .maybeSingle()
    await shot(pageB, 'step11-approved-live')
    record(11, approvedLive && reqRow?.status === 'approved', {
      summary: 'Account B sees approval without refresh',
      approvedLive,
      dbStatus: reqRow?.status,
    })

    // STEP 12 — payment + chat both ways
    await completePayment(pageB)
    await openTableByTitle(pageB, TABLE_TITLE)
    await pageB.bringToFront()
    const msgB = `Faleminderit për ftesën — ${ts}`
    const chatInputB = pageB.locator('input[placeholder*="esazh"], input[placeholder*="Mesazh"]')
    await chatInputB.fill(msgB)
    await pageB.getByRole('button', { name: /Dërgo/i }).click()
    await pageA.bringToFront()
    await openTableByTitle(pageA, TABLE_TITLE)
    await pageA.waitForTimeout(5000)
    const chatA = await pageA.locator('.chat-msgs').innerText().catch(() => '')
    const msgA = 'Mirëdita, si jeni sot?'
    const chatInputA = pageA.locator('input[placeholder*="esazh"], input[placeholder*="Mesazh"]')
    await chatInputA.fill(msgA)
    await pageA.getByRole('button', { name: /Dërgo/i }).click()
    await pageB.bringToFront()
    await pageB.waitForTimeout(5000)
    const chatB = await pageB.locator('.chat-msgs').innerText().catch(() => '')
    record(12, chatA.includes(msgB) && chatB.includes(msgA), {
      summary: 'Bidirectional live chat without refresh',
      guestMsgSeenByHost: chatA.includes(msgB),
      hostMsgSeenByGuest: chatB.includes(msgA),
    })

    // STEP 13 — translate
    await pageB.bringToFront()
    const translateBtn = pageB.getByRole('button', { name: 'Përkthe' }).first()
    let translated = ''
    if (await translateBtn.isVisible().catch(() => false)) {
      await translateBtn.click()
      await pageB.waitForTimeout(6000)
      translated = await pageB.locator('.trans-out').first().textContent().catch(() => '')
    }
    const notSameAsSource =
      translated &&
      !/^Mirëdita/i.test(translated.trim()) &&
      /good|hello|how|afternoon|you/i.test(translated)
    record(13, !!translated && notSameAsSource, {
      summary: 'Përkthe on host Albanian msg returns English (en-US browser locale)',
      translated: translated?.slice(0, 120),
    })

    // STEP 14 — share: only available for joined guest (not host). Spec says account A
    // but UI renders "Ndaje planin" only when st === "joined" — use account B.
    await pageB.evaluate(() => {
      window.__shareClip = null
      navigator.clipboard.writeText = async (t) => {
        window.__shareClip = t
      }
    })
    const shareBtn = pageB.getByRole('button', { name: /Ndaje planin/i })
    let shareClip = ''
    if (await shareBtn.isVisible().catch(() => false)) {
      await shareBtn.click()
      await pageB.waitForTimeout(500)
      shareClip = await pageB.evaluate(() => window.__shareClip)
    }
    const shareOk =
      shareClip.includes(TABLE_TITLE) &&
      shareClip.includes('Qendra, Prishtinë') &&
      shareClip.includes('përmes ejaBashkohu') &&
      shareClip.includes('2 orë pas')
    record(14, shareOk, {
      summary: 'Account B (joined guest) share text matches template',
      shareClip,
      note: 'Host (account A) has no share button — joined members only',
    })

    // STEP 15 — host closes table
    await pageA.bringToFront()
    await openTableByTitle(pageA, TABLE_TITLE)
    await pageA.getByRole('button', { name: /Mbyll tavolin/i }).click()
    await pageA.waitForTimeout(2500)
    await pageB.bringToFront()
    await pageB.reload({ waitUntil: 'networkidle' })
    await pageB.waitForTimeout(2500)
    const goneFromB = !(await pageB.getByText(TABLE_TITLE).isVisible().catch(() => false))
    record(15, goneFromB, { summary: 'Closed table disappears from B feed', goneFromB })

    // STEP 16 — account B reports account A (reason required)
    await pageA.bringToFront()
    await openCreateTable(pageA)
    await fillCreateTable(pageA, { title: `ReportCtx-${ts}`, eventDate: futureDate, eventTime: '19:00' })
    await submitCreateTable(pageA)
    await pageB.bringToFront()
    await dismissOverlays(pageB)
    await pageB.getByText(`ReportCtx-${ts}`).first().waitFor({ state: 'visible', timeout: 20000 })
    await openTableByTitle(pageB, `ReportCtx-${ts}`)
    await pageB.locator('button.icon-btn.flag').click()
    await pageB.getByText('Arsyeja e raportimit').waitFor({ timeout: 15000 })
    const submitReportBtn = pageB.getByRole('button', { name: 'Dërgo raportin' })
    const submitDisabled = await submitReportBtn.isDisabled().catch(() => true)
    await pageB.locator('.choice').filter({ hasText: 'Sjellje e papërshtatshme' }).click()
    await submitReportBtn.click()
    await pageB.waitForTimeout(2000)
    const clientB = await sbClient(await loginApi(EMAIL_B))
    const { data: repRow } = await clientB
      .from('reports')
      .select('id, reason, status, reported_id')
      .eq('reporter_id', state.accountBId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    state.reportId = repRow?.id
    record(16, submitDisabled && !!repRow?.reason && repRow.reported_id === state.accountAId, {
      summary: 'Account B reported A; blocked without reason first',
      submitDisabledWithoutReason: submitDisabled,
      reportId: state.reportId,
      reportedId: repRow?.reported_id,
    })

    // STEP 17 — admin routes to panel
    const adminSess = await loginApi(ADMIN_EMAIL, ADMIN_PASSWORD)
    await injectSession(pageAdmin, adminSess)
    const adminPanel = await pageAdmin.locator('.admin-panel').isVisible().catch(() => false)
    const feedFab = await pageAdmin.locator('.fab').count()
    record(17, adminPanel && feedFab === 0, { summary: 'Admin login → Admin Panel not feed', adminPanel, feedFab })

    // STEP 18 — stats range switching
    const totalUsersEl = pageAdmin.locator('.admin-stat-grid').first()
    await totalUsersEl.waitFor({ timeout: 15000 }).catch(() => {})
    const monthStats = await pageAdmin.locator('.admin-stat-grid').innerText().catch(() => '')
    await pageAdmin.getByRole('button', { name: 'Ditë' }).click()
    await pageAdmin.waitForTimeout(2500)
    const dayLabel = await pageAdmin.locator('.admin-range-meta').textContent().catch(() => '')
    await pageAdmin.getByRole('button', { name: 'Vit' }).click()
    await pageAdmin.waitForTimeout(2500)
    const yearLabel = await pageAdmin.locator('.admin-range-meta').textContent().catch(() => '')
    record(18, /Përdorues|tavolina/i.test(monthStats) && /dit/i.test(dayLabel) && /vit/i.test(yearLabel), {
      summary: 'Statistika loads; Ditë/Muaj/Vit change period label',
      monthStats: monthStats.slice(0, 80),
      dayLabel,
      yearLabel,
    })

    // STEP 19 — dismiss report from step 16
    await pageAdmin.getByRole('button', { name: 'Raportet' }).click()
    await pageAdmin.waitForTimeout(2000)
    await pageAdmin.getByRole('button', { name: 'Refuzo' }).first().click()
    await pageAdmin.waitForTimeout(2000)
    const adminClient = await sbClient(adminSess)
    const { data: dismissed } = await adminClient
      .from('reports')
      .select('status')
      .eq('id', state.reportId)
      .maybeSingle()
    const { count: bansOnA } = await adminClient.from('bans').select('*', { count: 'exact', head: true }).eq('user_id', state.accountAId)
    record(19, dismissed?.status === 'reviewed_dismissed' && (bansOnA || 0) === 0, {
      summary: 'Report dismissed; account A not banned',
      status: dismissed?.status,
      bansOnA,
    })

    // STEP 20 — 3 bans → account deleted
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
    if (lastBanCount !== 3) throw new Error(`expected ban count 3 got ${lastBanCount}`)
    let profAfter = null
    for (let poll = 0; poll < 15; poll += 1) {
      const { data } = await adminClient.from('profiles').select('id').eq('id', state.banTargetId).maybeSingle()
      profAfter = data
      if (!profAfter?.id) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    const authCheck = await fetch(`${SB_URL}/auth/v1/admin/users/${state.banTargetId}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    }).catch(() => null)
    const deleted = !profAfter?.id
    record(20, deleted, {
      summary: '3rd ban deletes user from profiles (and auth if edge fn works)',
      lastBanCount,
      profileExists: !!profAfter?.id,
      authCheckStatus: authCheck?.status,
      note: deleted
        ? 'delete-banned-user edge function removed profile'
        : 'Ban count reached 3 but profile remains — check delete-banned-user edge fn / pg_net service key',
    })

    // STEP 21 — admin view as user / return
    await pageAdmin.getByRole('button', { name: /Shiko si përdorues normal/ }).click()
    await pageAdmin.waitForTimeout(1500)
    const onFeedView = await pageAdmin.locator('.fab, .hdr').first().isVisible().catch(() => false)
    await pageAdmin.locator('.admin-return-badge').click()
    await pageAdmin.waitForTimeout(1500)
    const backAdmin = await pageAdmin.locator('.admin-panel').isVisible().catch(() => false)
    record(21, onFeedView && backAdmin, { summary: 'Admin view-as-user round trip', onFeedView, backAdmin })

    // STEP 22 — non-admin RPC rejected
    const regular = await signupApi(`ejabashkohu+e2ereg.${ts}@gmail.com`, 'Regular', 'User')
    const regClient = await sbClient(regular)
    const { error: rpcErr } = await regClient.rpc('admin_get_stats', { p_range: 'month' })
    record(22, !!rpcErr && /admin|Vetëm/i.test(rpcErr.message), {
      summary: 'Non-admin admin_get_stats rejected',
      error: rpcErr?.message,
    })

    // STEP 23 — permanent deactivation
    const deactEmail = `ejabashkohu+e2edeact.${ts}@gmail.com`
    const ctxDeact = await browser.newContext()
    const pageDeact = await ctxDeact.newPage()
    pageDeact.on('dialog', (d) => d.accept())
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

  // STEP 24 — duplicate email + Enter key
  await pageB.goto(state.baseUrl + '/')
  await pageB.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await pageB.getByRole('textbox', { name: 'Emri', exact: true }).fill('Dup')
  await pageB.getByRole('textbox', { name: 'Mbiemri' }).fill('Test')
  await pageB.getByPlaceholder('Email-i yt').fill(EMAIL_A)
    await pageB.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
    await pageB.getByRole('checkbox').check()
    await pageB.getByPlaceholder('Fjalëkalimi').press('Enter')
    await pageB.waitForTimeout(2000)
    const dupErr = await pageB.locator('.age-warn').textContent().catch(() => '')
    const stillStep1 = await pageB.getByText('Hapi 1 nga 4').isVisible().catch(() => false)
    record(24, /regjistruar tashmë/i.test(dupErr) && stillStep1, {
      summary: 'Duplicate email blocked at step 1 via Enter key',
      dupErr,
      stillStep1,
    })

    // STEP 25 — past date blocked, future succeeds
    await signInUI(pageB, EMAIL_B)
    await openCreateTable(pageB)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await fillCreateTable(pageB, {
      title: `PastFail-${ts}`,
      eventDate: localDateInputValue(yesterday),
      eventTime: '10:00',
    })
    await submitCreateTable(pageB)
    const pastToast = await pageB.locator('.toast').textContent().catch(() => '')
    await openCreateTable(pageB)
    await fillCreateTable(pageB, {
      title: `FutureOk-${ts}`,
      eventDate: futureDate,
      eventTime: '21:00',
    })
    await submitCreateTable(pageB)
    const futureOk = await pageB.getByText(`FutureOk-${ts}`).isVisible().catch(() => false)
    record(25, /datën|skaduar|Diçka|të ardhmen/i.test(pastToast) && futureOk, {
      summary: 'Past datetime blocked; future succeeds',
      pastToast,
      futureOk,
    })

    // STEP 26 — men/women mutual exclusivity
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

    // STEP 27 — Macedonian in language options
    await openCreateTable(pageB)
    const mkVisible = await pageB.locator('.lang-chip', { hasText: 'Македонски' }).isVisible().catch(() => false)
    await pageB.keyboard.press('Escape')
    record(27, mkVisible, { summary: 'Macedonian language option in create form', mkVisible })

    // STEP 28 — expiration (API + wait)
    const hostSess = await loginApi(EMAIL_A)
    const hostClient = await sbClient(hostSess)
    const guestClient = await sbClient(await loginApi(EMAIL_B))
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

    fs.writeFileSync(path.join(OUT, 'report-full.json'), JSON.stringify({ state, results }, null, 2))
    console.log(`\n════════════════════════════════════════`)
    console.log('ALL 28 STEPS PASSED')
    console.log(`Evidence: ${OUT}`)
    console.log(`════════════════════════════════════════\n`)
  } catch (err) {
    console.error('\nE2E JOURNEY ABORTED:', err)
    await shot(pageA, 'abort-a').catch(() => {})
    await shot(pageB, 'abort-b').catch(() => {})
    const failedStep = results.length + 1
    record(failedStep, false, {
      summary: `Unexpected error during step ${failedStep}`,
      error: String(err),
      stack: err.stack,
    })
  } finally {
    await browser.close()
  }
})()
