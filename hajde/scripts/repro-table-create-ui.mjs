/**
 * Playwright: reproduce table create via UI, capture network error.
 * Run: npm run build && npm run preview -- --port 4173 &
 *      node scripts/repro-table-create-ui.mjs http://127.0.0.1:4173
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const baseUrl = process.argv[2] || 'http://127.0.0.1:4173'
const ts = Date.now()

async function signup() {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `ui-table-${ts}@test.local`,
      password: 'TestPass123!',
      data: { first_name: 'Ui', last_name: 'Create', age: 28 },
    }),
  })
  return res.json()
}

function storageKey() {
  return `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`
}

async function main() {
  const session = await signup()
  if (!session.access_token) throw new Error(JSON.stringify(session))

  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  await sb.from('profiles').upsert({
    id: session.user.id,
    first_name: 'Ui',
    last_name: 'Create',
    age: 28,
    verified: true,
    photo_face_ok: true,
  })
  await sb.from('taste_profiles').upsert({
    user_id: session.user.id,
    group_size: 'mesatare',
    depth: 'thella',
    time_pref: 'mbremje',
    energy: 'mes',
    interests: ['muzike'],
    done: true,
    updated_at: new Date().toISOString(),
  })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  const networkLog = []
  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('/rest/v1/tables') && res.request().method() === 'POST') {
      let body = null
      try { body = await res.json() } catch { body = await res.text() }
      networkLog.push({
        url,
        status: res.status(),
        requestBody: res.request().postData(),
        responseBody: body,
      })
    }
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('BROWSER CONSOLE ERROR:', msg.text())
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, sess }) => {
    localStorage.setItem(key, JSON.stringify(sess))
  }, {
    key: storageKey(),
    sess: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: 'bearer',
      user: session.user,
    },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Open create sheet via FAB
  await page.locator('.fab').click({ timeout: 15000 })
  await page.waitForSelector('#f-cafe', { timeout: 10000 })

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dateStr = tomorrow.toISOString().split('T')[0]

  await page.fill('#f-cafe', `UiTest Cafe ${ts}`)
  await page.fill('#f-event-date', dateStr)
  await page.fill('#f-event-time', '20:00')

  const toastPromise = page.waitForFunction(
    () => document.querySelector('.toast')?.textContent?.length > 0,
    { timeout: 15000 },
  )

  await page.locator('button.btn.primary.full', { hasText: 'Hape tavolinën' }).click()
  await toastPromise
  const toast = await page.locator('.toast').innerText()
  console.log('Toast text:', toast)
  console.log('Network POST /tables:', JSON.stringify(networkLog, null, 2))

  await browser.close()
  if (networkLog.some((n) => n.status >= 400)) process.exit(1)
  if (!toast.includes('u hap')) {
    console.error('Expected success toast, got:', toast)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
