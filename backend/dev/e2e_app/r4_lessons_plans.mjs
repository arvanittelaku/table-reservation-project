// R4: lessons (near-me search, one-to-one booking, video room window, online vs in-person),
// lesson categories/subjects + group lessons, teacher profile CRUD + review, Premium packages
// (order / cancel / one pending / stacking / plan screen), Wednesday dinner (user side, Premium
// priority, restaurant reveal) and the WhatsApp support button.
import { LESSON_CATEGORIES, ALL_SUBJECTS } from '../../../hajde/src/lib/lessonSubjects.js'
import { SHOTS, api, bodyText, check, close, launch, newPage, signIn, sleep, sql, summary, token } from './lib.mjs'

const ADMIN = 'support@ejabashkohu.com'
const G = (n) => `${n}@gmail.com`
const T1 = G('noah.brown') //       teacher via the UI, Prishtinë (~1 km)
const T2 = G('petrit.kryeziu') //   teacher in Ferizaj (~33 km), in person + online
const T3 = G('rina.halili') //      teacher in Prizren (~60 km)
const S1 = G('mia.fischer') //      student
const S2 = G('njomza.tahiri') //    student
const S3 = G('shkumbin.mustafa') // student (sara.gjoka is deactivated by another suite)
const P1 = G('teuta.osmani') //     Premium buyer
const B1 = G('vesa.kastrati') //    Basic user (usage)
const W = ['stefan.jovanov', 'uran.ismaili', 'shkumbin.mustafa', 'valon.mehmeti', 'rrezarta.salihu', 'zana.thaci'].map(G)
const WUI = G('ylli.avdiu') //      Wednesday through the UI (Prishtinë)
const PRISHTINA = { latitude: 42.6629, longitude: 21.1655 }

