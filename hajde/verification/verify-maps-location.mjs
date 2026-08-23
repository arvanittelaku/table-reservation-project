/**
 * Location / maps_link verification — 7 tests
 * node verification/verify-maps-location.mjs [APP_URL]
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  isValidMapsLink,
  mapsUrlForTable,
  wednesdayMapsUrl,
} from '../src/lib/eventSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'maps-location', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const APP = (process.argv[2] || process.env.APP_URL || 'https://ejabashkohu.com').replace(/\/$/, '')
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const PASSWORD = process.env.TEST_PASSWORD || 'testpass123'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ejaBashkohu1@@'

/** Real Google Maps place link for Soma Book Station, Prishtinë */
const SOMA_MAPS_LINK =
  'https://www.google.com/maps/place/Soma+Book+Station/@42.6629038,21.1613769,17z/data=!3m1!4b1!4m6!3m5!1s0x13549f203b5a5a5b:0x8c8c8c8c8c8c8c8c!8m2!3d42.6629038!4d21.1639518!16s%2Fg%2F11b6g3x0xq'

const report = { ts, app: APP, outDir: OUT, tests: {} }

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: p, fullPage: true })
  return p
}

function sb() {
  return createClient(SUPABASE_URL, ANON_KEY)
}

async function authClient(email, password = PASSWORD, meta = {}) {
  const client = sb()
  let { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    ;({ data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: meta },
    }))
    if (error) throw error
    if (!data.session) {
      ;({ data, error } = await client.auth.signInWithPassword({ email, password }))
      if (error) throw error
    }
  }
  if (meta.first_name) {
    await client.from('profiles').upsert({
      id: data.user.id,
      first_name: meta.first_name,
      last_name: meta.last_name || 'Test',
      age: meta.age || 25,
    })
  }
  return { client, userId: data.user.id }
}

async function loginUI(page, email, password) {
  await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 90000 })
  const hyr = page.locator('.landing-nav .btn.ghost.sm')
  if (await hyr.isVisible().catch(() => false)) await hyr.click()
  await page.waitForTimeout(600)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('.ob-card .input-password-wrap input').first().fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForTimeout(6000)
  const viewAsUser = page.locator('button.btn.ghost', { hasText: 'Shiko si përdorues normal' })
  if (await viewAsUser.isVisible().catch(() => false)) {
    await viewAsUser.click()
    await page.waitForTimeout(3000)
  }
  await page.evaluate(() => document.querySelector('.admin-return-badge')?.remove())
}

async function openCreateForm(page) {
  await page.getByRole('button', { name: /Hap tavolin/i }).first().click()
  await page.locator('#f-maps').waitFor({ timeout: 15000 })
}

async function fillMinimalTable(page, { mapsLink, cafe = 'Verify Cafe Maps' }) {
  await page.locator('#f-cafe').fill(cafe)
  await page.locator('#f-area').fill('Qendra')
  await page.locator('#f-maps').fill(mapsLink)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const yyyy = tomorrow.getFullYear()
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
  const dd = String(tomorrow.getDate()).padStart(2, '0')
  await page.locator('#f-event-date').fill(`${yyyy}-${mm}-${dd}`)
  await page.locator('#f-event-time').fill('18:00')
}

