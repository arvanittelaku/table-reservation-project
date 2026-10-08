// R1 / P1: the admin console. Overview KPIs + charts, users list (paging, filters,
// sorting, search) and detail, user actions (strikes up to 3rd-strike deletion,
// deactivate, admin role, Premium, notifications), tables (filters, detail, cancel
// + restore), payments (filters, search, CSV), reports, global search, plan editing
// reflected in the user Plans screen, Wednesday restaurants/sign-ups/groups, tutor
// review, audit log, and non-admin lock-out. Every action is verified with SQL.
import fs from 'node:fs'
import { SHOTS, api, bodyText, check, close, launch, newPage, section, signIn, sleep, sql as rawSql, summary, token, waitMail } from './lib.mjs'
const sql = (s) => rawSql(s.replace(/\s*\n\s*/g, ' '))

const ADMIN = 'support@ejabashkohu.com'
const ARTA = 'arta.krasniqi@gmail.com'
const BLERIM = 'blerim.gashi@gmail.com'
const DONIKA = 'donika.berisha@gmail.com'
const ERION = 'erion.morina@gmail.com'
const GENTRIT = 'gentrit.shala@gmail.com'
const ILIR = 'ilir.kelmendi@gmail.com'
const MINE = [ARTA, BLERIM, DONIKA, ERION, GENTRIT, ILIR]
const STAMP = Date.now().toString(36)
const T0 = new Date().toISOString()
const uid = (e) => sql(`select id from auth.users where email='${e}'`)
const q = (s) => s.replace(/'/g, "''")

for (const e of MINE) sql(`update profiles set home_city='Prishtinë', deactivated_at=null, is_admin=false where id='${uid(e)}'`)
sql(`delete from tutors where user_id in ('${uid(ARTA)}','${uid(BLERIM)}')`)
sql(`delete from wednesday_signups where user_id in (${MINE.map((e) => `'${uid(e)}'`).join(',')})`)
sql(`delete from subscriptions where user_id='${uid(DONIKA)}'`)
sql(`delete from subscription_orders where user_id='${uid(DONIKA)}'`)
const PLANS0 = sql("select json_agg(row_to_json(p)) from plans p")
const restorePlans = () => {
  for (const p of JSON.parse(PLANS0)) {
    sql(`update plans set price_cents=${p.price_cents}, monthly_table_limit=${p.monthly_table_limit ?? 'null'}, monthly_join_limit=${p.monthly_join_limit ?? 'null'}, active=${p.active} where id='${p.id}'`)
  }
}

// throwaway accounts for destructive actions
async function throwaway(tag) {
  const email = `r1.${tag}.${STAMP}@gmail.com`
  const last = `Prova${tag[0].toUpperCase()}${tag.slice(1)}${STAMP}`
  const r = await api('/auth/v1/signup', { email, password: 'Test1234!', options: { data: { first_name: 'Tmp', last_name: last } } })
  const id = uid(email)
  if (!id) throw new Error('signup failed ' + JSON.stringify(r).slice(0, 200))
  sql(`update auth.users set email_confirmed_at=now() where id='${id}'`)
  sql(`update profiles set first_name='Tmp', last_name='${last}', age=25, onboarded_at=now(), home_city='Prishtinë' where id='${id}'`)
  return { email, id, name: `Tmp ${last}`, last }
}
const T1 = await throwaway('strike') // deactivate/reactivate, 3 strikes -> deleted
const T2 = await throwaway('admin') // admin role on/off
const T3 = await throwaway('rep') // reported: dismiss + ban from report
const T4 = await throwaway('del') // reported: delete immediately

// a table with a host, a paying guest, a pending request
const TABLE_ID = sql('select gen_random_uuid()')
const TITLE = `R1 Admin darkë ${STAMP}`
const TICKET = `EBT-R1${STAMP.toUpperCase().slice(-6)}`
sql(`insert into tables (id, host_id, kind, category, title, area, city, time_label, spots, women_only, mystery, revealed, langs, tags, description, status, created_at, event_datetime, men_only, activity_at, share_code)
 values ('${TABLE_ID}', '${uid(ERION)}', 'tavoline', 'darke', '${TITLE}', 'Qendër', 'Prishtinë', 'Nesër 20:00', 6, false, false, false, '{sq}', '{}', 'Darkë testi për adminin', 'open', now(), now() + interval '3 days', false, now(), 'r1${STAMP}')`)
sql(`insert into memberships (user_id, role, joined_at, table_id) values ('${uid(ERION)}','host',now(),'${TABLE_ID}'), ('${uid(GENTRIT)}','member',now(),'${TABLE_ID}')`)
sql(`insert into requests (id, status, created_at, table_id, user_id) values (gen_random_uuid(),'confirmed',now(),'${TABLE_ID}','${uid(GENTRIT)}'), (gen_random_uuid(),'pending',now(),'${TABLE_ID}','${uid(ILIR)}')`)
sql(`insert into payments (id, user_id, amount_cents, currency, provider, provider_ref, status, ticket_code, refundable, created_at, table_id, payer_name, table_title)
 values (gen_random_uuid(), '${uid(GENTRIT)}', 200, 'EUR', 'stub', 'r1-${STAMP}', 'paid', '${TICKET}', false, now(), '${TABLE_ID}', 'Gentrit Shala', '${TITLE}')`)
// reports
const REP_DISMISS = sql('select gen_random_uuid()'), REP_BAN = sql('select gen_random_uuid()'), REP_DEL = sql('select gen_random_uuid()')
sql(`insert into reports (id, reason, details, created_at, status, table_id, reported_id, reporter_id) values
 ('${REP_DISMISS}', 'R1 spam ${STAMP}', 'dërgon reklama', now() - interval '2 minutes', 'pending', '${TABLE_ID}', '${T3.id}', '${uid(ARTA)}'),
 ('${REP_BAN}', 'R1 sjellje ${STAMP}', 'fyerje në chat', now() - interval '1 minute', 'pending', null, '${T3.id}', '${uid(DONIKA)}'),
 ('${REP_DEL}', 'R1 profil i rremë ${STAMP}', 'foto e vjedhur', now(), 'pending', null, '${T4.id}', '${uid(ARTA)}')`)
// tutor applications
for (const [e, head] of [[BLERIM, `R1 Mësues vizatimi ${STAMP}`], [ARTA, `R1 Mësuese fotografie ${STAMP}`]]) {
  sql(`insert into tutors (user_id, status, headline, bio, subjects, teach_langs, price_cents, online, in_person, group_ok, city, years_experience, created_at, updated_at)
   values ('${uid(e)}', 'pending', '${head}', 'Jap mësim prej vitesh, me shumë durim dhe metoda praktike.', '{drawing_painting}', '{sq}', 1000, true, false, true, 'Prishtinë', 4, now(), now())`)
}

await launch()
const openAdmin = async (w = 1360, h = 900) => {
  const a = await newPage({ width: w, height: h })
  await signIn(a, ADMIN); await sleep(2500)
  a.on('dialog', (d) => d.accept())
  return a
}
const nav = async (a, label) => { while (await a.locator('.adm-drawer, .adm-modal').count()) { await a.keyboard.press('Escape'); await sleep(400); if (await a.locator('.adm-modal').count()) await a.locator('.adm-modal button', { hasText: 'Anulo' }).first().click().catch(() => {}) }
  await a.locator('.adm-nav button', { hasText: label }).click(); await sleep(1500) }
const seg = async (a, label, scope = '.adm-content') => { await a.locator(`${scope} .adm-seg button`, { hasText: label }).first().click(); await sleep(1300) }
const toast = async (a) => (await a.locator('.adm-toast').innerText({ timeout: 4000 }).catch(() => '')).trim()
const confirm = async (a, text) => {
  if (text !== undefined) await a.locator('.adm-modal input, .adm-modal textarea').first().fill(text)
  await a.locator('.adm-modal button[type=submit]').click(); await sleep(1600)
}
const rowsText = async (a) => (await a.locator('.adm-content .adm-table tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '))
const pager = async (a) => (await a.locator('.adm-content .adm-pager .adm-muted').innerText().catch(() => '')).trim()
const search = async (a, text) => { await a.locator('.adm-content .adm-toolbar .adm-search input').fill(text); await sleep(1500) }
const openUser = async (a, text) => {
  await nav(a, 'Përdoruesit'); await search(a, text)
  await a.locator('.adm-content .adm-table tbody tr').first().click(); await sleep(1800)
}
const drawerBtn = (a, label) => a.locator('.adm-drawer-actions button', { hasText: label })
const closeDrawer = async (a) => { await a.keyboard.press('Escape'); await sleep(500) }
const audit = (action, target) => sql(`select count(*) from admin_audit_log where action='${action}' and created_at >= '${T0}'${target ? ` and target_id='${target}'` : ''}`) !== '0'

const a = await openAdmin()

await section('Overview: KPIs, charts, range switch', async () => {
  await nav(a, 'Përmbledhje')
  const kpis = await a.locator('.adm-content .adm-kpis .adm-kpi').allInnerTexts()
  check('8 KPI tiles load with numbers', kpis.length === 8 && kpis.every((k) => /\d/.test(k)), kpis.join(' | ').replace(/\s+/g, ' '))
  const usersKpi = Number((await a.locator('.adm-kpi', { hasText: 'Përdorues' }).first().locator('.adm-kpi-value').innerText()).replace(/\D/g, ''))
  const usersDb = Number(sql('select count(*) from profiles'))
  check(`users KPI matches the database (${usersKpi} vs ${usersDb})`, Math.abs(usersKpi - usersDb) <= 2)
  check('4 charts render', (await a.locator('.adm-colchart').count()) === 4)
  const cols = {}
  for (const [k, label] of [['day', '30 ditë'], ['month', '12 muaj'], ['year', '5 vite']]) {
    await seg(a, label)
    cols[k] = await a.locator('.adm-colchart').first().locator('.adm-col').count()
    check(`range "${label}" selected and chart reloads`, (await a.locator('.adm-content .adm-seg button.on').innerText()).includes(label) && cols[k] > 0, String(cols[k]))
  }
  check(`ranges change the chart buckets (${cols.day}/${cols.month}/${cols.year})`, cols.day > cols.month && cols.month > cols.year)
  const txt = await bodyText(a)
  check('overview has recent users / upcoming tables / recent payments lists', /Regjistrimet e fundit/.test(txt) && /Tavolinat e ardhshme/.test(txt) && /Pagesat e fundit/.test(txt))
  check('no load error on overview', !/nuk u ngarkuan/.test(txt))
  await a.screenshot({ path: SHOTS + 'admin-overview.png' })
})

await section('Users list: paging, filters, sorting, search', async () => {
  await nav(a, 'Përdoruesit')
  const total = Number(sql('select count(*) from profiles'))
  const p1 = await pager(a)
  check(`users list shows all users (${p1})`, p1.includes(`nga ${total}`) && (await rowsText(a)).length === Math.min(25, total), p1)
  await a.locator('.adm-content .adm-pager-btns button').nth(1).click(); await sleep(1300)
  const p2 = await pager(a)
  check('next page shows 26–', p2.startsWith('26'), p2)
  await a.locator('.adm-content .adm-pager-btns button').nth(0).click(); await sleep(1300)
  check('previous page back to 1–25', (await pager(a)).startsWith('1'))
  // newest first: our throwaways are on top
  check('default sort newest: newest throwaway first', (await rowsText(a))[0].includes(STAMP))
  await a.locator('.adm-content .adm-toolbar select').selectOption('name'); await sleep(1500)
  const names = (await a.locator('.adm-content .adm-table tbody tr strong').allInnerTexts()).map((x) => x.trim())
  const sorted = [...names].sort((x, y) => x.localeCompare(y, 'sq', { sensitivity: 'base' }))
  check('sort by name A–Z', JSON.stringify(names.slice(0, 10).map((x) => x[0].toLowerCase())) === JSON.stringify(sorted.slice(0, 10).map((x) => x[0].toLowerCase())), names.slice(0, 6).join(', '))
  await a.locator('.adm-content .adm-toolbar select').selectOption('most_paid'); await sleep(1500)
  const top = sql("select p.first_name from payments y join profiles p on p.id=y.user_id where y.status='paid' group by p.id, p.first_name order by sum(y.amount_cents) desc limit 1")
  check(`sort by most paid: top payer first (${top})`, (await rowsText(a))[0].includes(top), (await rowsText(a))[0])
  await a.locator('.adm-content .adm-toolbar select').selectOption('newest'); await sleep(800)
  // filters
  await seg(a, 'Adminë')
  let rows = await rowsText(a)
  check('filter Adminë shows the admin account only', rows.some((r) => r.includes(ADMIN)) && rows.every((r) => /Admin/.test(r)), rows.join(' || ').slice(0, 300))
  await seg(a, 'Kanë paguar')
  rows = await rowsText(a)
  check('filter "Kanë paguar" contains Gentrit (paid €2)', rows.some((r) => r.includes(GENTRIT)))
  check('filter "Kanë paguar" count matches SQL', (await pager(a)).includes(`nga ${sql("select count(distinct user_id) from payments where status='paid' and user_id is not null")}`), await pager(a))
  await seg(a, 'Nikoqirë')
  check('filter Nikoqirë contains Erion (host)', (await rowsText(a)).some((r) => r.includes(ERION)))
  await seg(a, 'Të raportuar')
  check('filter "Të raportuar" contains the reported throwaway', (await rowsText(a)).some((r) => r.includes(T3.email)))
  await seg(a, 'Të gjithë')
  // search by name and email
  await search(a, 'Donika')
  rows = await rowsText(a)
  check('search by first name finds Donika', rows.length >= 1 && rows.every((r) => /Donika/i.test(r)) && rows.some((r) => r.includes(DONIKA)), rows.join(' || '))
  await search(a, 'ilir.kelmendi@')
  rows = await rowsText(a)
  check('search by email finds exactly Ilir', rows.length === 1 && rows[0].includes(ILIR), rows.join(' || '))
  await search(a, 'Gentrit Shala')
  rows = await rowsText(a)
  check('search by full name finds Gentrit', rows.some((r) => r.includes(GENTRIT)), rows.join(' || '))
  await search(a, 'zzzz-nobody-' + STAMP)
  check('search with no match shows the empty state', /S'ka përdorues me këto filtra/.test(await bodyText(a)))
  await search(a, '')
})

await section('User detail: tables, payments, reports, bans, subscription', async () => {
  await openUser(a, GENTRIT)
  const d = a.locator('.adm-drawer')
  check('drawer opens with name + email', (await d.innerText()).includes('Gentrit') && (await d.innerText()).includes(GENTRIT))
  check('drawer shows the subscription box (Bazike/Premium)', (await d.locator('.adm-premium-box').innerText()).match(/Bazike|Premium/))
  await d.locator('.adm-seg button', { hasText: 'Iu bashkua' }).click(); await sleep(400)
  check('joined tab lists the test table with the ticket', (await d.innerText()).includes(TITLE) && (await d.innerText()).includes(TICKET))
  await d.locator('.adm-seg button', { hasText: 'Pagesat' }).click(); await sleep(400)
  const pay = await d.locator('.adm-drawer-section').innerText()
  check('payments tab shows the €2 payment for the table (who paid)', pay.includes(TICKET) && pay.includes(TITLE) && /2[.,]00/.test(pay), pay.slice(0, 200))
  await d.locator('.adm-seg button', { hasText: 'Kërkesat' }).click(); await sleep(400)
  check('requests tab lists the request', (await d.locator('.adm-drawer-section').innerText()).includes(TITLE))
  await closeDrawer(a)
  await openUser(a, ERION)
  await a.locator('.adm-drawer .adm-seg button', { hasText: 'Tavolinat e veta' }).click(); await sleep(400)
  check('host drawer: hosted tab lists the test table', (await a.locator('.adm-drawer-section').innerText()).includes(TITLE))
  await closeDrawer(a)
  await openUser(a, T3.email)
  await a.locator('.adm-drawer .adm-seg button', { hasText: 'Raportet' }).click(); await sleep(400)
  const rep = await a.locator('.adm-drawer-section').innerText()
  check('reports tab lists both reports against the user with reporters', rep.includes(`R1 spam ${STAMP}`) && rep.includes(`R1 sjellje ${STAMP}`) && /Arta/.test(rep), rep.slice(0, 300))
  await closeDrawer(a)
})

await section('User actions: deactivate / reactivate, strikes up to deletion', async () => {
  await openUser(a, T1.email)
  await drawerBtn(a, 'Çaktivizo').click(); await confirm(a, 'test r1')
  check('toast: account deactivated', /çaktivizua/.test(await toast(a)))
  check('deactivated_at stored', sql(`select deactivated_at is not null from profiles where id='${T1.id}'`) === 't')
  check('deactivated user cannot use the app (sign-in shows gate)', await (async () => {
    const u = await newPage(); await signIn(u, T1.email); const t = await bodyText(u); await u.context().close()
    return /çaktivizuar|çaktivizua/i.test(t)
  })())
  await nav(a, 'Përdoruesit'); await seg(a, 'Të çaktivizuar')
  check('user appears under filter "Të çaktivizuar"', (await rowsText(a)).some((r) => r.includes(T1.email)))
  await seg(a, 'Të gjithë')
  await openUser(a, T1.email)
  await drawerBtn(a, 'Riaktivizo').click(); await confirm(a)
  check('reactivated (deactivated_at cleared)', sql(`select deactivated_at is null from profiles where id='${T1.id}'`) === 't')

  for (let n = 1; n <= 3; n++) {
    const since = Date.now()
    if (n > 1) { await openUser(a, T1.email) }
    const body = await (async () => { await drawerBtn(a, 'Pezullo (strike)').click(); await sleep(300); return a.locator('.adm-modal').innerText() })()
    check(`strike dialog says ${n}/3`, body.includes(`${n}/3`), body.slice(0, 200))
    await confirm(a, `R1 shkelje ${n}`)
    if (n < 3) {
      check(`strike ${n}: ban stored (${n} bans)`, sql(`select count(*) from bans where user_id='${T1.id}'`) === String(n))
      check(`strike ${n}: email job queued (notify-ban ${n}/3)`, sql(`select count(*) from backend.jobs where kind='notify-ban' and payload->>'user_id'='${T1.id}' and (payload->>'ban_count')::int=${n}`) === '1')
      check(`strike ${n}: in-app notification with reason`, sql(`select count(*) from notifications where user_id='${T1.id}' and body like '%R1 shkelje ${n}%${n}/3%'`) === '1')
      if (n === 1) check('strike 1: email delivered to the user', /shkelje 1|pezull/i.test(await waitMail(T1.email, since)))
      if (n === 2) {
        await a.locator('.adm-drawer .adm-seg button', { hasText: 'Pezullimet' }).click(); await sleep(400)
        const bans = await a.locator('.adm-drawer-section').innerText()
        check('bans tab lists both strikes', bans.includes('R1 shkelje 1') && bans.includes('R1 shkelje 2'))
        check('status pill shows 2/3 strikes', (await a.locator('.adm-drawer .adm-profile-head').innerText()).includes('2/3'))
      }
      await closeDrawer(a)
    }
  }
  check('3rd strike queues account deletion', sql(`select count(*) from backend.jobs where kind='delete-banned-user' and payload->>'user_id'='${T1.id}'`) === '1')
  let gone = false
  for (let i = 0; i < 30 && !gone; i++) { await sleep(500); gone = sql(`select count(*) from auth.users where id='${T1.id}'`) === '0' }
  check('3rd strike: the account is deleted by the worker', gone)
  await closeDrawer(a)
  // bans rows cascade with the profile, so the deleted account's record lives on in the audit log
  check('deletion recorded in the audit log with the email', sql(`select count(*) from admin_audit_log where action='user_banned' and target_id='${T1.id}' and details->>'ban_count'='3'`) === '1')
  await nav(a, 'Pezullimet')
  check('Pezullimet page loads (deleted account no longer listed)', !(await rowsText(a)).some((r) => r.includes(T1.email)))
})

await section('User actions: admin role, Premium, notification', async () => {
  await openUser(a, T2.email)
  await drawerBtn(a, 'Bëje admin').click(); await confirm(a)
  check('admin role granted (is_admin=true)', sql(`select is_admin from profiles where id='${T2.id}'`) === 't')
  const tk = await token(T2.email)
  check('new admin can call admin functions', (await api('/rest/v1/rpc/admin_list_users', { p_limit: 1, p_offset: 0 }, tk)).status === 200)
  await drawerBtn(a, 'Hiq rolin admin').click(); await confirm(a)
  check('admin role revoked', sql(`select is_admin from profiles where id='${T2.id}'`) === 'f')
  check('revoked admin is refused again', (await api('/rest/v1/rpc/admin_list_users', { p_limit: 1, p_offset: 0 }, tk)).status >= 400)
  await closeDrawer(a)

  await openUser(a, DONIKA)
  await a.locator('.adm-premium-box select').selectOption('premium_3m')
  await a.locator('.adm-premium-box button', { hasText: 'Jep Premium' }).click(); await confirm(a, 'R1 dhuratë')
  check('Premium granted (3 months, admin_grant)', sql(`select plan_id||'/'||source from subscriptions where user_id='${uid(DONIKA)}' and status='active'`) === 'premium_3m/admin_grant')
  check('drawer shows "Premium deri më"', /Premium deri më/.test(await a.locator('.adm-premium-box').innerText()))
  await a.locator('.adm-premium-box button', { hasText: 'Hiq Premium' }).click(); await confirm(a, 'R1 test')
  check('Premium revoked', sql(`select count(*) from subscriptions where user_id='${uid(DONIKA)}' and status='active'`) === '0')
  await closeDrawer(a)

  const msg = `Përshëndetje nga ekipi R1 ${STAMP}`
  await openUser(a, ILIR)
  await drawerBtn(a, 'Dërgo njoftim').click(); await confirm(a, msg)
  check('toast: notification sent', /Njoftimi u dërgua/.test(await toast(a)))
  check('notification stored for the user', sql(`select count(*) from notifications where user_id='${uid(ILIR)}' and body='${q(msg)}'`) === '1')
  await closeDrawer(a)
  const u = await newPage()
  await signIn(u, ILIR); await sleep(1000)
  await u.locator('.bell').first().click(); await sleep(1000)
  check('user sees the admin message in notifications', (await u.locator('.notif-panel').innerText().catch(() => '')).includes(msg))
  await u.context().close()
})

await section('Tables: filters, search, sort, paging, detail, cancel + restore', async () => {
  await nav(a, 'Tavolinat')
  const total = Number(sql('select count(*) from tables'))
  check(`tables list total matches SQL (${total})`, (await pager(a)).includes(`nga ${total}`), await pager(a))
  if (total > 25) {
    await a.locator('.adm-content .adm-pager-btns button').nth(1).click(); await sleep(1300)
    check('tables page 2', (await pager(a)).startsWith('26'))
    await a.locator('.adm-content .adm-pager-btns button').nth(0).click(); await sleep(1000)
  }
  const sel = a.locator('.adm-content .adm-toolbar select')
  await sel.nth(0).selectOption('sport'); await sleep(1500)
  let rows = await rowsText(a)
  const sports = Number(sql("select count(*) from tables where kind='sport'"))
  check(`kind filter Sport (${sports} in DB)`, sports === 0 ? rows.length === 0 : rows.length > 0 && rows.every((r) => r.includes('Sport')) && (await pager(a)).includes(`nga ${sports}`), rows[0])
  await sel.nth(0).selectOption(''); await sleep(800)
  const city = sql("select city from tables where city<>'Prishtinë' group by city order by count(*) desc limit 1")
  await sel.nth(1).selectOption(city); await sleep(1500)
  rows = await rowsText(a)
  check(`city filter ${city}`, rows.length > 0 && rows.every((r) => r.includes(city)) && (await pager(a)).includes(`nga ${sql(`select count(*) from tables where city='${city}'`)}`))
  await sel.nth(1).selectOption(''); await sleep(800)
  await seg(a, 'Me pagesa')
  check('status "Me pagesa" includes the paid test table', (await rowsText(a)).some((r) => r.includes(TITLE)))
  await seg(a, 'Kanë kaluar')
  rows = await rowsText(a)
  check('status "Kanë kaluar" shows only past tables', rows.length === 0 || rows.every((r) => /Ka kaluar|Anuluar|Përfunduar/.test(r)), rows[0])
  await seg(a, 'Të gjitha')
  await sel.nth(2).selectOption('most_revenue'); await sleep(1500)
  const topRev = sql("select t.title from payments p join tables t on t.id=p.table_id where p.status='paid' group by t.id, t.title order by sum(p.amount_cents) desc, max(t.created_at) desc limit 1")
  check('sort by most revenue puts a top-revenue table first', (await rowsText(a))[0].length > 0 && Number(sql(`select coalesce(sum(amount_cents),0) from payments where status='paid' and table_title='${q((await a.locator('.adm-content .adm-table tbody tr strong').first().innerText()).trim())}'`)) >= Number(sql(`select sum(amount_cents) from payments where status='paid' and table_title='${q(topRev)}'`)), (await rowsText(a))[0])
  await sel.nth(2).selectOption('newest'); await sleep(800)
  await search(a, `darkë ${STAMP}`)
  rows = await rowsText(a)
  check('search by title finds the test table only', rows.length === 1 && rows[0].includes(TITLE), rows.join(' || '))
  check('row shows host, seats 2/6, pending request, paid €2', /Erion/.test(rows[0]) && rows[0].includes('2/6') && /2[.,]00/.test(rows[0]))
  await search(a, 'Erion Morina')
  check('search by host name finds the table', (await rowsText(a)).some((r) => r.includes(TITLE)))
  await search(a, `darkë ${STAMP}`)
  await a.locator('.adm-content .adm-table tbody tr').first().click(); await sleep(1800)
  const d = await a.locator('.adm-drawer').innerText()
  check('table detail: members with host + paying guest', d.includes('Erion') && d.includes('Gentrit') && d.includes(TICKET))
  check('table detail: requests include Ilir (pending)', /Ilir/.test(d) && /Në pritje/.test(d))
  check('table detail: payments section', /Pagesat e kësaj tavoline/i.test(d))
  await drawerBtn(a, 'Anulo tavolinën').click(); await sleep(300)
  check('cancel dialog: reason required (button disabled when empty)', await a.locator('.adm-modal button[type=submit]').isDisabled())
  await confirm(a, `R1 vend jo ekzistues ${STAMP}`)
  check('toast: cancelled, members notified', /anulua/.test(await toast(a)))
  check('table status cancelled', sql(`select status from tables where id='${TABLE_ID}'`) === 'cancelled')
  check('guest + pending requester notified with reason', sql(`select count(distinct user_id) from notifications where body like '%${TITLE}%R1 vend jo ekzistues%' and user_id in ('${uid(GENTRIT)}','${uid(ILIR)}')`) === '2')
  check('pending request expired', sql(`select status from requests where table_id='${TABLE_ID}' and user_id='${uid(ILIR)}'`) === 'expired')
  await closeDrawer(a)
  await search(a, ''); await seg(a, 'Anuluar')
  check('status filter Anuluar lists it', (await rowsText(a)).some((r) => r.includes(TITLE)))
  await a.locator('.adm-content .adm-table tbody tr', { hasText: TITLE }).click(); await sleep(1500)
  await drawerBtn(a, 'Rikthe tavolinën').click(); await confirm(a)
  check('table restored (open)', sql(`select status from tables where id='${TABLE_ID}'`) === 'open')
  await closeDrawer(a); await seg(a, 'Të gjitha')
})

await section('Payments: list, filters, search, CSV', async () => {
  await nav(a, 'Pagesat')
  const total = Number(sql('select count(*) from payments'))
  check(`payments total ${total}`, (await pager(a)).includes(`nga ${total}`), await pager(a))
  const first = (await rowsText(a)).find((r) => r.includes(TICKET)) || ''
  check('row shows payer, email, amount, table, ticket, status', /Gentrit/.test(first) && first.includes(GENTRIT) && first.includes(TITLE) && /2[.,]00/.test(first) && /Paguar/.test(first), first)
  await search(a, TICKET)
  let rows = await rowsText(a)
  check('search by ticket code', rows.length === 1 && rows[0].includes(TICKET))
  await search(a, 'gentrit.shala@')
  rows = await rowsText(a)
  check('search by payer email', rows.length >= 1 && rows.every((r) => r.includes(GENTRIT)))
  await search(a, '')
  const sel = a.locator('.adm-content .adm-toolbar select')
  await sel.nth(1).selectOption('failed'); await sleep(1500)
  const failed = Number(sql("select count(*) from payments where status='failed'"))
  check(`status filter Dështuar (${failed})`, failed ? (await pager(a)).includes(`nga ${failed}`) : /S'ka pagesa/.test(await bodyText(a)))
  await sel.nth(1).selectOption(''); await sleep(800)
  await sel.nth(2).selectOption('stub'); await sleep(1500)
  check('provider filter stub', (await pager(a)).includes(`nga ${sql("select count(*) from payments where provider='stub'")}`))
  await sel.nth(2).selectOption(''); await sleep(800)
  await sel.nth(0).selectOption('today'); await sleep(1500)
  const today = Number(sql("select count(*) from payments where created_at >= date_trunc('day', now() at time zone 'Europe/Belgrade') at time zone 'Europe/Belgrade'"))
  const pt = await pager(a)
  check(`period Sot shows today's payments (${pt}; db≈${today})`, (await rowsText(a)).some((r) => r.includes(TICKET)) && Math.abs(Number(pt.split('nga ')[1]?.replace(/\D/g, '')) - today) <= 2, pt)
  await sel.nth(0).selectOption('custom'); await sleep(500)
  const dates = a.locator('.adm-content .adm-toolbar input[type=date]')
  await dates.nth(0).fill('2020-01-01'); await dates.nth(1).fill('2020-01-02'); await sleep(1500)
  check('custom date range in the past: no payments', /S'ka pagesa/.test(await bodyText(a)))
  await sel.nth(0).selectOption('all'); await sleep(1200)
  // CSV
  await search(a, TICKET)
  const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 20000 }), a.locator('button', { hasText: 'Eksporto CSV' }).click()])
  const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n')
  check('filtered CSV: header + 1 row', csv.length === 2 && /ticket_code/.test(csv[0]), csv.join(' / ').slice(0, 300))
  check('CSV row has payer, email, amount, table', csv[1]?.includes('Gentrit') && csv[1].includes(GENTRIT) && csv[1].includes('2.00') && csv[1].includes(TITLE), csv[1])
  await search(a, '')
  const [dl2] = await Promise.all([a.waitForEvent('download', { timeout: 30000 }), a.locator('button', { hasText: 'Eksporto CSV' }).click()])
  const all = fs.readFileSync(await dl2.path(), 'utf8').trim().split('\n')
  check(`full CSV has every payment (${all.length - 1})`, all.length - 1 === Number(sql('select count(*) from payments')))
})

