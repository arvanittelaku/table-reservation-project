// Lessons (apply -> admin approves -> book -> accept -> confirm -> video room),
// Premium packages (order -> admin marks paid -> all cities), admin user drawer
// grant/revoke, Wednesday sign-ups with Premium-first group formation, and the
// admin console (users, tables, payments CSV, activity log).
import fs from 'node:fs'
import { SITE, api, bodyText, check, close, launch, newPage, section, signIn, sleep, sql, summary, token } from './lib.mjs'

const TEACHER = 'fjolla.hoxha@gmail.com'
const STUDENT = 'hana.bytyqi@gmail.com'
const ADMIN = 'support@ejabashkohu.com'
const uid = (e) => sql(`select id from auth.users where email='${e}'`)
for (const e of [TEACHER, STUDENT]) sql(`update profiles set home_city='Prishtinë' where id='${uid(e)}'`)
sql(`delete from tutors where user_id='${uid(TEACHER)}'`)
sql(`delete from subscriptions where user_id in ('${uid(STUDENT)}','${uid(TEACHER)}')`)
sql(`delete from subscription_orders where user_id in ('${uid(STUDENT)}','${uid(TEACHER)}')`)
sql('delete from wednesday_signups')

await launch()

const openAdmin = async () => {
  const a = await newPage({ width: 1360, height: 900 })
  await signIn(a, ADMIN); await sleep(2500)
  return a
}
const adminNav = async (a, label) => { await a.locator('.adm-nav button', { hasText: label }).click(); await sleep(1200) }

await section('Lessons: teacher applies, admin approves, student books, video room', async () => {
  const t = await newPage({ geo: { latitude: 42.6629, longitude: 21.1655 } })
  await signIn(t, TEACHER)
  await t.locator('.browse-mode', { hasText: 'Mësimet' }).click(); await sleep(1200)
  await t.locator('.ls-views button', { hasText: 'Jap mësim' }).click(); await sleep(800)
  await t.locator('#tf-head').fill('Mësuese anglishteje me IELTS 8.5')
  await t.locator('#tf-bio').fill('Jap mësim anglisht prej 8 vitesh, përgatis studentë për IELTS dhe TOEFL me rezultate shumë të mira.')
  await t.locator('.chip', { hasText: /^Anglisht$/ }).first().click()
  await t.locator('#tf-price').fill('15')
  await t.locator('button', { hasText: 'Dërgo për aprovim' }).click(); await sleep(2000)
  check('teacher application stored as pending', sql(`select status from tutors where user_id='${uid(TEACHER)}'`) === 'pending')

  const a = await openAdmin()
  await adminNav(a, 'Mësuesit')
  check('admin sees the pending applicant', (await a.locator('.adm-report').first().innerText().catch(() => '')).includes('IELTS'))
  await a.locator('.adm-report button', { hasText: 'Aprovo' }).first().click(); await a.locator('.adm-modal button[type=submit]').click(); await sleep(1500)
  check('admin approval stored', sql(`select status from tutors where user_id='${uid(TEACHER)}'`) === 'approved')
  await a.context().close()

  const s = await newPage({ geo: { latitude: 42.6629, longitude: 21.1655 } })
  await signIn(s, STUDENT)
  await s.locator('.browse-mode', { hasText: 'Mësimet' }).click(); await sleep(1500)
  check('"Mësimet" opens the open group lessons first (live listings)', (await s.locator('.ls-views button.on').innerText()) === 'Në grup')
  await s.locator('.ls-views button', { hasText: 'Mësuesit' }).click(); await sleep(1200)
  await s.locator('.ls-cats .chip', { hasText: 'Gjuhë' }).click(); await sleep(400)
  await s.locator('.ls-subjects .chip', { hasText: /^Anglisht$/ }).click(); await sleep(1200)
  const cards = await s.locator('.ls-card').allInnerTexts()
  check('student finds the approved teacher under Anglisht', cards.some((c) => c.includes('IELTS')), cards.join(' || ').slice(0, 200))
  await s.locator('.ls-card', { hasText: 'IELTS' }).first().click(); await sleep(600)
  await s.locator('#ls-note').fill('Dua të përgatitem për IELTS.')
  await s.locator('.ls-book .btn.primary').click(); await sleep(2000)
  check('lesson request stored', sql(`select lp.status from lesson_participants lp join lessons l on l.id=lp.lesson_id where l.tutor_id='${uid(TEACHER)}' order by l.created_at desc limit 1`) === 'requested')

  await t.reload(); await sleep(2500)
  await t.locator('.browse-mode', { hasText: 'Mësimet' }).click(); await sleep(1000)
  await t.locator('.ls-views button', { hasText: 'Mësimet e mia' }).click(); await sleep(1200)
  await t.locator('.ls-student button', { hasText: 'Prano' }).first().click(); await sleep(1500)
  check('teacher accepted', sql(`select lp.status from lesson_participants lp join lessons l on l.id=lp.lesson_id where l.tutor_id='${uid(TEACHER)}' order by l.created_at desc limit 1`) === 'accepted')

  await s.locator('.ls-views button', { hasText: 'Mësimet e mia' }).click(); await sleep(1500)
  await s.locator('button', { hasText: 'Konfirmo (€2)' }).first().click(); await sleep(2000)
  check('student confirmed with the €2 fee (ticket EBM-)', /^EBM-/.test(sql(`select ticket_code from payments where lesson_id=(select id from lessons where tutor_id='${uid(TEACHER)}' order by created_at desc limit 1)`)))
  sql(`update lessons set starts_at = now() + interval '5 minutes' where tutor_id='${uid(TEACHER)}'`)
  await s.reload(); await sleep(2500)
  await s.locator('.browse-mode', { hasText: 'Mësimet' }).click(); await sleep(1000)
  await s.locator('.ls-views button', { hasText: 'Mësimet e mia' }).click(); await sleep(1200)
  await s.locator('button', { hasText: 'Hyr në mësim' }).first().click(); await sleep(2000)
  const src = await s.locator('.ls-room-frame').getAttribute('src').catch(() => '')
  check('video room opens (Jitsi iframe with camera/microphone)', /meet\.jit\.si|8x8\.vc/.test(src) && (await s.locator('.ls-room-frame').getAttribute('allow')).includes('camera'), src)
  check('no page errors (teacher/student)', !t.errs.length && !s.errs.length, [...t.errs, ...s.errs].join(' | '))
  await t.context().close(); await s.context().close()
})

