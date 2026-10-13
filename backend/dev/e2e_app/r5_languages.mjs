// R5: no screen mixes languages.
// For every UI language (sq, en, de, mk) a fresh sign-up, a normal user and the admin
// visit the main screens; the visible UI text (text nodes + placeholder / aria-label /
// title / alt / <option>s) must not contain Albanian words in en/de/mk, nor English
// UI words in sq. User content from the seed (names, table titles, descriptions,
// tutor bios, restaurant names, cities …) is read from the database and removed first.
//
//   SITE=http://localhost:5175 API=http://localhost:8001 DB_NAME=ejb_lang node backend/dev/e2e_app/r5_languages.mjs [en de mk sq]
import { execSync } from 'node:child_process'
process.env.SITE ||= 'http://localhost:5175'
process.env.API ||= 'http://localhost:8001'
const DB = process.env.DB_NAME || 'ejb_lang'
const { SITE, SHOTS, check, close, launch, makeJpeg, sleep, summary, verifyLink, waitMail } = await import('./lib.mjs')
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs')
void chromium

// lib.mjs sql() is bound to ejb_dev; this suite uses its own database
const sql = (q) => execSync(`psql -h /tmp -p 54329 -U postgres -d ${DB} -tA -c ${JSON.stringify(q)}`).toString().trim()

const LANGS = process.argv.slice(2).filter((a) => /^(sq|en|de|mk)$/.test(a))
if (!LANGS.length) LANGS.push('en', 'de', 'mk', 'sq')
const USER = 'arta.krasniqi@gmail.com'
const ADMIN = 'support@ejabashkohu.com'
const PW = 'Test1234!'

// ── allowed literal content (user data from the seed + proper names) ────────
const seedStrings = new Set()
const addCol = (q) => { for (const line of sql(q).split('\n')) { const v = line.trim(); if (v.length >= 2) seedStrings.add(v) } }
addCol(`select distinct unnest(array[title, area, description, budget, city, to_city]) from tables where coalesce(title,'')<>''`)
addCol(`select distinct unnest(array[first_name, last_name, first_name || ' ' || last_name, from_place, home_city]) from profiles`)
addCol(`select distinct unnest(array[headline, bio, education, city, rejection_reason]) from tutors`)
addCol(`select distinct unnest(array[title, location_note]) from lessons`)
addCol(`select distinct unnest(array[name, address, city]) from wednesday_restaurants`)
addCol(`select distinct unnest(array[reason, details]) from reports`)
addCol(`select distinct reason from bans`)
addCol(`select distinct body from messages`)
addCol(`select distinct unnest(array[table_title, payer_name, ticket_code]) from payments`)
addCol(`select distinct unnest(array[target_label, admin_name]) from admin_audit_log`)
addCol(`select distinct note from subscriptions where note is not null`)
addCol(`select distinct note from lesson_participants where note is not null`)
// generated defaults that the app must re-localize are NOT user content
const { SYSTEM_DESCRIPTIONS, SYSTEM_AREAS } = await import('../../../hajde/src/lib/localizeTableDescription.ts').catch(() => ({}))
if (SYSTEM_DESCRIPTIONS) for (const d of Object.values(SYSTEM_DESCRIPTIONS)) for (const v of Object.values(d)) seedStrings.delete(v)
if (SYSTEM_AREAS) for (const a of Object.values(SYSTEM_AREAS)) { seedStrings.delete(a.center); seedStrings.delete(a.centerLower) }
const SEED = [...seedStrings].sort((a, b) => b.length - a.length)
const CITIES = ['Prishtinë', 'Prizren', 'Pejë', 'Gjakovë', 'Mitrovicë e Veriut', 'Mitrovicë', 'Ferizaj', 'Gjilan', 'Podujevë', 'Vushtrri', 'Suharekë',
  'Rahovec', 'Drenas', 'Lipjan', 'Malishevë', 'Kamenicë', 'Viti', 'Deçan', 'Istog', 'Klinë', 'Skenderaj', 'Dragash', 'Fushë Kosovë', 'Obiliq',
  'Shtime', 'Kaçanik', 'Junik', 'Hani i Elezit', 'Mamushë', 'Graçanicë', 'Shtërpcë', 'Novobërdë', 'Kllokot', 'Ranillug', 'Partesh',
  'Zubin Potok', 'Zveçan', 'Leposaviq', 'Tiranë', 'Shkup', 'Tetovë', 'Durrës', 'Shkodër', 'Vlorë']
