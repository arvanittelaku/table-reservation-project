// R4 video room: the app's lesson room with the backend's room data, in both modes.
//  * no VIDEO_PROVIDER (dev): plain meet.jit.si room as served by the real backend; external_api.js is
//    answered by the stub (meet.jit.si is unreachable here) and the requested URL/options are checked
//  * 8x8 JaaS: get_lesson_room's real answer extended with a JaaS room + JWT (the backend's JWT itself
//    is covered by core/tests/test_jitsi.py), Jitsi's External API replaced by a recording stub
// Checks: JWT and room passed to the External API, camera/microphone allowed, hang-up returns to
// the app, camera errors explained, fatal errors / unreachable script / refused room shown clearly.
// Seed users: kushtrim.hasani (tutor, made here), qendrim.dervishi (student).
import { SHOTS, api, bodyText, check, close, launch, newPage, signIn, sleep, sql as sqlRaw, summary, token } from './lib.mjs'

const sql = (q) => sqlRaw(q.replace(/\s+/g, ' '))

const TUTOR = 'kushtrim.hasani@gmail.com'
const STUDENT = 'qendrim.dervishi@gmail.com'
const APP = 'vpaas-magic-cookie-e2etest'
const FAKE_JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.eyJyb29tIjoidGVzdCJ9.c2ln'
const uid = (e) => sql(`select id from auth.users where email='${e}'`)
const T = uid(TUTOR), S = uid(STUDENT)
const shot = (p, name) => p.screenshot({ path: `${SHOTS}r4v-${name}.png` }).catch(() => {})

// a fresh online lesson starting in 5 minutes, student confirmed, room key present
sql(`insert into tutors (user_id, status, headline, bio, subjects, teach_langs, price_cents, online, in_person, group_ok, city, years_experience, created_at, updated_at)
     values ('${T}', 'approved', 'Mësues testi për video', 'Profil testi për dhomën e videos, krijuar nga r4_video_room.', '{english}', '{sq}', 1000, true, false, false, 'Prishtinë', 3, now(), now())
     on conflict (user_id) do update set status = 'approved', online = true`)
sql(`delete from lessons where tutor_id = '${T}'`)
const L = sql(`insert into lessons (id, tutor_id, subject, kind, starts_at, duration_min, format, max_students, price_cents, status, created_at)
     values (gen_random_uuid(), '${T}', 'english', 'individual', now() + interval '5 minutes', 60, 'online', 1, 1000, 'scheduled', now()) returning id`).split('\n')[0]
sql(`insert into lesson_participants (lesson_id, student_id, status, created_at) values ('${L}', '${S}', 'confirmed', now())`)
sql(`insert into lesson_rooms (lesson_id, room_key) values ('${L}', md5(random()::text) || md5(random()::text))`)
const ROOM = 'ejaBashkohu-' + sql(`select room_key from lesson_rooms where lesson_id='${L}'`)
const STUDENT_NAME = sql(`select first_name || ' ' || last_name from profiles where id='${S}'`)

// stub of https://8x8.vc/<app>/external_api.js: records options, creates the iframe, lets the test fire events
const STUB = `window.JitsiMeetExternalAPI = function (domain, o) {
  const f = document.createElement('iframe')
  f.src = 'https://' + domain + '/' + o.roomName + (o.jwt ? '?jwt=' + o.jwt : '')
  f.setAttribute('allow', 'camera; microphone; display-capture; autoplay; clipboard-write')
  o.parentNode.appendChild(f)
  const ls = {}
  window.__jitsi = { domain, o, commands: [], disposed: false, fire: (n, e) => (ls[n] || []).forEach((cb) => cb(e || {})) }
  this.addListener = (n, cb) => { (ls[n] = ls[n] || []).push(cb) }
  this.getIFrame = () => f
  this.executeCommand = (c) => window.__jitsi.commands.push(c)
  this.dispose = () => { window.__jitsi.disposed = true; f.remove() }
}`