let orderCode = ''
await section('Premium: order a package, admin marks it paid, all cities unlock', async () => {
  const s = await newPage()
  await signIn(s, STUDENT)
  await s.locator('.premium-pill').click(); await sleep(800)
  const packs = await s.locator('.pl-pack').allInnerTexts()
  check('3 Premium packages: 9.99 / 24.99 / 59.99', ['9.99', '24.99', '59.99'].every((p) => packs.join(' ').includes(p.replace('.', ',')) || packs.join(' ').includes(p)), packs.join(' | ').replace(/\s+/g, ' '))
  await s.locator('.pl-pack').nth(1).click(); await sleep(1500)
  orderCode = (await s.locator('.pl-code').innerText().catch(() => '')).trim()
  check('order created with a code (EBP-...)', /EBP-/.test(orderCode), orderCode)
  const wa = await s.locator('.pl-order a[href*="wa.me"]').getAttribute('href').catch(() => '')
  check('WhatsApp pay link includes the order code', decodeURIComponent(wa || '').includes(orderCode.replace(/.*(EBP-\w+).*/, '$1')), wa)

  const a = await openAdmin()
  await adminNav(a, 'Pakot')
  await a.locator('button', { hasText: 'Shëno si të paguar' }).first().click(); await a.locator('.adm-modal button[type=submit]').click(); await sleep(1500)
  check('admin toast: Premium activated', /Premium u aktivizua/.test(await a.locator('.adm-toast').innerText().catch(() => '')))
  check('3-month subscription stored', sql(`select plan_id from subscriptions where user_id='${uid(STUDENT)}' and status='active'`) === 'premium_3m')

  await s.reload(); await sleep(3000)
  const chips = (await s.locator('.chip.city').allInnerTexts()).map((x) => x.trim())
  check('Premium user now sees every city', chips.includes('Prizren') && chips.includes('Pejë'), chips.join(' | '))
  check('premium notification arrived', sql(`select count(*) from notifications where user_id='${uid(STUDENT)}' and kind='premiumActivated'`) !== '0')

  // admin user drawer: grant to the teacher, then revoke
  await adminNav(a, 'Përdoruesit')
  await a.locator('.adm-search input, input[type=search]').first().fill('Fjolla'); await sleep(1500)
  await a.locator('.adm-table tbody tr', { hasText: 'Fjolla' }).first().click(); await sleep(1500)
  await a.locator('.adm-premium-box button', { hasText: 'Jep Premium' }).click(); await a.locator('.adm-modal button[type=submit]').click(); await sleep(1500)
  check('admin grants Premium from the user drawer', sql(`select count(*) from subscriptions where user_id='${uid(TEACHER)}' and status='active'`) === '1')
  await a.locator('.adm-premium-box button', { hasText: 'Hiq Premium' }).click()
  await a.locator('.adm-modal input').fill('test'); await a.locator('.adm-modal button[type=submit]').click(); await sleep(1500)
  check('admin revokes it again', sql(`select count(*) from subscriptions where user_id='${uid(TEACHER)}' and status='active'`) === '0')
  await a.context().close(); await s.context().close()
})

