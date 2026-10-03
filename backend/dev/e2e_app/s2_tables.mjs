// Tables, live listings, join flow, share links, Basic limits, sports,
// notifications language, WhatsApp, startup requests: all against Django.
import { API, SITE, api, bodyText, check, close, launch, newPage, section, signIn, sleep, sql, summary, token } from './lib.mjs'

const HOST = 'arta.krasniqi@gmail.com'
const GUEST = 'blerim.gashi@gmail.com'
const VIEWER = 'donika.berisha@gmail.com'
const PEJA = 'erion.morina@gmail.com'
// known starting point: both in Prishtinë, Basic, nothing hosted this month
for (const e of [HOST, GUEST, VIEWER]) sql(`update profiles set home_city='Prishtinë', home_city_changed_at=null where id=(select id from auth.users where email='${e}')`)
const pejaExists = sql(`select count(*) from auth.users where email='${PEJA}'`) === '1'
const PEJA_USER = pejaExists ? PEJA : sql(`select u.email from auth.users u join profiles p on p.id=u.id where u.email not in ('${HOST}','${GUEST}','${VIEWER}') and not p.is_admin order by u.email limit 1`)
sql(`update profiles set home_city='Pejë' where id=(select id from auth.users where email='${PEJA_USER}')`)
sql(`delete from tables where host_id in (select id from auth.users where email in ('${HOST}','${GUEST}')) and created_at > now() - interval '40 days'`)
sql(`delete from subscriptions where user_id in (select id from auth.users where email in ('${HOST}','${GUEST}','${VIEWER}','${PEJA_USER}'))`)

const RUN_START = sql('select now()')
const tomorrow = new Date(Date.now() + 864e5)
const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
let created = null

await launch()
const host = await newPage()
await signIn(host, HOST)
const guest = await newPage()
await signIn(guest, GUEST)

await section('Basic plan: home city only + browse modes', async () => {
  const chips = (await host.locator('.chip.city').allInnerTexts()).map((s) => s.trim())
  check('Basic user sees only the home city chip + a locked "other cities" chip', chips.includes('Prishtinë') && chips.some((c) => /Qytetet tjera/.test(c)) && !chips.includes('Prizren'), chips.join(' | '))
  const modes = await host.locator('.browse-mode').allInnerTexts()
  check('browse modes: Tavolinat, Sport, Mësimet, Udhëtimet, Vozitjet', ['Tavolinat', 'Sport', 'Mësimet', 'Udhëtimet', 'Vozitjet'].every((m) => modes.some((x) => x.includes(m))), modes.join('|'))
  for (const [m, kind] of [['Vozitjet', 'vozitje'], ['Udhëtimet', 'udhetim']]) {
    await host.locator('.browse-mode', { hasText: m }).click(); await sleep(700)
    const titles = await host.locator('.card-body h3').allInnerTexts()
    const expected = sql(`select count(*) from tables where city='Prishtinë' and kind='${kind}' and status='open' and event_datetime>now()`)
    check(`${m} shows only ${kind} listings from the database (${expected})`, titles.length === Number(expected), `${titles.length} vs ${expected}`)
  }
  await host.locator('.browse-mode', { hasText: 'Tavolinat' }).click(); await sleep(600)
})

await section('Create a table -> share prompt, link in address bar; arrives live for others', async () => {
  const before = await guest.locator('.card-body h3').allInnerTexts()
  await host.locator('.fab').click(); await sleep(600)
  await host.locator('#f-cafe').fill('Kafe Django Test')
  await host.locator('#f-area').fill('Dardania').catch(() => {})
  await host.locator('#f-event-date').fill(ymd)
  await host.locator('#f-event-time').fill('19:30')
  await host.locator('#f-maps').fill('https://maps.app.goo.gl/django123')
  const meter = await host.locator('.usage-meter').innerText().catch(() => '')
  check('usage meter shows 0/3 tables this month', /0\s*\/\s*3/.test(meter), meter)
  await host.locator('.btn.primary.full', { hasText: 'Hape tavolinën' }).click(); await sleep(2500)
  created = JSON.parse(sql(`select row_to_json(t) from (select id, share_code from tables where title='Kafe Django Test' order by created_at desc limit 1) t`) || 'null')
  check('table stored in the database', !!created)
  check('new table opens with the "share with friends" prompt', await host.locator('.share-row.nudge').isVisible().catch(() => false))
  check('address bar shows the share link /t/<code>', new URL(host.url()).pathname === `/t/${created?.share_code}`, host.url())
  await host.locator('.share-main').click(); await sleep(600)
  const clip = await host.evaluate(() => navigator.clipboard.readText())
  check('share copies text + link', clip.includes(`/t/${created?.share_code}`) && clip.includes('Kafe Django Test'), clip)
  await sleep(2500)
  const after = await guest.locator('.card-body h3').allInnerTexts()
  check('other user sees the new table appear live (no reload)', after.includes('Kafe Django Test') && !before.includes('Kafe Django Test'), after.join(', '))
})

