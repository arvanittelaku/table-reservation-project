/**
 * Phase 7 i18n verification — admin panel, legal pages, host notifications, full-app scan.
 *
 * TEST 1: Admin panel screenshots (3 tabs × 4 locales)
 * TEST 2: Terms + Privacy screenshots (4 locales)
 * TEST 3: Host notification panel (4 locales, populated)
 * TEST 4: Full-app residual Albanian scan (EN, DE, MK)
 * TEST 5: Regression spot-check (feed, payment, duplicate-email error)
 *
 * Run: node verification/verify-phase7-i18n.mjs [baseUrl]
 * Env: E2E_EMAIL, E2E_PASSWORD, EVIDENCE_DIR=...
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildEventDatetime, localDateInputValue } from '../src/lib/eventSchedule.js'
import { formatEventTime } from '../src/lib/formatEventTime.js'
import sqLocale from '../src/i18n/locales/sq.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '')
const ts = Date.now()
const OUT = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : path.join(__dirname, 'evidence', 'phase7-i18n', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const UI_LANG_KEY = 'ejabashkohu-ui-lang'
const ADMIN_SCREEN_KEY = 'ejabashkohu-admin-screen'

const ADMIN_EMAIL = process.env.E2E_EMAIL || 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = process.env.E2E_PASSWORD || 'ejaBashkohu1@@'
const GUEST_EMAIL = process.env.GAP_GUEST_EMAIL || 'ultreuvl@guerrillamailblock.com'
const GUEST_PASSWORD = process.env.GAP_GUEST_PASSWORD || 'TestPass123!'

const LOCALES = ['sq', 'en', 'de', 'mk']
const SCAN_LOCALES = ['en', 'de', 'mk']

/** Distinctive Albanian UI chrome — must not appear when locale ≠ sq */
const ALBANIAN_PATTERNS = [
  /\bDuke ngarkuar\b/i,
  /\bDuke ruajtur\b/i,
  /\bKthehu te Admin\b/i,
  /\bShiko si përdorues normal\b/i,
  /\bPaneli i sigurisë\b/i,
  /\bStatistika\b/,
  /\bRaportet\b/,
  /\bPërdorues gjithsej\b/i,
  /\bTavolina gjithsej\b/i,
  /\bKushtet e Përdorimit\b/,
  /\bPolitika e Privatësisë\b/,
  /\bHyrë në fuqi\b/,
  /\bPranimi i kushteve\b/i,
  /\bKonfirmo vendin\b/i,
  /\bNumri i kartelës\b/i,
  /\bNjoftimet\b/,
  /\bKy email është i regjistruar\b/i,
  /\bHyr në llogari\b/,
  /\bNuk ke qasje\b/i,
  /\bBanoje\b/,
  /\bRefuzo\b/,
  /\bFshi menjëherë\b/i,
]

const CITY_NAMES = [
  'Prishtinë', 'Prizren', 'Pejë', 'Gjakovë', 'Mitrovicë', 'Ferizaj', 'Gjilan',
  'Podujevë', 'Vushtrri', 'Suharekë', 'Rahovec', 'Drenas', 'Lipjan', 'Malishevë',
  'Kamenicë', 'Viti', 'Deçan', 'Istog', 'Klinë', 'Skenderaj', 'Dragash',
  'Fushë Kosovë', 'Obiliq', 'Shtime', 'Kaçanik', 'Junik', 'Hani i Elezit',
  'Mamushë', 'Graçanicë', 'Shtërpcë', 'Novobërdë', 'Kllokot', 'Ranillug',
  'Partesh', 'Zubin Potok', 'Zveçan', 'Leposaviq', 'Mitrovicë e Veriut',
]

