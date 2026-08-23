/**
 * Screenshot Wednesday Dinner quiz steps (requires network + Supabase).
 * Run after build: npm run build && node scripts/screenshot-wednesday-quiz.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const baseUrl = process.argv[2] || 'http://127.0.0.1:4173'
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'verification', 'evidence', 'local', 'wed-quiz')
mkdirSync(outDir, { recursive: true })

const ts = Date.now()
const email = `wed-quiz-${ts}@test.local`

async function signup() {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass123!',
      data: { first_name: 'Wed', last_name: 'Quiz', age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

async function seedProfile(userId, session) {
  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  await sb.from('profiles').upsert({
    id: userId,
    first_name: 'Wed',
    last_name: 'Quiz',
    age: 28,
    verified: true,
    photo_face_ok: true,
  })
  await sb.from('taste_profiles').upsert({
    user_id: userId,
    group_size: 'mesatare',
    depth: 'thella',
    time_pref: 'mbremje',
    energy: 'mes',
    interests: ['muzike'],
    done: true,
    updated_at: new Date().toISOString(),
  })
}

function storageKey() {
  return `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`
}

async function main() {
  const session = await signup()
  await seedProfile(session.user.id, session)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 420, height: 820 } })

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
  await page.waitForTimeout(1500)

  const wedBanner = page.locator('.wed-banner')
  if (!(await wedBanner.count())) {
    console.warn('Wednesday banner not visible — check city=Prishtinë and taste profile done')
  }
  await wedBanner.first().click({ timeout: 15000 })
  await page.waitForSelector('.quiz-q', { timeout: 10000 })

  const answers = [
    'Diçka tjetër',
    'Diçka tjetër',
    'Diçka tjetër',
    'Diçka tjetër',
  ]

  for (let i = 0; i < answers.length; i++) {
    await page.waitForSelector('.quiz-q')
    const qText = await page.locator('.quiz-q').innerText()
    await page.screenshot({ path: join(outDir, `q${i + 1}-${ts}.png`), fullPage: true })
    console.log(`Screenshot Q${i + 1}: ${qText}`)
    await page.locator('.choice', { hasText: answers[i] }).click()
    await page.waitForTimeout(300)
  }

  await page.waitForSelector('.quiz-q')
  await page.waitForSelector('.lang-grid .lang-chip')
  await page.screenshot({ path: join(outDir, `q5-all-langs-${ts}.png`), fullPage: true })
  console.log('Screenshot Q5: all language chips')

  await page.locator('.lang-chip', { hasText: 'Deutsch' }).click()
  await page.screenshot({ path: join(outDir, `q5-deutsch-selected-${ts}.png`), fullPage: true })

  await page.locator('button.btn.primary', { hasText: 'Vazhdo' }).click()
  await page.waitForSelector('h2', { hasText: 'Duke të përputhur' }, { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(3000)

  const tableLangs = await page.evaluate(async ({ sbUrl, anon, token, uid }) => {
    const res = await fetch(
      `${sbUrl}/rest/v1/tables?select=langs&host_id=eq.${uid}&kind=eq.darka_e_merkures&order=created_at.desc&limit=1`,
      { headers: { apikey: anon, Authorization: `Bearer ${token}` } },
    )
    const rows = await res.json()
    return rows?.[0]?.langs ?? null
  }, { sbUrl: SB_URL, anon: ANON, token: session.access_token, uid: session.user.id })

  console.log('Created table langs (Deutsch test):', JSON.stringify(tableLangs))

  await browser.close()

  if (JSON.stringify(tableLangs) !== JSON.stringify(['de'])) {
    console.error('Expected langs ["de"], got', tableLangs)
    process.exit(1)
  }
  console.log(`Evidence saved under ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
