// R3: tables / sports / trips / rides, live listings, share links, Basic & Premium limits,
// startup performance. Real app + Django + Postgres + Redis.
//   cd backend/dev && node e2e_app/r3_tables.mjs
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { API, SITE, SHOTS, api, bodyText, check, close, launch, newPage, section as section0, signIn as signIn0, sleep, sql, summary, token } from './lib.mjs'

const U = (n) => `${n}@gmail.com`
const HOST = U('agon.begolli')          // Premium host (creates many listings)
const ANA = U('ana.petrovska'), BESA = U('besa.hyseni'), DARDAN = U('dardan.maloku')
const ELENA = U('elena.stojanova'), ELIRA = U('elira.dobruna'), FATOS = U('fatos.jashari')
const GRESA = U('gresa.leka'), LIAM = U('liam.weber'), LORIK = U('lorik.bajrami')
const EMMA = U('emma.schmidt')          // Basic, Gjakovë
const LUKAS = U('lukas.muller')         // Premium, Prizren
const MARKO = U('marko.nikolov')        // Basic, Prishtinë (monthly limit)
const ALL = [HOST, ANA, BESA, DARDAN, ELENA, ELIRA, FATOS, GRESA, LIAM, LORIK, EMMA, LUKAS, MARKO]
const inList = ALL.map((e) => `'${e}'`).join(',')
const id = {}
for (const e of ALL) id[e] = sql(`select id from auth.users where email='${e}'`)

// ── known starting point (only my own users) ──
sql(`update auth.users set email_confirmed_at=now() where email in (${inList}) and email_confirmed_at is null`)
sql(`delete from connections where a in (select id from auth.users where email in (${inList})) and b in (select id from auth.users where email in (${inList}))`)
sql(`update profiles set home_city='Prishtinë', home_city_changed_at=null where id in (select id from auth.users where email in (${inList}))`)
sql(`update profiles set home_city='Gjakovë' where id='${id[EMMA]}'`)
sql(`update profiles set home_city='Prizren' where id='${id[LUKAS]}'`)
sql(`delete from blocks where blocker_id in (select id from auth.users where email in (${inList})) or blocked_id in (select id from auth.users where email in (${inList}))`)
sql(`delete from tables where host_id in (select id from auth.users where email in (${inList})) and created_at > now() - interval '40 days'`)
sql(`delete from requests where user_id in (select id from auth.users where email in (${inList})) and created_at > now() - interval '40 days'`)
sql(`delete from subscriptions where user_id in (select id from auth.users where email in (${inList}))`)
for (const e of [HOST, LUKAS]) sql(`insert into subscriptions (id,user_id,plan_id,starts_at,ends_at,status,source,amount_cents,created_at) values (gen_random_uuid(),'${id[e]}','premium_1m',now()-interval '1 hour',now()+interval '20 days','active','admin_grant',0,now())`)

const RUN = Date.now().toString(36).slice(-5)
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const iso = (days, h = 19) => { const d = new Date(Date.now() + days * 864e5); d.setUTCHours(h, 0, 0, 0); return d.toISOString() }
const tok = {}
async function tk(e) {   // sign-ins are rate limited per IP (shared with other suites): retry
  if (!tok[e] || Date.now() - tok[e].at > 40 * 60e3) {
    let t
    for (let i = 0; i < 8 && !t; i++) { t = await token(e); if (!t) await sleep(10000) }
    tok[e] = { t, at: Date.now() }
  }
  return tok[e].t
}
async function signIn(p, e) {
  for (let i = 0; i < 6; i++) {
    await signIn0(p, e)
    if (await p.locator('.fab, .browse-modes').first().isVisible().catch(() => false)) return
    await sleep(12000); await p.goto(SITE + '/'); await sleep(1200)
  }
}
const q = async (e, body) => api('/rest/v1/query', body, await tk(e))
const rpc = async (e, name, args) => api(`/rest/v1/rpc/${name}`, args, e ? await tk(e) : undefined)
const row = (query) => JSON.parse(sql(`select row_to_json(t) from (${query}) t`) || 'null')
async function newTable(e, v) {
  const r = await q(e, { table: 'tables', action: 'insert', returning: true, single: true, select: 'id,share_code', values: {
    host_id: id[e], kind: 'tavoline', category: 'kafe', city: 'Prishtinë', area: 'Qendër', spots: 4, time_label: 'x',
    event_datetime: iso(2), maps_link: 'https://maps.app.goo.gl/r3test', ...v } })
  return r.data || r
}
// guest takes a seat through the same calls the app makes (request -> approve -> pay stub / free seat)
async function seat(e, t, host = HOST, kind = 'tavoline') {
  const r = await rpc(e, 'request_join', { p_table: t })
  if (r.status !== 200) return r
  const a = await rpc(host, 'approve_request', { p_request: r.data })
  if (a.status !== 200) return a
  return confirm(e, t, kind)
}
async function confirm(e, t, kind = 'tavoline') {
  if (kind === 'vozitje') return rpc(e, 'confirm_free_seat', { p_table: t })
  const m = await q(e, { table: 'memberships', action: 'insert', values: { table_id: t, user_id: id[e], role: 'member' } })
  if (m.status !== 200) return m
  await q(e, { table: 'requests', action: 'update', values: { status: 'confirmed' }, filters: [{ col: 'table_id', op: 'eq', value: t }, { col: 'user_id', op: 'eq', value: id[e] }] })
  return q(e, { table: 'payments', action: 'insert', values: { user_id: id[e], table_id: t, amount_cents: 200, currency: 'EUR', provider: 'stub', provider_ref: 'STUB-' + Date.now(), status: 'paid', ticket_code: 'EBK-' + (1000 + Math.floor(Math.random() * 9000)) + Math.random().toString(36).slice(2, 6), refundable: false } })
}
const members = (t) => Number(sql(`select count(*) from memberships where table_id='${t}'`))
const notif = (e, kind, since) => Number(sql(`select count(*) from notifications where user_id='${id[e]}' and kind='${kind}' and created_at >= '${since}'`))
const visibleTo = async (e, t) => ((await q(e, { table: 'tables', action: 'select', select: 'id', filters: [{ col: 'id', op: 'eq', value: t }] })).data || []).length === 1
const titles = async (p) => (await p.locator('.card-body h3').allInnerTexts()).map((s) => s.trim())
const cardsText = async (p) => (await p.locator('.cards').allInnerTexts().catch(() => [])).join(' ')
async function openShare(p, code) { await p.goto(`${SITE}/t/${code}`); await sleep(2800) }
async function mode(p, m) {
  if (!(await p.locator('.browse-modes').isVisible().catch(() => false))) { await p.locator('nav button, .tabbar button, .bottom-nav button, button', { hasText: 'Zbulo' }).first().click().catch(() => {}); await sleep(800) }
  await p.locator('.browse-mode', { hasText: m }).click(); await sleep(800)
}
const pages = []
// 429s on sign-in come from the per-IP limit shared with other suites running at the same time
const bad = (p) => p.bad.filter((b) => !/^429 \/auth\/v1\/token/.test(b))
let secNo = 0
async function section(name, fn) {   // on a crash, keep a screenshot of every open page
  const n = ++secNo
  await section0(name, async () => {
    try { await fn() } catch (err) {
      for (const [i, p] of [host, ...pages].entries()) await p?.screenshot({ path: `${SHOTS}r3-crash-${n}-${i}.png` }).catch(() => {})
      throw err
    }
  })
}