async function getLatestTableByHost(client, hostId, title) {
  const { data, error } = await client
    .from('tables')
    .select('id, title, maps_link, city, area, created_at')
    .eq('host_id', hostId)
    .eq('title', title)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

async function main() {
  report.unit = {
    emptyInvalid: isValidMapsLink('') === false,
    exampleInvalid: isValidMapsLink('https://example.com') === false,
    googleValid: isValidMapsLink('https://www.google.com/maps/place/test') === true,
    gooGlValid: isValidMapsLink('https://maps.app.goo.gl/abc123') === true,
  }

  let browser
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    report.browser = 'msedge'
  } catch {
    browser = await chromium.launch({ headless: true })
    report.browser = 'chromium'
  }

  const context = await browser.newContext({ locale: 'sq-AL', viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    localStorage.setItem('ejabashkohu-ui-lang', 'sq')
  })
  const page = await context.newPage()

  const testEmail = ADMIN_EMAIL
  const testPassword = ADMIN_PASSWORD
  const { client, userId } = await authClient(testEmail, testPassword)

  await loginUI(page, testEmail, testPassword)

  await openCreateForm(page)
  await fillMinimalTable(page, { mapsLink: '', cafe: `Blocked Empty ${ts}` })
  await page.getByRole('button', { name: /Hape tavolin/i }).click()
  await page.waitForTimeout(800)
  const toastEmpty = await page.locator('.toast').textContent().catch(() => '')
  const blockedEmptyRow = await getLatestTableByHost(client, userId, `Blocked Empty ${ts}`)
  report.tests.test1_empty = {
    toast: toastEmpty,
    blocked: !blockedEmptyRow && /Google Maps/i.test(toastEmpty || ''),
    pass: !blockedEmptyRow && /Google Maps/i.test(toastEmpty || ''),
  }

  await page.locator('#f-maps').fill('https://example.com/not-google')
  await page.getByRole('button', { name: /Hape tavolin/i }).click()
  await page.waitForTimeout(800)
  const toastInvalid = await page.locator('.toast').textContent().catch(() => '')
  report.tests.test1_invalid = {
    toast: toastInvalid,
    blocked: /Google Maps/i.test(toastInvalid || ''),
    pass: /Google Maps/i.test(toastInvalid || ''),
  }
  report.tests.test1 = {
    pass: report.tests.test1_empty.pass && report.tests.test1_invalid.pass,
  }
  await shot(page, 'test1-blocked')

  await page.locator('#f-maps').fill(SOMA_MAPS_LINK)
  await page.locator('#f-cafe').fill(`Maps OK ${ts}`)
  await page.getByRole('button', { name: /Hape tavolin/i }).click()
  await page.waitForTimeout(2500)
  const createdRow = await getLatestTableByHost(client, userId, `Maps OK ${ts}`)
  report.tests.test2 = {
    created: !!createdRow,
    maps_link: createdRow?.maps_link ?? null,
    mapsLinkValid: isValidMapsLink(createdRow?.maps_link),
    pass: !!createdRow && isValidMapsLink(createdRow?.maps_link),
  }
  await shot(page, 'test2-created')

  if (createdRow) {
    await page.locator('.card', { hasText: `Maps OK ${ts}` }).first().click()
    await page.waitForTimeout(1200)
    const href = await page.locator('a', { hasText: 'Hape në hartë' }).getAttribute('href')
    report.tests.test3 = {
      href,
      matchesStoredLink: href === createdRow.maps_link,
      pass: href === createdRow.maps_link && isValidMapsLink(href),
    }
    await shot(page, 'test3-table-detail')
    const mapPage = await context.newPage()
    await mapPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await mapPage.waitForTimeout(4000)
    await mapPage.screenshot({ path: path.join(OUT, 'test3-google-maps.png'), fullPage: true })
    const mapUrl = mapPage.url()
    const mapTitle = await mapPage.title().catch(() => '')
    report.tests.test3.mapPage = { url: mapUrl, title: mapTitle }
    report.tests.test3.pass =
      report.tests.test3.pass &&
      /google\.[a-z.]+\/maps|maps\.google/i.test(mapUrl)
    await mapPage.close().catch(() => {})
  } else {
    report.tests.test3 = { pass: false, error: 'no created table' }
  }

  const distanceBtn = page.locator('button.loc-link', { hasText: 'Sa larg është nga unë?' })
  report.tests.test4 = {
    distanceButtonCount: await distanceBtn.count(),
    pass: (await distanceBtn.count()) === 0,
  }
  await context.setGeolocation({ latitude: 42.3803, longitude: 20.4310 })
  await context.grantPermissions(['geolocation'])
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  report.tests.test4.locationBannerDetected = await page.locator('.location-banner').isVisible().catch(() => false)
  await shot(page, 'test4-no-distance')

  const dinnerFar = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  dinnerFar.setHours(20, 0, 0, 0)
  const { data: groupFar, error: gFarErr } = await client.rpc('create_wednesday_dinner_group', {
    p_city: 'Prishtinë',
    p_dinner_date: dinnerFar.toISOString(),
  })
  if (gFarErr) {
    report.tests.test5 = { pass: false, error: gFarErr.message }
    report.tests.test6 = { pass: false, skipped: true }
  } else {
    await client.from('wednesday_participants').upsert({ group_id: groupFar, user_id: userId })
    const { data: locked } = await client.rpc('get_wednesday_restaurant', { p_group: groupFar })
    report.tests.test5 = {
      revealed: locked?.revealed,
      pass: locked?.revealed === false,
    }

    const dinnerNear = new Date(Date.now() + 12 * 60 * 60 * 1000)
    const { data: groupNear, error: gNearErr } = await client.rpc('create_wednesday_dinner_group', {
      p_city: 'Prishtinë',
      p_dinner_date: dinnerNear.toISOString(),
    })
    if (gNearErr) throw gNearErr
    await client.from('wednesday_participants').upsert({ group_id: groupNear, user_id: userId })
    const { data: revealedRest } = await client.rpc('get_wednesday_restaurant', { p_group: groupNear })
    const expectedHref = wednesdayMapsUrl(revealedRest)
    report.tests.test6 = {
      restaurant: revealedRest,
      expectedHref,
      usesPlaceholder: /Restoranti sekret/i.test(expectedHref),
      pass:
        revealedRest?.revealed === true &&
        !/Restoranti sekret/i.test(expectedHref) &&
        /google\.[a-z.]+\/maps/i.test(expectedHref),
    }
  }

  const legacyUrl = mapsUrlForTable({
    cafe: 'Legacy Cafe',
    area: 'Qendra',
    city: 'Prishtinë',
    cat: 'kafe',
    mapsLink: '',
  })
  report.tests.test7 = {
    legacyUrl,
    isSearchFallback: legacyUrl.includes('/maps/search/'),
    pass: legacyUrl.includes('/maps/search/') && !legacyUrl.includes('Restoranti+sekret'),
  }

  const { data: oldRows } = await client.from('tables').select('id, title, maps_link').is('maps_link', null).limit(1)
  report.tests.test7.oldNullRowSample = oldRows?.[0] ?? null

  report.allPass = Object.entries(report.tests)
    .filter(([k]) => /^test\d/.test(k))
    .every(([, t]) => t.pass)
  report.unitPass = Object.values(report.unit).every(Boolean)

  save('report.json', report)
  await browser.close()
  console.log(JSON.stringify(report, null, 2))
  if (!report.allPass || !report.unitPass) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