async function jaasMode(p, { script = 'stub', rpcError = false, startedMinAgo = null } = {}) {
  await p.route('**/rest/v1/rpc/get_lesson_room', async (route) => {
    if (rpcError) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Nuk ke qasje në këtë mësim', code: 'P0001' }) })
    const res = await route.fetch()
    const body = await res.json()
    const d = body.data
    Object.assign(d, { provider: 'jaas', domain: '8x8.vc', room_name: `${APP}/${d.room}`, jwt: FAKE_JWT,
      script_url: `https://8x8.vc/${APP}/external_api.js` })
    if (startedMinAgo != null) d.starts_at = new Date(Date.now() - startedMinAgo * 60000).toISOString()
    await route.fulfill({ response: res, body: JSON.stringify(body) })
  })
  await p.route(`https://8x8.vc/${APP}/external_api.js`, (route) =>
    script === 'stub' ? route.fulfill({ contentType: 'application/javascript', body: STUB }) : route.abort())
  await p.route(`https://8x8.vc/${APP}/ejaBashkohu-*`, (route) => route.fulfill({ contentType: 'text/html', body: '<p>jitsi</p>' }))
}

const openLessons = async (p) => {
  if (!(await p.locator('.ls-views').isVisible().catch(() => false))) { await p.locator('.browse-mode', { hasText: 'Mësimet' }).click(); await sleep(1200) }
  await p.locator('.ls-views button', { hasText: 'Mësimet e mia' }).click(); await sleep(1200)
}
const enter = async (p) => {
  await openLessons(p)
  await p.locator('.ls-item', { hasText: /Anglisht/ }).filter({ has: p.locator('button', { hasText: 'Hyr në mësim' }) }).first()
    .locator('button', { hasText: 'Hyr në mësim' }).click()
  await sleep(1500)
}