await launch()
var host = await newPage()
host.on('dialog', (d) => d.accept())
await signIn(host, HOST)
const T = {}   // created listings: kind -> {id, share_code, title}

await section('Create one listing of each kind in the browser (tavoline, sport, udhetim, vozitje)', async () => {
  const fill = async (sel, v) => host.locator(sel).fill(v)
  const open = async (modeBtn) => {
    await host.goto(SITE + '/'); await sleep(2200)
    await host.locator('.fab').click(); await sleep(700)
    await host.locator('.mode-toggle .mode-btn').nth(modeBtn).click(); await sleep(300)
  }
  const common = async (date, time, spots, desc) => {
    await fill('#f-maps', 'https://maps.app.goo.gl/r3' + RUN)
    await fill('#f-event-date', date); await fill('#f-event-time', time)
    await host.locator('input.range').fill(String(spots))
    await fill('#f-desc', desc)
  }
  // tavoline
  await open(0)
  await fill('#f-cafe', `Kafe R3 ${RUN}`); await fill('#f-area', 'Dardania')
  await common(day(2), '19:30', 5, 'Kafe dhe bisedë')
  await host.screenshot({ path: SHOTS + 'r3-create-tavoline.png' })
  await host.locator('.btn.primary.full', { hasText: 'Hape tavolinën' }).click(); await sleep(2500)
  T.tavoline = row(`select id, share_code, title, kind, category, spots, description from tables where title='Kafe R3 ${RUN}'`)
  check('tavoline stored (kind, category, 5 spots, description)', T.tavoline?.kind === 'tavoline' && T.tavoline.spots === 5 && T.tavoline.description === 'Kafe dhe bisedë', JSON.stringify(T.tavoline))
  check('after create the address bar shows /t/<code>', new URL(host.url()).pathname === `/t/${T.tavoline?.share_code}`, host.url())
  // sport: football, 6 players, intermediate
  await open(1)
  await host.locator('.sport-pick .chip', { hasText: 'Futboll' }).click()
  await host.locator('.cat-row.wrap .chip', { hasText: /Mesatar|Intermediate/ }).first().click().catch(() => {})
  await fill('#f-cafe', `Fusha R3 ${RUN}`)
  await common(day(3), '18:00', 6, 'Futboll 3 me 3')
  await host.locator('.btn.primary.full', { hasText: 'Hap lojën' }).click(); await sleep(2500)
  T.sport = row(`select id, share_code, title, kind, category, sport, skill_level, spots from tables where title='Fusha R3 ${RUN}'`)
  check('football game stored: kind=sport, sport=football, 6 players, skill level', T.sport?.sport === 'football' && T.sport.spots === 6 && T.sport.skill_level && T.sport.skill_level !== null, JSON.stringify(T.sport))
  check('skill level from the form stored (intermediate)', T.sport?.skill_level === 'intermediate', T.sport?.skill_level)
  // udhetim
  await open(3)
  await fill('#f-dest', `Rugova R3 ${RUN}`); await fill('#f-budget', '20€')
  await common(day(4), '08:00', 5, 'Ecje në Rugovë')
  await host.locator('.btn.primary.full').last().click(); await sleep(2500)
  T.udhetim = row(`select id, share_code, title, kind, category, budget from tables where title='Rugova R3 ${RUN}'`)
  check('trip stored: kind=udhetim, budget', T.udhetim?.kind === 'udhetim' && T.udhetim.category === 'udhetim' && T.udhetim.budget === '20€', JSON.stringify(T.udhetim))
  // vozitje
  await open(2)
  await host.locator('#f-tocity').selectOption('Prizren')
  await fill('#f-pickup', `Pika R3 ${RUN}`)
  await common(day(2), '07:15', 3, 'Vozitje në mëngjes')
  await host.locator('.btn.primary.full').last().click(); await sleep(2500)
  T.vozitje = row(`select id, share_code, title, kind, to_city, area, spots from tables where host_id='${id[HOST]}' and kind='vozitje' and area like '%R3 ${RUN}%'`)
  check('ride stored: kind=vozitje, Prishtinë → Prizren, 3 seats', T.vozitje?.to_city === 'Prizren' && T.vozitje.spots === 3, JSON.stringify(T.vozitje))
  await host.screenshot({ path: SHOTS + 'r3-ride-created.png' })
  const codes = Object.values(T).map((t) => t?.share_code)
  check('each listing has its own share code', codes.every(Boolean) && new Set(codes).size === codes.length, codes.join(','))
  check('host page: no failed API calls while creating', bad(host).length === 0, bad(host).join(' | '))
})