// language names in their own language (language pickers) and the brand
const PROPER = ['ejaBashkohu', 'Shqip', 'Français', 'Türkçe', 'Español', 'Deutsch', 'English', 'Македонски', 'Italiano', 'Hrvatski', 'Srpski', 'Bosanski', 'Português', 'Polski', 'Русский', 'Українська', 'Ελληνικά', 'Română', 'Български', 'العربية', 'Nederlands', 'Svenska']
const ALLOWED = [...SEED, ...CITIES, ...PROPER]

// ── language markers ───────────────────────────────────────────────────────
// Distinctive Albanian UI words (none of them is an English/German/Macedonian word).
const SQ_WORDS = ['Tavolin\\w*', 'Kërko\\w*', 'Mësim\\w*', 'Mësues\\w*', 'Hyr', 'Vazhdo', 'Anulo', 'Ruaj', 'Dil', 'Kthehu', 'Regjistro\\w*', 'Njoftim\\w*',
  'Profili', 'Zbulo', 'Pako\\w*', 'Mbyll', 'Dërgo', 'Shiko', 'Shto', 'Fshi', 'Ndrysho', 'Përdorues\\w*', 'Pagesa\\w*', 'Raport\\w*', 'Pezull\\w*',
  'Aktiviteti', 'Përmbledhje', 'dhe', 'për', 'nuk', 'një', 'është', 'ose', 'apo', 'Sot', 'Nesër', 'Ora', 'vende', 'Vendi', 'Plot', 'Pije', 'Ushqim',
  'Mërkur\\w*', 'Darka', 'Bashkohu', 'Qendra', 'Nisja', 'Turist', 'Kosovë', 'Kyçu', 'Fjalëkalim\\w*', 'Gjuha', 'Emri', 'Mbiemri', 'Mosha', 'Qyteti',
  'Ngarko', 'Duke', 'Provo', 'sërish', 'Gabim', 'Konfirmo', 'Aprovo', 'Refuzo', 'Kërkesa\\w*', 'Vozitje\\w*', 'Udhëtim\\w*', 'falas', 'muaj', 'javë', 'ditë', 'orë']
const SQ_RE = new RegExp(`(?<![\\p{L}])(${SQ_WORDS.join('|')})(?![\\p{L}])|\\p{L}*[ëË]\\p{L}*`, 'u')
// English UI words that must not appear on Albanian screens.
const EN_WORDS = ['the', 'and', 'your', 'you', 'please', 'loading', 'save', 'cancel', 'search', 'sign in', 'sign up', 'log in', 'continue', 'settings',
  'delete', 'edit', 'close', 'back', 'next', 'submit', 'join', 'tables?', 'lessons?', 'notifications?', 'profile', 'error', 'failed', 'requests?',
  'seats?', 'today', 'tomorrow', 'with', 'from', 'teacher', 'users?', 'payments?', 'reports?', 'overview', 'packages?', 'month', 'week', 'free',
  'more', 'less', 'show', 'hide', 'open', 'none', 'yes', 'no', 'all', 'new', 'upload', 'photo', 'name', 'age', 'city', 'retry', 'approve', 'reject']
const EN_RE = new RegExp(`(?<![\\p{L}'])(${EN_WORDS.join('|')})(?![\\p{L}'])`, 'iu')

function cleanText(s) {
  let out = ` ${s.replace(/\s+/g, ' ')} `
  for (const a of ALLOWED) if (out.includes(a)) out = out.split(a).join(' ')
  return out.replace(/[\w.+-]+@[\w.-]+/g, ' ').replace(/https?:\/\/\S+/g, ' ')
}
function findForeign(lang, strings) {
  const re = lang === 'sq' ? EN_RE : SQ_RE
  const hits = []
  for (const s of strings) {
    const c = cleanText(s)
    const m = c.match(re)
    if (m) hits.push(`${JSON.stringify(m[0])} in ${JSON.stringify(s.trim().slice(0, 90))}`)
  }
  return [...new Set(hits)]
}