async function section(name, fn) {
  console.log(`\n── ${name}`)
  try { await fn() } catch (err) {
    const m = err.message.split('\n'); const w = m.find((l) => /waiting for|locator\(/.test(l)) || ''
    check(`${name}: finished without crashing`, false, `${m[0]} ${w.trim()}`)
  }
}
const toLang = async (p, l) => { await p.evaluate((x) => localStorage.setItem('ejabashkohu-ui-lang', x), l); await p.reload(); await sleep(3000) }
const uid = (e) => sql(`select id from auth.users where email='${e}'`)
const U = {}
for (const e of [T1, T2, T3, S1, S2, S3, P1, B1, WUI, ...W]) U[e] = uid(e)
const ids = (list) => list.map((e) => `'${U[e]}'`).join(',')
const shot = (p, name) => p.screenshot({ path: `${SHOTS}r4-${name}.png`, fullPage: false }).catch(() => {})
const rpc = async (name, args, t) => {
  const r = await api(`/rest/v1/rpc/${name}`, args, t)
  if (r.status < 400 && 'data' in r) {
    const d = r.data
    if (d && typeof d === 'object' && !Array.isArray(d)) return { ...d, status: r.status }
    if (Array.isArray(d)) { d.status = r.status; return d }
    return d === null ? { status: r.status, value: null } : d
  }
  return r
}
const q = (table, action, extra, t) => api('/rest/v1/query', { table, action, filters: [], ...extra }, t)
const byUser = (id) => ({ filters: [{ col: 'user_id', op: 'eq', value: id }] })
const errOf = (r) => r.message || r.error || r.text || JSON.stringify(r)

// ── clean state for my users only
sql(`delete from lesson_participants where student_id in (${ids([S1, S2, S3])})`)
sql(`delete from tutors where user_id in (${ids([T1, T2, T3])})`)
sql(`delete from subscriptions where user_id in (${ids([P1, B1])})`)
sql(`delete from subscription_orders where user_id in (${ids([P1, B1])})`)
sql(`delete from wednesday_signups where user_id in (${ids([P1, WUI, ...W])})`)
sql(`update profiles set home_city='Prishtinë' where id in (${ids([T1, S1, S2, S3, P1, B1, WUI])})`)


const TKC = {}
// auth is rate limited (20 sign-ins/min per IP, shared with the other suites): cache tokens, retry on 429
const tk = async (e) => {
  const c = TKC[e]; if (c && Date.now() - c.at < 40 * 60000) return c.tk
  for (let i = 0; i < 6; i++) { const t = await token(e); if (t) { TKC[e] = { tk: t, at: Date.now() }; return t } await sleep(15000) }
  return undefined
}
async function login(p, e) {
  for (let i = 0; i < 5; i++) {
    await signIn(p, e)
    if (await p.evaluate(() => !!JSON.parse(localStorage.getItem('ejb-auth-session') || 'null')?.access_token)) return
    console.log('  (sign-in throttled, retrying)', e); await sleep(15000); await p.reload(); await sleep(1000)
  }
}

await launch()

const openLessons = async (p, view) => {
  if (!(await p.locator('.ls-views').isVisible().catch(() => false))) { await p.locator('.browse-mode', { hasText: 'Mësimet' }).click(); await sleep(1200) }
  if (view) { await p.locator('.ls-views button', { hasText: view }).click(); await sleep(1200) }
}

// ═══════════════ Teacher profile CRUD + review ═══════════════
await section('Teacher profile: apply, reject, edit -> pending, no self-approval, approve, edit', async () => {
  const t = await newPage({ geo: { latitude: 42.6700, longitude: 21.1700 } })
  await login(t, T1)
  await openLessons(t, 'Jap mësim')
  const intro = await bodyText(t)
  check('teach form shown to a non-teacher', /Dërgo për aprovim/.test(intro))
  await t.locator('#tf-head').fill('Anglisht për biznes dhe IELTS')
  await t.locator('#tf-bio').fill('Shkurt')
  await t.locator('.ls-teach .chip', { hasText: /^Anglisht$/ }).first().click()
  check('form refuses a too-short bio (submit disabled)', await t.locator('button', { hasText: 'Dërgo për aprovim' }).isDisabled())
  await t.locator('#tf-bio').fill('Jam mësues anglishteje me 6 vite përvojë, punoj me studentë dhe profesionistë për IELTS e biznes.')
  await t.locator('#tf-price').fill('20')
  await t.locator('.toggle-row', { hasText: 'Pranoj edhe mësime në grup' }).locator('input').check()
  await t.locator('.ls-teach .link-btn', { hasText: 'Përdor vendndodhjen' }).click(); await sleep(800)
  check('"use my location" takes the browser position', /Vendndodhja u vendos/.test(await bodyText(t)))
  await t.locator('button', { hasText: 'Dërgo për aprovim' }).click(); await sleep(2000)
  const row = sql(`select status||'|'||price_cents||'|'||array_to_string(subjects,',')||'|'||lat||','||lng||'|'||group_ok from tutors where user_id='${U[T1]}'`)
  check('application stored as pending with price, subject and rounded GPS location', row === 'pending|2000|english|42.67,21.17|true', row)
  check('pending banner shown', /po shqyrtohet/.test(await bodyText(t)))

  // not visible to students while pending
  const pend = await rpc('list_tutors', { p_subject: 'english' }, (await tk(S1)))
  check('pending teacher is not listed for students', Array.isArray(pend) && !pend.some((x) => x.user_id === U[T1]))
  // self-approve via the API
  await q('tutors', 'update', { values: { status: 'approved', reviewed_by: U[T1] }, ...byUser(U[T1]) }, (await tk(T1)))
  check('teacher cannot self-approve (status stays pending)', sql(`select status from tutors where user_id='${U[T1]}'`) === 'pending')
  const self = await rpc('admin_review_tutor', { p_user: U[T1], p_status: 'approved' }, (await tk(T1)))
  check('admin_review_tutor refused for non-admins', self.status >= 400, JSON.stringify(self).slice(0, 100))
  // reject needs a reason
  const noReason = await rpc('admin_review_tutor', { p_user: U[T1], p_status: 'rejected' }, await tk(ADMIN))
  check('rejection without reason refused', noReason.status >= 400 && /arsyen/.test(errOf(noReason)))
  await rpc('admin_review_tutor', { p_user: U[T1], p_status: 'rejected', p_reason: 'Shto më shumë detaje për përvojën' }, await tk(ADMIN))
  check('admin rejects with a reason', sql(`select status from tutors where user_id='${U[T1]}'`) === 'rejected')
  check('teacher notified of the rejection', sql(`select count(*) from notifications where user_id='${U[T1]}' and kind='tutorRejected'`) !== '0')
  await t.reload(); await sleep(2500)
  await openLessons(t, 'Jap mësim')
  const rej = await bodyText(t)
  check('rejected banner + reason shown on the teach form', /nuk u aprovua/.test(rej) && /më shumë detaje/.test(rej), rej.slice(0, 200))
  await t.locator('#tf-bio').fill('Jam mësues anglishteje me 6 vite përvojë (CELTA), punoj me studentë dhe profesionistë për IELTS e anglisht biznesi.')
  await t.locator('#tf-years').fill('6')
  await t.locator('button', { hasText: 'Ruaj ndryshimet' }).click(); await sleep(2000)
  check('editing a rejected profile sends it back to pending (reason cleared)', sql(`select status||'|'||coalesce(rejection_reason,'') from tutors where user_id='${U[T1]}'`) === 'pending|')
  await rpc('admin_review_tutor', { p_user: U[T1], p_status: 'approved' }, await tk(ADMIN))
  check('admin approves', sql(`select status from tutors where user_id='${U[T1]}'`) === 'approved')
  check('approval notification', sql(`select count(*) from notifications where user_id='${U[T1]}' and kind='tutorApproved'`) !== '0')

  // edit while approved: price, subjects (second category), bio -> stays approved
  await t.reload(); await sleep(2500)
  await openLessons(t, 'Jap mësim')
  check('approved banner', /është aktiv/.test(await bodyText(t)))
  await t.locator('#tf-price').fill('18')
  await t.locator('.ls-teach .ls-cats .chip', { hasText: 'Shkollë' }).click(); await sleep(200)
  await t.locator('.ls-teach .chip', { hasText: /^Matematikë$/ }).click()
  await t.locator('#tf-head').fill('Anglisht (IELTS) dhe matematikë')
  await t.locator('button', { hasText: 'Ruaj ndryshimet' }).click(); await sleep(2000)
  const ed = sql(`select status||'|'||price_cents||'|'||array_to_string(subjects,',')||'|'||headline from tutors where user_id='${U[T1]}'`)
  check('edit of an approved profile is saved and stays approved', ed === 'approved|1800|english,math|Anglisht (IELTS) dhe matematikë', ed)
  const bad = await q('tutors', 'update', { values: { subjects: ['klingon'] }, ...byUser(U[T1]) }, (await tk(T1)))
  check('unknown subject refused by the backend', bad.status >= 400, JSON.stringify(bad).slice(0, 100))
  const other = await q('tutors', 'update', { values: { price_cents: 1 }, ...byUser(U[T1]) }, (await tk(S1)))
  check('another user cannot edit the teacher profile', sql(`select price_cents from tutors where user_id='${U[T1]}'`) === '1800', JSON.stringify(other).slice(0, 80))
  await shot(t, 'teach-form')
  check('no page errors (teacher)', !t.errs.length, t.errs.join(' | '))
  await t.context().close()

  // two more teachers via the API at other distances
  const mk = async (e, city, lat, lng, extra) => {
    const r = await q('tutors', 'insert', { values: {
      user_id: U[e], headline: `Mësues anglishteje në ${city}`, bio: `Jap mësim anglisht në ${city} prej shumë vitesh, me grupe dhe individualisht.`,
      subjects: ['english'], teach_langs: ['sq', 'en'], price_cents: 1200, online: true, in_person: true, group_ok: false, city, lat, lng, years_experience: 3, ...extra,
    } }, (await tk(e)))
    if (r.status >= 400) console.log('tutor insert', e, errOf(r))
    await rpc('admin_review_tutor', { p_user: U[e], p_status: 'approved' }, await tk(ADMIN))
    return r
  }
  await mk(T2, 'Ferizaj', 42.37, 21.15)
  await mk(T3, 'Prizren', 42.21, 20.74, { online: false })
  check('API-created teachers approved', sql(`select count(*) from tutors where user_id in (${ids([T2, T3])}) and status='approved'`) === '2')
})

// ═══════════════ A5: near me, booking, video room ═══════════════
let lessonId = ''
await section('A5: student finds English teachers near Prishtinë, books, room only in time window', async () => {
  const s = await newPage({ geo: PRISHTINA })
  await login(s, S1)
  await openLessons(s, 'Mësuesit')
  await s.locator('.ls-cats .chip', { hasText: 'Gjuhë' }).click(); await sleep(400)
  await s.locator('.ls-subjects .chip', { hasText: /^Anglisht$/ }).click(); await sleep(1200)
  await s.locator('.ls-filters .chip', { hasText: 'Afër meje' }).click(); await sleep(2000)
  check('near-me uses the GPS position', /Afër: vendndodhja jote|Afër: /i.test(await s.locator('.ls-filters').innerText()))
  const mine = async () => (await s.locator('.ls-card').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '))
    .filter((x) => /Noah|Petrit|Rina/.test(x))
  let cards = await mine()
  const order = cards.map((c) => (c.match(/Noah|Petrit|Rina/) || [])[0])
  check('my three teachers listed nearest first (Noah, Petrit, Rina)', order.join(',') === 'Noah,Petrit,Rina', order.join(','))
  const kms = cards.map((c) => Number((c.match(/([\d.]+) km larg/) || [])[1]))
  check('distance shown on every card and increasing', kms.length === 3 && kms.every((k) => k >= 0) && kms[0] < 3 && kms[1] > 25 && kms[1] < 40 && kms[2] > 45 && kms[2] < 75, kms.join(','))
  const all = (await s.locator('.ls-card').allInnerTexts()).map((x) => Number((x.match(/([\d.]+) km larg/) || [])[1])).filter((x) => !Number.isNaN(x))
  check('whole list sorted by distance', all.every((k, i) => i === 0 || k >= all[i - 1]), all.join(','))
  await s.locator('.ls-filters select').first().selectOption('10'); await sleep(1500)
  cards = await mine()
  check('radius 10 km: only the Prishtinë teacher', cards.length === 1 && /Noah/.test(cards[0]), cards.join(' | ').slice(0, 200))
  await s.locator('.ls-filters select').first().selectOption('50'); await sleep(1500)
  cards = await mine()
  check('radius 50 km: Noah + Petrit, not Prizren', cards.length === 2 && !cards.some((c) => /Rina/.test(c)))
  await s.locator('.ls-filters select').first().selectOption(''); await sleep(1200)
  // format filter
  await s.locator('.ls-seg button', { hasText: 'Në person' }).click(); await sleep(1500)
  cards = await mine()
  check('in-person filter: Petrit + Rina (Noah is online-only)', cards.length === 2 && !cards.some((c) => /Noah/.test(c)), cards.join(' | ').slice(0, 200))
  await s.locator('.ls-seg button', { hasText: 'Online' }).click(); await sleep(1500)
  cards = await mine()
  check('online filter: Noah + Petrit (Rina is in-person only)', cards.length === 2 && !cards.some((c) => /Rina/.test(c)))
  await s.locator('.ls-seg button', { hasText: 'Të gjitha' }).click(); await sleep(1200)
  await shot(s, 'near-me')
  const nearApi = await rpc('list_tutors', { p_subject: 'english', p_lat: PRISHTINA.latitude, p_lng: PRISHTINA.longitude, p_radius_km: 5 }, (await tk(S1)))
  check('API radius filter agrees', Array.isArray(nearApi) && nearApi.some((x) => x.user_id === U[T1]) && !nearApi.some((x) => x.user_id === U[T2]))

  // book one-to-one, online
  await s.locator('.ls-card', { hasText: 'Noah' }).first().click(); await sleep(700)
  check('teacher sheet shows distance', /km larg/.test(await s.locator('.ls-sheet').innerText()))
  await s.locator('#ls-note').fill('Dua të përgatitem për IELTS speaking.')
  await s.locator('.ls-book .btn.primary').click(); await sleep(2000)
  lessonId = sql(`select l.id from lessons l join lesson_participants lp on lp.lesson_id=l.id where l.tutor_id='${U[T1]}' and lp.student_id='${U[S1]}' and l.kind='individual' order by l.created_at desc limit 1`)
  check('request stored (individual, online, requested, price 18€)', sql(`select l.format||'|'||lp.status||'|'||l.price_cents from lessons l join lesson_participants lp on lp.lesson_id=l.id where l.id='${lessonId}'`) === 'online|requested|1800')
  check('teacher notified of the request', sql(`select count(*) from notifications where user_id='${U[T1]}' and kind='lessonRequested'`) !== '0')
  const early = await rpc('book_lesson', { p_tutor: U[T1], p_subject: 'english', p_starts_at: new Date(Date.now() + 5 * 60000).toISOString(), p_duration: 60, p_format: 'online' }, (await tk(S1)))
  check('booking less than 30 min ahead refused', early.status >= 400)
  const wrongFmt = await rpc('book_lesson', { p_tutor: U[T1], p_subject: 'english', p_starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), p_duration: 60, p_format: 'in_person' }, (await tk(S1)))
  check('in-person booking with an online-only teacher refused', wrongFmt.status >= 400 && /mënyrë/.test(errOf(wrongFmt)))
  const self = await rpc('book_lesson', { p_tutor: U[T1], p_subject: 'english', p_starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), p_duration: 60, p_format: 'online' }, (await tk(T1)))
  check('teacher cannot book themselves', self.status >= 400)

  const t = await newPage()
  await login(t, T1)
  await openLessons(t, 'Mësimet e mia')
  const tl = await t.locator('.ls-section').innerText()
  check('teacher sees the request with the student note', /IELTS speaking/.test(tl))
  await t.locator('.ls-student', { hasText: 'Mia' }).locator('button', { hasText: 'Prano' }).click(); await sleep(1500)
  check('teacher accepted', sql(`select status from lesson_participants where lesson_id='${lessonId}'`) === 'accepted')
  const notConfirmedRoom = await rpc('get_lesson_room', { p_lesson: lessonId }, (await tk(S1)))
  check('room refused before the student confirms', notConfirmedRoom.status >= 400)

  await openLessons(s, 'Mësimet e mia')
  await s.locator('.ls-item', { hasText: 'Noah' }).first().locator('button', { hasText: 'Konfirmo (€2)' }).click(); await sleep(2000)
  check('student confirmed, €2 booking fee with EBM- ticket', /^EBM-\d{4}$/.test(sql(`select ticket_code from payments where lesson_id='${lessonId}' and user_id='${U[S1]}'`)))
  await s.reload(); await sleep(2500); await openLessons(s, 'Mësimet e mia')
  const btn = s.locator('.ls-item', { hasText: 'Noah' }).first().locator('button', { hasText: /Dhoma hapet|Hyr në mësim/ })
  check('tomorrow: room button disabled ("Dhoma hapet ...")', (await btn.isDisabled()) && /Dhoma hapet/.test(await btn.innerText()), await btn.innerText().catch(() => ''))
  const tooEarly = await rpc('get_lesson_room', { p_lesson: lessonId }, (await tk(S1)))
  check('API: room closed until 15 min before', tooEarly.status >= 400 && /15 minuta/.test(errOf(tooEarly)))

  sql(`update lessons set starts_at = now() + interval '5 minutes' where id='${lessonId}'`)
  const roomFor = async (p) => {
    await p.reload(); await sleep(2500); await openLessons(p, 'Mësimet e mia')
    await p.locator('.ls-item', { hasText: /Anglisht/ }).filter({ has: p.locator('button', { hasText: 'Hyr në mësim' }) }).first().locator('button', { hasText: 'Hyr në mësim' }).click(); await sleep(2000)
    const f = p.locator('.ls-room-frame')
    return { src: await f.getAttribute('src').catch(() => ''), allow: await f.getAttribute('allow').catch(() => '') }
  }
  const rs = await roomFor(s), rt = await roomFor(t)
  const roomName = (x) => (x.src.match(/\/(ejaBashkohu-[\w-]+)/) || [])[1]
  check('student enters the Jitsi room (camera + microphone allowed)', /meet\.jit\.si|8x8\.vc/.test(rs.src) && /camera/.test(rs.allow) && /microphone/.test(rs.allow), rs.src)
  check('teacher enters the same room', roomName(rs) && roomName(rs) === roomName(rt), `${roomName(rs)} vs ${roomName(rt)}`)
  await shot(s, 'room')
  const stranger = await rpc('get_lesson_room', { p_lesson: lessonId }, (await tk(S2)))
  check('another user cannot get the room', stranger.status >= 400 && /qasje/.test(errOf(stranger)))
  sql(`update lessons set starts_at = now() - interval '2 hours' where id='${lessonId}'`)
  const late = await rpc('get_lesson_room', { p_lesson: lessonId }, (await tk(S1)))
  check('room closed 30 min after the end', late.status >= 400 && /përfunduar/.test(errOf(late)))

  // in-person one-to-one with Petrit: no video room, location instead
  const ip = await rpc('book_lesson', { p_tutor: U[T2], p_subject: 'english', p_starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), p_duration: 90, p_format: 'in_person', p_note: 'Në person' }, (await tk(S1)))
  const ipId = typeof ip === 'string' ? ip : (ip.text || '').replace(/"/g, '')
  await rpc('respond_lesson_request', { p_lesson: ipId, p_student: U[S1], p_accept: true }, (await tk(T2)))
  await rpc('confirm_lesson_seat', { p_lesson: ipId }, (await tk(S1)))
  check('in-person lesson stored (90 min, price 18€ = 12€/h * 1.5)', sql(`select format||'|'||price_cents from lessons where id='${ipId}'`) === 'in_person|1800', ipId)
  sql(`update lessons set starts_at = now() + interval '5 minutes' where id='${ipId}'`)
  const ipRoom = await rpc('get_lesson_room', { p_lesson: ipId }, (await tk(S1)))
  check('in-person lesson has no video room', ipRoom.status >= 400)
  await s.reload(); await sleep(2500); await openLessons(s, 'Mësimet e mia')
  const ipItem = await s.locator('.ls-item', { hasText: 'Petrit' }).first().innerText()
  check('in-person lesson shows "Në person", no room button', /Në person/.test(ipItem) && !/Hyr në mësim/.test(ipItem), ipItem.replace(/\s+/g, ' '))
  // a declined request
  const d = await rpc('book_lesson', { p_tutor: U[T3], p_subject: 'english', p_starts_at: new Date(Date.now() + 4 * 864e5).toISOString(), p_duration: 60, p_format: 'in_person' }, (await tk(S1)))
  const dId = typeof d === 'string' ? d : (d.text || '').replace(/"/g, '')
  await rpc('respond_lesson_request', { p_lesson: dId, p_student: U[S1], p_accept: false }, (await tk(T3)))
  check('teacher declines: participant declined, lesson cancelled, student notified', sql(`select lp.status||'|'||l.status from lessons l join lesson_participants lp on lp.lesson_id=l.id where l.id='${dId}'`) === 'declined|cancelled' && sql(`select count(*) from notifications where user_id='${U[S1]}' and kind='lessonDeclined'`) !== '0')
  check('no page errors (student/teacher)', !s.errs.length && !t.errs.length, [...s.errs, ...t.errs].join(' | '))
  check('no unexpected failed API calls in the browser', !s.bad.length && !t.bad.length, [...s.bad, ...t.bad].join(', '))
  await s.context().close(); await t.context().close()
})

// ═══════════════ A6: categories + subjects, group lessons ═══════════════
await section('A6: every category and all 81 subjects listed and filterable', async () => {
  const db = sql("select category||':'||string_agg(id, ',' order by sort) from lesson_subjects group by category order by category").split('\n')
  const dbMap = Object.fromEntries(db.map((l) => [l.split(':')[0], l.split(':')[1].split(',')]))
  check('lesson_subjects table has 81 subjects in 10 categories', Object.values(dbMap).flat().length === 81 && Object.keys(dbMap).length === 10)
  check('app subject list = database subject list', ALL_SUBJECTS.length === 81 && ALL_SUBJECTS.every((s) => Object.values(dbMap).flat().includes(s)))
  const s = await newPage({ width: 1280, height: 800 })
  await login(s, S1)
  for (const view of ['Mësuesit', 'Në grup']) {
    await openLessons(s, view)
    const catChips = s.locator('.ls-cats .chip')
    check(`${view}: 10 categories + "Të gjitha"`, (await catChips.count()) === 11)
    let total = 0, mismatch = []
    for (let i = 0; i < LESSON_CATEGORIES.length; i++) {
      await catChips.nth(i + 1).click(); await sleep(250)
      const subs = (await s.locator('.ls-subjects .chip').allInnerTexts()).slice(1)
      total += subs.length
      const cat = LESSON_CATEGORIES[i]
      if (subs.length !== (dbMap[cat.id] || []).length || subs.some((x) => /lessons\.|subjects\./.test(x))) mismatch.push(`${cat.id}:${subs.length}/${(dbMap[cat.id] || []).length}`)
    }
    check(`${view}: every category shows exactly its DB subjects (81 total, all translated)`, total === 81 && !mismatch.length, `${total} ${mismatch.join(' ')}`)
  }
  // filtering
  await openLessons(s, 'Mësuesit')
  await s.locator('.ls-cats .chip', { hasText: 'Shkollë' }).click(); await sleep(300)
  await s.locator('.ls-subjects .chip', { hasText: /^Matematikë$/ }).click(); await sleep(1500)
  let names = await s.locator('.ls-card').allInnerTexts()
  check('Matematikë: Noah shown, Petrit/Rina (English only) not', names.some((x) => /Noah/.test(x)) && !names.some((x) => /Petrit|Rina/.test(x)))
  await s.locator('.ls-cats .chip', { hasText: 'Gjuhë' }).click(); await sleep(300)
  await s.locator('.ls-subjects .chip', { hasText: /^Gjermanisht$/ }).click(); await sleep(1500)
  names = await s.locator('.ls-card').allInnerTexts()
  check('Gjermanisht: none of the English teachers', !names.some((x) => /Noah|Petrit|Rina/.test(x)))
  await s.locator('.ls-cats .chip', { hasText: 'Muzikë' }).click(); await sleep(1500)
  names = await s.locator('.ls-card').allInnerTexts()
  check('category filter (Muzikë) hides language teachers', !names.some((x) => /Noah|Petrit|Rina/.test(x)))
  await shot(s, 'categories-desktop')
  check('no page errors (categories)', !s.errs.length, s.errs.join(' | '))
  await s.context().close()
})

await section('A6: group lesson: create, join, seat limit, student cancels, teacher cancels', async () => {
  const title = `Speaking klub ${Date.now() % 100000}`
  const t = await newPage()
  await login(t, T1)
  await openLessons(t, 'Mësimet e mia')
  await t.locator('button', { hasText: 'Hap mësim në grup' }).click(); await sleep(700)
  await t.locator('#gf-title').fill(title)
  await t.locator('.ls-sheet input[type=range]').fill('2')
  await t.locator('#gf-price').fill('5')
  await t.locator('button', { hasText: 'Publiko mësimin' }).click(); await sleep(2000)
  const gid = sql(`select id from lessons where tutor_id='${U[T1]}' and title='${title}'`)
  check('group lesson stored (group, 2 seats, 5€)', sql(`select kind||'|'||max_students||'|'||price_cents||'|'||status from lessons where id='${gid}'`) === 'group|2|500|scheduled')
  const noLoc = await rpc('create_group_lesson', { p_subject: 'english', p_title: 'x in person', p_starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), p_duration: 60, p_format: 'in_person', p_max_students: 4, p_price_cents: 0 }, (await tk(T2)))
  check('teacher without group lessons enabled cannot open a group', noLoc.status >= 400)
  const notTeacher = await rpc('create_group_lesson', { p_subject: 'english', p_title: 'fake', p_starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), p_duration: 60, p_format: 'online', p_max_students: 4, p_price_cents: 0 }, (await tk(S1)))
  check('a non-teacher cannot open a group lesson', notTeacher.status >= 400)

  const s = await newPage()
  await login(s, S1)
  await openLessons(s, 'Në grup')
  const card = s.locator('.ls-card', { hasText: title })
  check('students see the new group lesson with 0/2 seats', /0\s*\/\s*2/.test(await card.innerText().catch(() => '')), await card.innerText().catch(() => 'missing'))
  await card.locator('button', { hasText: 'Bashkohu' }).click(); await sleep(2000)
  check('student 1 joined (accepted)', sql(`select status from lesson_participants where lesson_id='${gid}' and student_id='${U[S1]}'`) === 'accepted')
  await rpc('join_group_lesson', { p_lesson: gid }, (await tk(S2)))
  const s3 = await newPage()
  await login(s3, S3)
  await openLessons(s3, 'Në grup')
  const c3 = s3.locator('.ls-card', { hasText: title })
  check('when full the join button says "Plot" and is disabled', (await c3.locator('button').isDisabled()) && /Plot/.test(await c3.innerText()))
  const full = await rpc('join_group_lesson', { p_lesson: gid }, (await tk(S3)))
  check('API: third student refused (Grupi është plot)', full.status >= 400 && /plot/.test(errOf(full)))
  const own = await rpc('join_group_lesson', { p_lesson: gid }, (await tk(T1)))
  check('teacher cannot join their own group', own.status >= 400)
  await rpc('cancel_lesson', { p_lesson: gid }, (await tk(S2)))
  check('student 2 cancels: seat freed, lesson still scheduled, teacher notified',
    sql(`select status from lesson_participants where lesson_id='${gid}' and student_id='${U[S2]}'`) === 'cancelled'
    && sql(`select status from lessons where id='${gid}'`) === 'scheduled'
    && sql(`select count(*) from notifications where user_id='${U[T1]}' and kind='lessonCancelled'`) !== '0')
  await sleep(1500)
  check('seat count updates live for the waiting student (1/2, join enabled)', /1\s*\/\s*2/.test(await c3.innerText().catch(() => '')) && !(await c3.locator('button').isDisabled().catch(() => true)))
  await c3.locator('button', { hasText: 'Bashkohu' }).click(); await sleep(2000)
  check('student 3 takes the freed seat', sql(`select status from lesson_participants where lesson_id='${gid}' and student_id='${U[S3]}'`) === 'accepted')
  await rpc('confirm_lesson_seat', { p_lesson: gid }, (await tk(S1)))
  check('student 1 confirms the seat (payment EBM-)', /^EBM-/.test(sql(`select ticket_code from payments where lesson_id='${gid}' and user_id='${U[S1]}'`)))

  // teacher cancels the whole lesson
  await t.reload(); await sleep(2500); await openLessons(t, 'Mësimet e mia')
  const item = t.locator('.ls-item', { hasText: title })
  check('teacher sees 2/2 students on the group lesson', /2\s*\/\s*2/.test(await item.innerText()))
  await item.locator('button', { hasText: 'Anulo mësimin' }).click(); await sleep(2000)
  check('lesson cancelled, all seats cancelled',
    sql(`select status from lessons where id='${gid}'`) === 'cancelled' && sql(`select count(*) from lesson_participants where lesson_id='${gid}' and status<>'cancelled'`) === '0')
  check('both students notified of the cancellation', sql(`select count(distinct user_id) from notifications where user_id in (${ids([S1, S3])}) and kind='lessonCancelled' and created_at > now() - interval '2 minutes'`) === '2')
  const pay = sql(`select count(*) from payments where lesson_id='${gid}'`)
  check('payment of the confirmed student is kept on record (stub, no automatic refund in the app)', pay === '1', pay)
  await openLessons(s, 'Në grup')
  check('cancelled group lesson disappears from the open list', !(await s.locator('.ls-card', { hasText: title }).count()))
  await openLessons(s, 'Mësimet e mia')
  check('student sees it as cancelled under "Mësimet e mia"', /Anuluar|anulu/i.test(await s.locator('.ls-item', { hasText: title }).innerText().catch(() => '')))
  check('no page errors (group)', !t.errs.length && !s.errs.length && !s3.errs.length, [...t.errs, ...s.errs, ...s3.errs].join(' | '))
  await t.context().close(); await s.context().close(); await s3.context().close()
})

