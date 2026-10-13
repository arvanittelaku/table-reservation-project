// R6: official events hosted by the ejaBashkohu team (Premium package: "prioritet tek
// Wednesday Dinner apo ndonjë event që ju hostoni"). Real app + Django + Postgres + Redis.
//   admin marks a team-hosted listing official (non-admins / user-hosted listings refused),
//   Premium-only window enforced by the server (RPC and direct inserts), Premium joins,
//   Basic joins after the window (city lock exempt, like Wednesday Dinner), Premium-first
//   approvals and waitlist promotion, badge + Premium upsell in the app, admin console
//   action + filter, audit log rows.
//   cd backend/dev && node e2e_app/r6_official_events.mjs
import { SITE, SHOTS, api, bodyText, check, close, launch, newPage, section, signIn as signIn0, sleep, sql, summary, token } from './lib.mjs'

const U = (n) => `${n}@gmail.com`
const ADMIN = 'support@ejabashkohu.com'
const P1 = U('lukas.muller'), P2 = U('liam.weber'), P3 = U('noah.brown')       // Premium
const B1 = U('emma.schmidt'), B2 = U('mia.fischer'), B3 = U('sara.gjoka')      // Basic (B1 lives in Gjakovë)
const MINE = [P1, P2, P3, B1, B2, B3]
const id = {}
for (const e of [ADMIN, ...MINE]) id[e] = sql(`select id from auth.users where email='${e}'`)
const inList = MINE.map((e) => `'${id[e]}'`).join(',')
const T0 = sql('select now()')

// ── known starting point (only my own users and R6 listings) ──
sql(`delete from tables where title like 'R6 %'`)
sql(`delete from requests where user_id in (${inList}) and created_at > now() - interval '40 days'`)
sql(`delete from subscriptions where user_id in (${inList})`)
sql(`delete from blocks where blocker_id in (${inList}) or blocked_id in (${inList})`)
sql(`update auth.users set email_confirmed_at=now() where id in (${inList}) and email_confirmed_at is null`)
sql(`update profiles set home_city='Prishtinë', home_city_changed_at=null where id in (${inList})`)
sql(`update profiles set home_city='Gjakovë' where id='${id[B1]}'`)
for (const e of [P1, P2, P3]) sql(`insert into subscriptions (id,user_id,plan_id,starts_at,ends_at,status,source,amount_cents,created_at) values (gen_random_uuid(),'${id[e]}','premium_1m',now()-interval '1 hour',now()+interval '20 days','active','admin_grant',0,now())`)

const RUN = Date.now().toString(36).slice(-5)
const iso = (hours) => new Date(Date.now() + hours * 3600e3).toISOString()
const tok = {}
async function tk(e) {   // sign-ins are rate limited per IP (shared with other suites): retry
  if (!tok[e]) { let t; for (let i = 0; i < 8 && !t; i++) { t = await token(e); if (!t) await sleep(10000) } tok[e] = t }
  return tok[e]
}
const q = async (e, body) => api('/rest/v1/query', body, await tk(e))
const rpc = async (e, name, args) => api(`/rest/v1/rpc/${name}`, args, e ? await tk(e) : undefined)
const msg = (r) => r.message || r.msg || r.error || r.text || ''
async function newTable(e, title, v = {}) {
  const r = await q(e, { table: 'tables', action: 'insert', returning: true, single: true, select: 'id', values: {
    host_id: id[e], kind: 'tavoline', category: 'kafe', city: 'Prishtinë', area: 'Qendër', spots: 6, time_label: 'Event',
    event_datetime: iso(120), maps_link: 'https://maps.app.goo.gl/r6test', title: `R6 ${title} ${RUN}`, ...v } })
  return (r.data || r).id
}
async function seat(e, t) {   // request -> host approves -> seat, as the app does
  const r = await rpc(e, 'request_join', { p_table: t })
  if (r.status !== 200) return r
  const a = await rpc(ADMIN, 'approve_request', { p_request: r.data })
  if (a.status !== 200) return a
  return q(e, { table: 'memberships', action: 'insert', values: { table_id: t, user_id: id[e], role: 'member' } })
}
const reqStatus = (t, e) => sql(`select coalesce((select status from requests where table_id='${t}' and user_id='${id[e]}'), 'none')`)
const onWaitlist = (t, e) => sql(`select count(*) from waitlist where table_id='${t}' and user_id='${id[e]}'`) === '1'
const audit = (action, t) => JSON.parse(sql(`select coalesce(json_agg(details order by id), '[]') from admin_audit_log where action='${action}' and target_id='${t}' and created_at >= '${T0}'`))
const PREMIUM_ONLY = /^Ky event zyrtar është vetëm për anëtarët Premium deri më \d\d\.\d\d\.\d{4} \d\d:\d\d$/