// Visible UI text: text nodes of visible elements + user-facing attributes + options of visible selects.
const COLLECT = () => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' }
  const out = []
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement
    const v = n.nodeValue.trim()
    if (!v || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue
    if (el.closest('.logo-word, .logo-bang, [data-user-content], .lang-switcher, textarea')) continue
    if (vis(el)) out.push(v)
  }
  for (const el of document.querySelectorAll('[placeholder],[aria-label],[title],img[alt]')) {
    if (!vis(el) || el.closest('.lang-switcher')) continue
    for (const a of ['placeholder', 'aria-label', 'title', 'alt']) { const v = el.getAttribute(a); if (v && v.trim()) out.push(v) }
  }
  for (const s of document.querySelectorAll('select')) if (vis(s)) for (const o of s.options) out.push(o.text)
  for (const i of document.querySelectorAll('input[type=submit],input[type=button]')) if (vis(i)) out.push(i.value)
  return out
}

let browser
async function page(lang) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: lang === 'sq' ? 'sq-AL' : lang })
  const p = await ctx.newPage()
  p.errs = []
  p.on('pageerror', (e) => p.errs.push(e.message))
  await p.goto(SITE + '/')
  await p.evaluate((l) => { localStorage.clear(); localStorage.setItem('ejabashkohu-ui-lang', l) }, lang)
  await p.reload(); await sleep(1800)
  return p
}
const shotName = (s) => s.replace(/[^\w-]+/g, '_').slice(0, 60)
const seen = new Map() // screen → count of checks, for the summary
async function screen(p, lang, name, settle = 900) {
  await sleep(settle)
  const strings = await p.evaluate(COLLECT)
  const hits = findForeign(lang, strings)
  seen.set(name, (seen.get(name) || 0) + 1)
  if (hits.length) await p.screenshot({ path: `${SHOTS}r5-${lang}-${shotName(name)}.png` }).catch(() => {})
  check(`[${lang}] ${name}: no ${lang === 'sq' ? 'English' : 'Albanian'} UI text`, hits.length === 0 && strings.length > 3,
    hits.length ? hits.slice(0, 6).join(' | ') : `only ${strings.length} strings`)
}
const click = async (p, sel, opts = {}) => { const l = p.locator(sel, opts).first(); await l.waitFor({ state: 'visible', timeout: 8000 }); await l.click(); await sleep(700) }
const has = (p, sel) => p.locator(sel).first().isVisible().catch(() => false)
const escape = async (p) => { await p.keyboard.press('Escape').catch(() => {}); await sleep(300) }
async function closeSheets(p) {
  for (let i = 0; i < 4 && await has(p, '.sheet-wrap'); i++) {
    await p.mouse.click(5, 5); await sleep(500)
  }
}
async function section(name, fn) {
  console.log(`\n── ${name}`)
  try { await fn() } catch (err) {
    const m = err.message.split('\n'); const w = m.find((l) => /waiting for|locator\(/.test(l)) || ''
    check(`${name}: finished without crashing`, false, `${m[0]} ${w.trim()}`)
  }
}

async function signIn(p, email) {
  if (await has(p, '.landing-host .btn.ghost.sm, .btn.ghost.sm')) await click(p, '.btn.ghost.sm')
  for (let i = 0; i < 6; i++) {
    await p.locator('input[type=email]').first().fill(email)
    await p.locator('.input-password-wrap input').first().fill(PW)
    await p.locator('form button[type=submit]').first().click()
    await sleep(3000)
    if (await p.evaluate(() => !!JSON.parse(localStorage.getItem('ejb-auth-session') || 'null')?.access_token)) break
    console.log('  (sign-in throttled, retrying)'); await sleep(15000)
  }
  // Basic users without a home city pick one first
  if (await has(p, '.pl-sheet select')) await click(p, '.pl-sheet .btn.primary')
}

// ── known starting state for my users ─────────────────────────────────────
const uid = (e) => sql(`select id from auth.users where email='${e}'`)
const UID = uid(USER)
sql(`update profiles set home_city='Prishtinë' where id='${UID}'`)
sql(`delete from tutors where user_id='${UID}'`)
// a notification of every common kind, so the panel has something to render
sql(`insert into notifications (id, user_id, kind, icon, body, params, read, created_at) select gen_random_uuid(), '${UID}', kind, icon, body, params, false, now() from notifications where user_id<>'${UID}' and kind in (select distinct kind from notifications) limit 6`)

browser = await launch()

for (const lang of LANGS) {
  // ═══ signed out: landing, sign-in, sign-up steps ═══
  await section(`[${lang}] signed out + sign-up`, async () => {
    const p = await page(lang)
    await screen(p, lang, 'landing')
    await click(p, '.btn.ghost.sm')
    await screen(p, lang, 'sign-in')
    // wrong password → error message in the right language
    await p.locator('input[type=email]').first().fill(USER)
    await p.locator('.input-password-wrap input').first().fill('Wrong-pass-1')
    await p.locator('form button[type=submit]').first().click(); await sleep(2500)
    await screen(p, lang, 'sign-in error')
    await p.goto(SITE + '/'); await sleep(1500)
    await click(p, '.btn.hero-cta')
    await screen(p, lang, 'sign-up step 1')
    // submit empty → validation messages
    await p.locator('.step-body .btn.primary').first().click().catch(() => {}); await sleep(600)
    await screen(p, lang, 'sign-up step 1 validation')
    const email = `r5.${lang}.${Date.now()}@gmail.com`
    await p.locator('input[placeholder]').nth(0).fill('Lena')
    await p.locator('input[placeholder]').nth(1).fill('Test')
    await p.locator('input[type=email]').fill(email)
    await p.locator('.input-password-wrap input').first().fill('Secret123!')
    await p.locator('#terms-check').check()
    const t0 = Date.now()
    await p.locator('.step-body .btn.primary').first().click(); await sleep(2500)
    await screen(p, lang, 'sign-up confirm email')
    const link = verifyLink(await waitMail(email, t0))
    check(`[${lang}] confirmation mail arrived`, !!link)
    if (!link) return
    await p.goto(link); await sleep(3500)
    await screen(p, lang, 'sign-up step 2 (age)')
    await click(p, '.step-body .btn.primary')
    await screen(p, lang, 'sign-up step 3 (photo)')
    await p.locator('input[type=file]').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: await makeJpeg(p, 900, 1200) })
    await sleep(4000)
    await screen(p, lang, 'sign-up step 3 photo checked')
    await click(p, '.step-body .btn.primary')
    await screen(p, lang, 'sign-up step 4 (local/tourist)')
    await click(p, '.choice-grid button'); await sleep(2500)
    if (await has(p, '.pl-sheet select')) { await screen(p, lang, 'home city picker'); await click(p, '.pl-sheet .btn.primary') }
    await screen(p, lang, 'first feed after sign-up')
    check(`[${lang}] no page errors (sign-up)`, p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  })

  // ═══ normal user ═══
  await section(`[${lang}] normal user`, async () => {
    const p = await page(lang)
    await signIn(p, USER)
    await p.locator('.browse-modes').first().waitFor({ timeout: 15000 })
    const modes = p.locator('.browse-mode')
    const n = await modes.count()
    for (let i = 0; i < n; i++) {
      await modes.nth(i).click(); await sleep(1300)
      const name = ['tables', 'sport', 'lessons', 'trips', 'rides'][i] || `mode${i}`
      await screen(p, lang, `feed mode ${name}`)
      if (name === 'lessons') { await p.locator('.nav button').first().click().catch(() => {}); await sleep(800); await modes.first().waitFor({ timeout: 5000 }).catch(() => {}) }
    }
    await modes.first().click(); await sleep(1000)
    // a category chip
    await p.locator('.cat-row .chip').nth(1).click().catch(() => {}); await sleep(900)
    await screen(p, lang, 'feed category filter')
    await p.locator('.cat-row .chip').first().click().catch(() => {}); await sleep(900)

    // table detail
    const card = p.locator('.content .card, .content .tbl-card, .content [class*="card"]').filter({ has: p.locator('.meta') }).first()
    if (await card.isVisible().catch(() => false)) {
      await card.click(); await sleep(1500)
      await screen(p, lang, 'table detail')
      await closeSheets(p)
    } else check(`[${lang}] a table card is visible in the feed`, false)

    // create form (all kinds)
    for (const [i, mname] of ['tables', 'sport', 'lessons', 'trips', 'rides'].entries()) {
      if (mname === 'lessons') continue
      await modes.nth(i).click(); await sleep(900)
      const fab = p.locator('.fab').first()
      if (!(await fab.isVisible().catch(() => false))) continue
      await fab.click(); await sleep(1200)
      await screen(p, lang, `create form (${mname})`)
      // submit empty → validation
      const submit = p.locator('.sheet .btn.primary').last()
      if (await submit.isVisible().catch(() => false)) { await submit.click().catch(() => {}); await sleep(800); await screen(p, lang, `create form validation (${mname})`) }
      await closeSheets(p)
    }
    await modes.first().click(); await sleep(800)

    // notifications
    await click(p, '.bell')
    await screen(p, lang, 'notifications')
    await p.locator('.notif-panel .clear').first().click().catch(() => {}); await sleep(500)

    // plans
    if (await has(p, '.premium-pill')) {
      await click(p, '.premium-pill')
      await screen(p, lang, 'plans')
      await closeSheets(p); await escape(p)
    }

    // my tables
    await click(p, '.nav button:nth-child(2)')
    await screen(p, lang, 'my tables')
    const mine = p.locator('.content [class*="card"]').filter({ has: p.locator('.meta') }).first()
    if (await mine.isVisible().catch(() => false)) { await mine.click(); await sleep(1500); await screen(p, lang, 'my table detail'); await closeSheets(p) }

    // lessons: all views + teacher form
    await click(p, '.nav button:nth-child(3)')
    for (let i = 0; i < 4; i++) {
      await p.locator('.ls-views button').nth(i).click(); await sleep(1500)
      await screen(p, lang, `lessons view ${['find', 'groups', 'mine', 'teach'][i]}`)
    }
    await p.locator('.ls-views button').nth(0).click(); await sleep(1500)
    const tutor = p.locator('.ls-card').first()
    if (await tutor.isVisible().catch(() => false)) { await tutor.click(); await sleep(1300); await screen(p, lang, 'tutor sheet'); await p.locator('.ls-close').first().click().catch(() => {}); await sleep(500) }

    // profile + edit profile
    await click(p, '.nav button:nth-child(1)')
    await click(p, '.hdr-user')
    await screen(p, lang, 'profile')
    const editBtn = p.locator('.edit-profile-btn').first()
    if (await editBtn.isVisible().catch(() => false)) { await editBtn.click(); await sleep(1200); await screen(p, lang, 'edit profile') }
    else check(`[${lang}] edit profile button found`, false)
    await closeSheets(p); await escape(p)

    // Wednesday dinner banner / quiz
    if (await has(p, '.wed-banner')) {
      await click(p, '.wed-banner'); await sleep(1000)
      await screen(p, lang, 'wednesday')
      await closeSheets(p); await escape(p)
    }
    check(`[${lang}] no page errors (user)`, p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  })

  // ═══ admin console ═══
  await section(`[${lang}] admin`, async () => {
    const p = await page(lang)
    await signIn(p, ADMIN)
    await p.locator('.adm-nav button').first().waitFor({ timeout: 15000 })
    const nav = p.locator('.adm-nav button')
    const n = await nav.count()
    for (let i = 0; i < n; i++) {
      await nav.nth(i).click(); await sleep(1800)
      const title = (await p.locator('.adm-top-title').innerText().catch(() => `page ${i}`)).trim()
      await screen(p, lang, `admin ${i + 1} ${title}`)
      // open the first row's drawer where there is a table of rows
      const row = p.locator('.adm-content .adm-table tbody tr').first()
      if (await row.isVisible().catch(() => false)) {
        await row.click(); await sleep(1800)
        if (await has(p, '.adm-drawer')) {
          await screen(p, lang, `admin ${i + 1} ${title} drawer`)
          const segs = p.locator('.adm-drawer .adm-seg button')
          const sc = await segs.count()
          for (let j = 1; j < sc; j++) { await segs.nth(j).click(); await sleep(700); await screen(p, lang, `admin ${i + 1} ${title} drawer tab ${j + 1}`, 300) }
        }
        await escape(p); await escape(p)
      }
    }
    check(`[${lang}] no page errors (admin)`, p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  })
}

await close()
console.log(`\nscreens checked: ${seen.size} distinct, ${[...seen.values()].reduce((a, b) => a + b, 0)} visits`)
process.exit(summary() ? 1 : 0)
