/**
 * Verify admin stats range filter + loading (BUG 1/2).
 * Run: node scripts/verify-admin-stats-range.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'fs'
import { join } from 'path'

const BASE = process.env.VERIFY_URL || 'https://4099876e.ejabashkohu.pages.dev'
const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ejaBashkohu1@@'
const SHOT_DIR = join('scripts', 'screenshots', 'admin-stats-range')
mkdirSync(SHOT_DIR, { recursive: true })

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
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

async function rpcCompare() {
  const c = createClient(SB_URL, ANON)
  const { data: auth } = await c.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  await c.auth.setSession({
    access_token: auth.session.access_token,
    refresh_token: auth.session.refresh_token,
  })
  const out = {}
  for (const r of ['day', 'month', 'year']) {
    const t0 = performance.now()
    const { data, error } = await c.rpc('admin_get_stats', { p_range: r })
    out[r] = {
      ms: Math.round(performance.now() - t0),
      error: error?.message || null,
      buckets: (data?.new_users || []).length,
      sample: (data?.new_users || []).slice(0, 3),
      rangeField: data?.range || null,
    }
  }
  return out
}

async function chartSignature(page) {
  return page.evaluate(() => {
    const cols = [...document.querySelectorAll('.admin-stats-content .admin-bar-col')]
    return cols.map((col) => {
      const val = col.querySelector('.admin-bar-val')?.textContent?.trim() || ''
      const lbl = col.querySelector('.admin-bar-lbl')?.textContent?.trim() || ''
      return `${lbl}:${val}`
    }).join('|')
  })
}

async function main() {
  console.log(`Verify URL: ${BASE}\n`)

  console.log('=== SQL/RPC comparison (direct) ===')
  const rpc = await rpcCompare()
  console.log(JSON.stringify(rpc, null, 2))

  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()

  const adminSess = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  await injectSession(page, adminSess)

  const ranges = [
    { label: 'Ditë', key: 'day', file: 'range-day.png' },
    { label: 'Muaj', key: 'month', file: 'range-month.png' },
    { label: 'Vit', key: 'year', file: 'range-year.png' },
  ]

  const ui = {}
  let networkMs = null

  page.on('response', async (resp) => {
    if (!resp.url().includes('/rpc/admin_get_stats')) return
    const timing = resp.request().timing()
    if (timing) networkMs = Math.round(timing.responseEnd)
  })

  for (const r of ranges) {
    await page.getByRole('button', { name: r.label, exact: true }).click()
    await page.waitForSelector('.admin-stats-content', { timeout: 15000 })
    await page.waitForTimeout(800)
    const sig = await chartSignature(page)
    const barCount = sig ? sig.split('|').filter(Boolean).length : 0
    await page.screenshot({ path: join(SHOT_DIR, r.file), fullPage: true })
    ui[r.key] = { barCount, chartSignature: sig }
    console.log(`UI ${r.key}: bars=${barCount} sig=${sig.slice(0, 120)}`)
  }

  const passRange =
    ui.day?.barCount > 1 &&
    ui.month?.barCount >= 1 &&
    ui.year?.barCount >= 1 &&
    ui.day.chartSignature !== ui.month.chartSignature &&
    ui.month.chartSignature !== ui.year.chartSignature

  console.log('\n=== SUMMARY ===')
  console.log('RPC buckets day/month/year:', rpc.day.buckets, rpc.month.buckets, rpc.year.buckets)
  console.log('UI bar counts day/month/year:', ui.day?.barCount, ui.month?.barCount, ui.year?.barCount)
  console.log('Range filter UI test:', passRange ? 'PASS' : 'FAIL')
  console.log('Screenshots:', SHOT_DIR)

  await browser.close()
  process.exit(passRange ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
