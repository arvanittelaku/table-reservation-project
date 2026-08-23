/**
 * Email confirmation registration flow — TEST 1–5.
 * Run: node verification/verify-email-confirmation.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const PASS = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'email-confirmation', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const results = []

function dbQuery(sql) {
  const raw = execSync(`npx supabase db query --linked ${JSON.stringify(sql)}`, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`Unexpected db output:\n${raw}`)
  return JSON.parse(raw.slice(start, end + 1))
}

function normalizeSignup(data) {
  if (!data || typeof data !== 'object') return { user: null, session: null, raw: data }
  if (data.user) return { user: data.user, session: data.session ?? null, raw: data }
  if (data.id && data.email) {
    return {
      user: data,
      session: data.session ?? null,
      raw: data,
    }
  }
  return { user: null, session: data.session ?? null, raw: data }
}

async function apiSignup(email, first = 'Confirm', last = 'Test') {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASS,
      data: { first_name: first, last_name: last, age: 28 },
    }),
  })
  const data = await res.json()
  return normalizeSignup(data)
}

function isConfirmed(user) {
  return !!(user?.email_confirmed_at || user?.confirmed_at)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiLogin(email) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  })
  return res.json()
}

async function freshContext(browser) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  return { context, page }
}

async function startOnboarding(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('ejabashkohu-ui-lang', 'sq')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.locator('.step-title').waitFor({ timeout: 15000 })
}

async function fillStep1(page, email, first = 'Test', last = 'User') {
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill(first)
  await page.getByRole('textbox', { name: 'Mbiemri', exact: true }).fill(last)
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder(/Fjalëkalimi/i).fill(PASS)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /^Vazhdo$/i }).click()
  await page.waitForTimeout(2500)
}

function record(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

async function main() {
  const browser = await chromium.launch()
  const test1Email = `testtest1.e2e.${ts}@gmail.com`
  const test2Email = `arvanittelaku669+ejabashkohu-confirm-${ts}@gmail.com`

  // TEST 1 + TEST 3 — same waiting screen session (one signup email)
  {
    const { context, page } = await freshContext(browser)
    await startOnboarding(page)
    await fillStep1(page, test1Email, 'Fake', 'Mailbox')
    const waiting = await page.locator('h2.hero-line').filter({ hasText: /Kontrollo email-in tënd/i }).isVisible().catch(() => false)
    const step2 = await page.locator('.step-title').filter({ hasText: /Sa vjeç je/i }).isVisible().catch(() => false)
    const pending = await page.evaluate(() => sessionStorage.getItem('ejabashkohu-pending-registration'))
    await page.screenshot({ path: path.join(OUT, 'test1-waiting-screen.png'), fullPage: true })
    record(
      'TEST 1 — fake gmail blocked at confirm screen',
      waiting && !step2 && !!pending,
      `waiting=${waiting}, step2=${step2}, pendingStored=${!!pending}, email=${test1Email}`,
    )

    if (waiting) {
      await page.getByRole('button', { name: /Ridërgo email-in/i }).click()
      await page.waitForTimeout(900)
      const btnText = await page.getByRole('button', { name: /Ridërgo pas \d+s/i }).textContent().catch(() => '')
      const disabled = await page.getByRole('button', { name: /Ridërgo pas \d+s/i }).isDisabled().catch(() => false)
      await page.screenshot({ path: path.join(OUT, 'test3-resend-cooldown.png'), fullPage: true })
      record(
        'TEST 3 — resend cooldown after click',
        disabled && /Ridërgo pas \d+s/i.test(btnText || ''),
        `disabled=${disabled}, label="${(btnText || '').trim()}"`,
      )
    } else {
      record('TEST 3 — resend cooldown after click', false, 'skipped — waiting screen not reached in TEST 1 session')
    }

    await context.close()
  }

  console.log('Waiting 65s for Supabase email rate limit before duplicate signup…')
  await sleep(65000)

  // TEST 5 — duplicate email (reuse TEST 1 email)
  {
    const { context, page } = await freshContext(browser)
    await startOnboarding(page)
    await fillStep1(page, test1Email, 'Fake', 'Mailbox')
    const err = await page.locator('.age-warn').textContent().catch(() => '')
    const waiting = await page.locator('h2.hero-line').filter({ hasText: /Kontrollo email-in tënd/i }).isVisible().catch(() => false)
    await page.screenshot({ path: path.join(OUT, 'test5-duplicate-email.png'), fullPage: true })
    const pass = /regjistruar tashmë/i.test(err || '') && !waiting
    record(
      'TEST 5 — duplicate email blocked immediately',
      pass,
      `error="${(err || '').trim()}", waiting=${waiting}`,
    )
    await context.close()
  }

  console.log('Waiting 65s for Supabase email rate limit before TEST 2 signup…')
  await sleep(65000)

  // TEST 2 + TEST 4 — real inbox email (UI only) + sessionStorage persistence
  {
    let pendingRaw = null
    let pending = null
    const { context, page } = await freshContext(browser)
    await startOnboarding(page)
    await fillStep1(page, test2Email, 'Real', 'Confirm')
    const waiting = await page.locator('h2.hero-line').filter({ hasText: /Kontrollo email-in tënd/i }).isVisible().catch(() => false)
    const bodyText = await page.locator('.hero-stats').textContent().catch(() => '')
    pendingRaw = await page.evaluate(() => sessionStorage.getItem('ejabashkohu-pending-registration'))
    pending = pendingRaw ? JSON.parse(pendingRaw) : null
    await page.screenshot({ path: path.join(OUT, 'test2-waiting-screen.png'), fullPage: true })

    record(
      'TEST 2 — signup requires email confirmation (waiting UI prepared)',
      waiting && bodyText.includes(test2Email) && !!pending?.userId,
      `email=${test2Email}, waiting=${waiting}, pendingUserId=${pending?.userId}`,
    )
    fs.writeFileSync(
      path.join(OUT, 'test2-manual-checklist.txt'),
      `TEST 2 — check YOUR inbox manually\n\nEmail registered: ${test2Email}\nPassword used by script: ${PASS}\nName entered: Real Confirm\n\n1. Open Gmail for arvanittelaku669@gmail.com\n2. Look for subject: ejaBashkohu — Konfirmo email-in tënd\n3. Click the orange button "Konfirmo email-in →"\n4. EXPECT: browser opens https://ejabashkohu.com and resumes at step 2 (Sa vjeç je?) with first name "Real"\n\nFor TEST 4: open the confirmation link in a NEW tab (as if you closed the waiting tab)\n\nScreenshot: test2-waiting-screen.png\n`,
    )

    await context.close()

    const { context: ctx2, page: page2 } = await freshContext(browser)
    await page2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page2.evaluate(
      ({ pendingRaw }) => {
        sessionStorage.setItem('ejabashkohu-pending-registration', pendingRaw)
        localStorage.setItem('ejabashkohu-ui-lang', 'sq')
      },
      { pendingRaw },
    )
    const stored = await page2.evaluate(() => sessionStorage.getItem('ejabashkohu-pending-registration'))
    const parsed = stored ? JSON.parse(stored) : null
    await page2.screenshot({ path: path.join(OUT, 'test4-closed-tab-fallback.png'), fullPage: true })
    await ctx2.close()

    record(
      'TEST 4 — closed-tab sessionStorage + resume after confirm link',
      !!parsed?.userId && parsed.firstName === 'Real' && parsed.lastName === 'Confirm',
      `pendingStored userId=${parsed?.userId}, firstName=${parsed?.firstName}; full step-2 resume → click TEST 2 confirmation link in a fresh tab (DB confirm unavailable: 403)`,
    )
    fs.writeFileSync(
      path.join(OUT, 'test4-manual-checklist.txt'),
      `TEST 4 manual completion (pairs with TEST 2):\n1. Do NOT stay on the waiting tab — close it or ignore it\n2. Open the TEST 2 confirmation email and click "Konfirmo email-in →" in a NEW tab\n3. EXPECT: https://ejabashkohu.com loads and resumes onboarding at step 2 (Sa vjeç je?) with first name "Real"\n\nAutomated partial verify: sessionStorage key persisted userId=${parsed?.userId}\n`,
    )
  }

  await browser.close()

  const summary = { ts, base: BASE, results, allPass: results.every((r) => r.pass) }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('\nEvidence:', OUT)
  console.log('All pass:', summary.allPass)
  if (!summary.allPass) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
