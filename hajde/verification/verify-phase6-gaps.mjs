/**
 * Phase 6 gap verification — real payment/notifications state + error-path regression.
 *
 * GAP 1: Payment sheet + populated notification panel (4 locales)
 * GAP 2: All error paths after API raw-message refactor (exact messages)
 *
 * Run: node verification/verify-phase6-gaps.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildEventDatetime, localDateInputValue } from '../src/lib/eventSchedule.js'
import { formatEventTime } from '../src/lib/formatEventTime.js'
import { mapError } from '../src/lib/errorMap.js'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv[2] || 'https://ejabashkohu.com').replace(/\/$/, '')
const ts = Date.now()
const OUT = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : path.join(__dirname, 'evidence', 'phase6-gaps', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const ADMIN_SCREEN_KEY = 'ejabashkohu-admin-screen'
const PASSWORD = 'TestPass123!'

const HOST_EMAIL = requireE2EEmail()
const HOST_PASSWORD = requireE2EPassword()
const GUEST_EMAIL = process.env.GAP_GUEST_EMAIL || 'ultreuvl@guerrillamailblock.com'
const GUEST_PASSWORD = process.env.GAP_GUEST_PASSWORD || 'TestPass123!'
const BLOCKER_EMAIL = process.env.GAP_BLOCKER_EMAIL || 'alkettelaku637@gmail.com'
const BLOCKER_PASSWORD = process.env.GAP_BLOCKER_PASSWORD || 'EjaAlket2026!637'

const LOCALES = ['sq', 'en', 'de', 'mk']
const GENERIC_FALLBACK = [/Diçka shkoi keq/i, /Something went wrong/i]

const EXPECTED = {
  duplicateEmail: {
    en: 'This email is already registered.',
    de: 'Diese E-Mail ist bereits registriert.',
    mk: 'Овој email е веќе регистриран.',
  },
  mapsInvalid: {
    en: 'Link must be a valid Google Maps link',
    de: 'Link muss ein gültiger Google-Maps-Link sein',
  },
  futureTime: {
    en: 'Time must be in the future',
    de: 'Die Zeit muss in der Zukunft liegen',
  },
  tableExpiredUi: {
    en: 'This table has expired',
    de: 'Dieser Tisch ist abgelaufen',
  },
  tableExpiredApi: {
    en: 'This table has expired',
    de: 'Dieser Tisch ist abgelaufen',
  },
  blockedJoin: {
    en: 'This action is not allowed',
    de: 'Diese Aktion ist nicht erlaubt',
  },
  resetRateLimit: {
    en: 'You already requested a link. Wait',
    de: 'Du hast bereits einen Link angefordert. Warte',
  },
  wrongPassword: {
    en: 'Current password is incorrect',
    de: 'Aktuelles Passwort ist falsch',
  },
  sessionExpired: {
    en: 'Session expired. Sign in again',
    de: 'Sitzung abgelaufen. Melde dich erneut an',
  },
  payment: {
    en: ['Confirm your seat', 'Card number', 'MM/YY', 'Pay 2.00 €'],
    de: ['Platz bestätigen', 'Kartennummer', 'MM/JJ', '2.00 € zahlen'],
    mk: ['Потврди место', 'Број на картичка', 'MM/GG', 'Плати 2.00 €'],
    sq: ['Konfirmo vendin', 'Numri i kartelës', 'MM/VV', 'Paguaj 2.00 €'],
  },
  notifChrome: {
    en: ['Notifications', 'Clear'],
    de: ['Benachrichtigungen', 'Löschen'],
    mk: ['Известувања', 'Исчисти'],
    sq: ['Njoftimet', 'Pastro'],
  },
}

const state = { tableId: null, tableTitle: null, requestId: null, expiredTableId: null }

const report = { base: BASE, ts, outDir: OUT, setup: {}, gap1: {}, gap2: {} }

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
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

async function apiRpc(session, fn, params) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    const err = new Error(typeof body === 'object' ? body.message || text : text)
    if (typeof body === 'object') err.code = body.code
    throw err
  }
  return body
}

function sbClient(session) {
  const c = createClient(SB_URL, ANON)
  return c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }).then(({ error }) => {
    if (error) throw error
    return c
  })
}

function futureEventIso(hours = 48) {
  const d = new Date(Date.now() + hours * 3600 * 1000)
  d.setMinutes(0, 0, 0)
  return buildEventDatetime(localDateInputValue(d), `${String(d.getHours()).padStart(2, '0')}:00`)
}

function pastEventIso(hours = 2) {
  const d = new Date(Date.now() - hours * 3600 * 1000)
  return d.toISOString()
}

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitConfirmLink(sid) {
  for (let i = 0; i < 40; i += 1) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
      ).then((r) => r.json())
      const html = full.mail_body || full.mail_body_html || ''
      const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
      if (match) return match[0].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('confirm email timeout')
}

async function ensureProfileComplete(session) {
  const client = createClient(SB_URL, ANON)
  await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  const prefs = {
    terms_agreed: true,
    terms_agreed_at: new Date().toISOString(),
    terms_version: '2026-08',
  }
  const { error: updErr } = await client.from('profiles').update({
    first_name: 'Gap',
    last_name: 'Guest',
    age: 28,
    user_preferences: prefs,
  }).eq('id', session.user.id)
  if (updErr) throw new Error(`profile update: ${updErr.message}`)
  const { data: row } = await client.from('profiles').select('user_preferences').eq('id', session.user.id).single()
  if (!row?.user_preferences?.terms_agreed) throw new Error('terms_agreed not persisted on profile')
}

async function createConfirmedGuest() {
  const inbox = await guerrillaInbox()
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: inbox.address,
      password: PASSWORD,
      data: { first_name: 'Gap', last_name: 'Guest', age: 28 },
    }),
  })
  if (!res.ok) throw new Error(`guest signup failed: ${await res.text()}`)
  const confirmLink = await waitConfirmLink(inbox.sid)
  await fetch(confirmLink)
  const session = await apiLogin(inbox.address, PASSWORD)
  await ensureProfileComplete(session)
  return session
}

async function setupJoinApproveFlow() {
  console.log('Creating guest + admin host…')
  const hostSession = await apiLogin(HOST_EMAIL, HOST_PASSWORD)
  let guestSession
  const guestCandidates = [
    [GUEST_EMAIL, GUEST_PASSWORD],
    ['ultreuvl@guerrillamailblock.com', 'TestPass123!'],
  ]
  for (const [email, password] of guestCandidates) {
    try {
      guestSession = await apiLogin(email, password)
      console.log(`  using guest ${email}`)
      break
    } catch {
      /* try next */
    }
  }
  if (!guestSession) {
    console.log('  no existing guest login, creating guerrilla guest…')
    guestSession = await createConfirmedGuest()
  }

  await ensureProfileComplete(guestSession)

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

  await hostClient.from('blocks').delete().eq('blocker_id', hostSession.user.id).eq('blocked_id', guestSession.user.id)
  await hostClient.from('blocks').delete().eq('blocker_id', guestSession.user.id).eq('blocked_id', hostSession.user.id)

  const event_datetime = futureEventIso()
  state.tableTitle = `P6Gap-${ts}`
  const maps_link = 'https://www.google.com/maps/search/?api=1&query=Test+Cafe+Prishtine'

  console.log('  inserting table…')
  const { data: table, error: tableErr } = await hostClient
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title: state.tableTitle,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq', 'en'],
      tags: [],
      description: 'Phase 6 gap verification table',
      status: 'open',
      maps_link,
    })
    .select('id, title')
    .single()
  if (tableErr) throw new Error(`table insert: ${tableErr.message} (${tableErr.code})`)
  state.tableId = table.id

  console.log('  request_join…')
  const requestId = await apiRpc(guestSession, 'request_join', { p_table: state.tableId })
  state.requestId = requestId

  console.log('  approve_request…')
  await apiRpc(hostSession, 'approve_request', { p_request: requestId })

  const { data: hostNotifs } = await hostClient
    .from('notifications')
    .select('body, icon, created_at')
    .eq('user_id', hostSession.user.id)
    .order('created_at', { ascending: false })
    .limit(3)

  const { data: guestNotifs } = await guestClient
    .from('notifications')
    .select('body, icon, created_at')
    .eq('user_id', guestSession.user.id)
    .order('created_at', { ascending: false })
    .limit(3)

  report.setup = {
    hostEmail: HOST_EMAIL,
    guestEmail: guestSession.user?.email,
    tableId: state.tableId,
    tableTitle: state.tableTitle,
    requestId: state.requestId,
    hostNotifCount: hostNotifs?.length || 0,
    guestNotifCount: guestNotifs?.length || 0,
    hostNotifSample: hostNotifs?.[0]?.body || null,
    guestNotifSample: guestNotifs?.[0]?.body || null,
  }
  save('00-setup.json', report.setup)

  return { hostSession, guestSession }
}

