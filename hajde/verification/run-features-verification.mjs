/**
 * Feature verification TEST 1-6 — evidence to verification/evidence/local/
 * Run: node verification/run-features-verification.mjs http://localhost:5173
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '')
const OUT = path.join(__dirname, 'evidence', 'local', 'features')
const ts = Date.now()
const PASSWORD = 'testpass123'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''

fs.mkdirSync(OUT, { recursive: true })
const report = { base: BASE, ts, tests: {} }

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  process.stderr.write(line + '\n')
  fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n')
}

function save(name, obj) {
  fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2))
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  return p
}

function sbClient() {
  return createClient(SUPABASE_URL, ANON_KEY)
}

async function signUpUser(email, firstName = 'Test', lastName = 'User') {
  const sb = sbClient()
  const { data, error } = await sb.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { first_name: firstName, last_name: lastName } },
  })
  if (error) throw error
  return { sb, user: data.user, session: data.session }
}

async function signInUser(email) {
  const sb = sbClient()
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return { sb, user: data.user, session: data.session }
}

async function test1WednesdayReveal() {
  log('TEST 1 — Wednesday restaurant reveal gate')
  const email = `ejabashkohu+wed.${ts}@gmail.com`
  const { sb, user } = await signUpUser(email, 'Wed', 'Test')
  if (!user?.id) throw new Error('No user id after signup')

  const { data: rest } = await sb.from('wednesday_restaurants').select('id').limit(1)
  // restaurants not exposed to client — use RPC create instead
  const dinnerFar = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  dinnerFar.setHours(20, 0, 0, 0)

  const { data: groupId, error: createErr } = await sb.rpc('create_wednesday_dinner_group', {
    p_city: 'Prishtinë',
    p_dinner_date: dinnerFar.toISOString(),
    p_user_ids: [user.id],
  })
  if (createErr) throw createErr

  const { data: locked, error: rpcErr1 } = await sb.rpc('get_wednesday_restaurant', { p_group: groupId })
  if (rpcErr1) throw rpcErr1

  const lockedRow = locked?.[0]
  save('test1-locked.json', lockedRow)

  const dinnerNear = new Date(Date.now() + 12 * 60 * 60 * 1000)
  // Update via service — use raw SQL through second client won't work; use rpc workaround:
  // Host can't update dinner_date via RLS — need admin. Use signIn and check if update works... it won't.
  // Use supabase service role if available, else document MCP update separately.

  report.tests.test1 = {
    locked: lockedRow,
    lockedPass: lockedRow?.revealed === false && lockedRow?.name == null,
  }

  // Update dinner_date via authenticated won't work — call from MCP in parallel script
  return { groupId, userId: user.id, email, lockedRow }
}

async function test1RevealUpdate(groupId, userId) {
  // Called after MCP updates dinner_date
  const email = `ejabashkohu+wed.${ts}@gmail.com`
  const { sb } = await signInUser(email)
  const { data: revealed, error } = await sb.rpc('get_wednesday_restaurant', { p_group: groupId })
  if (error) throw error
  save('test1-revealed.json', revealed?.[0])
  report.tests.test1.revealed = revealed?.[0]
  report.tests.test1.revealedPass =
    revealed?.[0]?.revealed === true && !!revealed?.[0]?.name && !!revealed?.[0]?.address
}

async function test2LocationBanner(page) {
  log('TEST 2 — Location banner Gjakovë')
  const email = `ejabashkohu+geo.${ts}@gmail.com`
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill('Geo')
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill('Test')
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()

  // Skip full onboard — sign in existing if needed; for geo test use sign-in flow
  // Simpler: use context with geolocation before goto after sign-in

  await page.context().setGeolocation({ latitude: 42.3803, longitude: 20.4310 })
  await page.context().grantPermissions(['geolocation'])

  // Sign in via UI if we completed reg — for speed use minimal path
  await page.goto(BASE + '/')
  // Use sign-in modal
  const signInBtn = page.getByRole('button', { name: /Hyr/i }).first()
  if (await signInBtn.isVisible().catch(() => false)) {
    await signInBtn.click()
    await page.getByPlaceholder('Email-i yt').fill(email)
    await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
    await page.getByRole('button', { name: 'Hyr' }).click()
  }

  await page.waitForTimeout(3000)
  const banner = page.locator('.location-banner')
  const bannerVisible = await banner.isVisible().catch(() => false)
  if (bannerVisible) {
    await shot(page, 'test2-banner')
    await page.getByRole('button', { name: 'Po, tregoma' }).click()
    await page.waitForTimeout(500)
    await shot(page, 'test2-city-gjakove')
    const gjakovaChip = page.locator('.chip.city.on', { hasText: 'Gjakovë' })
    report.tests.test2 = {
      bannerVisible: true,
      citySelected: await gjakovaChip.isVisible().catch(() => false),
    }
  } else {
    await shot(page, 'test2-no-banner')
    report.tests.test2 = { bannerVisible: false, note: 'Banner not visible — may need completed auth feed' }
  }
}

async function main() {
  if (!ANON_KEY) {
    log('Missing VITE_SUPABASE_ANON_KEY')
    process.exit(1)
  }

  log(`Base URL: ${BASE}`)

  // TEST 1 part A
  const t1 = await test1WednesdayReveal()
  log(`TEST 1 locked RPC: ${JSON.stringify(t1.lockedRow)}`)

  save('test1-group-id.txt', t1.groupId)
  save('report-partial.json', report)
  log('Partial run done — run MCP update for dinner_date then test1RevealUpdate')
}

main().catch((err) => {
  log(`FATAL: ${err.message}`)
  console.error(err)
  process.exit(1)
})