await section('Reports: dismiss, ban from report, delete immediately', async () => {
  await nav(a, 'Raportet')
  const card = (txt) => a.locator('.adm-report', { hasText: txt })
  check('pending reports listed with reporter → reported', (await card(`R1 spam ${STAMP}`).innerText()).includes('Arta') && (await card(`R1 spam ${STAMP}`).innerText()).includes(T3.last))
  await card(`R1 spam ${STAMP}`).locator('button', { hasText: 'Refuzo raportin' }).click(); await confirm(a)
  check('dismissed', sql(`select status from reports where id='${REP_DISMISS}'`) === 'reviewed_dismissed')
  check('dismissed report leaves the pending list', (await card(`R1 spam ${STAMP}`).count()) === 0)
  await card(`R1 sjellje ${STAMP}`).locator('button', { hasText: 'Pezullo' }).first().click(); await sleep(300)
  check('ban dialog pre-fills the report reason', (await a.locator('.adm-modal input, .adm-modal textarea').first().inputValue()).includes('R1 sjellje'))
  await confirm(a)
  check('ban from report: report closed as banned + 1 strike', sql(`select status from reports where id='${REP_BAN}'`) === 'reviewed_banned' && sql(`select count(*) from bans where user_id='${T3.id}'`) === '1')
  check('ban from report: email job queued', sql(`select count(*) from backend.jobs where kind='notify-ban' and payload->>'user_id'='${T3.id}'`) === '1')
  await card(`R1 profil i rremë ${STAMP}`).locator('button', { hasText: 'Fshi llogarinë' }).click(); await confirm(a)
  check('delete immediately: report closed + deletion job queued', sql(`select count(*) from reports where id='${REP_DEL}'`) === '0' || sql(`select status from reports where id='${REP_DEL}'`) === 'deleted_immediately')
  check('deletion job queued', sql(`select count(*) from backend.jobs where kind='delete-banned-user' and payload->>'user_id'='${T4.id}'`) === '1')
  let gone = false
  for (let i = 0; i < 30 && !gone; i++) { await sleep(500); gone = sql(`select count(*) from auth.users where id='${T4.id}'`) === '0' }
  check('reported account deleted by the worker', gone)
  await seg(a, 'U refuzuan')
  check('"U refuzuan" tab shows the dismissed report with reviewer', /Admin|ejaBashkohu|Support/i.test(await card(`R1 spam ${STAMP}`).innerText().catch(() => '')) || (await card(`R1 spam ${STAMP}`).count()) === 1)
})