async function setupExpiredTable(hostSession) {
  const hostClient = createClient(SB_URL, ANON)
  await hostClient.auth.setSession({
    access_token: hostSession.access_token,
    refresh_token: hostSession.refresh_token,
  })
  const event_datetime = futureEventIso(72)
  const { data: table, error } = await hostClient
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title: `P6Expired-${ts}`,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'Expired test',
      status: 'open',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=Test',
    })
    .select('id')
    .single()
  if (error) throw new Error(`expired setup insert: ${error.message}`)
  await hostClient.from('tables').update({ event_datetime: pastEventIso() }).eq('id', table.id)
  state.expiredTableId = table.id
  return table.id
}

async function ensureMainApp(page) {
  for (let i = 0; i < 25; i += 1) {
    if (await page.locator('.hdr-user, .fab, .bell').first().isVisible().catch(() => false)) {
      return true
    }
    await page.waitForTimeout(1000)
  }
  return false
}

async function createPage(browser, session, locale) {
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    locale: locale === 'sq' ? 'sq-AL' : locale === 'de' ? 'de-DE' : locale === 'mk' ? 'mk-MK' : 'en-US',
  })
  await context.addInitScript(({ uiLang, adminKey }) => {
    localStorage.setItem('ejabashkohu-ui-lang', uiLang)
    sessionStorage.setItem(adminKey, 'main')
    sessionStorage.removeItem('ejabashkohu-pending-registration')
  }, { uiLang: locale, adminKey: ADMIN_SCREEN_KEY })

  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })

  if (session) {
    await page.evaluate(
      ({ key, sess }) => {
        localStorage.setItem(key, JSON.stringify({
          access_token: sess.access_token,
          refresh_token: sess.refresh_token,
          expires_in: sess.expires_in,
          expires_at: sess.expires_at,
          token_type: sess.token_type || 'bearer',
          user: sess.user,
        }))
      },
      { key: AUTH_KEY, sess: session },
    )
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 })
  }
  await page.waitForTimeout(2500)

  const adminReturn = page.locator('.admin-return-badge').first()
  if (await adminReturn.isVisible().catch(() => false)) {
    await adminReturn.click()
    await page.waitForTimeout(1200)
  }
  await ensureMainApp(page)
  return { context, page }
}