await section('Wednesday Dinner: sign-ups, Premium first, admin forms groups', async () => {
  const people = sql("select string_agg(u.email, ',') from (select u.email from auth.users u join profiles p on p.id=u.id where not p.is_admin and p.onboarded_at is not null and u.email_confirmed_at is not null and p.deactivated_at is null and u.email not in ('hana.bytyqi@gmail.com') order by u.email limit 7) u").split(',')
  for (const e of people) sql(`update profiles set home_city='Prishtinë' where id='${uid(e)}'`)
  const s = await newPage()
  await signIn(s, STUDENT)
  for (const e of people) {
    const tk = await token(e)
    await api('/rest/v1/rpc/signup_wednesday', { p_city: 'Prishtinë', p_langs: ['sq'] }, tk)
  }
  const st = await api('/rest/v1/rpc/signup_wednesday', { p_city: 'Prishtinë', p_langs: ['sq'] }, await token(STUDENT))
  check('sign-ups stored (8 people, 1 Premium)', sql("select count(*) from wednesday_signups where status='signed_up'") === '8', JSON.stringify(st).slice(0, 120))
  const a = await openAdmin()
  await adminNav(a, 'Darka e Mërkurës')
  await a.locator('.adm-seg button, [role=tab]', { hasText: 'Regjistrimet' }).first().click(); await sleep(1000)
  const list = await a.locator('.adm-page').innerText()
  check('admin sees the sign-ups with Premium marked', /Premium/.test(list) && /Regjistruar/.test(list))
  a.on('dialog', (d) => d.accept())
  await a.locator('button', { hasText: 'Formo grupet tani' }).click(); await sleep(2500)
  check('admin forms the groups', /Grupet u formuan/.test(await a.locator('.adm-toast').innerText().catch(() => '')))
  check('Premium member got a seat', sql(`select status from wednesday_signups where user_id='${uid(STUDENT)}'`) === 'grouped')
  const grouped = Number(sql("select count(*) from wednesday_signups where status='grouped'"))
  const waitl = Number(sql("select count(*) from wednesday_signups where status='waitlisted'"))
  check(`8 people -> one group of 6, 2 on the waitlist (${grouped} seated, ${waitl} waiting)`, grouped === 6 && waitl === 2)
  await s.reload(); await sleep(2500)
  check('grouped notification sent to members', sql(`select count(*) from notifications where user_id='${uid(STUDENT)}' and kind='wednesdayGrouped'`) !== '0')
  await a.context().close(); await s.context().close()
})

await section('Admin console: overview, search, tables, payments CSV, activity', async () => {
  const a = await openAdmin()
  const overview = await a.locator('.adm-page').innerText()
  check('overview loads with KPIs', /Përdorues|Tavolina/.test(overview) && !/nuk u ngarkuan/.test(overview))
  await adminNav(a, 'Tavolinat')
  const rows = await a.locator('.adm-table tbody tr').count()
  check('tables list loads', rows > 0)
  await adminNav(a, 'Pagesat')
  const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 20000 }), a.locator('button', { hasText: 'Eksporto CSV' }).click()])
  const csv = fs.readFileSync(await dl.path(), 'utf8')
  check('payments CSV export downloads all payments', csv.trim().split('\n').length - 1 === Number(sql('select count(*) from payments')), `${csv.trim().split('\n').length - 1} rows`)
  await adminNav(a, 'Aktiviteti')
  const audit = await a.locator('.adm-table tbody').innerText()
  check('activity log shows today\'s admin actions', /Premium|mësuesin|grupet/i.test(audit), audit.slice(0, 200))
  check('admin console: no page errors', a.errs.length === 0, a.errs.join(' | '))
  await a.context().close()
})

await close()
process.exit(summary() ? 1 : 0)
