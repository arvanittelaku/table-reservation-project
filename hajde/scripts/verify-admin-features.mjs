/**
 * Verify Macedonian language + admin panel (requires migration applied).
 * Run: node scripts/verify-admin-features.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VERIFY_URL || 'https://abf4f943.ejabashkohu.pages.dev'
const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'

async function signup(email, firstName, lastName) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass123!',
      data: { first_name: firstName, last_name: lastName, age: 25 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
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
  await page.waitForTimeout(4000)
}

async function main() {
  const results = {}
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()

  // TEST 5 — Macedonian language chip
  try {
    const sess = await signup(`mktest${Date.now()}@test.local`, 'Mk', 'Test')
    await injectSession(page, sess)
    await page.locator('.fab').click({ force: true })
    await page.waitForTimeout(600)
    const chips = await page.locator('.sheet .ob-choice button, .sheet button.choice').filter({ hasText: /.+/ }).allTextContents()
    const langChips = await page.locator('.lang-chip').allTextContents()
    const mkChip = langChips.filter((t) => t.includes('Македонски'))
    await page.locator('.lang-chip', { hasText: 'Македонски' }).click()
    await page.locator('#f-cafe').fill('Test Kafe MK')
    await page.locator('#f-area').fill('Qendra')
    await page.locator('#f-time').fill('20:00')
    await page.locator('button', { hasText: 'Hape tavolinën' }).click()
    await page.waitForTimeout(3500)
    const sheetOpen = await page.locator('.sheet-wrap').count()
    if (sheetOpen) await page.locator('.sheet-hdr .icon-btn').first().click()
    await page.waitForTimeout(800)
    await page.locator('.card').first().click()
    await page.waitForTimeout(1500)
    const detailText = await page.locator('.sheet').innerText()
    results.lang = {
      pass: mkChip.length === 1 && langChips.length === 9 && /Shqip · Македонски/.test(detailText),
      langChipCount: langChips.length,
      hasMkChip: mkChip.length === 1,
      detailSnippet: detailText.slice(0, 400),
    }
    console.log('TEST 5 (Macedonian):', JSON.stringify(results.lang, null, 2))
  } catch (e) {
    results.lang = { pass: false, error: String(e) }
    console.log('TEST 5 FAIL:', e)
  }

  // TEST 1 — non-admin blocked
  try {
    const userSess = await signup(`noadmin${Date.now()}@test.local`, 'Regular', 'User')
    const client = createClient(SB_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${userSess.access_token}` } },
    })
    client.auth.setSession({
      access_token: userSess.access_token,
      refresh_token: userSess.refresh_token,
    })
    const { data, error } = await client.rpc('admin_get_stats', { p_range: 'month' })
    await injectSession(page, userSess)
    const adminLink = await page.locator('.admin-link').count()
    results.nonAdmin = {
      pass: !!error && adminLink === 0 && error.message.includes('admin'),
      adminLinkVisible: adminLink > 0,
      rpcError: error?.message || null,
      rpcData: data,
    }
    console.log('TEST 1 (non-admin):', JSON.stringify(results.nonAdmin, null, 2))
  } catch (e) {
    results.nonAdmin = { pass: false, error: String(e) }
    console.log('TEST 1 FAIL:', e)
  }

  // TEST 2-4 require pre-configured admin — try env ADMIN_EMAIL or skip
  const adminEmail = process.env.ADMIN_TEST_EMAIL
  const adminPass = process.env.ADMIN_TEST_PASSWORD || 'TestPass123!'
  if (adminEmail) {
    try {
      const client = createClient(SB_URL, ANON)
      const { data: login, error: loginErr } = await client.auth.signInWithPassword({
        email: adminEmail,
        password: adminPass,
      })
      if (loginErr) throw loginErr
      const { data: stats, error: statsErr } = await client.rpc('admin_get_stats', { p_range: 'month' })
      results.adminStats = {
        pass: !statsErr && stats?.totals?.total_users > 0,
        stats,
        error: statsErr?.message,
      }
      console.log('TEST 2 (admin stats):', JSON.stringify(results.adminStats, null, 2))
    } catch (e) {
      results.adminStats = { pass: false, error: String(e) }
    }
  } else {
    results.adminStats = { pass: null, skipped: 'Set ADMIN_TEST_EMAIL to run admin stats test' }
    console.log('TEST 2 skipped — no ADMIN_TEST_EMAIL')
  }

  await browser.close()
  console.log('\nSUMMARY:', Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.pass])))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