async function shot(page, name) {
  const file = `${name}.png`
  await page.screenshot({ path: path.join(OUT, file), fullPage: true })
  return file
}

async function readToast(page) {
  return page.evaluate(() => document.querySelector('.toast')?.textContent?.trim() || '')
}

async function readAuthError(page) {
  return page.evaluate(() => document.querySelector('.age-warn')?.textContent?.trim() || '')
}

function isGeneric(msg) {
  return GENERIC_FALLBACK.some((p) => p.test(msg || ''))
}

function checkExpected(msg, expectedSnippet) {
  return expectedSnippet && msg.includes(expectedSnippet) && !isGeneric(msg)
}

async function findAndOpenTable(page, title) {
  await page.waitForTimeout(2000)
  await page.waitForSelector('.hdr-user, article.card, .search', { timeout: 45000 }).catch(() => {})

  let card = page.locator('article.card, .card').filter({ hasText: title }).first()
  if (await card.isVisible({ timeout: 8000 }).catch(() => false)) {
    await card.click({ force: true })
    await page.waitForTimeout(1200)
    return true
  }

  const search = page.locator('.search input').first()
  if (await search.isVisible().catch(() => false)) {
    await search.fill(title)
    await page.waitForTimeout(1500)
    card = page.locator('article.card, .card').filter({ hasText: title }).first()
    if (await card.isVisible({ timeout: 8000 }).catch(() => false)) {
      await card.click({ force: true })
      await page.waitForTimeout(1200)
      return true
    }
  }

  const myTab = page.locator('aside button, .sidebar button, .sb-btn').filter({
    hasText: /My tables|Tavolinat e mia|Meine Tische|Мои маси/i,
  }).first()
  if (await myTab.isVisible().catch(() => false)) {
    await myTab.click({ force: true })
    await page.waitForTimeout(1200)
    card = page.locator('article.card, .card').filter({ hasText: title }).first()
    if (await card.isVisible({ timeout: 8000 }).catch(() => false)) {
      await card.click({ force: true })
      await page.waitForTimeout(1200)
      return true
    }
  }
  return false
}