await section('Join request -> host approves live -> guest confirms seat (€2)', async () => {
  await guest.locator('.card-body h3', { hasText: 'Kafe Django Test' }).click(); await sleep(1200)
  await guest.locator('button', { hasText: "Kërko t'i bashkohesh" }).click(); await sleep(2500)
  check('request stored', sql(`select status from requests where table_id='${created.id}'`) === 'pending')
  const hostReq = host.locator('.btn-approve')
  await hostReq.first().waitFor({ timeout: 8000 }).catch(() => {})
  check('host sees the request live in the open table', await hostReq.count() > 0)
  await hostReq.first().click(); await sleep(3000)
  const confirmBtn = guest.locator('button', { hasText: /U aprovove/ })
  await confirmBtn.first().waitFor({ timeout: 8000 }).catch(() => {})
  check("guest's screen switches to 'approved, confirm' live", await confirmBtn.count() > 0, (await bodyText(guest)).slice(0, 200))
  if (await confirmBtn.count()) {
    await confirmBtn.first().click(); await sleep(1000)
    await guest.locator('.method', { hasText: /PayPal/i }).click().catch(() => {})
    await guest.locator('button', { hasText: /Paguaj/ }).first().click(); await sleep(3000)
  }
  check('seat confirmed: guest is a member', sql(`select count(*) from memberships m join auth.users u on u.id=m.user_id where m.table_id='${created.id}' and u.email='${GUEST}'`) === '1')
  check('€2 booking payment recorded with ticket code', /^EBK-/.test(sql(`select p.ticket_code from payments p join auth.users u on u.id=p.user_id where p.table_id='${created.id}' and u.email='${GUEST}'`)))
  const kinds = sql(`select string_agg(distinct kind, ',') from notifications n join auth.users u on u.id=n.user_id where u.email in ('${HOST}','${GUEST}') and n.created_at > now() - interval '5 minutes'`)
  check('notifications created for request / approval', /request|approved|seat/i.test(kinds), kinds)
  const dupes = sql(`select count(*) from (select user_id, kind, params from notifications where created_at > now() - interval '5 minutes' and created_at >= '${RUN_START}' group by 1,2,3 having count(*) > 1) d`)
  check('no duplicate notifications', dupes === '0', dupes)
})

await section('Notifications follow the app language', async () => {
  await guest.goto(SITE + '/'); await sleep(2500)
  await guest.locator('.bell, [aria-label*="Njoftime"], .notif-btn').first().click().catch(() => {}); await sleep(800)
  const sq = (await guest.locator('.notif-list li, .notifs li, .notif-item').allInnerTexts()).join(' || ')
  await guest.evaluate(() => localStorage.setItem('ejabashkohu-ui-lang', 'en')); await guest.reload(); await sleep(3000)
  await guest.locator('.bell, [aria-label*="otif"], .notif-btn').first().click().catch(() => {}); await sleep(800)
  const en = (await guest.locator('.notif-list li, .notifs li, .notif-item').allInnerTexts()).join(' || ')
  check('notification texts change language (sq -> en)', sq && en && sq !== en && /approved|seat|confirmed|request/i.test(en), `${sq.slice(0, 120)} >> ${en.slice(0, 120)}`)
  await guest.evaluate(() => localStorage.setItem('ejabashkohu-ui-lang', 'sq')); await guest.reload(); await sleep(2500)
})

await section('Share link opened signed out -> preview -> sign in -> table opens', async () => {
  const anon = await newPage()
  await anon.goto(`${SITE}/t/${created.share_code}`); await sleep(2500)
  const card = await anon.locator('.share-card').innerText().catch(() => '')
  check('preview card with title, seats and host (from Django, anonymous)', card.includes('Kafe Django Test') && /vende të lira/.test(card) && /Arta/.test(card), card.replace(/\s+/g, ' '))
  await anon.locator('.share-card .btn.ghost').click(); await sleep(500)
  await signIn(anon, VIEWER)
  await sleep(2500)
  check('after signing in the shared table opens by itself', (await anon.locator('.sheet h2').innerText().catch(() => '')).includes('Kafe Django Test'))
  await anon.context().close()
  const peja = await newPage()
  await signIn(peja, PEJA_USER)
  await peja.goto(`${SITE}/t/${created.share_code}`); await sleep(3000)
  const pcard = await peja.locator('.share-card').innerText().catch(() => '')
  check('Basic user from Pejë gets the Premium card instead of the table', /Premium/.test(pcard) && /Prishtinë/.test(pcard), pcard.replace(/\s+/g, ' '))
  await peja.context().close()
  const r = await api('/rest/v1/rpc/table_share_preview', { p_code: created.share_code })
  check('anonymous preview never includes the maps link', !JSON.stringify(r).includes('maps.app.goo.gl'))
})