await section('Edit a listing (title, time, spots, description); share link never changes', async () => {
  const before = T.tavoline.share_code
  const newTime = iso(5, 18)
  const r = await q(HOST, { table: 'tables', action: 'update', values: { title: `Kafe R3 ${RUN} (ndryshuar)`, event_datetime: newTime, spots: 6, description: 'Përshkrim i ri', share_code: 'hack-code-123' }, filters: [{ col: 'id', op: 'eq', value: T.tavoline.id }] })
  const t = row(`select title, spots, description, share_code, event_datetime from tables where id='${T.tavoline.id}'`)
  check('host can edit title / time / spots / description (stored)', r.status === 200 && t.title.endsWith('(ndryshuar)') && t.spots === 6 && t.description === 'Përshkrim i ri' && new Date(t.event_datetime).getTime() === new Date(newTime).getTime(), JSON.stringify(t))
  check('share code unchanged after edit (even if the client tries to change it)', t.share_code === before, t.share_code)
  T.tavoline.title = t.title
  const r2 = await q(ANA, { table: 'tables', action: 'update', count: 'exact', values: { title: 'hijacked' }, filters: [{ col: 'id', op: 'eq', value: T.tavoline.id }] })
  check('a non-host cannot edit the listing', sql(`select title from tables where id='${T.tavoline.id}'`) === t.title, JSON.stringify(r2))
  console.log('  info: [MISSING] the app has no "edit listing" screen; edits are only possible through the API (api/tables.js updateTable is unused)')
  await openShare(host, before)
  check('the old link opens the edited table', (await host.locator('.sheet h2').innerText().catch(() => '')).includes('(ndryshuar)'))
})

const ana = await newPage(); pages.push(ana); ana.on('dialog', (d) => d.accept())
await signIn(ana, ANA)

await section('Guest: request, cancel, request again, host approves live, pay €2, leave', async () => {
  await openShare(ana, T.tavoline.share_code)
  await ana.locator('button', { hasText: "Kërko t'i bashkohesh" }).click(); await sleep(2000)
  check('request stored as pending', sql(`select status from requests where table_id='${T.tavoline.id}' and user_id='${id[ANA]}'`) === 'pending')
  await ana.locator('.link-btn', { hasText: 'Anulo kërkesën' }).click(); await sleep(2000)
  check('guest can cancel the request (row removed)', sql(`select count(*) from requests where table_id='${T.tavoline.id}' and user_id='${id[ANA]}'`) === '0')
  check('after cancelling the "request to join" button is back', await ana.locator('button', { hasText: "Kërko t'i bashkohesh" }).isVisible().catch(() => false))
  const since = sql('select now()')
  await ana.locator('button', { hasText: "Kërko t'i bashkohesh" }).click(); await sleep(2000)
  check('host notified of the request', notif(HOST, 'requestReceived', since) + Number(sql(`select count(*) from notifications where user_id='${id[HOST]}' and created_at>='${since}' and body like '%kërkon%'`)) > 0)
  await openShare(host, T.tavoline.share_code)
  await host.locator('.btn-approve').first().waitFor({ timeout: 8000 }).catch(() => {})
  await host.locator('.btn-approve').first().click(); await sleep(3000)
  const btn = ana.locator('button', { hasText: /U aprovove/ })
  await btn.first().waitFor({ timeout: 8000 }).catch(() => {})
  check('guest sees "approved, confirm" live', await btn.count() > 0)
  check('button says €2.00 for a table', /2[.,]00/.test(await btn.first().innerText().catch(() => '')))
  await btn.first().click(); await sleep(800)
  await ana.locator('.method', { hasText: /PayPal/i }).click().catch(() => {})
  await ana.locator('button', { hasText: /Paguaj/ }).first().click(); await sleep(3500)
  check('seat confirmed (membership) + €2 payment', members(T.tavoline.id) === 2 && sql(`select amount_cents from payments where table_id='${T.tavoline.id}' and user_id='${id[ANA]}'`) === '200')
  check('host notified that the guest confirmed the seat', notif(HOST, 'hostSeatConfirmedNotif', since) === 1)
  await ana.locator('.sheet-wrap').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); await sleep(500)
  await ana.screenshot({ path: SHOTS + 'r3-guest-joined.png' })
  // besa requests and gets rejected (host UI)
  await rpc(BESA, 'request_join', { p_table: T.tavoline.id })
  await openShare(host, T.tavoline.share_code)
  await host.locator('.btn-reject').first().waitFor({ timeout: 6000 }).catch(() => {})
  await host.locator('.btn-reject').first().click(); await sleep(2000)
  check('host rejects a request (status rejected)', sql(`select status from requests where table_id='${T.tavoline.id}' and user_id='${id[BESA]}'`) === 'rejected')
  check('rejected guest cannot confirm a seat', (await confirm(BESA, T.tavoline.id)).status >= 400)
  // ana leaves
  await openShare(ana, T.tavoline.share_code)
  await ana.locator('button', { hasText: /Largohu/ }).first().click(); await sleep(2500)
  check('guest leaves the table (membership gone)', members(T.tavoline.id) === 1)
  check('guest + host pages: no failed API calls', bad(ana).length === 0 && bad(host).length === 0, [...bad(ana), ...bad(host)].join(' | '))
})

await section('Ride: approved guest confirms the seat for free', async () => {
  await rpc(DARDAN, 'request_join', { p_table: T.vozitje.id })
  await rpc(HOST, 'approve_request', { p_request: sql(`select id from requests where table_id='${T.vozitje.id}' and user_id='${id[DARDAN]}'`) })
  const d = await newPage(); pages.push(d)
  await signIn(d, DARDAN); await openShare(d, T.vozitje.share_code)
  const b = d.locator('button', { hasText: /U aprovove/ })
  check('ride button has no price', (await b.count()) > 0 && !/€|2[.,]00/.test(await b.first().innerText()), await b.first().innerText().catch(() => ''))
  await b.first().click(); await sleep(2500)
  check('free seat confirmed: membership, no payment', members(T.vozitje.id) === 2 && sql(`select count(*) from payments where table_id='${T.vozitje.id}'`) === '0')
  check('paid-seat RPC refused for non-ride tables', (await rpc(ANA, 'confirm_free_seat', { p_table: T.tavoline.id })).status >= 400)
  check('dardan page: no failed API calls', bad(d).length === 0, bad(d).join(' | '))
  await d.context().close()
})