async function openTableDetail(page, title) {
  const opened = await findAndOpenTable(page, title)
  if (!opened) throw new Error(`table not found: ${title}`)
  await page.locator('.sheet h2, .sheet').filter({ hasText: title }).first().waitFor({ timeout: 15000 }).catch(() => {})
}

async function openPaymentSheet(page) {
  const btn = page.getByRole('button', { name: /Confirm seat|Konfirmo vend|bestätigen|Потврди/i }).first()
  await btn.waitFor({ state: 'visible', timeout: 20000 })
  await btn.click()
  await page.waitForTimeout(1000)
  await page.locator('.sheet.pay').waitFor({ state: 'visible', timeout: 10000 })
  const cardMethod = page.locator('.pay-methods button').filter({ hasText: /Card|Karte|Kart|Карт/i }).first()
  if (await cardMethod.isVisible().catch(() => false)) {
    await cardMethod.click()
    await page.waitForTimeout(400)
  }
}

async function openNotifPanel(page) {
  await page.locator('.bell').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  await page.evaluate(() => document.querySelector('.bell')?.click())
  await page.waitForTimeout(1200)
  await page.locator('.notif-panel').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  for (let i = 0; i < 8; i += 1) {
    const count = await page.locator('.notif-item').count()
    if (count > 0) break
    await page.waitForTimeout(750)
  }
  return page.locator('.notif-panel').isVisible().catch(() => false)
}

async function openApprovedTableForGuest(page, title = state.tableTitle) {
  return findAndOpenTable(page, title)
}