let T1, T2, T3, T4
await section('admin marks a team-hosted event official', async () => {
  T1 = await newTable(ADMIN, 'Mbrëmje jazz')
  const userTable = await newTable(P1, 'Kafe e Lukasit')
  check('setup: admin and user listings created', !!T1 && !!userTable)
  let r = await rpc(B2, 'admin_set_official_event', { p_table: T1, p_premium_hours: 48 })
  check('non-admin cannot mark an event official', r.status >= 400 && msg(r) === 'Vetëm adminët mund ta bëjnë këtë', `${r.status} ${msg(r)}`)
  r = await rpc(P1, 'admin_set_official_event', { p_table: T1 })
  check('Premium (non-admin) cannot either', r.status >= 400 && /Vetëm adminët/.test(msg(r)))
  r = await rpc(null, 'admin_set_official_event', { p_table: T1 })
  check('signed out cannot either', r.status >= 400)
  check('nothing stored by refused calls', sql(`select count(*) from official_events where table_id='${T1}'`) === '0')
  r = await q(B2, { table: 'official_events', action: 'insert', values: { table_id: T1, premium_hours: 0 } })
  check('direct insert into official_events refused', r.status >= 400 && sql(`select count(*) from official_events where table_id='${T1}'`) === '0', `${r.status}`)
  r = await rpc(ADMIN, 'admin_set_official_event', { p_table: userTable })
  check('a listing hosted by a user cannot be official', r.status >= 400 && /Vetëm eventet që hoston ekipi/.test(msg(r)), msg(r))
  r = await rpc(ADMIN, 'admin_set_official_event', { p_table: T1, p_premium_hours: 1000 })
  check('Premium window over 720 h refused', r.status >= 400 && /^Dritarja Premium duhet të jetë/.test(msg(r)), msg(r))
  r = await rpc(ADMIN, 'admin_set_official_event', { p_table: T1 })
  const until = new Date(r.data?.premium_until).getTime()
  check('admin marks it official (default 48 h)', r.status === 200 && r.data?.premium_hours === 48 && r.data?.priority_open === true, JSON.stringify(r))
  check('Premium window ends 48 h before the event', Math.abs(until - (Date.now() + 72 * 3600e3)) < 120e3, r.data?.premium_until)
  check('official_events row stored with the admin as marker', sql(`select premium_hours || '|' || marked_by_id from official_events where table_id='${T1}'`) === `48|${id[ADMIN]}`)
  const log = audit('table_marked_official', T1)
  check('audit log: table_marked_official with the window', log.length === 1 && log[0].premium_hours === 48 && log[0].previous_premium_hours === null, JSON.stringify(log))
  const listed = await rpc(ADMIN, 'admin_list_tables', { p_status: 'official', p_search: RUN, p_limit: 100 })
  check('admin_list_tables filter "official" lists only official listings', listed.data?.rows?.length === 1 && listed.data.rows[0].id === T1, JSON.stringify(listed.data?.rows?.map((x) => x.title)))
  const embed = await q(B2, { table: 'tables', action: 'select', select: 'id, official_events ( premium_hours )', filters: [{ col: 'id', op: 'eq', value: T1 }] })
  check('the app reads the official mark with the listing', embed.data?.[0]?.official_events?.[0]?.premium_hours === 48, JSON.stringify(embed))
  r = await q(ADMIN, { table: 'tables', action: 'update', values: { title: `R6 Mbrëmje jazz ${RUN}` }, filters: [{ col: 'id', op: 'eq', value: T1 }] })
  check('host edits to the listing keep the official mark', r.status === 200 && sql(`select count(*) from official_events where table_id='${T1}'`) === '1')
})

