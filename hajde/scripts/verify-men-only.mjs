/**
 * Verify men_only table option + mutual exclusivity with women_only.
 * Run: node scripts/verify-men-only.mjs [previewUrl]
 *
 * Requires migration 20260816170000_men_only.sql applied.
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { localDateInputValue } from '../src/lib/eventSchedule.js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const previewUrl = process.argv[2] || 'http://127.0.0.1:4173'
const ts = Date.now()
let failed = 0

function pass(label, ok, detail = '') {
  if (ok) console.log(`PASS  ${label}${detail ? `: ${detail}` : ''}`)
  else {
    failed++
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ''}`)
  }
}

async function signup(prefix = 'men-only') {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${prefix}-${ts}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      password: 'TestPass123!',
      data: { first_name: 'Men', last_name: 'Only', age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

function storageKey() {
  return `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`
}

async function seedProfile(session) {
  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  await sb.from('profiles').upsert({
    id: session.user.id,
    first_name: 'Men',
    last_name: 'Only',
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
  return sb
}

async function createMenOnlyTable(sb, hostId, title) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(20, 0, 0, 0)
  const eventDatetime = new Date(`${localDateInputValue(tomorrow)}T20:00`).toISOString()
  return sb.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Nesër, 20:00',
    event_datetime: eventDatetime,
    starts_at: eventDatetime,
    spots: 4,
    langs: ['sq'],
    tags: ['Vetëm meshkuj'],
    description: 'Men-only verify table',
    women_only: false,
    men_only: true,
    host_id: hostId,
  }).select('id, women_only, men_only, title').single()
}

async function main() {
  const session = await signup()
  const sb = await seedProfile(session)

  // TEST 2 — DB insert men_only
  console.log('\n=== TEST 2 DB men_only ===')
  const marker = `MenOnlyCafe-${ts}`
  const { data: row, error: insertErr } = await createMenOnlyTable(sb, session.user.id, marker)
  if (insertErr?.message?.includes('men_only')) {
    console.error('MIGRATION REQUIRED: run hajde/supabase/migrations/20260816170000_men_only.sql')
    process.exit(1)
  }
  pass('insert men_only table', !insertErr && row?.men_only === true, insertErr?.message || JSON.stringify(row))
  pass('women_only false when men_only true', row?.women_only === false)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  await page.goto(previewUrl, { waitUntil: 'networkidle' })
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

  // TEST 1 — mutual exclusivity in form
  console.log('\n=== TEST 1 form toggles ===')
  await page.locator('.fab').click({ timeout: 15000 })
  await page.waitForSelector('.gender-restriction-options', { timeout: 10000 })
  const womenLabel = page.locator('.gender-restriction-options span', { hasText: 'Tavolinë vetëm për femra' })
  const menLabel = page.locator('.gender-restriction-options span', { hasText: 'Tavolinë vetëm për meshkuj' })
  pass('women checkbox visible', await womenLabel.count() === 1)
  pass('men checkbox visible', await menLabel.count() === 1)

  const womenInput = page.locator('.gender-restriction-options input[type="checkbox"]').first()
  const menInput = page.locator('.gender-restriction-options input[type="checkbox"]').nth(1)
  await womenInput.check()
  pass('women checked', await womenInput.isChecked())
  pass('men auto-unchecked when women selected', !(await menInput.isChecked()))
  await menInput.check()
  pass('men checked', await menInput.isChecked())
  pass('women auto-unchecked when men selected', !(await womenInput.isChecked()))

  await page.screenshot({ path: `verification/evidence/local/men-only-form-${ts}.png`, fullPage: true })

  // TEST 5 — vozitje hides gender options
  console.log('\n=== TEST 5 vozitje/udhëtim unaffected ===')
  await page.locator('.mode-btn', { hasText: 'Vozitje' }).click()
  pass('no gender options on vozitje', await page.locator('.gender-restriction-options').count() === 0)
  await page.locator('.mode-btn', { hasText: 'Udhëtim' }).click()
  pass('no gender options on udhëtim', await page.locator('.gender-restriction-options').count() === 0)

  // TEST 4 — sign out clears form (second account)
  console.log('\n=== TEST 4 form reset on account switch ===')
  const sessionB = await signup('men-only-b')
  await seedProfile(sessionB)
  await page.evaluate(({ key, sess }) => {
    localStorage.setItem(key, JSON.stringify(sess))
  }, {
    key: storageKey(),
    sess: {
      access_token: sessionB.access_token,
      refresh_token: sessionB.refresh_token,
      expires_at: sessionB.expires_at,
      expires_in: sessionB.expires_in,
      token_type: 'bearer',
      user: sessionB.user,
    },
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('.fab').click()
  await page.waitForSelector('.gender-restriction-options')
  const menCheckedAfterSwitch = await page.locator('.gender-restriction-options input[type="checkbox"]').nth(1).isChecked()
  pass('men_only not carried to new account', !menCheckedAfterSwitch)

  await browser.close()

  // TEST 3 — badge in feed data
  console.log('\n=== TEST 3 badge via API row mapping ===')
  const { data: feedRow } = await sb.from('tables').select('women_only, men_only, title').eq('id', row.id).single()
  pass('DB men_only true for badge source', feedRow?.men_only === true)
  pass('DB women_only false', feedRow?.women_only === false)

  console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests PASS')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