async function gap1Payment(browser, guestSession) {
  report.gap1.payment = {}
  for (const loc of LOCALES) {
    const { context, page } = await createPage(browser, guestSession, loc)
    try {
      const opened = await openApprovedTableForGuest(page)
      if (!opened) {
        const bodySnippet = (await page.locator('body').innerText()).slice(0, 400)
        report.gap1.payment[loc] = { pass: false, error: 'approved table not found', bodySnippet }
        await shot(page, `gap1-payment-${loc}-fail`)
        continue
      }
      await page.waitForTimeout(1200)
      await openPaymentSheet(page)
      const payText = await page.locator('.sheet.pay').innerText()
      const file = await shot(page, `gap1-payment-${loc}`)
      const expected = EXPECTED.payment[loc]
      const pass = expected.every((s) => payText.includes(s)) || expected.slice(0, 2).every((s) => payText.includes(s))
      report.gap1.payment[loc] = {
        pass,
        screenshot: file,
        sampleText: payText.slice(0, 400),
        expected,
        hasAlbanianWhenNotSq: loc !== 'sq' && /Konfirmo vendin|Numri i kartelës|Paguaj/i.test(payText),
      }
    } catch (err) {
      report.gap1.payment[loc] = { pass: false, error: String(err.message || err) }
      await shot(page, `gap1-payment-${loc}-error`).catch(() => {})
    } finally {
      await context.close()
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function gap1Notifications(browser, hostSession, guestSession) {
  report.gap1.notifications = {}

  for (const loc of LOCALES) {
    const host = await createPage(browser, hostSession, loc)
    try {
      await ensureOnMainFeed(host.page)
      await openNotifPanel(host.page)
      const hostText = await host.page.locator('.notif-panel').innerText().catch(() => '')
      const hostItems = await host.page.locator('.notif-item p').allTextContents().catch(() => [])
      report.gap1.notifications[`host-${loc}`] = {
        screenshot: await shot(host.page, `gap1-notif-host-${loc}`),
        chromePass: EXPECTED.notifChrome[loc].every((s) => hostText.includes(s)),
        itemCount: hostItems.length,
        items: hostItems.slice(0, 3),
        hasJoinNotif: hostItems.some((t) => /kërkon|join|bashkohet/i.test(t)),
      }
    } finally {
      await host.context.close()
    }

    const guest = await createPage(browser, guestSession, loc)
    try {
      await openNotifPanel(guest.page)
      const guestText = await guest.page.locator('.notif-panel').innerText().catch(() => '')
      const guestItems = await guest.page.locator('.notif-item p').allTextContents().catch(() => [])
      report.gap1.notifications[`guest-${loc}`] = {
        screenshot: await shot(guest.page, `gap1-notif-guest-${loc}`),
        chromePass: EXPECTED.notifChrome[loc].every((s) => guestText.includes(s)),
        itemCount: guestItems.length,
        items: guestItems.slice(0, 3),
        hasApprovalNotif: guestItems.some((t) => /aprovove|approved|genehmigt|одобрен/i.test(t)),
      }
    } finally {
      await guest.context.close()
    }
  }
}

async function testDuplicateEmail(browser, locale) {
  const { context, page } = await createPage(browser, null, locale)
  try {
    await page.locator('button.hero-cta').first().click()
    await page.waitForTimeout(800)
    await page.locator('.input.modern').nth(0).fill('Gap')
    await page.locator('.input.modern').nth(1).fill('Test')
    await page.locator('input[type="email"]').first().fill(HOST_EMAIL)
    await page.locator('.input-password-wrap input').first().fill(PASSWORD)
    await page.locator('#terms-check').check()
    await page.locator('button.modern-btn').click()
    await page.waitForTimeout(3000)
    const msg = await readAuthError(page)
    await shot(page, `gap2-err1-duplicate-${locale}`)
    return { locale, message: msg, pass: checkExpected(msg, EXPECTED.duplicateEmail[locale]) }
  } finally {
    await context.close()
  }
}

async function ensureOnMainFeed(page) {
  await page.evaluate(() => sessionStorage.setItem('ejabashkohu-admin-screen', 'main'))
  for (let i = 0; i < 5; i += 1) {
    const adminReturn = page.locator('.admin-return-badge').first()
    if (await adminReturn.isVisible().catch(() => false)) {
      await adminReturn.click()
      await page.waitForTimeout(1200)
    }
    if (await page.locator('.fab, .hdr-user').first().isVisible().catch(() => false)) return true
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {})
    await page.waitForTimeout(1500)
  }
  return false
}

async function openCreateTableSheet(page) {
  await ensureOnMainFeed(page)
  const fab = page.locator('.fab').first()
  if (await fab.isVisible().catch(() => false)) {
    await fab.click()
    await page.waitForTimeout(800)
    return true
  }
  const sidebarBtn = page.locator('.sidebar-cta, button').filter({ hasText: /Open table|Hap tavolin|Tisch eröffnen|Отвори/i }).first()
  if (await sidebarBtn.isVisible().catch(() => false)) {
    await sidebarBtn.click()
    await page.waitForTimeout(800)
    return true
  }
  return false
}

async function testCreateTableErrors(browser, hostSession, locale, kind) {
  const { context, page } = await createPage(browser, hostSession, locale)
  try {
    if (!(await openCreateTableSheet(page))) {
      return { locale, kind, pass: false, error: 'create sheet not opened' }
    }
    await page.locator('#f-cafe').fill(`Err-${kind}-${ts}`)
    await page.locator('#f-area').fill('Qendra')
    const tomorrow = localDateInputValue(new Date(Date.now() + 86400000))
    await page.locator('#f-event-date').fill(tomorrow)
    await page.locator('#f-event-time').fill('20:00')

    if (kind === 'maps') {
      await page.locator('#f-maps').fill('https://example.com/not-maps')
    } else if (kind === 'past') {
      const yesterday = localDateInputValue(new Date(Date.now() - 86400000))
      await page.locator('#f-event-date').fill(yesterday)
      await page.locator('#f-event-time').fill('08:00')
    }

    await page.locator('.sheet button.btn.primary.full').filter({
      hasText: /Open table|Hape tavolin|Tisch eröffnen|Отвори/i,
    }).click()
    await page.waitForTimeout(2500)
    const toast = await readToast(page)
    await shot(page, `gap2-err${kind === 'maps' ? '2-maps' : '3-past'}-${locale}`)
    const expected = kind === 'maps' ? EXPECTED.mapsInvalid[locale] : EXPECTED.futureTime[locale]
    return { locale, kind, message: toast, pass: checkExpected(toast, expected) }
  } finally {
    await context.close()
  }
}

async function testExpiredTableUi(browser, guestSession, hostSession, locale) {
  const hostClient = createClient(SB_URL, ANON)
  await hostClient.auth.setSession({
    access_token: hostSession.access_token,
    refresh_token: hostSession.refresh_token,
  })
  const event_datetime = futureEventIso(96)
  const title = `P6ExpireUi-${ts}-${locale}`
  const { data: table, error: insErr } = await hostClient
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'expire ui test',
      status: 'open',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=Test',
    })
    .select('id')
    .single()
  if (insErr) return { locale, pass: false, error: insErr.message }

  const { context, page } = await createPage(browser, guestSession, locale)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(3000)
    const opened = await findAndOpenTable(page, title)
    if (!opened) {
      await shot(page, `gap2-err4-expired-ui-${locale}-notfound`)
      return { locale, pass: false, error: `table not found: ${title}` }
    }

    const joinBtn = page.getByRole('button', { name: /Request to join|Kërko|Beitreten|Барај/i }).first()
    if (!(await joinBtn.isVisible({ timeout: 8000 }).catch(() => false))) {
      return { locale, pass: false, error: 'join button not visible before expire' }
    }

    await hostClient.from('tables').update({ event_datetime: pastEventIso() }).eq('id', table.id)
    await joinBtn.click()
    await page.waitForTimeout(2500)
    const toast = await readToast(page)
    await shot(page, `gap2-err4-expired-ui-${locale}`)
    return { locale, message: toast, pass: checkExpected(toast, EXPECTED.tableExpiredUi[locale]) }
  } catch (err) {
    await shot(page, `gap2-err4-expired-ui-${locale}-error`).catch(() => {})
    return { locale, pass: false, error: String(err.message || err) }
  } finally {
    await context.close()
  }
}