await launch()
try {
  console.log('\n── self-hosted / dev Jitsi (real backend answer)')
  {
    const r = await api('/rest/v1/rpc/get_lesson_room', { p_lesson: L }, await token(STUDENT))
    check('backend: plain room, no JWT, old keys kept', r.status === 200 && r.data.room === ROOM && r.data.provider === 'jitsi' &&
      r.data.jwt === null && r.data.room_name === ROOM && r.data.duration_min === 60 && !!r.data.starts_at && !!r.data.domain, JSON.stringify(r.data))
    const t = await api('/rest/v1/rpc/get_lesson_room', { p_lesson: L }, await token(TUTOR))
    check('backend: tutor is moderator, student is not', t.data?.moderator === true && r.data.moderator === false)
    const p = await newPage()
    const scripts = []   // meet.jit.si is unreachable here: record the request and answer with the stub
    await p.route('https://meet.jit.si/external_api.js', (route) => { scripts.push(route.request().url()); route.fulfill({ contentType: 'application/javascript', body: STUB }) })
    await p.goto('http://localhost:5173'); await signIn(p, STUDENT)
    await enter(p)
    const j = await p.evaluate(() => window.__jitsi && { domain: window.__jitsi.domain, room: window.__jitsi.o.roomName, jwt: window.__jitsi.o.jwt ?? null, name: window.__jitsi.o.userInfo?.displayName,
      cfg: window.__jitsi.o.configOverwrite })
    check('IFrame API script requested from the backend\'s domain', scripts.length === 1 && scripts[0] === `https://${r.data.domain}/external_api.js`, scripts.join(','))
    check('IFrame API gets the lesson room, no jwt', j?.domain === r.data.domain && j?.room === ROOM && !j?.jwt, JSON.stringify(j))
    check('display name passed to Jitsi', j?.name === STUDENT_NAME, JSON.stringify(j))
    check('starts with camera + microphone on, no prejoin', j?.cfg?.startWithAudioMuted === false && j?.cfg?.startWithVideoMuted === false && j?.cfg?.prejoinPageEnabled === false, JSON.stringify(j?.cfg))
    const allow = await p.locator('.ls-room-holder .ls-room-frame').getAttribute('allow').catch(() => '')
    check('camera + microphone allowed in the frame', /camera/.test(allow) && /microphone/.test(allow), allow)
    const timer = await p.locator('[data-testid="room-timer"]').innerText().catch(() => '')
    check('countdown to the lesson end (starts in 5 min, 60 min long)', /^Përfundon pas 1:0[45]:\d\d$/.test(timer), timer)
    await shot(p, 'plain')
    await p.locator('.ls-room-bar button', { hasText: 'Dil nga mësimi' }).click(); await sleep(600)
    check('leaving returns to the lessons list', !(await p.locator('.ls-room').isVisible().catch(() => false)) && await p.locator('.ls-views').isVisible())
    check('no page errors', p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  }

  console.log('\n── 8x8 JaaS: External API with the participant JWT')
  {
    const p = await newPage()
    await jaasMode(p)
    await p.goto('http://localhost:5173'); await signIn(p, STUDENT)
    await enter(p)
    const j = await p.evaluate(() => window.__jitsi && { domain: window.__jitsi.domain, roomName: window.__jitsi.o.roomName, jwt: window.__jitsi.o.jwt, name: window.__jitsi.o.userInfo?.displayName, prejoin: window.__jitsi.o.configOverwrite?.prejoinPageEnabled })
    check('External API loaded from 8x8.vc/<appId>/external_api.js and started', !!j, JSON.stringify(j))
    check('JaaS domain + room "<appId>/<room>"', j?.domain === '8x8.vc' && j?.roomName === `${APP}/${ROOM}`, JSON.stringify(j))
    check('participant JWT handed to Jitsi', j?.jwt === FAKE_JWT)
    check('display name from the backend, prejoin page off', j?.name === STUDENT_NAME && j?.prejoin === false, JSON.stringify(j))
    const f = p.locator('.ls-room-holder .ls-room-frame')
    check('Jitsi frame shown full size with camera + microphone', await f.isVisible() && /camera/.test(await f.getAttribute('allow')) && /microphone/.test(await f.getAttribute('allow')))
    const box = await f.boundingBox()
    check('frame fills the phone screen below the bar', box && box.width >= 390 && box.height >= 700, JSON.stringify(box))
    await p.evaluate(() => window.__jitsi.fire('cameraError', { type: 'gum.permission_denied' }))
    await sleep(300)
    check('blocked camera explained', /Kamera ose mikrofoni janë të bllokuar/.test(await bodyText(p)))
    await shot(p, 'jaas')
    await p.evaluate(() => window.__jitsi.fire('videoConferenceJoined', {}))
    await p.evaluate(() => window.__jitsi.fire('readyToClose', {}))
    await sleep(600)
    check('hang-up in Jitsi returns to the app', !(await p.locator('.ls-room').isVisible().catch(() => false)) && await p.locator('.ls-views').isVisible())
    check('Jitsi disposed after leaving', await p.evaluate(() => window.__jitsi.disposed))
    // the app's own leave button hangs up first
    await enter(p)
    await p.locator('.ls-room-bar button', { hasText: 'Dil nga mësimi' }).click(); await sleep(500)
    check('app leave button: hangup sent, room closed', (await p.evaluate(() => window.__jitsi.commands.includes('hangup'))) && !(await p.locator('.ls-room').isVisible().catch(() => false)))
    // a fatal Jitsi error (e.g. rejected token) is shown, with retry
    await enter(p)
    await p.evaluate(() => window.__jitsi.fire('errorOccurred', { error: { isFatal: true, name: 'conference.authenticationRequired' } }))
    await sleep(400)
    const txt = await bodyText(p)
    check('fatal error: clear message + "Provo përsëri" + open in new window', /Dhoma e videos nuk u hap/.test(txt) && /Provo përsëri/.test(txt) && /Hape në një dritare të re/.test(txt), txt.slice(0, 300))
    const href = await p.locator('.ls-room-msg a').getAttribute('href').catch(() => '')
    check('new-window link carries the room and JWT', href.startsWith(`https://8x8.vc/${APP}/${ROOM}?jwt=${FAKE_JWT}`), href)
    await shot(p, 'jaas-error')
    await p.locator('.ls-room-msg button', { hasText: 'Provo përsëri' }).click(); await sleep(1500)
    check('retry reopens the room', await p.locator('.ls-room-holder .ls-room-frame').isVisible().catch(() => false))
    check('no page errors (JaaS)', p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  }

  console.log('\n── 8x8 JaaS: External API script unreachable -> clear error, no raw iframe')
  {
    const p = await newPage({ width: 1280, height: 800 })
    await jaasMode(p, { script: 'abort' })
    await p.goto('http://localhost:5173'); await signIn(p, STUDENT)
    await enter(p)
    const txt = await bodyText(p)
    check('error shown with retry', /Dhoma e videos nuk u hap/.test(txt) && /Provo përsëri/.test(txt), txt.slice(0, 200))
    check('no raw iframe embedded', (await p.locator('.ls-room iframe').count()) === 0)
    const href = await p.locator('.ls-room-msg a').getAttribute('href').catch(() => '')
    check('"open in a new window" link on 8x8.vc/<appId>/<room>?jwt=…', href.startsWith(`https://8x8.vc/${APP}/${ROOM}?jwt=${FAKE_JWT}#`), href)
    await shot(p, 'jaas-noscript-desktop')
    check('no page errors (script unreachable)', p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  }

  console.log('\n── lesson over: overtime timer, then the room closes itself')
  {
    const p = await newPage()
    await jaasMode(p, { startedMinAgo: 65 })   // 60-min lesson ended 5 min ago, room open 25 more min
    await p.goto('http://localhost:5173'); await signIn(p, STUDENT)
    await enter(p)
    const timer = await p.locator('[data-testid="room-timer"]').innerText().catch(() => '')
    check('overtime: "room closes in 2x:xx"', /dhoma mbyllet pas 2[45]:\d\d/.test(timer), timer)
    await p.context().close()
    const q = await newPage()
    await jaasMode(q, { startedMinAgo: 91 })   // past the 30-min grace: closes at once
    await q.goto('http://localhost:5173'); await signIn(q, STUDENT)
    await enter(q)
    await sleep(1200)
    const txt = await bodyText(q)
    check('after the window: "Mësimi ka përfunduar", Jitsi hung up and disposed', /Mësimi ka përfunduar/.test(txt)
      && await q.evaluate(() => !window.__jitsi || window.__jitsi.disposed), txt.slice(0, 200))
    check('no retry offered once closed', !(await q.locator('.ls-room-msg button', { hasText: 'Provo përsëri' }).count()))
    await q.context().close()
  }

  console.log('\n── room refused by the backend')
  {
    const p = await newPage()
    await jaasMode(p, { rpcError: true })
    await p.goto('http://localhost:5173'); await signIn(p, STUDENT)
    await enter(p)
    const txt = await bodyText(p)
    check('refusal shown in the room with retry, no frame', /Nuk ke qasje/.test(txt) && /Provo përsëri/.test(txt) && !(await p.locator('.ls-room-frame').count()), txt.slice(0, 200))
    await p.locator('.ls-room-bar button', { hasText: 'Dil nga mësimi' }).click(); await sleep(400)
    check('leave works from the error screen', !(await p.locator('.ls-room').isVisible().catch(() => false)))
    await p.context().close()
  }
} finally {
  sql(`delete from lessons where id = '${L}'`)
  await close()
}
process.exit(summary() ? 1 : 0)