await section('Teacher profile delete', async () => {
  const r = await q('tutors', 'delete', byUser(U[T3]), (await tk(S1)))
  check('another user cannot delete a teacher profile', sql(`select count(*) from tutors where user_id='${U[T3]}'`) === '1', JSON.stringify(r).slice(0, 80))
  await q('tutors', 'delete', byUser(U[T3]), (await tk(T3)))
  check('teacher can delete their own profile (API; no button in the UI)', sql(`select count(*) from tutors where user_id='${U[T3]}'`) === '0')
  const l = await rpc('list_tutors', { p_subject: 'english' }, (await tk(S1)))
  check('deleted teacher no longer listed', Array.isArray(l) && !l.some((x) => x.user_id === U[T3]))
})

// ═══════════════ A1: Premium packages ═══════════════
await section('A1: Premium packages, order, cancel, one pending, paid, stacking', async () => {
  const p = await newPage()
  await login(p, P1)
  await p.locator('.premium-pill').click(); await sleep(900)
  const packs = (await p.locator('.pl-pack').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '))
  check('exactly 3 packages', packs.length === 3, packs.join(' | '))
  check('1 month €9.99, 3 months €24.99, 12 months €59.99', /€9\.99/.test(packs[0]) && /€24\.99/.test(packs[1]) && /€59\.99/.test(packs[2]), packs.join(' | '))
  const sheet = await p.locator('.pl-sheet').innerText()
  check('Plans screen shows Basic as the current plan with usage', /Bazike[\s\S]*Pakoja jote/.test(sheet) && /\d+\/\d+ tavolina këtë muaj/.test(sheet), sheet.replace(/\s+/g, ' ').slice(0, 300))
  await shot(p, 'plans-basic')
  await p.locator('.pl-pack').nth(0).click(); await sleep(1500)
  const code1 = (await p.locator('.pl-code strong').innerText().catch(() => '')).trim()
  check('order created with an EBP- code', /^EBP-/.test(code1), code1)
  check('order stored pending 9.99', sql(`select plan_id||'|'||amount_cents||'|'||status from subscription_orders where code='${code1}'`) === `premium_1m|999|pending`)
  const wa = decodeURIComponent(await p.locator('.pl-order a[href*="wa.me"]').getAttribute('href').catch(() => '') || '')
  check('WhatsApp pay link: wa.me/<support number> with code, plan price and account email', /^https:\/\/wa\.me\/38344123456\?text=/.test(wa) && wa.includes(code1) && wa.includes('€9.99') && wa.includes(P1), wa)
  check('packages hidden while an order is pending', (await p.locator('.pl-pack').count()) === 0)
  await shot(p, 'plans-order')
  await p.locator('.pl-order button', { hasText: /Anulo/ }).click(); await sleep(1500)
  check('cancel order: stored as cancelled, packages back', sql(`select status from subscription_orders where code='${code1}'`) === 'cancelled' && (await p.locator('.pl-pack').count()) === 3)
  // one pending order at a time
  await rpc('request_premium', { p_plan: 'premium_12m' }, (await tk(P1)))
  const o2 = await rpc('request_premium', { p_plan: 'premium_3m' }, (await tk(P1)))
  check('a new order replaces the previous pending one (only one pending)', sql(`select count(*) from subscription_orders where user_id='${U[P1]}' and status='pending'`) === '1' && sql(`select plan_id from subscription_orders where user_id='${U[P1]}' and status='pending'`) === 'premium_3m')
  const bogus = await rpc('request_premium', { p_plan: 'basic' }, (await tk(P1)))
  check('unknown/basic package refused', bogus.status >= 400)
  const notAdmin = await rpc('admin_mark_order_paid', { p_order: o2.id }, (await tk(P1)))
  check('user cannot mark their own order paid', notAdmin.status >= 400 && sql(`select status from subscription_orders where id='${o2.id}'`) === 'pending')
  await p.reload(); await sleep(2500)
  await p.locator('.premium-pill').click(); await sleep(900)
  check('reopened Plans shows the pending 3-month order with its code', (await p.locator('.pl-code').innerText().catch(() => '')).includes(o2.code))
  await rpc('admin_mark_order_paid', { p_order: o2.id }, await tk(ADMIN))
  const end1 = sql(`select to_char(max(ends_at) at time zone 'UTC','YYYY-MM-DD') from subscriptions where user_id='${U[P1]}' and status='active'`)
  const exp1 = sql(`select to_char((now() + interval '3 months') at time zone 'UTC','YYYY-MM-DD')`)
  check('admin marks paid: Premium 3 months, end date = now + 3 months', end1 === exp1, `${end1} vs ${exp1}`)
  check('order paid + payment recorded 24.99', sql(`select status from subscription_orders where id='${o2.id}'`) === 'paid' && sql(`select amount_cents from payments where provider_ref='${o2.code}'`) === '2499')
  const again = await rpc('admin_mark_order_paid', { p_order: o2.id }, await tk(ADMIN))
  check('order cannot be marked paid twice', again.status >= 400)
  // stacking
  const o3 = await rpc('request_premium', { p_plan: 'premium_1m' }, (await tk(P1)))
  await rpc('admin_mark_order_paid', { p_order: o3.id }, await tk(ADMIN))
  const end2 = sql(`select to_char(max(ends_at) at time zone 'UTC','YYYY-MM-DD') from subscriptions where user_id='${U[P1]}' and status='active'`)
  const exp2 = sql(`select to_char((now() + interval '3 months' + interval '1 month') at time zone 'UTC','YYYY-MM-DD')`)
  check('second purchase stacks: ends 3 + 1 months from now', end2 === exp2 && sql(`select count(*) from subscriptions where user_id='${U[P1]}' and status='active'`) === '2', `${end2} vs ${exp2}`)
  const plan = await rpc('my_plan', {}, (await tk(P1)))
  check('my_plan: tier premium, premium_until = stacked end, no pending order', plan.tier === 'premium' && String(plan.premium_until).startsWith(end2) && !plan.pending_order)
  await p.reload(); await sleep(2500)
  await p.locator('.premium-pill').click(); await sleep(900)
  const s2 = await p.locator('.pl-sheet').innerText()
  const [y, m, d] = end2.split('-')
  check('Plans screen: Premium current, "active until" with the stacked end date, packages say "extend"', /Premium aktiv deri më/.test(s2) && (s2.includes(`${Number(d)}`) && (s2.includes(y))) && /Premium[\s\S]*Pakoja jote/.test(s2) && !/tavolina këtë muaj/.test(s2), s2.replace(/\s+/g, ' ').slice(0, 300))
  await shot(p, 'plans-premium')
  check('no page errors (plans)', !p.errs.length, p.errs.join(' | '))
  await p.context().close()
})

// ═══════════════ A10: Wednesday dinner ═══════════════
await section('A10: Wednesday sign-up through the UI, status, cancel', async () => {
  sql(`insert into taste_profiles (user_id, interests, done, updated_at) values ('${U[WUI]}', '{}', true, now()) on conflict (user_id) do update set done=true`)
  const p = await newPage()
  await login(p, WUI)
  await sleep(1500)
  const banner = p.locator('.wed-banner')
  check('Wednesday banner shown on the feed (Prishtinë)', await banner.isVisible().catch(() => false))
  await banner.click(); await sleep(800)
  for (let i = 0; i < 12; i++) {
    if (await p.locator('.lang-grid').isVisible().catch(() => false)) {
      await p.locator('.lang-chip').first().click(); await p.locator('.sheet .btn.primary.full').first().click(); await sleep(500); continue
    }
    const c = p.locator('.sheet .ob-choice .choice').first()
    if (!(await c.isVisible().catch(() => false))) break
    await c.click(); await sleep(400)
  }
  await sleep(2500)
  const txt = await p.locator('.sheet').innerText().catch(() => '')
  check('after the quiz: "Je regjistruar!" with city and Basic note', /Je regjistruar/.test(txt) && /Prishtinë/.test(txt) && /Premium kanë përparësi/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 200))
  check('sign-up stored for next Wednesday 20:00', sql(`select status||'|'||city||'|'||extract(isodow from dinner_date at time zone 'Europe/Belgrade')||'|'||to_char(dinner_date at time zone 'Europe/Belgrade','HH24:MI') from wednesday_signups where user_id='${U[WUI]}'`) === 'signed_up|Prishtinë|3|20:00')
  await shot(p, 'wed-signed')
  await p.locator('.sheet button', { hasText: 'Anulo regjistrimin' }).click(); await sleep(1500)
  check('cancel: stored as cancelled', sql(`select status from wednesday_signups where user_id='${U[WUI]}'`) === 'cancelled')
  const st = await rpc('my_wednesday', {}, (await tk(WUI)))
  check('my_wednesday shows no active sign-up after cancel', st.signup === null)
  const basicOther = await rpc('signup_wednesday', { p_city: 'Prizren', p_langs: ['sq'] }, (await tk(WUI)))
  check('Basic user cannot sign up in another city', basicOther.status >= 400 && /qytetin tënd/.test(errOf(basicOther)))
  const noRest = await rpc('signup_wednesday', { p_city: 'Atlantis', p_langs: [] }, (await tk(P1)))
  check('city without restaurants refused', noRest.status >= 400)
  check('no page errors (wednesday UI)', !p.errs.length, p.errs.join(' | '))
  await p.context().close()
})