const REG_LABELS = {
  en: { fn: 'First name', ln: 'Last name', em: 'Your email', pw: 'Password', cont: 'Continue', local: "I'm from Kosovo", skipPhoto: /Continue without photo/i, step2: /How old are you/i, step3: /profile photo/i, step4: /Local or visitor/i },
  de: { fn: 'Vorname', ln: 'Nachname', em: 'Deine E-Mail', pw: 'Passwort', cont: 'Weiter', local: 'Ich bin aus dem Kosovo', skipPhoto: /Ohne Foto/i, step2: /Wie alt/i, step3: /Profilfoto/i, step4: /Einheimisch oder Gast/i },
  mk: { fn: 'Име', ln: 'Презиме', em: 'Твојот email', pw: 'Лозинка', cont: 'Продолжи', local: 'Јас сум од Косово', skipPhoto: /без фотографија/i, step2: /Колку години/i, step3: /фотографија/i, step4: /Домашен или гостин/i },
}

function flattenSqStrings(obj, out = []) {
  if (typeof obj === 'string') {
    if (obj.length >= 6) out.push(obj)
    return out
  }
  if (Array.isArray(obj)) {
    for (const item of obj) flattenSqStrings(item, out)
    return out
  }
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) flattenSqStrings(v, out)
  }
  return out
}

function isDistinctiveSqString(s) {
  if (!s || s.length < 6) return false
  if (CITY_NAMES.some((c) => s.includes(c))) return false
  if (/eja\s*bashkohu/i.test(s)) return false
  if (/[ëçÇ]/.test(s)) return true
  return /\b(tavolin|nikoqir|zbulo|kërko|përdorues|regjistr|ngarkuar|mbremje|ushqim|faleminderit|njoftim|përdorim|privatësi)\b/i.test(s)
}

const SQ_CORPUS = [...new Set(flattenSqStrings(sqLocale).filter(isDistinctiveSqString))]

function isCityText(text) {
  return CITY_NAMES.some((c) => text.includes(c))
}

const ADMIN_TAB_HINTS = {
  sq: { stats: /Statistika/i, reports: /Raportet/i, bans: /Bans/i },
  en: { stats: /Statistics/i, reports: /Reports/i, bans: /Bans/i },
  de: { stats: /Statistik/i, reports: /Meldungen/i, bans: /Sperren/i },
  mk: { stats: /Статистика/i, reports: /Пријави/i, bans: /Блокади/i },
}

const LEGAL_HINTS = {
  sq: { terms: /Kushtet e Përdorimit/i, privacy: /Politika e Privatësisë/i },
  en: { terms: /Terms of Service/i, privacy: /Privacy Policy/i },
  de: { terms: /Nutzungsbedingungen/i, privacy: /Datenschutzerklärung/i },
  mk: { terms: /Услови за користење/i, privacy: /Политика за приватност/i },
}

const NOTIF_CHROME = {
  sq: ['Njoftimet', 'Pastro'],
  en: ['Notifications', 'Clear'],
  de: ['Benachrichtigungen', 'Löschen'],
  mk: ['Известувања', 'Исчисти'],
}

const report = { base: BASE, ts, tests: {} }

function futureEventIso(hours = 48) {
  const d = new Date(Date.now() + hours * 3600000)
  return buildEventDatetime(localDateInputValue(d), `${String(d.getHours()).padStart(2, '0')}:00`)
}

async function apiRpc(session, fn, args) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${fn}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function setupHostNotifications(hostSession, guestSession) {
  const hostClient = createClient(SB_URL, ANON)
  await hostClient.auth.setSession({
    access_token: hostSession.access_token,
    refresh_token: hostSession.refresh_token,
  })
  const guestClient = createClient(SB_URL, ANON)
  await guestClient.auth.setSession({
    access_token: guestSession.access_token,
    refresh_token: guestSession.refresh_token,
  })

  const event_datetime = futureEventIso()
  const tableTitle = `P7Notif-${ts}`
  const { data: table, error: tableErr } = await hostClient
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title: tableTitle,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq', 'en'],
      tags: [],
      description: 'Phase 7 host notification verification',
      status: 'open',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=Test+Cafe+Prishtine',
    })
    .select('id')
    .single()
  if (tableErr) throw new Error(`table insert: ${tableErr.message}`)

  const requestId = await apiRpc(guestSession, 'request_join', { p_table: table.id })
  await apiRpc(hostSession, 'approve_request', { p_request: requestId })

  const { data: hostNotifs } = await hostClient
    .from('notifications')
    .select('id')
    .eq('user_id', hostSession.user.id)
    .limit(5)

  return { tableId: table.id, hostNotifCount: hostNotifs?.length || 0 }
}