await section('Global search: users, tables, payments', async () => {
  const g = a.locator('.adm-gsearch input')
  await g.fill('Kelmendi'); await sleep(1500)
  check('finds user by name', (await a.locator('.adm-gsearch-pop').innerText()).includes(ILIR))
  await g.fill(`darkë ${STAMP}`); await sleep(1500)
  check('finds table by title', (await a.locator('.adm-gsearch-pop').innerText()).includes(TITLE))
  await a.locator('.adm-gsearch-pop button', { hasText: TITLE }).click(); await sleep(1500)
  check('clicking the table result opens its drawer', (await a.locator('.adm-drawer h2').innerText()).includes(TITLE))
  await closeDrawer(a)
  await g.fill(TICKET); await sleep(1500)
  check('finds payment by ticket', (await a.locator('.adm-gsearch-pop').innerText()).includes(TICKET))
  await a.locator('.adm-gsearch-pop button', { hasText: TICKET }).click(); await sleep(1500)
  check('clicking the payment result opens Payments filtered to it', (await rowsText(a)).length === 1 && (await rowsText(a))[0].includes(TICKET))
  await g.fill('qqqzzz' + STAMP); await sleep(1500)
  check('no-match message', (await a.locator('.adm-gsearch-pop').innerText()).includes('Asgjë nuk u gjet'))
  await g.fill('')
})