await section('Basic monthly limit (3) enforced in UI and database', async () => {
  const t = await token(HOST)
  for (const n of [2, 3]) {
    const r = await api('/rest/v1/query', { table: 'tables', action: 'insert', values: { host_id: sql(`select id from auth.users where email='${HOST}'`), kind: 'tavoline', category: 'kafe', title: `Limit test ${n}`, city: 'Prishtinë', area: 'Qendër', spots: 4, time_label: 'x', event_datetime: new Date(Date.now() + 2 * 864e5).toISOString(), maps_link: 'https://maps.app.goo.gl/x' } }, t)
    check(`table ${n} of 3 allowed`, r.status === 200, JSON.stringify(r).slice(0, 160))
  }
  const r4 = await api('/rest/v1/query', { table: 'tables', action: 'insert', values: { host_id: sql(`select id from auth.users where email='${HOST}'`), kind: 'tavoline', category: 'kafe', title: 'Limit test 4', city: 'Prishtinë', area: 'Qendër', spots: 4, time_label: 'x', event_datetime: new Date(Date.now() + 2 * 864e5).toISOString(), maps_link: 'https://maps.app.goo.gl/x' } }, t)
  check('4th table refused by the database', r4.status === 400 && /muaj|limit|Premium/i.test(r4.message), r4.message)
  await host.goto(SITE + '/'); await sleep(3000)
  await host.locator('.fab').click(); await sleep(800)
  check('create form shows the Premium upsell instead of submit', await host.locator('.upsell').isVisible().catch(() => false))
  await host.keyboard.press('Escape').catch(() => {})
})

await section('Sports: per-sport filtering', async () => {
  await guest.goto(SITE + '/'); await sleep(2500)
  await guest.locator('.browse-mode', { hasText: 'Sport' }).click(); await sleep(800)
  await guest.locator('.fab').click(); await sleep(700)
  await guest.locator('.sport-pick .chip', { hasText: 'Futboll' }).click()
  await guest.locator('#f-cafe').fill('Fusha Django')
  await guest.locator('#f-event-date').fill(ymd)
  await guest.locator('#f-event-time').fill('18:00')
  await guest.locator('#f-maps').fill('https://maps.app.goo.gl/futboll1')
  await guest.locator('.btn.primary.full', { hasText: 'Hap lojën' }).click(); await sleep(2500)
  check('football game stored with kind=sport, sport=football', sql("select kind || ',' || sport from tables where title='Fusha Django'") === 'sport,football')
  await guest.goto(SITE + '/'); await sleep(2500)
  await guest.locator('.browse-mode', { hasText: 'Sport' }).click(); await sleep(700)
  await guest.locator('.sport-row .chip', { hasText: 'Futboll' }).click(); await sleep(600)
  const fb = await guest.locator('.card-body h3').allInnerTexts()
  await guest.locator('.sport-row .chip', { hasText: 'Volejboll' }).click(); await sleep(600)
  const vb = await guest.locator('.card-body h3').allInnerTexts()
  check('Futboll filter shows the football game', fb.includes('Fusha Django'), fb.join(', '))
  check('Volejboll filter does not show it', !vb.includes('Fusha Django'), vb.join(', '))
})

await section('WhatsApp support button', async () => {
  const href = await guest.locator('.wa-btn').getAttribute('href').catch(() => null)
  check('WhatsApp button links to wa.me with a prefilled message', href && href.startsWith('https://wa.me/') && href.includes('text='), href)
})

await section('Startup requests and errors (real network)', async () => {
  const p = await newPage()
  await signIn(p, VIEWER)
  const reqs = []
  p.on('request', (r) => {
    if (!r.url().startsWith(API)) return
    let what = r.url().replace(API, '').split('?')[0]
    if (what === '/rest/v1/query') { try { const b = r.postDataJSON(); what += ' ' + b.table + ' ' + (b.select || '').replace(/\s+/g, '').slice(0, 30) + ' ' + JSON.stringify(b.filters) } catch {} }
    reqs.push(r.method() + ' ' + what)
  })
  await p.reload(); await sleep(3500)
  const userCalls = reqs.filter((r) => r.includes('/auth/v1/user')).length
  check(`startup makes ${reqs.length} API requests (target ≤ 18)`, reqs.length <= 18, reqs.join(' | '))
  check('no auth-server round trip at startup', userCalls === 0, String(userCalls))
  const dup = reqs.filter((r, i) => reqs.indexOf(r) !== i)
  check('no duplicate queries at startup', dup.length === 0, dup.join(', '))
  check('no failed requests', p.bad.length === 0, p.bad.join(', '))
  await p.context().close()
})

check('host page: no errors', host.errs.length === 0, host.errs.join(' | '))
check('guest page: no errors', guest.errs.length === 0, guest.errs.join(' | '))
await close()
process.exit(summary() ? 1 : 0)