await section('A10: Premium priority when groups form, restaurant reveal only to participants', async () => {
  const CITY = 'Gjakovë'
  sql(`update profiles set home_city='${CITY}' where id in (${ids(W)})`)
  sql(`insert into taste_profiles (user_id, interests, done, updated_at) values ('${U[P1]}', '{}', true, now()) on conflict (user_id) do update set done=true`)
  // six Basic users sign up first, the Premium member (P1, home Prishtinë) last
  for (const e of W) { const r = await rpc('signup_wednesday', { p_city: CITY, p_langs: ['sq'] }, (await tk(e))); if (r.status >= 400) console.log('signup', e, errOf(r)); await sleep(30) }
  const pr = await rpc('signup_wednesday', { p_city: CITY, p_langs: ['sq', 'en'] }, (await tk(P1)))
  check('Premium member may sign up outside their home city', pr.status < 400 && pr.signup?.city === CITY && pr.premium === true, errOf(pr))
  const dinner = sql(`select to_json(dinner_date)#>>'{}' from wednesday_signups where user_id='${U[P1]}' and status='signed_up'`)
  check('7 sign-ups in Gjakovë', sql(`select count(*) from wednesday_signups where city='${CITY}' and dinner_date='${dinner}' and status='signed_up'`) === '7')
  const lastBasic = W[W.length - 1]
  const notAdmin = await rpc('admin_form_wednesday', {}, (await tk(P1)))
  check('non-admin cannot form groups', notAdmin.status >= 400)
  const res = await rpc('admin_form_wednesday', { p_dinner: new Date(dinner).toISOString() }, await tk(ADMIN))
  check('admin_form_wednesday ran', res.status < 400 && res.groups >= 1, JSON.stringify(res).slice(0, 200))
  const st = (e) => sql(`select status from wednesday_signups where user_id='${U[e]}' and dinner_date='${dinner}'`)
  check('Premium member (signed up last) got a seat', st(P1) === 'grouped')
  check('last Basic sign-up is the one waitlisted (7 people -> 6 seated + 1 waiting)', st(lastBasic) === 'waitlisted' && W.slice(0, -1).every((e) => st(e) === 'grouped'), W.map(st).join(','))
  check('premium flag stored on the sign-up', sql(`select premium from wednesday_signups where user_id='${U[P1]}' and dinner_date='${dinner}'`) === 't')
  check('grouped + waitlisted notifications', sql(`select count(*) from notifications where user_id='${U[P1]}' and kind='wednesdayGrouped'`) !== '0' && sql(`select count(*) from notifications where user_id='${U[lastBasic]}' and kind='wednesdayWaitlisted'`) !== '0')
  const gid = sql(`select group_id from wednesday_signups where user_id='${U[P1]}' and dinner_date='${dinner}'`)
  const mw = await rpc('my_wednesday', {}, (await tk(P1)))
  check('member sees status grouped with 6 members (first names only)', mw.signup?.status === 'grouped' && mw.signup.members.length === 6 && !('last_name' in mw.signup.members[0]))
  const wl = await rpc('my_wednesday', {}, (await tk(lastBasic)))
  check('waitlisted user sees status waitlisted', wl.signup?.status === 'waitlisted')

  // restaurant: hidden > 24h before, shown afterwards, never to outsiders
  sql(`update wednesday_groups set dinner_date = now() + interval '3 days' where id='${gid}'`)
  const hidden = await rpc('get_wednesday_restaurant', { p_group: gid }, (await tk(P1)))
  check('more than 24h before: restaurant hidden', hidden.revealed === false && hidden.name === null)
  const outsider = await rpc('get_wednesday_restaurant', { p_group: gid }, (await tk(lastBasic)))
  check('non-participant cannot see the restaurant', outsider.status >= 400)
  const p = await newPage()
  await login(p, P1)
  await p.evaluate(() => {})
  await sleep(1000)
  const tableId = sql(`select table_id from wednesday_groups where id='${gid}'`)
  // a Premium member grouped in another city opens the dinner table from that city's feed
  const openTable = async () => {
    await p.reload(); await sleep(3000)
    await p.locator('.chip.city', { hasText: CITY }).first().click(); await sleep(2500)
    await p.getByText('Darka e së Mërkurës').first().click(); await sleep(3000)
  }
  await openTable()
  const locked = await bodyText(p)
  check('UI: table shows the restaurant as locked', /Restoranti zbulohet 24 orë/.test(locked) && !locked.includes(sql(`select r.name from wednesday_restaurants r join wednesday_groups g on g.restaurant_id=r.id where g.id='${gid}'`)), locked.slice(0, 200))
  sql(`update wednesday_groups set dinner_date = now() + interval '20 hours' where id='${gid}'`)
  const shown = await rpc('get_wednesday_restaurant', { p_group: gid }, (await tk(P1)))
  const rname = sql(`select r.name from wednesday_restaurants r join wednesday_groups g on g.restaurant_id=r.id where g.id='${gid}'`)
  check('within 24h: restaurant revealed to participants', shown.revealed === true && shown.name === rname)
  const still = await rpc('get_wednesday_restaurant', { p_group: gid }, (await tk(lastBasic)))
  check('still hidden from non-participants', still.status >= 400)
  await openTable()
  check('UI: participant sees the revealed restaurant name', (await bodyText(p)).includes(rname), tableId)
  await shot(p, 'wed-reveal')
  sql(`update wednesday_groups set dinner_date = '${dinner}' where id='${gid}'`)
  await p.context().close()
})