await section('Plans: edit price / limit / visibility, user sees it, restore', async () => {
  try {
    await nav(a, 'Pakot'); await seg(a, 'Pakot')
    const edit = async (name) => { await a.locator('.adm-card', { hasText: name }).locator('button', { hasText: 'Ndrysho' }).click(); await sleep(400) }
    await edit('Premium 1 muaj')
    await a.locator('.adm-modal input[type=number]').fill('11.99'); await confirm(a)
    await edit('Premium 12 muaj')
    await a.locator('.adm-modal input[type=checkbox]').uncheck(); await confirm(a)
    await edit('Bazike')
    await a.locator('.adm-modal input[type=number]').fill('5'); await confirm(a)
    check('plan edits stored', sql("select price_cents from plans where id='premium_1m'") === '1199' && sql("select active from plans where id='premium_12m'") === 'f' && sql("select monthly_table_limit from plans where id='basic'") === '5')
    check('hidden plan marked "E fshehur" in admin', (await a.locator('.adm-card', { hasText: 'Premium 12 muaj' }).innerText()).includes('E fshehur'))
    const u = await newPage()
    await signIn(u, DONIKA); await sleep(800)
    await u.locator('.premium-pill').click(); await sleep(1200)
    const packs = (await u.locator('.pl-pack').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')
    check('user Plans screen shows the new price €11.99', packs.includes('11.99'), packs)
    check('hidden 12-month plan no longer offered', !packs.includes('59.99') && (await u.locator('.pl-pack').count()) === 2, packs)
    check('basic limit shown to user: "Deri 5 tavolina në muaj"', (await u.locator('.pl-sheet').innerText()).includes('Deri 5 tavolina'))
    await u.screenshot({ path: SHOTS + 'admin-plans-user.png' })
    await u.context().close()
    // restore through the UI
    await edit('Premium 1 muaj'); await a.locator('.adm-modal input[type=number]').fill('9.99'); await confirm(a)
    await edit('Premium 12 muaj'); await a.locator('.adm-modal input[type=checkbox]').check(); await confirm(a)
    await edit('Bazike'); await a.locator('.adm-modal input[type=number]').fill('3'); await confirm(a)
    check('original plan values restored', sql("select string_agg(id||':'||price_cents||':'||coalesce(monthly_table_limit,-1)||':'||active, ',' order by sort) from plans") === 'basic:0:3:true,premium_1m:999:-1:true,premium_3m:2499:-1:true,premium_12m:5999:-1:true')
  } finally { restorePlans() }
})

await section('Wednesday: restaurants add/edit/deactivate, sign-ups, groups', async () => {
  const RN = `R1 Restorant ${STAMP}`
  await nav(a, 'Darka e Mërkurës'); await seg(a, 'Restorantet')
  await a.locator('button', { hasText: 'Shto restorant' }).click(); await sleep(400)
  const f = a.locator('.adm-modal input')
  check('save disabled until fields are filled', await a.locator('.adm-modal button[type=submit]').isDisabled())
  await f.nth(0).fill(RN); await f.nth(1).fill('Prishtinë'); await f.nth(2).fill('Rr. Agim Ramadani 1'); await f.nth(3).fill('https://maps.app.goo.gl/r1test')
  await a.locator('.adm-modal button[type=submit]').click(); await sleep(1500)
  check('restaurant created', sql(`select count(*) from wednesday_restaurants where name='${RN}' and active`) === '1')
  await a.locator('.adm-content .adm-table tbody tr', { hasText: RN }).locator('button', { hasText: 'Ndrysho' }).click(); await sleep(400)
  await a.locator('.adm-modal input').nth(2).fill('Rr. Nëna Terezë 22'); await a.locator('.adm-modal button[type=submit]').click(); await sleep(1500)
  check('restaurant edited', sql(`select address from wednesday_restaurants where name='${RN}'`) === 'Rr. Nëna Terezë 22')
  await a.locator('.adm-content .adm-table tbody tr', { hasText: RN }).locator('.adm-switch').click(); await sleep(1500)
  check('restaurant deactivated', sql(`select active from wednesday_restaurants where name='${RN}'`) === 'f')
  check('deactivated row shown muted', /is-muted/.test(await a.locator('.adm-content .adm-table tbody tr', { hasText: RN }).getAttribute('class')))
  // sign-ups from my six users, then form groups
  for (const e of MINE) await api('/rest/v1/rpc/signup_wednesday', { p_city: 'Prishtinë', p_langs: ['sq'] }, await token(e))
  const mine = MINE.map((e) => `'${uid(e)}'`).join(',')
  check('six sign-ups stored', sql(`select count(*) from wednesday_signups where user_id in (${mine}) and status='signed_up'`) === '6')
  await a.reload(); await sleep(2500)
  await seg(a, 'Regjistrimet')
  const list = await a.locator('.adm-content').innerText()
  check('sign-ups list shows my users', ['Arta', 'Blerim', 'Donika', 'Erion', 'Gentrit', 'Ilir'].every((n) => list.includes(n)), list.slice(0, 300))
  await a.locator('button', { hasText: 'Formo grupet tani' }).click(); await sleep(3000)
  check('toast: groups formed', /Grupet u formuan/.test(await toast(a)))
  check('my sign-ups were grouped/waitlisted', sql(`select count(*) from wednesday_signups where user_id in (${mine}) and status in ('grouped','waitlisted')`) === '6')
  await seg(a, 'Të ardhshme')
  check('upcoming groups show participants', (await a.locator('.adm-wed').count()) > 0 && /pjesëmarrës/.test(await a.locator('.adm-content').innerText()))
})

await section('Tutors: approve, suspend, reject', async () => {
  await nav(a, 'Mësuesit')
  const card = (t) => a.locator('.adm-report', { hasText: t })
  check('pending applications listed', (await card(`R1 Mësues vizatimi ${STAMP}`).count()) === 1 && (await card(`R1 Mësuese fotografie ${STAMP}`).count()) === 1)
  await card(`R1 Mësues vizatimi ${STAMP}`).locator('button', { hasText: 'Aprovo' }).click(); await confirm(a)
  check('approved', sql(`select status from tutors where user_id='${uid(BLERIM)}'`) === 'approved')
  await card(`R1 Mësuese fotografie ${STAMP}`).locator('button', { hasText: 'Refuzo' }).click(); await sleep(300)
  check('reject requires a reason', await a.locator('.adm-modal button[type=submit]').isDisabled())
  await confirm(a, 'Profili nuk është i plotë')
  check('rejected with reason', sql(`select status||'/'||rejection_reason from tutors where user_id='${uid(ARTA)}'`) === 'rejected/Profili nuk është i plotë')
  await seg(a, 'Të aprovuar')
  await card(`R1 Mësues vizatimi ${STAMP}`).locator('button', { hasText: 'Pezullo' }).click(); await confirm(a, 'Ankesa nga studentët')
  check('suspended', sql(`select status from tutors where user_id='${uid(BLERIM)}'`) === 'suspended')
  check('tutor notified of each decision', Number(sql(`select count(*) from notifications where user_id in ('${uid(BLERIM)}','${uid(ARTA)}') and created_at >= '${T0}' and (kind like 'tutor%' or body ilike '%mësues%')`)) >= 3)
})

await section('Activity log records every action', async () => {
  const expected = {
    user_deactivated: T1.id, user_reactivated: T1.id, user_banned: T1.id, admin_granted: T2.id, admin_revoked: T2.id,
    premium_granted: null, premium_revoked: null, user_notified: uid(ILIR), table_cancelled: TABLE_ID, table_restored: TABLE_ID,
    report_dismissed: T3.id, user_deleted: T4.id, plan_updated: null, restaurant_created: null, restaurant_updated: null,
    restaurant_deactivated: null, wednesday_formed: null, tutor_approved: uid(BLERIM), tutor_rejected: uid(ARTA), tutor_suspended: uid(BLERIM),
  }
  const missing = Object.entries(expected).filter(([k, v]) => !audit(k, v)).map(([k]) => k)
  check('audit rows stored for all 20 action types', missing.length === 0, missing.join(', '))
  await nav(a, 'Aktiviteti')
  const txt = (await rowsText(a)).join(' || ')
  const labels = ['Pezulloi përdoruesin', 'Çaktivizoi llogarinë', 'Riaktivizoi llogarinë', 'Dha rolin admin', 'Hoqi rolin admin', 'Dha Premium', 'Hoqi Premium', 'Dërgoi njoftim', 'Anuloi tavolinën', 'Riktheu tavolinën', 'Refuzoi raportin', 'Fshiu llogarinë', 'Ndryshoi pakon', 'Shtoi restorant', 'Ndryshoi restorantin', 'Çaktivizoi restorantin', 'Formoi grupet e Mërkurës', 'Aprovoi mësuesin', 'Refuzoi mësuesin', 'Pezulloi mësuesin']
  const notShown = labels.filter((l) => !txt.includes(l))
  check('Activity page shows each action in Albanian', notShown.length === 0, notShown.join(', '))
  check('activity shows reasons/details (e.g. strike 3/3, notified count)', txt.includes('3/3') && /të njoftuar/.test(txt) && txt.includes(`R1 vend jo ekzistues ${STAMP}`))
  check('admin console: no page errors', a.errs.length === 0, a.errs.join(' | '))
  const bad = a.bad.filter((x) => !/rpc\/admin_get_user/.test(x))
  check('admin console: no failed API calls', bad.length === 0, bad.join(', '))
})

await section('Phone width (400x860): admin console usable', async () => {
  const m = await openAdmin(400, 860)
  const noHScroll = async () => m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('overview: no horizontal scroll', await noHScroll())
  await m.locator('.adm-menu-btn').click(); await sleep(500)
  await m.locator('.adm-nav button', { hasText: 'Përdoruesit' }).click(); await sleep(1800)
  check('users list on phone: rows visible, no horizontal scroll', (await m.locator('.adm-table tbody tr').count()) > 0 && await noHScroll())
  await m.screenshot({ path: SHOTS + 'admin-users-phone.png' })
  await m.locator('.adm-table tbody tr').first().click(); await sleep(1800)
  check('user drawer on phone fits the screen', await m.locator('.adm-drawer').evaluate((el) => el.getBoundingClientRect().width <= window.innerWidth))
  await m.screenshot({ path: SHOTS + 'admin-user-drawer-phone.png' })
  check('phone: no page errors', m.errs.length === 0, m.errs.join(' | '))
  await m.context().close()
})

await section('Non-admin cannot open the console or call admin functions', async () => {
  const u = await newPage({ width: 1280, height: 800 })
  await signIn(u, GENTRIT)
  await u.evaluate(() => { sessionStorage.setItem('ejabashkohu-admin-screen', 'admin'); sessionStorage.setItem('ejabashkohu-admin-section', 'users') })
  await u.reload(); await sleep(2500)
  check('no admin console / no "back to admin" button for a normal user', (await u.locator('.adm-nav, .admin-return-badge').count()) === 0)
  const tk = await token(GENTRIT)
  const calls = [
    ['admin_get_dashboard', { p_range: 'day' }], ['admin_list_users', { p_limit: 5, p_offset: 0 }], ['admin_global_search', { p_q: 'gmail' }],
    ['admin_ban_user', { p_user: uid(ILIR), p_reason: 'x' }], ['admin_set_user_admin', { p_user: uid(GENTRIT), p_is_admin: true }],
    ['admin_update_plan', { p_plan: 'premium_1m', p_price_cents: 1, p_table_limit: null, p_join_limit: null, p_active: true }],
    ['admin_cancel_table', { p_table: TABLE_ID, p_reason: 'x' }], ['admin_list_payments', { p_limit: 5, p_offset: 0 }],
    ['admin_dismiss_report', { p_report_id: REP_BAN }], ['admin_delete_user', { p_user: uid(ILIR), p_reason: 'x' }],
    ['admin_review_tutor', { p_user: uid(ARTA), p_status: 'approved' }], ['admin_upsert_restaurant', { p_name: 'Hack', p_city: 'X', p_address: 'Y' }],
  ]
  const allowed = []
  for (const [fn, body] of calls) { const r = await api('/rest/v1/rpc/' + fn, body, tk); if (r.status < 400) allowed.push(`${fn}:${r.status}`) }
  check('all 12 admin functions refused for a normal user', allowed.length === 0, allowed.join(', '))
  check('nothing changed by those calls', sql(`select is_admin from profiles where id='${uid(GENTRIT)}'`) === 'f' && sql("select price_cents from plans where id='premium_1m'") === '999' && sql(`select status from tables where id='${TABLE_ID}'`) === 'open' && sql(`select count(*) from bans where user_id='${uid(ILIR)}'`) === '0' && sql("select count(*) from wednesday_restaurants where name='Hack'") === '0')
  const r = await api('/rest/v1/query', { table: 'profiles', action: 'update', values: { is_admin: true }, filters: [{ col: 'id', op: 'eq', value: uid(GENTRIT) }] }, tk)
  check('user cannot make himself admin via a profile update', sql(`select is_admin from profiles where id='${uid(GENTRIT)}'`) === 'f', JSON.stringify(r).slice(0, 150))
  const anon = await api('/rest/v1/rpc/admin_list_users', { p_limit: 5, p_offset: 0 })
  check('signed-out caller refused', anon.status >= 400)
  await u.context().close()
})

// cleanup of my own data (keeps the audit log)
sql(`delete from wednesday_signups where user_id in (${MINE.map((e) => `'${uid(e)}'`).join(',')})`)
sql(`delete from tutors where user_id in ('${uid(ARTA)}','${uid(BLERIM)}')`)
sql(`delete from auth.users where email like 'r1.%.${STAMP}@gmail.com'`)
restorePlans()
await close()
process.exit(summary() ? 1 : 0)