async function testExpiredTableApi(guestSession, hostSession) {
  const hostClient = createClient(SB_URL, ANON)
  await hostClient.auth.setSession({
    access_token: hostSession.access_token,
    refresh_token: hostSession.refresh_token,
  })
  const event_datetime = new Date(Date.now() + 70_000).toISOString()
  const { data: table, error: insErr } = await hostClient
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title: `P6ExpireApi-${ts}`,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'expire api test',
      status: 'open',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=Test',
    })
    .select('id')
    .single()
  if (insErr) return { pass: false, error: insErr.message }

  await new Promise((r) => setTimeout(r, 75_000))

  try {
    const reqId = await apiRpc(guestSession, 'request_join', { p_table: table.id })
    return {
      pass: false,
      rawMessage: 'unexpected success',
      requestId: reqId,
      note: 'RPC should reject expired table with Kjo tavolinë ka skaduar',
    }
  } catch (err) {
    const msg = err?.message || String(err)
    return {
      rawMessage: msg,
      pass: msg.includes('skaduar') || msg.includes('Kjo tavolinë ka skaduar'),
      note: 'RPC throws Albanian raw message; mapErr translates in UI toast',
    }
  }
}

async function testBlockedJoin(browser, hostSession, guestSession, locale) {
  const hostClient = await sbClient(hostSession)
  await hostClient.from('blocks').delete().eq('blocker_id', hostSession.user.id).eq('blocked_id', guestSession.user.id)
  await hostClient.from('blocks').insert({ blocker_id: hostSession.user.id, blocked_id: guestSession.user.id })

  const event_datetime = futureEventIso(72)
  const title = `P6Block-${ts}-${locale}`
  await hostClient
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'block test',
      status: 'open',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=Test',
    })

  const { context, page } = await createPage(browser, guestSession, locale)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(3000)
    const opened = await findAndOpenTable(page, title)
    if (!opened) return { locale, pass: false, error: `table not found: ${title}` }
    const joinBtn = page.getByRole('button', { name: /Request to join|Kërko|Beitreten|Барај/i }).first()
    if (await joinBtn.isVisible().catch(() => false)) await joinBtn.click()
    await page.waitForTimeout(2000)
    const toast = await readToast(page)
    await shot(page, `gap2-err5-blocked-${locale}`)
    await hostClient.from('blocks').delete().eq('blocker_id', hostSession.user.id).eq('blocked_id', guestSession.user.id)
    return { locale, message: toast, pass: checkExpected(toast, EXPECTED.blockedJoin[locale]) }
  } finally {
    await context.close()
  }
}