await section('Chat: members talk live, non-members cannot read or write', async () => {
  await seat(ANA, T.tavoline.id)
  await openShare(ana, T.tavoline.share_code); await openShare(host, T.tavoline.share_code)
  const text = `Mirëdita nga R3 ${RUN}`
  await ana.locator('.chat-input input').fill(text); await ana.locator('.chat-input .send').click(); await sleep(3000)
  check('message stored', sql(`select count(*) from messages where table_id='${T.tavoline.id}' and body='${text}'`) === '1')
  check('host sees the message live', (await host.locator('.chat-msgs').innerText().catch(() => '')).includes(text))
  const r = await q(BESA, { table: 'messages', action: 'select', select: 'body', filters: [{ col: 'table_id', op: 'eq', value: T.tavoline.id }] })
  check('non-member reads 0 messages', r.status === 200 && (r.data || []).length === 0, JSON.stringify(r).slice(0, 120))
  const w = await q(BESA, { table: 'messages', action: 'insert', values: { table_id: T.tavoline.id, sender_id: id[BESA], body: 'spam' } })
  check('non-member cannot post', w.status >= 400)
  const b = await newPage(); pages.push(b); await signIn(b, BESA); await openShare(b, T.tavoline.share_code)
  check('non-member sees the locked chat text, not the messages', !(await bodyText(b)).includes(text))
  await b.context().close()
})

await section('Sports A4: 6 players max, 7th waitlisted, auto promotion, no overbooking', async () => {
  const t = T.sport.id
  for (const e of [ANA, BESA, DARDAN, ELENA]) { const r = await seat(e, t); if (r.status !== 200) console.log('  seat failed', e, JSON.stringify(r).slice(0, 200)) }
  check('5/6 after four guests', members(t) === 5)
  const rE = await rpc(ELIRA, 'request_join', { p_table: t }); const rG = await rpc(GRESA, 'request_join', { p_table: t })
  await rpc(HOST, 'approve_request', { p_request: rE.data }); await rpc(HOST, 'approve_request', { p_request: rG.data })
  await confirm(ELIRA, t)
  check('6th player takes the last place', members(t) === 6)
  const over = await confirm(GRESA, t)
  check('7th approved player cannot take a seat beyond 6 (no overbooking)', members(t) === 6 && over.status >= 400, JSON.stringify(over).slice(0, 150))
  const r7 = await rpc(FATOS, 'request_join', { p_table: t })
  check('a new request on a full game is refused with a waitlist hint', r7.status >= 400 && /plot|pritjes/i.test(r7.message), r7.message)
  const wG = await q(GRESA, { table: 'waitlist', action: 'insert', values: { table_id: t, user_id: id[GRESA] } })
  check('player joins the waitlist (API)', wG.status === 200, JSON.stringify(wG).slice(0, 120))
  const f = await newPage(); pages.push(f); await signIn(f, FATOS); await openShare(f, T.sport.share_code)
  const wb = f.locator('button', { hasText: /pritjes/i })
  check('full game shows "join the waitlist" in the browser', await wb.first().isVisible().catch(() => false), (await bodyText(f)).slice(0, 200))
  await wb.first().click(); await sleep(2000)
  check('waitlist row stored from the browser', sql(`select count(*) from waitlist where table_id='${t}' and user_id='${id[FATOS]}'`) === '1')
  const since = sql('select now()')
  await rpc(ELIRA, 'leave_table', { p_table: t }); await sleep(500)
  check('when someone leaves, the first on the waitlist is approved automatically', sql(`select status from requests where table_id='${t}' and user_id='${id[GRESA]}'`) === 'approved' && sql(`select count(*) from waitlist where table_id='${t}' and user_id='${id[GRESA]}'`) === '0')
  check('promoted player is notified', Number(sql(`select count(*) from notifications where user_id='${id[GRESA]}' and created_at>='${since}' and body like '%lirua%'`)) === 1)
  check('second on the waitlist stays waiting', sql(`select count(*) from waitlist where table_id='${t}' and user_id='${id[FATOS]}'`) === '1')
  await confirm(GRESA, t)
  check('promoted player confirms: 6/6 again', members(t) === 6)
  check('fatos page: no failed API calls', bad(f).length === 0, bad(f).join(' | '))
  await f.context().close()
})

await section('Sports A4: exact filtering per sport and per mode', async () => {
  const vb = await newTable(HOST, { kind: 'sport', category: 'sport', sport: 'volleyball', skill_level: 'any', title: `Volej R3 ${RUN}`, spots: 8 })
  T.volley = vb
  const g = await newPage(); pages.push(g); await signIn(g, LIAM); await sleep(1000)
  const fb = T.sport.title, vt = `Volej R3 ${RUN}`
  await mode(g, 'Sport')
  await g.locator('.sport-row .chip', { hasText: 'Futboll' }).click(); await sleep(600)
  const a = await titles(g)
  await g.locator('.sport-row .chip', { hasText: 'Volejboll' }).click(); await sleep(600)
  const b = await titles(g)
  await g.locator('.sport-row .chip', { hasText: 'Basketboll' }).click(); await sleep(600)
  const c = await titles(g)
  check('Futboll shows the football game and not the volleyball game', a.includes(fb) && !a.includes(vt), a.join(', '))
  check('Volejboll shows the volleyball game and not the football game', b.includes(vt) && !b.includes(fb), b.join(', '))
  check('Basketboll shows neither', !c.includes(fb) && !c.includes(vt), c.join(', '))
  await g.screenshot({ path: SHOTS + 'r3-sport-filter.png' })
  for (const m of ['Tavolinat', 'Udhëtimet', 'Vozitjet']) {
    await mode(g, m); const x = await titles(g)
    check(`sport games do not appear under ${m}`, !x.includes(fb) && !x.includes(vt), x.join(', '))
  }
  check('liam page: no failed API calls', bad(g).length === 0, bad(g).join(' | '))
  await g.context().close()
})

