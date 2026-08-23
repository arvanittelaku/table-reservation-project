/**
 * Verification script for bugs A–G against deployed bundle.
 * Run: node scripts/verify-bugs-AG.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.VERIFY_URL || 'https://45c971d9.ejabashkohu.pages.dev'
const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'

async function signup(email, password = 'TestPass123!', firstName = 'Test', lastName = 'User') {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      data: { first_name: firstName, last_name: lastName, age: 25 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`signup failed: ${JSON.stringify(data)}`)
  return data
}

async function injectSession(page, session) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, session }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type,
          user: session.user,
        }),
      )
    },
    { key: AUTH_KEY, session },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
}

async function answerQuiz(page, logs) {
  const choices = [
    'Të vogla (2-4 veta)',
    'Biseda të thella',
    'Paradite',
    'Introvert — dëgjues i mirë',
  ]
  for (const label of choices) {
    await page.locator('.ob-choice button', { hasText: label }).click()
    await page.waitForTimeout(350)
  }
  // interests Q5
  for (const label of ['Muzikë', 'Sport', 'Libra', 'Udhëtime', 'Art']) {
    await page.locator('.ob-choice button', { hasText: label }).click()
    await page.waitForTimeout(150)
  }
  const btnText = await page.locator('.btn.primary.full').first().textContent()
  await page.locator('.btn.primary.full').first().click()
  await page.waitForTimeout(400)
  return btnText
}

const results = {}

async function main() {
  console.log(`\n=== Verify bugs A–G @ ${BASE} ===\n`)
  console.log(`Note: ejabashkohu.com DNS did not resolve (HTTP 000); using Pages preview URL.\n`)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (t.includes('[ejaBashkohu]')) logs.push(t)
  })

  // ── BUG A: interests max 5 ──
  try {
    const emailA = `bugA${Date.now()}@test.local`
    const sessA = await signup(emailA)
    await injectSession(page, sessA)
    await page.locator('.mq-banner').click()
    await page.waitForTimeout(800)
    // jump to Q5
    await page.locator('.quiz-dot').nth(4).click()
    await page.waitForTimeout(400)
    const qText = await page.locator('.quiz-q').textContent()
    for (const label of ['Muzikë', 'Sport', 'Libra', 'Udhëtime', 'Art']) {
      await page.locator('.ob-choice button', { hasText: label }).click()
      await page.waitForTimeout(120)
    }
    const sixthBlocked = await page.locator('.ob-choice button.on', { hasText: 'Teknologji' }).count()
    await page.locator('.ob-choice button', { hasText: 'Teknologji' }).click()
    await page.waitForTimeout(200)
    const techOn = await page.locator('.ob-choice button.on', { hasText: 'Teknologji' }).count()
    const btnText = await page.locator('.btn.primary.full').first().textContent()
    results.A = {
      pass: qText.includes('deri 5') && (btnText.includes('5/5') || btnText.includes('Përfundo')) && techOn === 0,
      qText,
      btnText,
      selectedCount: await page.locator('.ob-choice button.on').count(),
      sixthBlocked: techOn === 0,
    }
    console.log('BUG A:', JSON.stringify(results.A, null, 2))
  } catch (e) {
    results.A = { pass: false, error: String(e) }
    console.log('BUG A FAIL:', e)
  }

  // ── BUG B: quiz navigation preserves forward answers ──
  try {
    logs.length = 0
    const emailB = `bugB${Date.now()}@test.local`
    const sessB = await signup(emailB)
    await injectSession(page, sessB)
    await page.locator('.mq-banner').click()
    await page.waitForTimeout(600)
    // answer all 5
    await page.locator('.ob-choice button', { hasText: 'Të vogla (2-4 veta)' }).click()
    await page.waitForTimeout(300)
    await page.locator('.ob-choice button', { hasText: 'Biseda të thella' }).click()
    await page.waitForTimeout(300)
    await page.locator('.ob-choice button', { hasText: 'Paradite' }).click()
    await page.waitForTimeout(300)
    await page.locator('.ob-choice button', { hasText: 'Introvert — dëgjues i mirë' }).click()
    await page.waitForTimeout(300)
    await page.locator('.ob-choice button', { hasText: 'Muzikë' }).click()
    await page.locator('.ob-choice button', { hasText: 'Sport' }).click()
    await page.waitForTimeout(300)
    // back to Q2 (index 1), change answer
    await page.locator('.quiz-dot').nth(1).click()
    await page.waitForTimeout(400)
    await page.locator('.ob-choice button', { hasText: 'Argëtim e lehtësi' }).click()
    await page.waitForTimeout(400)
    // forward via dots to Q3, Q4, Q5
    await page.locator('.quiz-dot').nth(2).click()
    await page.waitForTimeout(400)
    const q3 = await page.locator('.ob-choice button.on').first().textContent()
    await page.locator('.quiz-dot').nth(3).click()
    await page.waitForTimeout(400)
    const q4 = await page.locator('.ob-choice button.on').first().textContent()
    await page.locator('.quiz-dot').nth(4).click()
    await page.waitForTimeout(400)
    const q5On = await page.locator('.ob-choice button.on').count()
    const quizLogs = logs.filter((l) => l.includes('quizAnswers'))
    const lastLog = quizLogs[quizLogs.length - 1] || ''
    results.B = {
      pass:
        q3.includes('Paradite') &&
        q4.includes('Introvert') &&
        q5On >= 2 &&
        lastLog.includes('time') &&
        lastLog.includes('energy'),
      q3Selected: q3?.trim(),
      q4Selected: q4?.trim(),
      q5SelectedCount: q5On,
      lastQuizAnswersLog: lastLog,
    }
    console.log('BUG B:', JSON.stringify(results.B, null, 2))
  } catch (e) {
    results.B = { pass: false, error: String(e) }
    console.log('BUG B FAIL:', e)
  }

  // ── BUG C: profile leak on sign-out / account switch ──
  try {
    const ts = Date.now()
    const emailC1 = `bugC1${ts}@test.local`
    const emailC2 = `bugC2${ts}@test.local`
    const s1 = await signup(emailC1)
    await injectSession(page, s1)
    await page.locator('.mq-banner').click()
    await page.waitForTimeout(500)
    await page.locator('.quiz-dot').nth(4).click()
    await page.locator('.ob-choice button', { hasText: 'Muzikë' }).click()
    await page.locator('.ob-choice button', { hasText: 'Sport' }).click()
    await page.waitForTimeout(300)
    await page.locator('.link-btn', { hasText: 'Më vonë' }).click()
    await page.waitForTimeout(600)
    // sign out via profile
    await page.locator('[title="Profili im"]').click()
    await page.waitForTimeout(500)
    page.once('dialog', (d) => d.accept())
    await page.locator('button', { hasText: 'Dil nga llogaria' }).click()
    await page.waitForTimeout(2500)
    const s2 = await signup(emailC2)
    await injectSession(page, s2)
    await page.locator('.mq-banner').click()
    await page.waitForTimeout(500)
    await page.locator('.quiz-dot').nth(4).click()
    await page.waitForTimeout(300)
    const q5Selected = await page.locator('.ob-choice button.on').count()
    const avatarSrc = await page.locator('[title="Profili im"] img').getAttribute('src').catch(() => null)
    results.C = {
      pass: q5Selected === 0 && (!avatarSrc || !avatarSrc.includes('blob:')),
      q5SelectedAfterSwitch: q5Selected,
      avatarSrc: avatarSrc?.slice(0, 120) || null,
    }
    console.log('BUG C:', JSON.stringify(results.C, null, 2))
  } catch (e) {
    results.C = { pass: false, error: String(e) }
    console.log('BUG C FAIL:', e)
  }

  // ── BUG E: logout lands on hero/landing ──
  try {
    const emailE = `bugE${Date.now()}@test.local`
    const sessE = await signup(emailE)
    await injectSession(page, sessE)
    await page.waitForTimeout(5000)
    const onMain = (await page.locator('.sidebar, .content.main, .app-main .sidebar').count()) > 0
    await page.locator('[title="Profili im"]').click()
    await page.waitForTimeout(400)
    page.once('dialog', (d) => d.accept())
    await page.locator('button', { hasText: 'Dil nga llogaria' }).click()
    await page.waitForTimeout(2500)
    const landing = await page.getByRole('heading', { name: /Sonte, dikush/ }).count()
    const quizVisible = await page.locator('.quiz-q').count()
    results.E = {
      pass: landing > 0 && quizVisible === 0,
      landingVisible: landing > 0,
      quizVisible: quizVisible > 0,
      onMainBeforeLogout: onMain,
    }
    console.log('BUG E:', JSON.stringify(results.E, null, 2))
  } catch (e) {
    results.E = { pass: false, error: String(e) }
    console.log('BUG E FAIL:', e)
  }

  // ── BUG G: no women_only on vozitje form + DB ──
  try {
    const emailG = `bugG${Date.now()}@test.local`
    const sessG = await signup(emailG)
    await injectSession(page, sessG)
    await page.waitForTimeout(5000)
    await page.locator('.fab').click({ force: true })
    await page.waitForTimeout(800)
    await page.locator('button.mode-btn', { hasText: 'Vozitje' }).click()
    await page.waitForTimeout(400)
    const womenField = await page.locator('.sheet span', { hasText: 'Tavolinë vetëm për femra' }).count()
    // fill minimal form
    await page.locator('#f-tocity').selectOption({ index: 1 })
    await page.locator('#f-pickup').fill('Test pickup')
    await page.locator('#f-time, input[placeholder*="koh"]').first().fill('18:00')
    await page.locator('button', { hasText: 'Hape vozitjen' }).click()
    await page.waitForTimeout(3000)
    const token = sessG.access_token
    const uid = sessG.user.id
    const tblRes = await fetch(
      `${SB_URL}/rest/v1/tables?host_id=eq.${uid}&order=created_at.desc&limit=1&select=id,women_only,kind,category`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
    )
    const rows = await tblRes.json()
    const row = rows[0]
    results.G = {
      pass: womenField === 0 && row && (row.women_only === false || row.women_only === null) && row.kind === 'vozitje',
      womenFieldInForm: womenField,
      dbRow: row,
    }
    console.log('BUG G:', JSON.stringify(results.G, null, 2))
  } catch (e) {
    results.G = { pass: false, error: String(e) }
    console.log('BUG G FAIL:', e)
  }

  // ── BUG D: live approval update while table detail open ──
  try {
    logs.length = 0
    const ts = Date.now()
    const hostEmail = `bugDhost${ts}@test.local`
    const guestEmail = `bugDguest${ts}@test.local`
    const hostSess = await signup(hostEmail, 'TestPass123!', 'HostD', 'Driver')
    const guestSess = await signup(guestEmail, 'TestPass123!', 'GuestD', 'Rider')

    const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()
    const hostLogs = []
    const guestLogs = []
    hostPage.on('console', (m) => { if (m.text().includes('[ejaBashkohu]')) hostLogs.push(m.text()) })
    guestPage.on('console', (m) => { if (m.text().includes('[ejaBashkohu]')) guestLogs.push(m.text()) })

    await injectSession(hostPage, hostSess)
    await injectSession(guestPage, guestSess)
    await hostPage.waitForTimeout(4000)
    await guestPage.waitForTimeout(4000)

    // Host creates ride
    await hostPage.locator('.fab').click({ force: true })
    await hostPage.waitForTimeout(600)
    await hostPage.locator('button.mode-btn', { hasText: 'Vozitje' }).click()
    await hostPage.locator('#f-tocity').selectOption({ index: 2 })
    await hostPage.locator('#f-pickup').fill('Test nisja')
    await hostPage.locator('#f-time').fill('19:00')
    await hostPage.locator('button', { hasText: 'Hape vozitjen' }).click()
    await hostPage.waitForTimeout(3500)

    const token = hostSess.access_token
    const uid = hostSess.user.id
    const tblRes = await fetch(
      `${SB_URL}/rest/v1/tables?host_id=eq.${uid}&order=created_at.desc&limit=1&select=id,title,category`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
    )
    const table = (await tblRes.json())[0]

    // Guest opens host ride card by title
    const rideTitle = table?.title || ''
    const card = guestPage.locator('.card').filter({ hasText: rideTitle.split('→')[0].trim() }).first()
    if (await card.count()) await card.click()
    else await guestPage.locator('.card').filter({ hasText: 'Vozitje' }).first().click()
    await guestPage.waitForTimeout(2000)
    await guestPage.locator('button', { hasText: 'bashkohesh' }).click()
    await guestPage.waitForTimeout(2500)

    const pendingBefore = await guestPage.locator('button', { hasText: /Në pritje/i }).count()

    // Host opens table and approves
    await hostPage.locator('.card').filter({ hasText: rideTitle.split('→')[0].trim() }).first().click()
    await hostPage.waitForTimeout(1500)
    await hostPage.locator('button', { hasText: 'Prano' }).first().click()
    await hostPage.waitForTimeout(4000)

    const approvedBtn = await guestPage.locator('button', { hasText: /U aprovove|Konfirmo ulësen/i }).count()
    const channelLogs = guestLogs.filter((l) => l.includes('Membership channel'))
    results.D = {
      pass: pendingBefore > 0 && approvedBtn > 0 && channelLogs.some((l) => l.includes('SUBSCRIBED') || l.includes('Request channel update') || l.includes('Membership channel update')),
      pendingBefore,
      approvedBtn,
      channelLogs: channelLogs.slice(-5),
      tableId: table?.id,
    }
    console.log('BUG D:', JSON.stringify(results.D, null, 2))
    await hostCtx.close()
    await guestCtx.close()
  } catch (e) {
    results.D = { pass: false, error: String(e) }
    console.log('BUG D FAIL:', e)
  }

  // ── BUG F: password recovery shows set-new-password form ──
  try {
    const emailF = `bugF${Date.now()}@test.local`
    const sessF = await signup(emailF)
    const hash = `access_token=${sessF.access_token}&refresh_token=${sessF.refresh_token}&expires_in=${sessF.expires_in}&token_type=bearer&type=recovery`
    const fPage = await browser.newPage()
    await fPage.setViewportSize({ width: 390, height: 844 })
    await fPage.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' })
    await fPage.waitForTimeout(4500)
    const resetForm = await fPage.getByText('Vendos fjalëkalim të ri').count()
    const mainFeed = await fPage.locator('.sidebar').count()
    results.F = {
      pass: resetForm > 0 && mainFeed === 0,
      resetFormVisible: resetForm > 0,
      mainFeedVisible: mainFeed > 0,
      snippet: (await fPage.locator('body').innerText()).slice(0, 250),
    }
    console.log('BUG F:', JSON.stringify(results.F, null, 2))
    await fPage.close()
  } catch (e) {
    results.F = { pass: false, error: String(e) }
    console.log('BUG F FAIL:', e)
  }

  await browser.close()
  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