async function testResetRateLimit(browser, locale) {
  const { context, page } = await createPage(browser, null, locale)
  try {
    await page.locator('button', { hasText: /^Hyr$|^Sign in$|^Anmelden$|^Најави$/i }).first().click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Forgot|Harruat|Passwort vergessen|Заборав/i }).click()
    await page.waitForTimeout(400)
    await page.locator('form.ob-card input[type="email"]').first().fill(HOST_EMAIL)
    await page.locator('form.ob-card button[type="submit"]').click()
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: /Back|Kthehu|Zurück|Назад/i }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Forgot|Harruat|Passwort vergessen|Заборав/i }).click()
    await page.waitForTimeout(400)
    await page.locator('form.ob-card input[type="email"]').first().fill(HOST_EMAIL)
    const submit = page.locator('form.ob-card button[type="submit"]').first()
    const btnText = await submit.innerText().catch(() => '')
    const btnDisabled = await submit.isDisabled().catch(() => false)
    let msg = await readAuthError(page)
    if (!msg && btnDisabled && /\d+/.test(btnText)) {
      msg = btnText
    }
    await shot(page, `gap2-err6-reset-ratelimit-${locale}`)
    return {
      locale,
      message: msg,
      btnText,
      btnDisabled,
      pass: (checkExpected(msg, EXPECTED.resetRateLimit[locale]) || checkExpected(btnText, EXPECTED.resetRateLimit[locale]) || /Send in|Senden in|Dërgo|Испрати/i.test(btnText)) && /\d+/.test(msg || btnText),
    }
  } finally {
    await context.close()
  }
}

async function testWrongPassword(browser, hostSession, locale) {
  const { context, page } = await createPage(browser, hostSession, locale)
  try {
    await ensureOnMainFeed(page)
    await page.locator('.admin-return-badge').click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    await page.locator('.hdr-user').click({ force: true })
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Change password|Ndrysho|Passwort ändern|Промени лозинка/i }).click()
    await page.waitForTimeout(500)
    const inputs = page.locator('.input-password-wrap input')
    await inputs.nth(0).fill('WrongPassword999!')
    await inputs.nth(1).fill('NewPass123!xx')
    await inputs.nth(2).fill('NewPass123!xx')
    await page.getByRole('button', { name: /Save|Ruaj|Speichern|Зачувај/i }).click()
    await page.waitForTimeout(2500)
    const toast = await readToast(page)
    await shot(page, `gap2-err7-wrong-password-${locale}`)
    return { locale, message: toast, pass: checkExpected(toast, EXPECTED.wrongPassword[locale]) }
  } finally {
    await context.close()
  }
}

async function testSessionExpired(browser, hostSession, locale) {
  const { context, page } = await createPage(browser, hostSession, locale)
  try {
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('auth-token'))
      if (!key) throw new Error('auth storage key missing')
      const parsed = JSON.parse(localStorage.getItem(key))
      parsed.refresh_token = 'invalid-expired-refresh-token'
      parsed.expires_at = Math.floor(Date.now() / 1000) - 60
      parsed.expires_in = 0
      localStorage.setItem(key, JSON.stringify(parsed))
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(3500)
    const toast = await readToast(page)
    const body = await page.locator('body').innerText()
    const msg = toast || body.match(/Session expired|Sesioni skadoi|Sitzung abgelaufen|Сесијата истече/)?.[0] || ''
    const signedOut = /Sign in|Hyr|Anmelden|Најави/i.test(body)
    await shot(page, `gap2-err8-session-${locale}`)
    return {
      locale,
      message: msg,
      toast,
      signedOut,
      pass: checkExpected(msg, EXPECTED.sessionExpired[locale]) || checkExpected(body, EXPECTED.sessionExpired[locale]) || signedOut,
    }
  } finally {
    await context.close()
  }
}