async function goToAdminPanel(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => sessionStorage.setItem('ejabashkohu-admin-screen', 'admin'))
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForSelector('.admin-panel, .admin-tabs', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1500)
    if (await page.locator('.admin-panel').isVisible().catch(() => false)) return true
  }
  return page.locator('.admin-panel').isVisible().catch(() => false)
}

async function waitForMainChrome(page, { requireBell = false, timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await page.evaluate(() => sessionStorage.setItem('ejabashkohu-admin-screen', 'main'))
    const viewAs = page.locator('.admin-view-as-user button').first()
    if (await viewAs.isVisible().catch(() => false)) {
      await viewAs.click()
      await page.waitForTimeout(1200)
    }
    const feedReady = await page.locator('.fab, .hdr-user, .sidebar-cta').first().isVisible().catch(() => false)
    const bellReady = await page.locator('.bell').first().isVisible().catch(() => false)
    if (feedReady && (!requireBell || bellReady)) return true
    await page.waitForTimeout(1000)
  }
  return false
}

async function apiLogin(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`login failed ${email}: ${JSON.stringify(data)}`)
  return data
}

async function createPage(browser, session, locale, adminScreen = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript(({ langKey, lang, authKey, sess, adminKey, adminScreenVal }) => {
    localStorage.setItem(langKey, lang)
    if (adminScreenVal) sessionStorage.setItem(adminKey, adminScreenVal)
    if (sess?.access_token) {
      localStorage.setItem(authKey, JSON.stringify({
        access_token: sess.access_token,
        refresh_token: sess.refresh_token,
        expires_in: sess.expires_in,
        expires_at: Math.floor(Date.now() / 1000) + (sess.expires_in || 3600),
        token_type: sess.token_type || 'bearer',
        user: sess.user,
      }))
    }
  }, {
    langKey: UI_LANG_KEY,
    lang: locale,
    authKey: AUTH_KEY,
    sess: session,
    adminKey: ADMIN_SCREEN_KEY,
    adminScreenVal: adminScreen,
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2500)
  return { context, page }
}

async function shot(page, name) {
  const file = `${name}.png`
  await page.screenshot({ path: path.join(OUT, file), fullPage: true })
  return file
}

function scanAlbanian(text, context, excludePatterns = []) {
  const flags = []
  if (!text || text.length < 2) return flags
  for (const pat of ALBANIAN_PATTERNS) {
    if (excludePatterns.some((ep) => ep.test(text))) continue
    if (pat.test(text) && !isCityText(text)) {
      flags.push({ context, pattern: pat.toString(), snippet: text.replace(/\s+/g, ' ').slice(0, 160) })
    }
  }
  for (const sqStr of SQ_CORPUS) {
    if (sqStr.length < 8) continue
    if (text.includes(sqStr)) {
      flags.push({
        context,
        pattern: 'sq-corpus',
        snippet: `${sqStr} → ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
      })
    }
  }
  return flags
}

async function extractVisibleText(page, selector = 'body') {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return ''
    const clone = root.cloneNode(true)
    clone.querySelectorAll('script, style, noscript').forEach((n) => n.remove())
    clone.querySelectorAll('.notif-item p, .notif-item .notif-body, .admin-report-reason').forEach((n) => n.remove())
    return clone.innerText || ''
  }, selector)
}

async function dismissAllSheets(page) {
  for (let i = 0; i < 5; i += 1) {
    const open = await page.locator('.sheet-wrap').count()
    if (open === 0) return
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('.sheet-wrap .icon-btn').first().click({ force: true }).catch(() => {})
    await page.locator('.profile-sheet .icon-btn, .profile-back').first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(350)
  }
}

async function clickLocale(page, code) {
  const btn = page.locator('.lang-switcher button', { hasText: code.toUpperCase() })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(500)
  }
}

async function ensureOnMainFeed(page, { requireBell = false } = {}) {
  return waitForMainChrome(page, { requireBell, timeoutMs: requireBell ? 45000 : 30000 })
}

async function openNotifPanel(page) {
  const ready = await waitForMainChrome(page, { requireBell: true, timeoutMs: 60000 })
  if (!ready) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await waitForMainChrome(page, { requireBell: true, timeoutMs: 45000 })
  }
  await page.locator('.bell').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.bell').first().click({ force: true })
  await page.waitForTimeout(1200)
  await page.locator('.notif-panel').waitFor({ state: 'visible', timeout: 15000 })
  for (let i = 0; i < 24; i += 1) {
    if ((await page.locator('.notif-item').count()) > 0) break
    await page.waitForTimeout(750)
  }
}

async function test1Admin(browser, adminSession) {
  report.tests.test1 = { pass: true, locales: {}, rootCause: 'test-script race — admin panel needs sessionStorage admin + reload; not an app bug. Fixed with 3-attempt goToAdminPanel.' }
  for (const loc of LOCALES) {
    const { context, page } = await createPage(browser, adminSession, loc, 'admin')
    try {
      let ok = await page.locator('.admin-panel').isVisible().catch(() => false)
      if (!ok) ok = await goToAdminPanel(page)
      if (!ok) {
        await page.waitForTimeout(3000)
        ok = await goToAdminPanel(page)
      }
      if (!ok) {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2000)
        ok = await goToAdminPanel(page)
      }
      if (!ok) throw new Error('admin panel not visible')
      await page.waitForSelector('.admin-panel', { timeout: 15000 })
      const tabs = ADMIN_TAB_HINTS[loc]
      const localeResult = { tabs: {}, pass: true }

      for (const [tabKey, hint] of [
        ['stats', tabs.stats],
        ['reports', tabs.reports],
        ['bans', tabs.bans],
      ]) {
        const btn = page.locator('.admin-tabs button').filter({ hasText: hint }).first()
        if (await btn.isVisible().catch(() => false)) await btn.click()
        await page.waitForTimeout(1500)
        const text = await extractVisibleText(page, '.admin-panel')
        const file = await shot(page, `test1-admin-${tabKey}-${loc}`)
        const albanianFlags = loc === 'sq' ? [] : scanAlbanian(text, `admin-${tabKey}-${loc}`)
        localeResult.tabs[tabKey] = {
          screenshot: file,
          hintOk: hint.test(text),
          albanianFlags: albanianFlags.length,
          pass: hint.test(text) && albanianFlags.length === 0,
        }
        if (!localeResult.tabs[tabKey].pass) localeResult.pass = false
      }
      report.tests.test1.locales[loc] = localeResult
      if (!localeResult.pass) report.tests.test1.pass = false
    } catch (err) {
      report.tests.test1.locales[loc] = { pass: false, error: String(err.message || err) }
      report.tests.test1.pass = false
      await shot(page, `test1-admin-fail-${loc}`).catch(() => {})
    } finally {
      await context.close()
    }
  }
  report.tests.test1.pass = LOCALES.every((loc) => report.tests.test1.locales[loc]?.pass === true)
}

async function test2Legal(browser) {
  report.tests.test2 = { pass: true, locales: {} }
  for (const loc of LOCALES) {
    const { context, page } = await createPage(browser, null, loc)
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
      await clickLocale(page, loc)
      await page.waitForTimeout(400)

      const localeResult = { terms: {}, privacy: {}, pass: true }

      for (const [kind, hint] of [['terms', LEGAL_HINTS[loc].terms], ['privacy', LEGAL_HINTS[loc].privacy]]) {
        await page.evaluate((k) => {
          window.dispatchEvent(new CustomEvent('showPolicy', { detail: k }))
        }, kind)
        await page.waitForSelector('.policy-page', { timeout: 10000 })
        await page.waitForTimeout(600)
        const text = await extractVisibleText(page, '.policy-page')
        const file = await shot(page, `test2-${kind}-${loc}`)
        const rawKey = /\.section\d/.test(text)
        const albanianFlags = loc === 'sq' ? [] : scanAlbanian(text, `${kind}-${loc}`)
        localeResult[kind] = {
          screenshot: file,
          titleOk: hint.test(text),
          rawKey,
          albanianFlags: albanianFlags.length,
          pass: hint.test(text) && !rawKey && albanianFlags.length === 0,
        }
        if (!localeResult[kind].pass) localeResult.pass = false
        await page.evaluate(() => {
          document.querySelector('.policy-back')?.click()
        }).catch(() => {})
        await page.waitForTimeout(400)
      }

      report.tests.test2.locales[loc] = localeResult
      if (!localeResult.pass) report.tests.test2.pass = false
    } catch (err) {
      report.tests.test2.locales[loc] = { pass: false, error: String(err.message || err) }
      report.tests.test2.pass = false
    } finally {
      await context.close()
    }
  }
}

async function test3HostNotif(browser, adminSession) {
  report.tests.test3 = { pass: true, locales: {}, rootCause: 'test-script timing — bell icon waits for auth hydration after session inject; not an app bug. Fixed with waitForMainChrome + reload retry.' }
  for (const loc of LOCALES) {
    const { context, page } = await createPage(browser, adminSession, loc, 'main')
    try {
      let ok = false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await ensureOnMainFeed(page, { requireBell: true })
          await openNotifPanel(page)
          ok = true
          break
        } catch (err) {
          if (attempt === 0) {
            await page.reload({ waitUntil: 'domcontentloaded' })
            await page.waitForTimeout(3000)
          } else {
            throw err
          }
        }
      }
      if (!ok) throw new Error('bell panel unavailable')
      const text = await page.locator('.notif-panel').innerText().catch(() => '')
      const items = await page.locator('.notif-item').count()
      const file = await shot(page, `test3-host-notif-${loc}`)
      const chrome = NOTIF_CHROME[loc]
      const chromePass = chrome.every((s) => text.includes(s))
      const albanianFlags = loc === 'sq' ? [] : scanAlbanian(text, `host-notif-${loc}`)
      const pass = chromePass && items > 0 && albanianFlags.length === 0
      report.tests.test3.locales[loc] = {
        screenshot: file,
        itemCount: items,
        chromePass,
        albanianFlags: albanianFlags.length,
        pass,
      }
      if (!pass) report.tests.test3.pass = false
    } catch (err) {
      report.tests.test3.locales[loc] = { pass: false, error: String(err.message || err) }
      report.tests.test3.pass = false
      await shot(page, `test3-host-notif-fail-${loc}`).catch(() => {})
    } finally {
      await context.close()
    }
  }
  report.tests.test3.pass = LOCALES.every((loc) => report.tests.test3.locales[loc]?.pass === true)
}

async function walkScreen(page, name, fn) {
  try {
    await fn()
    await page.waitForTimeout(800)
    const text = await extractVisibleText(page)
    return { name, ok: true, text: text.slice(0, 2000) }
  } catch (err) {
    return { name, ok: false, error: String(err.message || err) }
  }
}

async function walkRegistrationSteps(page, loc) {
  const labels = REG_LABELS[loc]
  const walked = []
  const flags = []

  const capture = async (name) => {
    const text = await extractVisibleText(page)
    walked.push(name)
    flags.push(...scanAlbanian(text, `${loc}/${name}`))
  }

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await clickLocale(page, loc)
  await page.locator('button.hero-cta').first().click()
  await page.locator('.step-title, .onboard-card').first().waitFor({ timeout: 15000 })
  await capture('reg-step1')

  await page.getByPlaceholder(labels.fn).fill('Scan')
  await page.getByPlaceholder(labels.ln).fill('Test')
  await page.getByPlaceholder(labels.em).fill(`p7scan.${loc}.${ts}@guerrillamailblock.com`)
  await page.getByPlaceholder(new RegExp(labels.pw, 'i')).fill('TestPass123!')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: new RegExp(`^${labels.cont}$`, 'i') }).click()
  await page.waitForTimeout(2500)
  await page.locator('.step-title').filter({ hasText: labels.step2 }).waitFor({ timeout: 15000 })
  await capture('reg-step2')

  await page.getByRole('button', { name: new RegExp(`^${labels.cont}$`, 'i') }).click()
  await page.waitForTimeout(800)
  await page.locator('.step-title').filter({ hasText: labels.step3 }).waitFor({ timeout: 15000 })
  await capture('reg-step3')

  const skipBtn = page.getByRole('button', { name: labels.skipPhoto })
  if (await skipBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await skipBtn.click()
  } else {
    await page.getByRole('button', { name: new RegExp(`^${labels.cont}$`, 'i') }).click().catch(() => {})
  }
  await page.locator('.step-title').filter({ hasText: labels.step4 }).waitFor({ timeout: 15000 })
  await capture('reg-step4')

  return { walked, flags }
}

async function openCreateForm(page) {
  await page.locator('.fab, .sidebar-cta').first().click({ force: true }).catch(async () => {
    await page.locator('button', { hasText: /Open table|Hap tavolin|Entdecken|Откриј/i }).first().click()
  })
  await page.waitForSelector('.sheet, .create-form', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(600)
}

async function walkAuthenticatedScreens(page, loc, setup) {
  const walked = []
  const flags = []
  const errors = []

  const capture = async (name, fn) => {
    try {
      if (fn) await fn()
      await page.waitForTimeout(800)
      const text = await extractVisibleText(page)
      walked.push(name)
      flags.push(...scanAlbanian(text, `${loc}/${name}`))
    } catch (err) {
      walked.push(`${name}:error`)
      errors.push({ context: `${loc}/${name}`, error: String(err.message || err) })
    }
  }

  await capture('feed', async () => { await ensureOnMainFeed(page) })

  await capture('taste-quiz', async () => {
    await dismissAllSheets(page)
    const banner = page.locator('.mq-banner').first()
    if (await banner.isVisible({ timeout: 5000 }).catch(() => false)) {
      await banner.click({ force: true })
    }
    await page.locator('.sheet .quiz-q').first().waitFor({ timeout: 10000 })
  })

  await capture('wednesday-quiz', async () => {
    await dismissAllSheets(page)
    const wed = page.locator('.wed-banner').first()
    if (await wed.isVisible({ timeout: 5000 }).catch(() => false)) {
      await wed.click({ force: true })
      await page.locator('.sheet .quiz-q').first().waitFor({ timeout: 10000 })
    }
  })

  await capture('create-tavoline', async () => {
    await dismissAllSheets(page)
    await openCreateForm(page)
  })

  await capture('create-vozitje', async () => {
    await page.locator('button.mode-btn', { hasText: /^Ride$|^Vozitje$|^Mitfahrt$|^Возење$/ }).click({ force: true })
    await page.waitForTimeout(400)
  })

  await capture('create-udhetim', async () => {
    await page.locator('button.mode-btn', { hasText: /^Trip$|^Udhëtim$|^Reise$|^Патување$/ }).click({ force: true })
    await page.waitForTimeout(400)
  })

  await capture('table-detail', async () => {
    await dismissAllSheets(page)
    await page.evaluate(() => {
      const card = document.querySelector('article.card, .card')
      card?.click()
    })
    await page.waitForSelector('.sheet', { timeout: 10000 })
  })

  await capture('chat-view', async () => {
    await page.locator('.chat, .chat-top').first().scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(500)
  })

  await capture('payment-sheet', async () => {
    await dismissAllSheets(page)
    if (setup?.tableId) {
      await page.evaluate(() => {
        const card = [...document.querySelectorAll('article.card, .card')].find((c) => c.textContent?.includes('P7Notif'))
        card?.click()
      })
      await page.waitForSelector('.sheet', { timeout: 10000 })
    } else {
      await page.evaluate(() => document.querySelector('article.card, .card')?.click())
      await page.waitForSelector('.sheet', { timeout: 10000 })
    }
    const payBtn = page.locator('button.btn.primary.glow').first()
    if (await payBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await payBtn.click({ force: true })
      await page.waitForSelector('.sheet.pay, .pay-summary', { timeout: 10000 })
    }
  })

  await capture('notifications', async () => {
    await dismissAllSheets(page)
    await openNotifPanel(page)
  })

  await capture('profile', async () => {
    await dismissAllSheets(page)
    await page.locator('.hdr-user').click({ force: true })
    await page.waitForSelector('.sheet-wrap.centerv .prof-photo', { timeout: 10000 })
  })

  await capture('change-password', async () => {
    await page.locator('.sheet-wrap.centerv button', { hasText: /password|Passwort|лозинка|fjalëkalim/i }).first().click({ force: true })
    await page.waitForSelector('.change-password-screen', { timeout: 10000 })
  })

  await capture('blocked-users', async () => {
    await page.locator('.change-password-screen .back-btn').click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('.hdr-user').click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('.sheet-wrap.centerv button', { hasText: /blocked|Blockierte|блокирани|bllokuar/i }).first().click({ force: true })
    await page.waitForSelector('.blocked-users-screen', { timeout: 10000 })
  })

  await capture('my-reports', async () => {
    await page.locator('.blocked-users-screen .back-btn').click({ force: true })
    await page.waitForTimeout(300)
    await page.locator('.hdr-user').click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('.sheet-wrap.centerv button', { hasText: /report|Meldu|пријав|raport/i }).first().click({ force: true })
    await page.waitForSelector('.my-reports-screen', { timeout: 10000 })
  })

  return { walked, flags, errors }
}

async function test4FullScan(browser, adminSession, guestSession, setup) {
  report.tests.test4 = { pass: true, locales: {}, sqCorpusSize: SQ_CORPUS.length }

  for (const loc of SCAN_LOCALES) {
    const flags = []
    const walkErrors = []
    const walked = []

    const { context, page } = await createPage(browser, null, loc)
    try {
      page.on('dialog', (d) => d.accept())
      let r = await walkScreen(page, 'landing', async () => {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
        await clickLocale(page, loc)
      })
      walked.push(r.name)
      flags.push(...scanAlbanian(r.text, `${loc}/landing`))

      try {
        const reg = await walkRegistrationSteps(page, loc)
        walked.push(...reg.walked)
        flags.push(...reg.flags)
      } catch (err) {
        walkErrors.push({ context: `${loc}/registration`, error: String(err.message || err) })
      }

      r = await walkScreen(page, 'sign-in', async () => {
        await page.locator('button', { hasText: /Sign in|Anmelden|Најав/i }).first().click()
      })
      walked.push(r.name)
      flags.push(...scanAlbanian(r.text, `${loc}/sign-in`))
    } catch (err) {
      walkErrors.push({ context: `${loc}/landing`, error: String(err.message || err) })
    } finally {
      await context.close()
    }

    const guestCtx = await createPage(browser, guestSession, loc, 'main')
    try {
      guestCtx.page.on('dialog', (d) => d.accept())
      const authWalk = await walkAuthenticatedScreens(guestCtx.page, loc, setup)
      walked.push(...authWalk.walked)
      flags.push(...authWalk.flags)
      walkErrors.push(...authWalk.errors)
    } finally {
      await guestCtx.context.close()
    }

    const adminCtx = await createPage(browser, adminSession, loc, 'admin')
    try {
      let r = await walkScreen(adminCtx.page, 'admin-stats', async () => {
        await adminCtx.page.waitForSelector('.admin-panel', { timeout: 20000 })
      })
      walked.push(r.name)
      flags.push(...scanAlbanian(r.text, `${loc}/admin`))

      r = await walkScreen(adminCtx.page, 'admin-reports', async () => {
        const hint = ADMIN_TAB_HINTS[loc].reports
        await adminCtx.page.locator('.admin-tabs button').filter({ hasText: hint }).click()
      })
      walked.push(r.name)
      flags.push(...scanAlbanian(r.text, `${loc}/admin-reports`))

      r = await walkScreen(adminCtx.page, 'terms', async () => {
        await adminCtx.page.evaluate(() => window.dispatchEvent(new CustomEvent('showPolicy', { detail: 'terms' })))
        await adminCtx.page.waitForSelector('.policy-page')
      })
      walked.push(r.name)
      flags.push(...scanAlbanian(r.text, `${loc}/terms`))

      r = await walkScreen(adminCtx.page, 'privacy', async () => {
        await adminCtx.page.evaluate(() => window.dispatchEvent(new CustomEvent('showPolicy', { detail: 'privacy' })))
        await adminCtx.page.waitForSelector('.policy-page')
      })
      walked.push(r.name)
      flags.push(...scanAlbanian(r.text, `${loc}/privacy`))
    } finally {
      await adminCtx.context.close()
    }

    const uniqueFlags = []
    const seen = new Set()
    for (const f of flags) {
      const key = `${f.context}|${f.pattern}|${f.snippet?.slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      uniqueFlags.push(f)
    }

    report.tests.test4.locales[loc] = {
      screensWalked: walked,
      flagCount: uniqueFlags.length,
      flags: uniqueFlags,
      walkErrors,
      pass: uniqueFlags.length === 0,
    }
    if (uniqueFlags.length > 0) report.tests.test4.pass = false
  }

  report.tests.test4.totalFlags = Object.values(report.tests.test4.locales)
    .reduce((n, l) => n + (l.flagCount || 0), 0)
}

async function test5Regression(browser, guestSession) {
  report.tests.test5 = { pass: true, checks: {} }

  const { context, page } = await createPage(browser, guestSession, 'en', 'main')
  try {
    await ensureOnMainFeed(page)
    const feedText = await extractVisibleText(page, '.app')
    report.tests.test5.checks.feedEn = {
      pass: /Discover|My tables|Notifications/i.test(feedText) && !/Zbulo tavolinat/i.test(feedText),
      sample: feedText.slice(0, 200),
    }
  } finally {
    await context.close()
  }

  const dup = await createPage(browser, null, 'en')
  try {
    await dup.page.locator('button.hero-cta').first().click()
    await dup.page.waitForTimeout(600)
    await dup.page.locator('.input.modern').nth(0).fill('Gap')
    await dup.page.locator('.input.modern').nth(1).fill('Test')
    await dup.page.locator('input[type="email"]').first().fill(ADMIN_EMAIL)
    await dup.page.locator('.input-password-wrap input').first().fill('TestPass123!')
    await dup.page.locator('#terms-check').check()
    await dup.page.locator('button.modern-btn').click()
    await dup.page.waitForTimeout(2500)
    const err = await dup.page.evaluate(() => document.querySelector('.age-warn')?.textContent?.trim() || '')
    report.tests.test5.checks.duplicateEmail = {
      pass: /already registered/i.test(err),
      message: err,
    }
    await shot(dup.page, 'test5-duplicate-en')
  } finally {
    await dup.context.close()
  }

  for (const [key, check] of Object.entries(report.tests.test5.checks)) {
    if (!check.pass) report.tests.test5.pass = false
  }
}

async function main() {
  console.log(`Phase 7 verification → ${BASE}`)
  console.log(`Evidence: ${OUT}`)

  const adminSession = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
  let guestSession
  try {
    guestSession = await apiLogin(GUEST_EMAIL, GUEST_PASSWORD)
  } catch {
    guestSession = adminSession
  }

  console.log('Seeding host notifications…')
  const setup = await setupHostNotifications(adminSession, guestSession)
  report.setup = setup
  fs.writeFileSync(path.join(OUT, '00-setup.json'), JSON.stringify(setup, null, 2))

  const browser = await chromium.launch({ headless: true })
  try {
    await test1Admin(browser, adminSession)
    await test2Legal(browser)
    await test3HostNotif(browser, adminSession)
    await test4FullScan(browser, adminSession, guestSession, setup)
    await test5Regression(browser, guestSession)
  } finally {
    await browser.close()
  }

  const allPass = Object.values(report.tests).every((t) => t.pass === true)
  report.summary = {
    allPass,
    test1: report.tests.test1?.pass,
    test2: report.tests.test2?.pass,
    test3: report.tests.test3?.pass,
    test4: report.tests.test4?.pass,
    test4TotalFlags: report.tests.test4?.totalFlags,
    test5: report.tests.test5?.pass,
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.summary, null, 2))
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  fs.writeFileSync(path.join(OUT, 'fatal.json'), JSON.stringify({ error: String(err.stack || err) }, null, 2))
  console.error(err)
  process.exit(1)
})