// ═══════════════ A7: WhatsApp ═══════════════
await section('A7: WhatsApp support button on landing and in the app', async () => {
  for (const [lang, rx] of [['sq', /Përshëndetje! Kam nevojë për ndihmë/], ['en', /Hi! I need help/]]) {
    const p = await newPage({ lang })
    const a = p.locator('a.wa-btn').first()
    const href = decodeURIComponent(await a.getAttribute('href').catch(() => '') || '')
    check(`landing (${lang}): WhatsApp button visible, wa.me/38344123456, message in ${lang}`, (await a.isVisible().catch(() => false)) && href.startsWith('https://wa.me/38344123456?text=') && rx.test(href), href)
    check(`landing (${lang}): opens in a new tab`, (await a.getAttribute('target')) === '_blank')
    await p.context().close()
  }
  for (const [lang, rx, acc] of [['sq', /Përshëndetje! Kam nevojë/, 'Llogaria: '], ['en', /Hi! I need help/, 'Account: ']]) {
    const p = await newPage({ width: lang === 'en' ? 1280 : 400, height: lang === 'en' ? 800 : 860 })
    await login(p, B1)
    await toLang(p, lang)
    const a = p.locator('a.wa-btn.wa-app')
    const href = decodeURIComponent(await a.getAttribute('href').catch(() => '') || '')
    check(`in the app (${lang}): button visible, message in ${lang} with account email`, (await a.isVisible().catch(() => false)) && rx.test(href) && href.includes(acc + B1), href)
    const box = await a.boundingBox().catch(() => null)
    const vw = p.viewportSize().width
    check(`in the app (${lang}): button inside the viewport`, box && box.x >= 0 && box.x + box.width <= vw)
    await shot(p, `wa-${lang}`)
    await p.context().close()
  }
  // on the Premium order screen the pay link includes the order code (en)
  const p = await newPage()
  await login(p, B1)
  await toLang(p, 'en')
  await p.locator('.premium-pill').click(); await sleep(900)
  await p.locator('.pl-pack').nth(2).click(); await sleep(1500)
  const code = (await p.locator('.pl-code strong').innerText().catch(() => '')).trim()
  const wa = decodeURIComponent(await p.locator('.pl-order a[href*="wa.me"]').getAttribute('href').catch(() => '') || '')
  check('order screen (en): pay link in English with order code + email', /Order code: /.test(wa) && wa.includes(code) && wa.includes(B1) && code.startsWith('EBP-'), wa)
  await p.locator('.pl-order button').last().click(); await sleep(1200)
  check('order cancelled again (cleanup)', sql(`select count(*) from subscription_orders where user_id='${U[B1]}' and status='pending'`) === '0')
  await p.context().close()
})

await close()
process.exit(summary() ? 1 : 0)