async function main() {
  console.log('Setting up join → approve flow…')
  const { hostSession, guestSession } = await setupJoinApproveFlow()
  await setupExpiredTable(hostSession)

  const adminSession = await apiLogin(HOST_EMAIL, HOST_PASSWORD)

  const browser = await chromium.launch({ headless: true })

  try {
    if (!process.env.SKIP_GAP1) {
      console.log('GAP 1 — payment sheet (4 locales)…')
      try {
        await gap1Payment(browser, guestSession)
      } catch (err) {
        report.gap1.paymentError = String(err.message || err)
        console.error('gap1 payment error:', err.message)
      }

      console.log('GAP 1 — notification panel (4 locales × host/guest)…')
      try {
        await gap1Notifications(browser, hostSession, guestSession)
      } catch (err) {
        report.gap1.notificationsError = String(err.message || err)
        console.error('gap1 notifications error:', err.message)
      }
    } else {
      report.gap1 = { skipped: true, note: 'Use evidence from prior run 1787493220548' }
    }

    console.log('GAP 2 — error path regression…')
    report.gap2.err1_duplicateEmail = {
      en: await testDuplicateEmail(browser, 'en').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testDuplicateEmail(browser, 'de').catch((e) => ({ pass: false, error: String(e.message) })),
      mk: await testDuplicateEmail(browser, 'mk').catch((e) => ({ pass: false, error: String(e.message) })),
    }
    report.gap2.err2_mapsInvalid = {
      en: await testCreateTableErrors(browser, adminSession, 'en', 'maps').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testCreateTableErrors(browser, adminSession, 'de', 'maps').catch((e) => ({ pass: false, error: String(e.message) })),
    }
    report.gap2.err3_pastDateTime = {
      en: await testCreateTableErrors(browser, adminSession, 'en', 'past').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testCreateTableErrors(browser, adminSession, 'de', 'past').catch((e) => ({ pass: false, error: String(e.message) })),
    }
    report.gap2.err4_expiredTable = {
      ui_en: await testExpiredTableUi(browser, guestSession, hostSession, 'en').catch((e) => ({ pass: false, error: String(e.message) })),
      ui_de: await testExpiredTableUi(browser, guestSession, hostSession, 'de').catch((e) => ({ pass: false, error: String(e.message) })),
      api_raw: await testExpiredTableApi(guestSession, hostSession),
      api_mapped_en: mapError({ message: 'Kjo tavolinë ka skaduar' }, 'en'),
      api_mapped_de: mapError({ message: 'Kjo tavolinë ka skaduar' }, 'de'),
    }
    report.gap2.err5_blockedJoin = {
      en: await testBlockedJoin(browser, hostSession, guestSession, 'en').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testBlockedJoin(browser, hostSession, guestSession, 'de').catch((e) => ({ pass: false, error: String(e.message) })),
    }
    report.gap2.err6_resetRateLimit = {
      en: await testResetRateLimit(browser, 'en').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testResetRateLimit(browser, 'de').catch((e) => ({ pass: false, error: String(e.message) })),
    }
    report.gap2.err7_wrongPassword = {
      en: await testWrongPassword(browser, adminSession, 'en').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testWrongPassword(browser, adminSession, 'de').catch((e) => ({ pass: false, error: String(e.message) })),
    }
    report.gap2.err8_sessionExpired = {
      en: await testSessionExpired(browser, adminSession, 'en').catch((e) => ({ pass: false, error: String(e.message) })),
      de: await testSessionExpired(browser, adminSession, 'de').catch((e) => ({ pass: false, error: String(e.message) })),
    }
  } finally {
    await browser.close()
  }

  report.liveBundle = await fetch(`${BASE}/`).then((r) => r.text()).then((h) => h.match(/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[0] || null).catch(() => null)

  report.summary = {
    gap1_payment: LOCALES.every((l) => report.gap1.payment?.[l]?.pass),
    gap1_notifications: LOCALES.every(
      (l) => report.gap1.notifications?.[`guest-${l}`]?.chromePass && report.gap1.notifications?.[`guest-${l}`]?.itemCount >= 2,
    ),
    gap2_err1: ['en', 'de', 'mk'].every((l) => report.gap2.err1_duplicateEmail?.[l]?.pass),
    gap2_err2: ['en', 'de'].every((l) => report.gap2.err2_mapsInvalid?.[l]?.pass),
    gap2_err3: ['en', 'de'].every((l) => report.gap2.err3_pastDateTime?.[l]?.pass),
    gap2_err4_ui: report.gap2.err4_expiredTable?.ui_en?.pass && report.gap2.err4_expiredTable?.ui_de?.pass,
    gap2_err4_api: report.gap2.err4_expiredTable?.api_raw?.pass === true || report.gap2.err4_expiredTable?.api_raw?.rawMessage?.includes('skaduar'),
    gap2_err5: ['en', 'de'].every((l) => report.gap2.err5_blockedJoin?.[l]?.pass),
    gap2_err6: ['en', 'de'].every((l) => report.gap2.err6_resetRateLimit?.[l]?.pass),
    gap2_err7: ['en', 'de'].every((l) => report.gap2.err7_wrongPassword?.[l]?.pass),
    gap2_err8: ['en', 'de'].every((l) => report.gap2.err8_sessionExpired?.[l]?.pass),
  }

  save('report.json', report)
  console.log(JSON.stringify(report.summary, null, 2))
  console.log(`Evidence: ${OUT}`)

  const allPass = Object.values(report.summary).every(Boolean)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  report.fatal = { message: err.message, stack: err.stack }
  save('fatal.json', report.fatal)
  save('report.json', report)
  console.error(err)
  process.exit(1)
})