await section('A9: live listings appear only in their own mode, closed ones disappear live', async () => {
  const v1 = await newPage(); const v2 = await newPage({ width: 1280, height: 800 }); pages.push(v1, v2)
  await signIn(v1, GRESA); await signIn(v2, ELENA)
  const KINDS = {
    Tavolinat: { kind: 'tavoline', category: 'kafe' },
    Sport: { kind: 'sport', category: 'sport', sport: 'tennis', skill_level: 'any' },
    Udhëtimet: { kind: 'udhetim', category: 'udhetim' },
    Vozitjet: { kind: 'vozitje', category: 'vozitje', to_city: 'Pejë' },
  }
  for (const m of ['Tavolinat', 'Sport', 'Mësimet', 'Udhëtimet', 'Vozitjet']) {
    await v1.goto(SITE + '/'); await v2.goto(SITE + '/'); await sleep(2500)
    await mode(v1, m); await mode(v2, m)
    const made = {}
    for (const [km, v] of Object.entries(KINDS)) {
      const tag = `L${RUN}${m.slice(0, 3)}${v.kind.slice(0, 3)}`
      made[km] = { tag, ...(await newTable(HOST, { ...v, title: v.kind === 'vozitje' ? 'Prishtinë → Pejë' : tag, area: tag, event_datetime: iso(1, 20) })) }
    }
    await sleep(4500)
    for (const [p, nm] of [[v1, 'phone'], [v2, 'desktop']]) {
      const txt = m === 'Mësimet' ? await bodyText(p) : await cardsText(p)
      const shown = Object.entries(made).filter(([, x]) => txt.includes(x.tag)).map(([k]) => k)
      const expect = m === 'Mësimet' ? [] : [m]
      check(`${m} (${nm}): new listings appear live only in their own mode`, JSON.stringify(shown) === JSON.stringify(expect), `shown: ${shown.join(',')}`)
    }
    if (m !== 'Mësimet') {
      await q(HOST, { table: 'tables', action: 'update', values: { status: 'cancelled' }, filters: [{ col: 'id', op: 'eq', value: made[m].id }] })
      await sleep(4000)
      const after = await cardsText(v1)
      check(`${m}: closed listing disappears live`, !after.includes(made[m].tag))
    }
    for (const x of Object.values(made)) sql(`update tables set status='cancelled' where id='${x.id}'`)
  }
  await v1.screenshot({ path: SHOTS + 'r3-live-phone.png' }); await v2.screenshot({ path: SHOTS + 'r3-live-desktop.png' })
  check('viewers: no page errors or failed calls', !v1.errs.length && !v2.errs.length && !bad(v1).length && !bad(v2).length, [...v1.errs, ...v2.errs, ...bad(v1), ...bad(v2)].join(' | '))
  await v1.context().close(); await v2.context().close()
})

await section('Close/cancel a listing: members, requesters and waitlist notified; listing gone', async () => {
  const t = await newTable(HOST, { title: `Mbyll R3 ${RUN}`, spots: 2 })
  await seat(ANA, t.id)                               // 2/2, full
  await q(DARDAN, { table: 'waitlist', action: 'insert', values: { table_id: t.id, user_id: id[DARDAN] } })
  const since = sql('select now()')
  await openShare(host, t.share_code)
  await host.locator('.btn-delete-table').click(); await sleep(2500)
  check('host closes from the browser (status cancelled)', sql(`select status from tables where id='${t.id}'`) === 'cancelled')
  check('member notified (tableClosedByHostNotif)', notif(ANA, 'tableClosedByHostNotif', since) === 1)
  check('waitlisted user notified', notif(DARDAN, 'tableClosedByHostNotif', since) === 1)
  check('host not notified about their own action', notif(HOST, 'tableClosedByHostNotif', since) === 0)
  check('closed listing no longer visible to guests', !(await visibleTo(BESA, t.id)))
  check('new requests refused on a closed listing', (await rpc(BESA, 'request_join', { p_table: t.id })).status >= 400)
  const p = await rpc(null, 'table_share_preview', { p_code: t.share_code })
  check('share preview says closed', p.data?.status === 'closed', JSON.stringify(p.data))
  check('host page: no failed calls on close', bad(host).length === 0, bad(host).join(' | '))
  // delete: no button in the app (closing is the delete); API allows host only
  const d = await newTable(HOST, { title: `Fshi R3 ${RUN}` })
  await q(ANA, { table: 'tables', action: 'delete', filters: [{ col: 'id', op: 'eq', value: d.id }] })
  check('non-host cannot delete', sql(`select count(*) from tables where id='${d.id}'`) === '1')
  await q(HOST, { table: 'tables', action: 'delete', filters: [{ col: 'id', op: 'eq', value: d.id }] })
  check('host can delete through the API', sql(`select count(*) from tables where id='${d.id}'`) === '0')
})