await section('priority window: only Premium can request or queue', async () => {
  let r = await rpc(B2, 'request_join', { p_table: T1 })
  check('Basic refused during the window with the Premium-only message', r.status >= 400 && PREMIUM_ONLY.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await rpc(B1, 'request_join', { p_table: T1 })
  check('Basic from another city: same Premium-only message (not the city lock)', r.status >= 400 && PREMIUM_ONLY.test(msg(r)), msg(r))
  r = await q(B2, { table: 'requests', action: 'insert', values: { table_id: T1, user_id: id[B2] } })
  check('direct request insert refused too (server, not only the UI)', r.status >= 400 && PREMIUM_ONLY.test(msg(r)) && reqStatus(T1, B2) === 'none', `${r.status} ${msg(r)}`)
  r = await q(B2, { table: 'waitlist', action: 'insert', values: { table_id: T1, user_id: id[B2] } })
  check('Basic cannot take a waitlist spot during the window', r.status >= 400 && !onWaitlist(T1, B2), `${r.status} ${msg(r)}`)
  const seen = await q(B1, { table: 'tables', action: 'select', select: 'id', filters: [{ col: 'id', op: 'eq', value: T1 }] })
  check('Basic member in another city still sees the official event', seen.data?.length === 1)
  r = await rpc(P1, 'request_join', { p_table: T1 })
  check('Premium member can request during the window', r.status === 200 && reqStatus(T1, P1) === 'pending', msg(r))
  r = await rpc(ADMIN, 'approve_request', { p_request: r.data })
  check('host (admin) approves the Premium request', r.status === 200 && reqStatus(T1, P1) === 'approved', msg(r))
})

await section('after the window everyone can join', async () => {
  let r = await rpc(ADMIN, 'admin_set_official_event', { p_table: T1, p_premium_hours: 200 })  // window ended 80 h ago
  check('admin shortens the window (now closed)', r.status === 200 && r.data?.priority_open === false, JSON.stringify(r.data))
  const log = audit('table_marked_official', T1)
  check('audit log: the change is logged with the previous value', log.length === 2 && log[1].premium_hours === 200 && log[1].previous_premium_hours === 48, JSON.stringify(log))
  r = await rpc(B2, 'request_join', { p_table: T1 })
  check('Basic can request after the window', r.status === 200 && reqStatus(T1, B2) === 'pending', msg(r))
  r = await rpc(B1, 'request_join', { p_table: T1 })
  check('Basic from another city can join an official event (city lock exempt, like Wednesday Dinner)', r.status === 200, msg(r))
  const plain = await newTable(ADMIN, 'Jo zyrtare')
  r = await rpc(B1, 'request_join', { p_table: plain })
  check('control: the city lock still applies to non-official listings', r.status >= 400 && msg(r) === 'Me pakon Bazike bashkohesh vetëm në qytetin tënd', msg(r))
})

await section('Premium first when seats are scarce', async () => {
  // approvals: 3 spots = host + 2 guests
  T2 = await newTable(ADMIN, 'Darkë degustimi', { spots: 3 })
  await rpc(ADMIN, 'admin_set_official_event', { p_table: T2, p_premium_hours: 0 })
  const rb2 = await rpc(B2, 'request_join', { p_table: T2 })
  const rp2 = await rpc(P2, 'request_join', { p_table: T2 })
  const rb3 = await rpc(B3, 'request_join', { p_table: T2 })
  check('setup: Basic, Premium, Basic requests pending', [rb2, rp2, rb3].every((x) => x.status === 200), [rb2, rp2, rb3].map(msg).join(' | '))
  let r = await rpc(ADMIN, 'approve_request', { p_request: rb2.data })
  check('a Basic request is approved while seats remain for the pending Premium ones', r.status === 200 && reqStatus(T2, B2) === 'approved', msg(r))
  r = await rpc(ADMIN, 'approve_request', { p_request: rb3.data })
  check('the last seat cannot go to Basic while a Premium request waits', r.status >= 400 && msg(r) === 'Aprovo fillimisht kërkesat Premium: vendet e mbetura u takojnë atyre' && reqStatus(T2, B3) === 'pending', msg(r))
  r = await rpc(ADMIN, 'approve_request', { p_request: rp2.data })
  check('the Premium request gets it', r.status === 200 && reqStatus(T2, P2) === 'approved', msg(r))

  // waitlist: 2 spots = host + 1 guest; Basic queued first, Premium later
  T3 = await newTable(ADMIN, 'Koncert akustik', { spots: 2 })
  await rpc(ADMIN, 'admin_set_official_event', { p_table: T3, p_premium_hours: 0 })
  r = await seat(B2, T3)
  check('setup: the only guest seat is taken', r.status === 200 && sql(`select count(*) from memberships where table_id='${T3}'`) === '2', msg(r))
  r = await rpc(B3, 'request_join', { p_table: T3 })
  check('full: request refused, join the waitlist', r.status >= 400 && msg(r) === 'Tavolina është plot. Futu në listën e pritjes', msg(r))
  const w1 = await q(B3, { table: 'waitlist', action: 'insert', values: { table_id: T3, user_id: id[B3] } })
  await sleep(50)
  const w2 = await q(P3, { table: 'waitlist', action: 'insert', values: { table_id: T3, user_id: id[P3] } })
  check('Basic queued first, then Premium', w1.status === 200 && w2.status === 200 && onWaitlist(T3, B3) && onWaitlist(T3, P3))
  const since = sql('select now()')
  r = await rpc(B2, 'leave_table', { p_table: T3 })
  check('the freed seat goes to the Premium member, ahead of the earlier Basic one', r.status === 200 && reqStatus(T3, P3) === 'approved' && !onWaitlist(T3, P3), `${reqStatus(T3, P3)}`)
  check('the Basic member stays first in line after Premium', onWaitlist(T3, B3) && reqStatus(T3, B3) === 'none')
  check('Premium member notified of the seat', sql(`select count(*) from notifications where user_id='${id[P3]}' and created_at >= '${since}' and body like '%U lirua një vend%'`) === '1')

  // control: same queue on a non-official listing keeps first-come order
  T4 = await newTable(ADMIN, 'Kafe e zakonshme', { spots: 2 })
  await seat(B2, T4)
  await q(B3, { table: 'waitlist', action: 'insert', values: { table_id: T4, user_id: id[B3] } })
  await sleep(50)
  await q(P3, { table: 'waitlist', action: 'insert', values: { table_id: T4, user_id: id[P3] } })
  await rpc(B2, 'leave_table', { p_table: T4 })
  check('control: non-official listings keep first-come waitlist order', reqStatus(T4, B3) === 'approved' && onWaitlist(T4, P3))
})

await launch()
async function signIn(p, e) {
  for (let i = 0; i < 6; i++) {
    await signIn0(p, e)
    if (await p.locator('.fab, .browse-modes, .adm-nav').first().isVisible().catch(() => false)) return
    await sleep(12000); await p.goto(SITE + '/'); await sleep(1200)
  }
}
const T5TITLE = `R6 Festa e verës ${RUN}`
let T5
await section('app: badge and Premium upsell', async () => {
  T5 = await newTable(ADMIN, 'Festa e verës', { event_datetime: iso(30) })   // soonest listing: first in the feed
  await rpc(ADMIN, 'admin_set_official_event', { p_table: T5, p_premium_hours: 24 })   // Premium only for the next 6 h
  const p = await newPage()
  await signIn(p, B2)
  const card = p.locator('.card', { hasText: T5TITLE }).first()
  await card.scrollIntoViewIfNeeded().catch(() => {})
  const cardText = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('feed: official badge with "Premium first until <date>"', /Event zyrtar · Premium të parët deri më \d+ \w+ \d{4}, \d\d:\d\d/.test(cardText), cardText)
  await card.click(); await sleep(1200)
  const sheet = (await p.locator('.sheet').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('detail: badge shown', /Event zyrtar · Premium të parët deri më/.test(sheet), sheet.slice(0, 300))
  check('detail: Basic sees the Premium upsell instead of the join button',
    await p.getByTestId('official-upsell').isVisible() && /Tani vetëm për anëtarët Premium/.test(sheet) && !sheet.includes("Kërko t'i bashkohesh"), sheet.slice(0, 400))
  await p.screenshot({ path: SHOTS + 'r6_official_upsell.png' })
  await p.locator('.official-upsell button').click(); await sleep(1200)
  check('upsell button opens the packages', /Pakot/.test(await bodyText(p)) && /Premium/.test(await bodyText(p)))
  check('no page errors (Basic)', p.errs.length === 0, p.errs.join(' | '))
  await p.context().close()

  const e = await newPage({ lang: 'en' })
  await signIn(e, P2)
  const c2 = e.locator('.card', { hasText: T5TITLE }).first()
  await c2.scrollIntoViewIfNeeded().catch(() => {})
  check('English: "Official event · Premium first until <date>"', /Official event · Premium first until/.test(await c2.innerText().catch(() => '')))
  await c2.click(); await sleep(1200)
  const s2 = (await e.locator('.sheet').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('Premium member gets the normal join button, no upsell', !(await e.getByTestId('official-upsell').count()) && /Request to join/i.test(s2), s2.slice(0, 400))
  await e.locator('.sheet .btn.primary', { hasText: /Request to join/i }).first().click(); await sleep(1500)
  check('Premium member requests from the app', reqStatus(T5, P2) === 'pending')
  await e.context().close()

  for (const [lang, re] of [['de', /Offizielles Event · Premium zuerst bis/], ['mk', /Официјален настан · Premium прво до/]]) {
    const x = await newPage({ lang })
    await signIn(x, B3)
    const c = x.locator('.card', { hasText: T5TITLE }).first()
    await c.scrollIntoViewIfNeeded().catch(() => {})
    check(`${lang}: badge translated`, re.test(await c.innerText().catch(() => '')))
    await c.click(); await sleep(1000)
    check(`${lang}: upsell translated`, await x.getByTestId('official-upsell').isVisible() && !/Tani vetëm/.test(await x.locator('.sheet').innerText()))
    await x.context().close()
  }
})

await section('admin console: mark action, filter, audit log', async () => {
  const a = await newPage({ width: 1360, height: 900 })
  await signIn(a, ADMIN); await sleep(2000)
  await a.locator('.adm-nav button', { hasText: 'Tavolinat' }).click(); await sleep(1500)
  await a.locator('.adm-content .adm-search input').fill(RUN); await sleep(1500)
  await a.locator('.adm-content .adm-seg button', { hasText: 'Zyrtare' }).click(); await sleep(1500)
  const rows = (await a.locator('.adm-content .adm-table tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '))
  check('filter "Zyrtare" lists the official events only', rows.length === 4 && rows.every((r) => /★ Event zyrtar/.test(r)) && !rows.some((r) => /Jo zyrtare|Kafe e zakonshme|Kafe e Lukasit/.test(r)), rows.join(' || '))
  // a team listing that is not official yet: mark it from the drawer
  await a.locator('.adm-content .adm-seg button', { hasText: 'Të gjitha' }).click(); await sleep(1200)
  await a.locator('.adm-content .adm-search input').fill(`Jo zyrtare ${RUN}`); await sleep(1500)
  await a.locator('.adm-content .adm-table tbody tr').first().click(); await sleep(1800)
  const box = a.getByTestId('official-box')
  check('drawer: official event section with the Premium window', await box.isVisible() && /Orë vetëm për Premium para eventit/.test(await box.innerText()))
  await a.getByTestId('official-hours').fill('36')
  await box.locator('button', { hasText: 'Shëno si event zyrtar' }).click(); await sleep(1500)
  const plainId = sql(`select id from tables where title='R6 Jo zyrtare ${RUN}'`)
  check('drawer action marks it official with 36 h', sql(`select premium_hours from official_events where table_id='${plainId}'`) === '36')
  check('toast confirms', /U shënua si event zyrtar/.test(await a.locator('.adm-toast').innerText({ timeout: 4000 }).catch(() => '')))
  check('drawer shows the official pill and the remove action', /★ Event zyrtar/.test(await a.locator('.adm-drawer').innerText()) && await box.locator('button', { hasText: 'Hiq shenjën zyrtare' }).isVisible())
  await a.screenshot({ path: SHOTS + 'r6_admin_official.png' })
  await box.locator('button', { hasText: 'Hiq shenjën zyrtare' }).click(); await sleep(1500)
  check('remove action clears it', sql(`select count(*) from official_events where table_id='${plainId}'`) === '0')
  check('audit log: marked and unmarked rows', audit('table_marked_official', plainId).length === 1 && audit('table_unmarked_official', plainId).length === 1)
  await a.keyboard.press('Escape'); await sleep(500)
  await a.locator('.adm-nav button', { hasText: 'Aktiviteti' }).click(); await sleep(1800)
  const act = await bodyText(a)
  check('Activity page labels the new audit actions', act.includes('Shënoi event zyrtar') && act.includes('Hoqi shenjën zyrtare'))
  check('no page errors (admin)', a.errs.length === 0, a.errs.join(' | '))
  await a.context().close()
})

await close()
// leave the shared dev data as it was
sql(`delete from tables where title like 'R6 %'`)
sql(`delete from subscriptions where user_id in (${inList})`)
sql(`update profiles set home_city='Prishtinë' where id in (${inList}) and id<>'${id[B1]}'`)
process.exit(summary() ? 1 : 0)