await section('After the event: rate host, pick connections, report, block', async () => {
  const t = await newTable(HOST, { title: `Pas R3 ${RUN}` })
  await seat(ANA, t.id); await seat(BESA, t.id)
  sql(`update tables set created_at=now()-interval '3 days', event_datetime=now()-interval '2 hours' where id='${t.id}'`)
  const r1 = await q(ANA, { table: 'ratings', action: 'insert', values: { table_id: t.id, rater_id: id[ANA], stars: 4, meet_again: true } })
  check('member rates the host after the event', r1.status === 200, JSON.stringify(r1).slice(0, 150))
  check("host's rating is the average of their ratings", Number(sql(`select rating from profiles where id='${id[HOST]}'`)) === Number(sql(`select round(avg(stars)::numeric,2) from ratings r join tables t on t.id=r.table_id where t.host_id='${id[HOST]}'`)))
  check('non-member cannot rate', (await q(DARDAN, { table: 'ratings', action: 'insert', values: { table_id: t.id, rater_id: id[DARDAN], stars: 1, meet_again: false } })).status >= 400)
  const since = sql('select now()')
  await q(ANA, { table: 'connection_picks', action: 'insert', values: { table_id: t.id, picker_id: id[ANA], picked_id: id[BESA] } })
  check('one-sided pick creates no connection', sql(`select count(*) from connections where (a='${id[ANA]}' and b='${id[BESA]}') or (a='${id[BESA]}' and b='${id[ANA]}')`) === '0')
  await q(BESA, { table: 'connection_picks', action: 'insert', values: { table_id: t.id, picker_id: id[BESA], picked_id: id[ANA] } })
  check('mutual pick creates a connection + notifies both', sql(`select count(*) from connections where (a='${id[ANA]}' and b='${id[BESA]}') or (a='${id[BESA]}' and b='${id[ANA]}')`) === '1' && Number(sql(`select count(*) from notifications where user_id in ('${id[ANA]}','${id[BESA]}') and created_at>='${since}' and body like '%ndërsjellë%'`)) === 2)
  check('non-member cannot pick', (await q(DARDAN, { table: 'connection_picks', action: 'insert', values: { table_id: t.id, picker_id: id[DARDAN], picked_id: id[ANA] } })).status >= 400)
  // after the event the guest's "my tables" still lists the table, so it can be rated
  await ana.goto(SITE + '/'); await sleep(2500)
  await ana.locator('nav button, .tabbar button, .bottom-nav button', { hasText: /Imet|Tavolinat e mia/ }).first().click().catch(() => {}); await sleep(1200)
  const mine = await bodyText(ana)
  check('past table is listed in the guest\'s "my tables" with the rate button', mine.includes(`Pas R3 ${RUN}`))
  // report from the browser
  await openShare(ana, T.vozitje.share_code)
  await ana.locator('.host-actions .icon-btn.flag').click(); await sleep(600)
  await ana.locator('.ob-choice .choice').first().click()
  await ana.locator('button', { hasText: /Raporto|Dërgo/ }).last().click(); await sleep(2000)
  check('report stored from the browser', sql(`select count(*) from reports where reporter_id='${id[ANA]}' and reported_id='${id[HOST]}' and created_at > now() - interval '1 minute'`) === '1')
  check('reporter cannot read other reports', ((await q(BESA, { table: 'reports', action: 'select', select: 'id', filters: [{ col: 'reporter_id', op: 'eq', value: id[ANA] }] })).data || []).length === 0)
  check('ana page: no failed calls', bad(ana).length === 0, bad(ana).join(' | '))
  sql(`delete from reports where reporter_id='${id[ANA]}' and created_at > now() - interval '5 minutes'`)
})

await section('Block: the blocked user\'s listings disappear both ways', async () => {
  const lt = await newTable(LORIK, { title: `Lorik R3 ${RUN}` })
  const mt = await newTable(LIAM, { title: `Liam R3 ${RUN}` })
  check('before blocking both see each other\'s listing', (await visibleTo(LIAM, lt.id)) && (await visibleTo(LORIK, mt.id)))
  const l = await newPage(); pages.push(l); l.on('dialog', (d) => d.accept())
  await signIn(l, LIAM); await openShare(l, lt.share_code)
  await l.locator('.host-actions .btn', { hasText: /Blloko/ }).click(); await sleep(2000)
  check('block stored from the browser', sql(`select count(*) from blocks where blocker_id='${id[LIAM]}' and blocked_id='${id[LORIK]}'`) === '1')
  check('blocker no longer sees the blocked user\'s listing', !(await visibleTo(LIAM, lt.id)))
  check('blocked user no longer sees the blocker\'s listing', !(await visibleTo(LORIK, mt.id)))
  check('join refused both ways', (await rpc(LIAM, 'request_join', { p_table: lt.id })).status >= 400 && (await rpc(LORIK, 'request_join', { p_table: mt.id })).status >= 400)
  check('share link of the blocked user gives no preview', (await rpc(LIAM, 'table_share_preview', { p_code: lt.share_code })).data == null)
  await l.goto(SITE + '/'); await sleep(2500)
  check('feed of the blocker does not show it', !(await titles(l)).includes(`Lorik R3 ${RUN}`))
  check('liam page: no failed calls', bad(l).length === 0, bad(l).join(' | '))
  await l.context().close()
  sql(`delete from blocks where blocker_id='${id[LIAM]}'`)
})

await section('P5: share links (unique, stable, signed out preview, signed in opens, crawler)', async () => {
  const anon = await newPage(); pages.push(anon)
  await anon.goto(`${SITE}/t/${T.udhetim.share_code}`); await sleep(2500)
  const card = await anon.locator('.share-card').innerText().catch(() => '')
  check('signed out: preview card with the title', card.includes(`Rugova R3 ${RUN}`), card.replace(/\s+/g, ' '))
  await anon.screenshot({ path: SHOTS + 'r3-share-preview.png' })
  await anon.locator('.share-card .btn.ghost').click().catch(() => {}); await sleep(500)
  await signIn(anon, GRESA); await sleep(2500)
  check('after signing in the shared trip opens', (await anon.locator('.sheet h2').innerText().catch(() => '')).includes(`Rugova R3 ${RUN}`))
  await anon.context().close()
  const all = sql(`select count(*), count(distinct share_code) from tables where share_code is not null`).split('|')
  check('share codes are unique across all tables', all[0] === all[1], all.join('/'))
  check('the code is part of a /t/<code> URL (6-64 chars a-z0-9-)', Object.values(T).every((t) => /^[a-z0-9-]{6,64}$/.test(t.share_code)))
  // Cloudflare Pages function run in Node with a minimal HTMLRewriter
  globalThis.HTMLRewriter = class {
    constructor() { this.h = [] }
    on(sel, handler) { this.h.push([sel, handler]); return this }
    transform(res) {
      const h = this.h
      const body = res.text().then((html) => {
        for (const [sel, handler] of h) {
          const m = sel.match(/^(\w+)(?:\[(\w+)="([^"]+)"\])?$/)
          const re = m[2] ? new RegExp(`<${m[1]}[^>]*${m[2]}="${m[3].replace(/[:]/g, '\\:')}"[^>]*>`, 'g') : new RegExp(`<${m[1]}>[\\s\\S]*?</${m[1]}>`, 'g')
          html = html.replace(re, (tag) => {
            let out = tag
            handler.element({
              setAttribute: (k, v) => { const esc = String(v).replace(/"/g, '&quot;'); out = new RegExp(`${k}="`).test(out) ? out.replace(new RegExp(`${k}="[^"]*"`), `${k}="${esc}"`) : out.replace(/\s*\/?>$/, ` ${k}="${esc}">`) },
              setInnerContent: (v) => { out = `<${m[1]}>${String(v).replace(/</g, '&lt;')}</${m[1]}>` },
            })
            return out
          })
        }
        return html
      })
      return { body: { _body: body }, headers: res.headers }
    }
  }
  const fn = await import(pathToFileURL('/home/claude/table-reservation-project/hajde/functions/t/[code].js').href)
  const _Response = globalThis.Response
  const env = { API_URL: API, ASSETS: { fetch: (u) => fetch(SITE + new URL(u).pathname, { headers: { 'User-Agent': 'WhatsApp/2.23.20.0' } }) } }
  const req = new Request(`${SITE}/t/${T.udhetim.share_code}`, { headers: { 'User-Agent': 'WhatsApp/2.23.20.0 A' } })
  globalThis.Response = class extends _Response { constructor(b, init) { super(null, init); this._b = b } }
  let html = ''
  try {
    const res = await fn.onRequestGet({ request: req, env, params: { code: T.udhetim.share_code } })
    html = res._b?._body ? await res._b._body : ''
    check('crawler response is 200 with noindex', res.status === 200 && res.headers.get('X-Robots-Tag') === 'noindex')
  } finally { globalThis.Response = _Response }
  if (!/og:title/.test(html)) console.log('  crawler html:', html.slice(0, 600))
  const og = (html.match(/property="og:title" content="([^"]*)"/) || [])[1] || ''
  const ogd = (html.match(/property="og:description" content="([^"]*)"/) || [])[1] || ''
  check('crawler HTML has og:title with the trip title and kind', og.includes(`Rugova R3 ${RUN}`) && og.includes('Udhëtim'), og || html.slice(0, 200))
  check('crawler og:description has seats and host first name', /vende të lira/.test(ogd) && /Nikoqir: Agon/.test(ogd), ogd)
  check('crawler HTML never contains the maps link', !html.includes('maps.app.goo.gl/r3'))
  const p1 = await rpc(null, 'table_share_preview', { p_code: T.vozitje.share_code })
  check('anonymous RPC preview: no id, no maps link, ride cities', p1.data && p1.data.id == null && !JSON.stringify(p1).includes('maps.app') && p1.data.to_city === 'Prizren', JSON.stringify(p1.data))
})

await section('A10: Basic plan (home city only, monthly limit 3, join limit) vs Premium', async () => {
  // Emma: Basic in Gjakovë
  const e = await newPage(); pages.push(e); await signIn(e, EMMA)
  const chips = (await e.locator('.chip.city').allInnerTexts()).map((s) => s.trim())
  check('Basic (Gjakovë): only home city + locked "other cities" chip', chips.includes('Gjakovë') && !chips.includes('Prishtinë') && chips.some((c) => /Qytetet tjera/.test(c)), chips.join('|'))
  check('Basic cannot see a Prishtinë listing (DB)', !(await visibleTo(EMMA, T.udhetim.id)))
  const rj = await rpc(EMMA, 'request_join', { p_table: T.udhetim.id })
  check('Basic cannot join outside home city', rj.status >= 400, rj.message)
  const rc = await newTable(EMMA, { title: `Emma R3 ${RUN}`, city: 'Prishtinë' })
  check('Basic cannot create outside home city', /qytetin tënd/.test(rc.message || ''), JSON.stringify(rc).slice(0, 150))
  await e.locator('.fab').click(); await sleep(700)
  check('create form city select is locked to the home city', await e.locator('#f-city').isDisabled() && (await e.locator('#f-city option').allInnerTexts()).join() === 'Gjakovë')
  await e.keyboard.press('Escape'); await e.context().close()
  // Marko: monthly limit 3
  const m = await newPage(); pages.push(m); await signIn(m, MARKO)
  for (const n of [1, 2]) await newTable(MARKO, { title: `Marko R3 ${n} ${RUN}` })
  await m.goto(SITE + '/'); await sleep(2500)
  await m.locator('.fab').click(); await sleep(700)
  check('usage meter 2/3', /2\s*\/\s*3/.test(await m.locator('.usage-meter').innerText().catch(() => '')))
  await m.locator('#f-cafe').fill(`Marko R3 3 ${RUN}`)
  await m.locator('#f-maps').fill('https://maps.app.goo.gl/marko'); await m.locator('#f-event-date').fill(day(2)); await m.locator('#f-event-time').fill('20:00')
  await m.locator('.btn.primary.full', { hasText: 'Hape tavolinën' }).click(); await sleep(2500)
  check('3rd table created in the browser', sql(`select count(*) from tables where host_id='${id[MARKO]}' and title like 'Marko R3 %${RUN}'`) === '3')
  await m.goto(SITE + '/'); await sleep(2500)
  await m.locator('.fab').click(); await sleep(700)
  check('at 3/3 the form shows the Premium upsell instead of submit', await m.locator('.upsell').isVisible().catch(() => false))
  await m.screenshot({ path: SHOTS + 'r3-basic-upsell.png' })
  await m.locator('.upsell button').click(); await sleep(800)
  check('upsell opens the plans screen', /Premium/.test(await bodyText(m)))
  const r4 = await newTable(MARKO, { title: `Marko R3 4 ${RUN}` })
  check('4th table refused by the database', /limitin mujor/.test(r4.message || ''), JSON.stringify(r4).slice(0, 150))
  check('marko page: no failed calls', bad(m).length === 0, bad(m).join(' | '))
  await m.context().close()
  // Lukas: Premium in Prizren
  const l = await newPage(); pages.push(l); await signIn(l, LUKAS)
  await l.locator('.chip.city').nth(2).waitFor({ timeout: 10000 }).catch(() => {})
  const lchips = (await l.locator('.chip.city').allInnerTexts()).map((s) => s.trim())
  check('Premium sees all cities', ['Prishtinë', 'Prizren', 'Pejë'].every((c) => lchips.includes(c)), lchips.join('|'))
  check('Premium sees and joins a listing in another city', (await visibleTo(LUKAS, T.udhetim.id)) && (await rpc(LUKAS, 'request_join', { p_table: T.udhetim.id })).status === 200)
  let ok = true
  for (let n = 1; n <= 4; n++) ok = ok && !!(await newTable(LUKAS, { title: `Lukas R3 ${n} ${RUN}`, city: n % 2 ? 'Pejë' : 'Prishtinë' })).id
  check('Premium: 4 tables in a month in other cities, no limit', ok)
  await l.context().close()
  // join limit + Wednesday priority: checked inside a rolled-back transaction (global plan setting)
  const py = `
import json, datetime
from django.db import transaction
from ejb import context
from ejb.context import Actor
from ejb.models import *
from ejb.services import wednesday as W
from ejb.errors import *
out = {}
emails = ${JSON.stringify([BESA, DARDAN, ELENA, ELIRA, FATOS, GRESA, LUKAS, MARKO])}
ids = {e: AuthUser.objects.get(email=e).id for e in emails}
class Rollback(Exception): pass
try:
    with transaction.atomic():
        Plan.objects.filter(pk='basic').update(monthly_join_limit=0)
        t = Table.objects.filter(host_id='${id[HOST]}', status='open', kind='tavoline', city='Prishtinë').exclude(spots__lte=1).order_by('-created_at').first()
        try:
            with context.acting(Actor(uid=ids['${MARKO}'], role='authenticated')):
                Request(table_id=t.id, user_id=ids['${MARKO}']).save()
            out['basic_join'] = 'allowed'
        except Exception as ex:
            out['basic_join'] = str(ex)
        try:
            with context.acting(Actor(uid=ids['${LUKAS}'], role='authenticated')):
                Request.objects.filter(table_id=t.id, user_id=ids['${LUKAS}']).delete()
                Request(table_id=t.id, user_id=ids['${LUKAS}']).save()
            out['premium_join'] = 'allowed'
        except Exception as ex:
            out['premium_join'] = str(ex)
        dinner = datetime.datetime(2031, 1, 8, 18, 0, tzinfo=datetime.timezone.utc)
        WednesdayRestaurant(name='R3', city='R3Qytet', address='x', maps_link='https://maps.app.goo.gl/x', active=True).save()
        base = context.now() - datetime.timedelta(hours=5)
        order = [e for e in emails if e != '${LUKAS}'] [:6] + ['${LUKAS}']
        for i, e in enumerate(order):
            WednesdaySignup(user_id=ids[e], dinner_date=dinner, city='R3Qytet', langs=['sq'], created_at=base + datetime.timedelta(minutes=i)).save(force_insert=True)
        with context.acting(Actor.service()):
            res = W._form_wednesday_groups(dinner)
        st = {e: WednesdaySignup.objects.get(user_id=ids[e], dinner_date=dinner).status for e in order}
        out['wed'] = res
        out['premium_last_signup'] = st['${LUKAS}']
        out['last_basic'] = st[order[5]]
        out['premium_flag'] = WednesdaySignup.objects.get(user_id=ids['${LUKAS}'], dinner_date=dinner).premium
        raise Rollback()
except Rollback:
    pass
print('R3JSON' + json.dumps(out, default=str))
`
  const res = execSync('MSGPACK_PUREPYTHON=1 python3 manage.py shell', { cwd: '/home/claude/table-reservation-project/backend', input: py }).toString()
  const o = JSON.parse((res.match(/R3JSON(.*)/) || [])[1] || '{}')
  check('Basic monthly join limit enforced in the DB when set', /limitin mujor të bashkimeve/.test(o.basic_join || ''), o.basic_join)
  check('Premium ignores the join limit', o.premium_join === 'allowed', o.premium_join)
  check('Wednesday: Premium signed up last still gets a seat (priority)', o.premium_last_signup === 'grouped' && o.premium_flag === true, JSON.stringify(o))
  check('Wednesday: the last Basic sign-up is the one waitlisted', o.last_basic === 'waitlisted', JSON.stringify(o.wed))
  const jl = sql(`select coalesce(monthly_join_limit::text,'none') from plans where id='basic'`)
  console.log(`  info: basic monthly_join_limit in the DB = ${jl} (admin-configurable; 'none' = unlimited)`)
})

await section('P3: cold start on a phone with 4x CPU throttling', async () => {
  const measure = async (signedIn) => {
    const p = await newPage()
    if (signedIn) await signIn(p, GRESA)
    const cdp = await p.context().newCDPSession(p)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await cdp.send('Network.enable'); await cdp.send('Network.clearBrowserCache')
    const reqs = []
    p.on('request', (r) => { if (r.url().startsWith(API)) reqs.push(r.method() + ' ' + r.url().replace(API, '').split('?')[0]) })
    const t0 = Date.now()
    await p.reload()
    const sel = signedIn ? '.browse-modes .browse-mode, .card-body h3' : 'button:has-text("Hyr"), .landing, h1'
    await p.locator(sel).first().waitFor({ timeout: 30000 })
    if (signedIn) await p.locator('.count, .empty').first().waitFor({ timeout: 30000 }).catch(() => {})
    const tti = Date.now() - t0
    await sleep(3000)
    const n = reqs.length
    await p.context().close()
    return { tti, n, reqs }
  }
  const out = await measure(false)
  const inn = await measure(true)
  console.log(`  info: signed out  -> ${out.n} API requests, interactive in ${out.tti} ms`)
  console.log(`  info: signed in   -> ${inn.n} API requests, feed interactive in ${inn.tti} ms`)
  console.log(`  info: signed-in requests: ${inn.reqs.join(' | ')}`)
  check(`signed out cold load: ${out.n} API requests (≤ 3)`, out.n <= 3, out.reqs.join(' | '))
  check(`signed in cold load: ${inn.n} API requests (≤ 18)`, inn.n <= 18)
  check(`signed in feed interactive in ${inn.tti} ms with 4x CPU throttle (< 6000)`, inn.tti < 6000)
})

check('no page errors on any page', [host, ...pages].every((p) => !p.errs?.length), [host, ...pages].flatMap((p) => p.errs || []).join(' | '))
// cleanup: listings of this run are closed so other suites' feeds stay small
sql(`update tables set status='cancelled' where host_id in (select id from auth.users where email in (${inList})) and status='open' and created_at > now() - interval '1 hour'`)
sql(`delete from subscriptions where user_id in ('${id[HOST]}','${id[LUKAS]}')`)
await close()
process.exit(summary() ? 1 : 0)
