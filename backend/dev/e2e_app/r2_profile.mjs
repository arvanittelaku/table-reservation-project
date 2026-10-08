// R2: profile, notifications, sign-in, design.
//  P2 badge notifications exactly once + notifications rendered fully in sq/en/de/mk
//  P4 profile photo upload / replace / remove (signed URLs for other users), masked passwords
//  Profile CRUD (name, age, languages, tourist, home city 30-day rule, taste profile,
//  email preference, deactivation), A2 rate/follow links, A3 social sign-in onboarding,
//  A8 screenshots of the main screens at phone + desktop size.
import { execSync } from 'node:child_process'
import { API, SITE, SHOTS, api, bodyText, check, close, launch, makeJpeg, newPage, section, signIn, sleep, sql, summary, token, verifyLink, waitMail } from './lib.mjs'

const BACKEND = '/home/claude/table-reservation-project/backend'
const STAMP = Date.now()
const ADMIN = 'support@ejabashkohu.com'
const OTHER = 'jeta.rexhepi@gmail.com' // seed user, only reads other people's avatars
const LANGS = ['sq', 'en', 'de', 'mk']

const uidOf = (email) => sql(`select id from auth.users where email='${email}'`)
const rpc = (name, args, tok) => api(`/rest/v1/rpc/${name}`, args, tok)
const q = (req, tok) => api('/rest/v1/query', req, tok)

let jpegBytes = null
async function jpeg(p) {
  if (jpegBytes) return jpegBytes
  jpegBytes = Buffer.from(await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d')
    for (let i = 0; i < 600; i += 40) for (let j = 0; j < 800; j += 40) { const v = 70 + Math.floor(Math.random() * 120); x.fillStyle = `rgb(${v + 50},${v},${v - 30})`; x.fillRect(i, j, 40, 40) }
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); return Array.from(new Uint8Array(await b.arrayBuffer()))
  }))
  return jpegBytes
}

/** A fresh, onboarded account with a photo and home city (re-runnable: unique email). */
async function makeUser(p, tag, { first = 'Test', last = tag, city = 'Prishtinë', photo = true } = {}) {
  const email = `r2.${tag}.${STAMP}@gmail.com`
  await api('/auth/v1/signup', { email, password: 'Test1234!', options: { data: { first_name: first, last_name: last } } })
  sql(`update auth.users set email_confirmed_at=now() where email='${email}'`)
  const tok = await token(email)
  const uid = uidOf(email)
  await rpc('complete_onboarding', { p_first_name: first, p_last_name: last, p_age: 27 }, tok)
  if (photo) {
    const r = await fetch(`${API}/storage/v1/object/avatars/${uid}/avatar.jpg`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: await jpeg(p) })
    if (!r.ok) console.log('avatar upload', r.status, await r.text())
    await q({ table: 'profiles', action: 'update', values: { photo_path: `${uid}/avatar.jpg`, photo_face_ok: true }, filters: [{ col: 'id', op: 'eq', value: uid }] }, tok)
  }
  if (city) await rpc('set_home_city', { p_city: city }, tok)
  return { email, tok, uid }
}

async function createTable(u, title, days = 2) {
  return q({ table: 'tables', action: 'insert', returning: true, values: { host_id: u.uid, kind: 'tavoline', category: 'kafe', title, city: 'Prishtinë', area: 'Qendër', spots: 4, time_label: 'x', event_datetime: new Date(Date.now() + days * 864e5).toISOString(), maps_link: 'https://maps.app.goo.gl/x' } }, u.tok)
}

async function signedAvatar(path, tok) {
  const r = await api('/storage/v1/object/sign/avatars', { paths: [path], expiresIn: 600 }, tok)
  const row = Array.isArray(r) ? r[0] : (r.data || r[0] || r)
  const rel = row?.signedURL || row?.signedUrl || row?.[0]?.signedURL
  if (!rel) return { status: 0, raw: JSON.stringify(r).slice(0, 200) }
  const url = rel.startsWith('http') ? rel : API + (rel.startsWith('/storage') ? rel : '/storage/v1' + rel)
  const g = await fetch(url)
  return { status: g.status, type: g.headers.get('content-type'), size: (await g.arrayBuffer()).byteLength, url }
}

/** Sign in by putting a real session into the app storage (works in any UI language). */
async function apiSignIn(p, email, password = 'Test1234!') {
  const sess = await api('/auth/v1/token?grant_type=password', { email, password })
  await p.evaluate(([v]) => localStorage.setItem('ejb-auth-session', v), [JSON.stringify(sess)])
  await p.reload(); await p.waitForTimeout(3000)
}

const dbg = (p, tag) => p.screenshot({ path: SHOTS + `r2-debug-${tag}.png` }).catch(() => {})

async function openProfile(p) {
  await p.locator('.hdr-user').click(); await p.waitForTimeout(500)
}
async function openEdit(p) {
  await openProfile(p)
  await p.locator('.edit-profile-btn').click(); await p.waitForTimeout(600)
}

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null
const sec = (name, fn) => (ONLY && !ONLY.test(name) ? Promise.resolve() : section(name, fn))
async function needUsers() {
  if (PU && HOST && GUEST) return
  const p = await newPage()
  PU ||= await makeUser(p, 'prof', { first: 'Arta', last: 'Profili', photo: false })
  HOST ||= await makeUser(p, 'host', { first: 'Host', last: 'Badge' })
  GUEST ||= await makeUser(p, 'guest', { first: 'Guest', last: 'Badge' })
  await p.context().close()
}
let PU = null, HOST = null, GUEST = null

await launch()

/* ───────────────────────── sign-in / passwords / providers ───────────────────────── */
await sec('Password masking + provider buttons', async () => {
  const p = await newPage()
  await p.getByText('Hyr', { exact: true }).first().click(); await p.waitForTimeout(500)
  const pw = p.locator('.input-password-wrap input').first()
  check('sign-in: password masked by default', (await pw.getAttribute('type')) === 'password')
  await pw.fill('abc12345')
  await p.locator('.password-toggle').first().click()
  check('sign-in: eye shows the password', (await pw.getAttribute('type')) === 'text')
  await p.locator('.password-toggle').first().click()
  check('sign-in: eye hides it again', (await pw.getAttribute('type')) === 'password')
  check('Google button shown (configured)', await p.locator('.social-btn.google').isVisible())
  check('Apple button hidden when Apple is not configured', (await p.locator('.social-btn.apple').count()) === 0)
  await p.screenshot({ path: SHOTS + 'r2-signin-400.png' })
  await p.context().close()

  // backend that has Apple configured -> button appears
  const p2 = await newPage()
  await p2.route(API + '/auth/v1/settings', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ external: { email: true, google: true, apple: true }, mailer_autoconfirm: false }) }))
  await p2.reload(); await p2.waitForTimeout(1200)
  await p2.getByText('Hyr', { exact: true }).first().click(); await p2.waitForTimeout(500)
  check('Apple button shown when settings say Apple is configured', await p2.locator('.social-btn.apple').isVisible())
  // Apple click goes to the backend authorize endpoint
  const reqP = p2.waitForRequest((r) => r.url().includes('/auth/v1/authorize') && r.url().includes('provider=apple'), { timeout: 5000 }).catch(() => null)
  await p2.route(API + '/auth/v1/authorize**', (r) => r.fulfill({ status: 200, body: 'stop' }))
  await p2.locator('.social-btn.apple').click()
  check('Apple button starts /auth/v1/authorize?provider=apple', !!(await reqP))
  await p2.context().close()

  // sign-up: masked + eye
  const p3 = await newPage()
  await p3.getByRole('button', { name: 'Eja bashkohu, falas' }).click(); await p3.waitForTimeout(600)
  const pw3 = p3.locator('.input-password-wrap input').first()
  check('sign-up: password masked', (await pw3.getAttribute('type')) === 'password')
  await p3.locator('.password-toggle').first().click()
  check('sign-up: eye toggle reveals', (await pw3.getAttribute('type')) === 'text')
  await p3.context().close()
})

await sec('Password reset screen masks the new password', async () => {
  const u = await (async () => { const p = await newPage(); const x = await makeUser(p, 'reset', { photo: false }); await p.context().close(); return x })()
  const t0 = Date.now()
  await api('/auth/v1/recover', { email: u.email })
  const mail = await waitMail(u.email, t0)
  const link = (mail.match(/(http:\/\/\S+\/auth\/v1\/verify\?token=[\w-]+&type=recovery\S*)/) || [])[1] || verifyLink(mail)
  check('reset email arrives', !!link)
  const p = await newPage()
  await p.goto(link.replace(/=\r?\n/g, '')); await p.waitForTimeout(3000)
  const pw = p.locator('.input-password-wrap input').first()
  check('reset: new password field masked', (await pw.getAttribute('type').catch(() => null)) === 'password', (await bodyText(p)).slice(0, 200))
  await p.locator('.password-toggle').first().click().catch(() => {})
  check('reset: eye toggle reveals', (await pw.getAttribute('type').catch(() => null)) === 'text')
  await pw.fill('NewPass123!')
  await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(2000)
  check('new password works for sign-in', !!(await token(u.email, 'NewPass123!')))
  await p.context().close()
})

/* ───────────────────────── Google onboarding (A3) ───────────────────────── */
await sec('Google sign-in runs every onboarding step', async () => {
  const p = await newPage()
  await p.getByText('Hyr', { exact: true }).first().click(); await p.waitForTimeout(300)
  await p.locator('.social-btn.google').click(); await p.waitForTimeout(4000)
  const t = await bodyText(p)
  check('Google: name step shown first', /Si të thërrasim/.test(t), t.slice(0, 200))
  const email = await p.evaluate(() => JSON.parse(localStorage.getItem('ejb-auth-session') || 'null')?.user?.email)
  const uid = uidOf(email)
  check('Google: account not onboarded yet', sql(`select onboarded_at is null from profiles where id='${uid}'`) === 't')
  // try to skip: reload must still land in onboarding
  await p.reload(); await p.waitForTimeout(3000)
  check('Google: reload keeps the onboarding (no skip to the feed)', /Si të thërrasim/.test(await bodyText(p)))
  check('Google: continue disabled until the terms are accepted', await p.locator('.step-body .btn.primary').isDisabled())
  await p.locator('.step-body input[type=checkbox]').check()
  await p.locator('.step-body input.input').nth(1).fill('')
  check('Google: empty surname blocks continuing', await p.locator('.step-body .btn.primary').isDisabled())
  await p.locator('.step-body input.input').nth(1).fill('Kelmendi')
  await p.locator('.step-body .btn.primary').first().click(); await p.waitForTimeout(800)
  check('Google: age step shown', await p.locator('.age-big').isVisible())
  await p.locator('.age-btn.plus').click(); await p.locator('.age-btn.plus').click()
  await p.locator('.step-body .btn.primary').click(); await p.waitForTimeout(600)
  check('Google: photo step shown, continue disabled without photo', await p.locator('.step-body .btn.primary').isDisabled().catch(() => false))
  await p.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await makeJpeg(p, 1200, 1600) })
  await p.waitForTimeout(3500)
  await p.locator('.step-body .btn.primary').click(); await p.waitForTimeout(800)
  check('Google: local/tourist step shown', await p.locator('.choice-grid button').first().isVisible())
  await p.locator('.choice-grid button').first().click(); await p.waitForTimeout(3500)
  check('Google: lands on the feed after the last step', await p.locator('.hdr-user').isVisible())
  await p.reload(); await p.waitForTimeout(3000)
  check('Google: header shows name and the chosen age', /Arbër, 26/.test(await p.locator('.hdr-user').innerText().catch(() => '')), await p.locator('.hdr-user').innerText().catch(() => ''))
  check('Google: onboarding completed in DB with age + photo', sql(`select (onboarded_at is not null and photo_path is not null and last_name='Kelmendi' and age=26)::text from profiles where id='${uid}'`) === 'true')
  check('Google: no failed API calls', p.bad.length === 0, p.bad.join(', '))
  await p.context().close()
})

/* ───────────────────────── profile CRUD + photo (P4) ───────────────────────── */
await sec('Profile edit: name, age, languages, tourist, email preference', async () => {
  await needUsers()
  const p = await newPage()
  PU ||= await makeUser(p, 'prof', { first: 'Arta', last: 'Profili', photo: false })
  await signIn(p, PU.email)
  check('signed in to the feed', await p.locator('.hdr-user').isVisible())
  await openProfile(p)
  check('own profile has an "Edit profile" button', await p.locator('.edit-profile-btn').isVisible())
  await p.screenshot({ path: SHOTS + 'r2-profile-400.png' })
  await p.locator('.edit-profile-btn').click(); await p.waitForTimeout(700)
  await p.screenshot({ path: SHOTS + 'r2-edit-profile-400.png', fullPage: true })
  check('edit sheet prefilled with the name', (await p.locator('#ep-first').inputValue()) === 'Arta')
  await p.locator('#ep-first').fill('Artina')
  await p.locator('#ep-last').fill('Ndryshuar')
  await p.locator('#ep-age').fill('17')
  await p.locator('.ep-save').click(); await p.waitForTimeout(500)
  check('age under 18 refused in the form', /18/.test(await p.locator('.edit-profile .age-warn').innerText().catch(() => '')))
  await p.locator('#ep-age').fill('31')
  await p.locator('.ep-langs .choice', { hasText: 'English' }).click()
  await p.locator('.ep-langs .choice', { hasText: 'Deutsch' }).click()
  await p.locator('.edit-profile .method').nth(1).click()
  await p.locator('.ep-from').fill('Zürich')
  await p.locator('.ep-save').click(); await p.waitForTimeout(2000)
  const row = sql(`select first_name||'|'||last_name||'|'||age||'|'||array_to_string(langs,',')||'|'||is_tourist||'|'||coalesce(from_place,'') from profiles where id='${PU.uid}'`)
  check('profile saved in DB (name, age, langs, tourist, from)', row === 'Artina|Ndryshuar|31|Shqip,English,Deutsch|true|Zürich', row)
  check('header shows the new name and age', /Artina, 31/.test(await p.locator('.hdr-user').innerText()), await p.locator('.hdr-user').innerText())
  await p.reload(); await p.waitForTimeout(2500)
  check('new name survives reload', /Artina, 31/.test(await p.locator('.hdr-user').innerText().catch(() => '')))
  await openProfile(p)
  const pv = await bodyText(p)
  check('profile card shows languages + tourist place', /English/.test(pv) && /Zürich/.test(pv), pv.slice(0, 300))
  await p.locator('.modal-x').click(); await p.waitForTimeout(300)
  // other users see the new name
  const other = await token(OTHER)
  const seen = await q({ table: 'profiles', select: 'first_name,last_name,age', filters: [{ col: 'id', op: 'eq', value: PU.uid }] }, other)
  check('other users read the updated name', seen.data?.[0]?.first_name === 'Artina', JSON.stringify(seen).slice(0, 200))
  // cannot write protected columns or others' profiles
  const hack = await q({ table: 'profiles', action: 'update', values: { is_admin: true, verified: true, rating: 5 }, filters: [{ col: 'id', op: 'eq', value: PU.uid }], returning: true }, PU.tok)
  check('protected columns (is_admin/verified/rating) not writable by the owner', sql(`select (is_admin or verified)::text from profiles where id='${PU.uid}'`) === 'false', JSON.stringify(hack).slice(0, 200))
  // email preference
  await openEdit(p)
  const box = p.locator('.ep-email input')
  check('email notifications ON by default', await box.isChecked())
  await box.click(); await p.waitForTimeout(1200)
  check('email preference OFF stored', sql(`select user_preferences->>'email_notifications' from profiles where id='${PU.uid}'`) === 'false')
  await box.click(); await p.waitForTimeout(1200)
  check('email preference back ON', sql(`select user_preferences->>'email_notifications' from profiles where id='${PU.uid}'`) === 'true')
  check('no failed API calls', p.bad.length === 0, p.bad.join(', '))
  check('no page errors', p.errs.length === 0, p.errs.join(' | '))
  await p.context().close()
})

await sec('Profile photo: add, replace, remove; others see it through signed URLs', async () => {
  await needUsers()
  const p = await newPage()
  await signIn(p, PU.email)
  await openEdit(p)
  check('no photo yet: "Add photo" button', /Shto foto/.test(await p.locator('.ep-photo').innerText()))
  await p.locator('.ep-photo input[type=file]').setInputFiles({ name: 'IMG_1.png', mimeType: 'image/png', buffer: await makeJpeg(p, 2400, 3200) })
  await p.waitForTimeout(5000)
  const path = sql(`select coalesce(photo_path,'') from profiles where id='${PU.uid}'`)
  check('photo uploaded and linked', path === `${PU.uid}/avatar.jpg`, path)
  const size1 = sql(`select size from backend.storage_objects where path='${PU.uid}/avatar.jpg'`)
  check('stored as a compressed JPEG', Number(size1) > 0 && Number(size1) < 400000, size1)
  const other = await token(OTHER)
  const s1 = await signedAvatar(path, other)
  check('another user can load the avatar through a signed URL', s1.status === 200 && /image\/jpeg/.test(s1.type || ''), JSON.stringify(s1))
  const unsigned = await fetch(`${API}/storage/v1/object/sign/avatars/${path}?token=forged`)
  check('avatar not readable with a forged token', unsigned.status >= 400)
  check('header avatar shows the photo', await p.locator('.hdr-user img').isVisible().catch(() => false))
  // replace
  const etag1 = sql(`select updated_at::text || size from backend.storage_objects where path='${PU.uid}/avatar.jpg'`)
  await p.locator('.ep-photo input[type=file]').setInputFiles({ name: 'IMG_2.png', mimeType: 'image/png', buffer: await makeJpeg(p, 1600, 1600) })
  await p.waitForTimeout(5000)
  const etag2 = sql(`select updated_at::text || size from backend.storage_objects where path='${PU.uid}/avatar.jpg'`)
  check('replace overwrites the stored file', etag1 !== etag2, `${etag1} / ${etag2}`)
  const s2 = await signedAvatar(path, other)
  check('replaced avatar served to others', s2.status === 200 && s2.size > 0)
  // remove
  p.once('dialog', (d) => d.accept())
  await p.locator('.ep-remove').click(); await p.waitForTimeout(2500)
  check('remove clears photo_path', sql(`select coalesce(photo_path,'') from profiles where id='${PU.uid}'`) === '')
  check('remove deletes the file', sql(`select count(*) from backend.storage_objects where path='${PU.uid}/avatar.jpg'`) === '0')
  check('sheet back to "Add photo"', /Shto foto/.test(await p.locator('.ep-photo').innerText()))
  await p.locator('.edit-profile .icon-btn').first().click(); await p.waitForTimeout(400)
  check('header falls back to the initial', !(await p.locator('.hdr-user img').isVisible().catch(() => false)))
  check('no page errors', p.errs.length === 0, p.errs.join(' | '))
  check('no failed API calls', p.bad.length === 0, p.bad.join(', '))
  await p.context().close()
})

await sec('Taste profile save + edit', async () => {
  await needUsers()
  const p = await newPage()
  await signIn(p, PU.email)
  await openEdit(p)
  await p.locator('.ep-taste').click(); await p.waitForTimeout(600)
  const pick = async (i) => { await p.locator('.sheet .ob-choice .choice').nth(i).click(); await p.waitForTimeout(450) }
  for (let k = 0; k < 4; k++) await pick(0)
  await pick(0); await pick(2)
  await p.locator('.sheet .btn.primary.full').last().click(); await p.waitForTimeout(2000)
  const r1 = sql(`select group_size||'|'||energy||'|'||array_to_string(array(select jsonb_array_elements_text(to_jsonb(interests))),',') from taste_profiles where user_id='${PU.uid}'`)
  check('taste profile saved', r1.startsWith('vogla|introvert|'), r1)
  check('"profile complete" badge awarded once', sql(`select count(*) from badges where user_id='${PU.uid}' and badge_id='profil'`) === '1')
  // edit: change group size and energy
  await openEdit(p)
  await p.locator('.ep-taste').click(); await p.waitForTimeout(600)
  for (let k = 0; k < 4; k++) {
    await p.locator('.sheet .ob-choice .choice').nth(2).click(); await p.waitForTimeout(300)
    await p.locator('.sheet .btn.primary').last().click(); await p.waitForTimeout(400) // answered questions show "Continue"
  }
  await p.locator('.sheet .ob-choice .choice').nth(3).click(); await p.waitForTimeout(300)
  await p.locator('.sheet .btn.primary').last().click(); await p.waitForTimeout(2000)
  const r2 = sql(`select group_size||'|'||energy from taste_profiles where user_id='${PU.uid}'`)
  check('taste profile edited (group size + energy changed)', r2 === 'medha|ekstrovert', r2)
  check('still one taste profile row', sql(`select count(*) from taste_profiles where user_id='${PU.uid}'`) === '1')
  check('"profile complete" badge still once after re-saving', sql(`select count(*) from notifications where user_id='${PU.uid}' and kind='badgeEarned' and params->>'badge'='profileComplete'`) === '1')
  check('no page errors', p.errs.length === 0, p.errs.join(' | '))
  await p.context().close()
})

await sec('Home city (Basic): change once, then 30-day rule', async () => {
  await needUsers()
  const p = await newPage()
  sql(`update profiles set home_city='Prishtinë', home_city_changed_at=null where id='${PU.uid}'`)
  await signIn(p, PU.email)
  await openEdit(p)
  const cityBtn = p.locator('.ep-city')
  check('Basic user sees "My city" in the profile', /Prishtinë/.test(await cityBtn.innerText().catch(() => '')))
  await cityBtn.click(); await p.waitForTimeout(700)
  await p.screenshot({ path: SHOTS + 'r2-city-picker-400.png' })
  const sel = p.locator('select').first()
  if (await sel.count()) await sel.selectOption('Prizren').catch(() => {})
  else await p.getByText('Prizren', { exact: true }).first().click().catch(() => {})
  await p.locator('button', { hasText: 'Ruaj' }).last().click().catch(() => {}); await p.waitForTimeout(1500)
  check('home city changed to Prizren', sql(`select home_city from profiles where id='${PU.uid}'`) === 'Prizren')
  const again = await rpc('set_home_city', { p_city: 'Pejë' }, PU.tok)
  check('second change within 30 days refused', /30/.test(JSON.stringify(again)), JSON.stringify(again).slice(0, 200))
  check('city unchanged after refusal', sql(`select home_city from profiles where id='${PU.uid}'`) === 'Prizren')
  const direct = await q({ table: 'profiles', action: 'update', values: { home_city: 'Pejë', home_city_changed_at: null }, filters: [{ col: 'id', op: 'eq', value: PU.uid }] }, PU.tok)
  check('home city cannot be changed by a direct profile update', sql(`select home_city from profiles where id='${PU.uid}'`) === 'Prizren', JSON.stringify(direct).slice(0, 100))
  sql(`update profiles set home_city_changed_at=now()-interval '31 days' where id='${PU.uid}'`)
  const later = await rpc('set_home_city', { p_city: 'Prishtinë' }, PU.tok)
  check('allowed again after 30 days', sql(`select home_city from profiles where id='${PU.uid}'`) === 'Prishtinë', JSON.stringify(later).slice(0, 100))
  await p.context().close()
})

/* ───────────────────────── rate / follow the app (A2) ───────────────────────── */
await sec('Rate the app + follow the app, in all languages', async () => {
  await needUsers()
  const labels = { sq: ['Vlerëso aplikacionin', 'Na ndiq'], en: ['Rate the app', 'Follow us'], de: ['App bewerten', 'Folge uns'], mk: ['Оцени ја апликацијата', 'Следи нè'] }
  for (const lang of LANGS) {
    const p = await newPage({ lang })
    await apiSignIn(p, PU.email)
    await openEdit(p)
    const rate = p.locator('.ep-rate')
    const txt = await p.locator('.ep-list').evaluate((e) => e.textContent).catch(() => '')
    check(`${lang}: "rate the app" label translated`, txt.includes(labels[lang][0]), txt.slice(0, 200))
    check(`${lang}: "follow" label translated`, txt.includes(labels[lang][1]), txt.slice(0, 200))
    const href = await rate.getAttribute('href').catch(() => '')
    check(`${lang}: rate link points to a store`, /^https:\/\/(play\.google\.com|apps\.apple\.com)\//.test(href || ''), href)
    const socials = await p.locator('.ep-social a').evaluateAll((as) => as.map((a) => [a.href, a.target, a.rel]))
    check(`${lang}: Instagram/Facebook/TikTok links open in a new tab`, socials.length === 3 && /instagram\.com/.test(socials[0][0]) && /facebook\.com/.test(socials[1][0]) && /tiktok\.com/.test(socials[2][0]) && socials.every((s) => s[1] === '_blank' && /noopener/.test(s[2])), JSON.stringify(socials))
    const sheetTxt = await p.locator('.edit-profile').innerText().catch(() => '')
    if (lang !== 'sq') check(`${lang}: edit sheet has no Albanian labels`, !/Ndrysho|Ruaj|Emri|Mosha|Gjuhët/.test(sheetTxt), sheetTxt.slice(0, 200))
    if (lang === 'en') await p.screenshot({ path: SHOTS + 'r2-edit-profile-en-400.png', fullPage: true })
    await p.context().close()
  }
})

/* ───────────────────────── badges exactly once (P2) ───────────────────────── */
await sec('Badge notifications exactly once', async () => {
  await needUsers()
  const p = await newPage()
  HOST ||= await makeUser(p, 'host', { first: 'Host', last: 'Badge' })
  GUEST ||= await makeUser(p, 'guest', { first: 'Guest', last: 'Badge' })
  // concurrent award calls (two tabs / double click)
  const res = await Promise.all([1, 2, 3, 4, 5].map(() => rpc('award_badge', { p_badge: 'first-host' }, HOST.tok)))
  check('concurrent award_badge: exactly one call returns true', res.filter((r) => r.data === true || r === true).length === 1, JSON.stringify(res.map((r) => r.data ?? r.message)))
  check('one first-host badge row', sql(`select count(*) from badges where user_id='${HOST.uid}' and badge_id='first-host'`) === '1')
  check('one "Nikoqiri i ri" notification', sql(`select count(*) from notifications where user_id='${HOST.uid}' and kind='badgeEarned' and params->>'badge'='firstHost'`) === '1')
  await p.context().close()

  // UI: host 2 tables through the create form, reload twice -> still once
  const h = await newPage()
  await signIn(h, HOST.email)
  for (const n of [1, 2]) {
    const r = await createTable(HOST, `R2 badge ${STAMP} ${n}`, 2 + n)
    if (r.status >= 400) console.log('create', JSON.stringify(r).slice(0, 200))
  }
  await h.reload(); await h.waitForTimeout(2500); await h.reload(); await h.waitForTimeout(2500)
  check('after hosting 2 tables + 2 reloads still one firstHost notification', sql(`select count(*) from notifications where user_id='${HOST.uid}' and kind='badgeEarned' and params->>'badge'='firstHost'`) === '1')
  await h.locator('.bell').click(); await h.waitForTimeout(800)
  const items = await h.locator('.notif-item p').allInnerTexts()
  check('bell shows the "Nikoqiri i ri" badge once', items.filter((x) => /Nikoqiri i ri/.test(x)).length === 1, items.join(' / '))
  await h.context().close()

  // guest joins (request) 2 tables + rate twice -> first-join / first-rate once each
  const tables = sql(`select string_agg(id::text, ',') from tables where host_id='${HOST.uid}'`).split(',')
  for (const tid of tables) {
    const rq = await rpc('request_join', { p_table: tid }, GUEST.tok)
    await rpc('approve_request', { p_request: rq.data }, HOST.tok)
    sql(`insert into memberships (table_id, user_id, role, joined_at) values ('${tid}', '${GUEST.uid}', 'member', now()) on conflict do nothing`)
    await rpc('award_badge', { p_badge: 'first-join' }, GUEST.tok)
    await q({ table: 'ratings', action: 'insert', values: { rater_id: GUEST.uid, table_id: tid, stars: 5, meet_again: true } }, GUEST.tok)
    await rpc('award_badge', { p_badge: 'first-rate' }, GUEST.tok)
  }
  for (const b of ['firstJoin', 'firstRate']) check(`guest ${b} notification exactly once after 2 tables`, sql(`select count(*) from notifications where user_id='${GUEST.uid}' and kind='badgeEarned' and params->>'badge'='${b}'`) === '1')
  check('host got one "wants to join" per request (no duplicates)', sql(`select count(*) from notifications where user_id='${HOST.uid}' and kind='requestNew'`) === String(tables.length))
  check('guest got one approval per table', sql(`select count(*) from notifications where user_id='${GUEST.uid}' and kind='requestApprovedGuest'`) === String(tables.length))
  const dup = sql(`select count(*) from (select user_id, kind, params from notifications where user_id in ('${HOST.uid}','${GUEST.uid}') group by 1,2,3 having count(*)>1) d`)
  check('no duplicate notifications for host/guest', dup === '0', dup)
  const adminDup = sql(`select count(*) from (select kind, params from notifications n join auth.users u on u.id=n.user_id where u.email='${ADMIN}' and n.kind='badgeEarned' group by 1,2 having count(*)>1) d`)
  check('admin has no duplicated badge notifications', adminDup === '0', adminDup)
})

/* ───────────────────────── notifications in every language (P2) ───────────────────────── */
await sec('Every notification renders fully in sq/en/de/mk', async () => {
  await needUsers()
  const adminTok = await token(ADMIN)
  const G = GUEST
  const title = `Run ${STAMP}`
  // server-created notifications for GUEST (real code paths)
  await rpc('admin_notify_user', { p_user: G.uid, p_message: 'Hello from support' }, adminTok)
  await rpc('admin_grant_premium', { p_user: G.uid, p_plan: 'premium_1m', p_note: 'r2 test' }, adminTok)
  await rpc('admin_ban_user', { p_user: G.uid, p_reason: 'spam test' }, adminTok)
  sql(`delete from bans where user_id='${G.uid}'`)
  // remaining legacy-text notifications go through the same server helper the hooks use
  const py = `
from ejb.hooks import notify
from ejb.services import common
u='${G.uid}'
notify(u, '🔔', 'U lirua një vend te "${title}" — ishe i pari në radhë! Konfirmoje.')
notify(u, '💫', 'Përputhje e ndërsjellë! Chat-i privat u hap te "Lidhjet e mia".')
notify(u, '🎟️', 'Vendi u konfirmua! Bileta jote: EBK-TEST1')
notify(u, 'info', 'Tavolina "${title}" u mbyll nga nikoqiri.', 'tableClosedByHostNotif', {'table': '${title}'})
common.notify(u, 'info', 'U përputhe me 5 persona për Darkën e së Mërkurës! Restoranti zbulohet 24 orë para.', 'wednesdayGrouped', {'count': 5, 'at': '2026-10-14T19:00:00+00:00'})
common.notify(u, 'info', 'Këtë të mërkurë nuk u formua grup për ty.', 'wednesdayWaitlisted', {'at': '2026-10-14T19:00:00+00:00'})
`
  execSync(`cd ${BACKEND} && MSGPACK_PUREPYTHON=1 python3 manage.py shell`, { input: py })
  const kinds = sql(`select string_agg(coalesce(kind,'NULL'), ',' order by created_at) from notifications where user_id='${G.uid}'`)
  check('every server notification got a kind (none stored as plain text)', !kinds.split(',').includes('NULL'), kinds)

  const albanian = /\b(u aprovove|kërkon|Fitove|Vendi u|Përputhje|Llogaria|Premium u aktivizua|U lirua|nikoqiri|Mesazh nga|Konfirmo|Darkën|Tavolina)\b|ë/
  const texts = {}
  for (const lang of LANGS) {
    const p = await newPage({ lang })
    await apiSignIn(p, G.email)
    await p.locator('.bell').click(); await p.waitForTimeout(1000)
    texts[lang] = await p.locator('.notif-item p').allInnerTexts()
    await p.screenshot({ path: SHOTS + `r2-notifs-${lang}-400.png` })
    check(`${lang}: all ${kinds.split(',').length} notifications listed`, texts[lang].length === kinds.split(',').length, `${texts[lang].length}`)
    check(`${lang}: no empty notification text`, texts[lang].every((x) => x.trim().length > 5), JSON.stringify(texts[lang]))
    if (lang !== 'sq') {
      const bad = texts[lang].filter((x) => albanian.test(x.replace(title, '').replace(/Guest Badge|Host Badge/g, '')))
      check(`${lang}: no Albanian left in any notification`, bad.length === 0, bad.join(' / '))
    }
    check(`${lang}: no page errors`, p.errs.length === 0, p.errs.join(' | '))
    await p.context().close()
  }
  const allDiffer = texts.sq.every((x, i) => LANGS.slice(1).every((l) => texts[l][i] !== x))
  check('each notification text differs between sq and the other languages', allDiffer)
  check('admin message framed in the viewer language and keeps the text', texts.en.some((x) => /Message from the ejaBashkohu team: Hello from support/.test(x)) && texts.de.some((x) => /Nachricht vom ejaBashkohu-Team/.test(x)))
})

/* ───────────────────────── rating sheet language (P2 related) ───────────────────────── */
await sec('After-meeting rating sheet is translated', async () => {
  await needUsers()
  // GUEST is a member of HOST's tables: open My tables in English and open the rating sheet
  sql(`delete from ratings where rater_id='${GUEST.uid}'`)
  const p = await newPage({ lang: 'en' })
  await apiSignIn(p, GUEST.email)
  await p.locator('nav.nav button').nth(1).click().catch(() => {}); await p.waitForTimeout(1500)
  const rb = p.locator('.rate-btn').first()
  if (await rb.count()) {
    await rb.click(); await p.waitForTimeout(600)
    const txt = await p.locator('.sheet').last().innerText()
    check('rating sheet in English', /How was it\?/.test(txt) && /Send rating/.test(txt) && !/Si ishte|Dërgo/.test(txt), txt.slice(0, 200))
    await p.screenshot({ path: SHOTS + 'r2-rating-en-400.png' })
  } else check('rating button available for a joined table', false, (await bodyText(p)).slice(0, 300))
  await p.context().close()
})

/* ───────────────────────── deactivation ───────────────────────── */
await sec('Account deactivation', async () => {
  await needUsers()
  const p = await newPage()
  const u = await makeUser(p, 'deact', { first: 'Dea', last: 'Aktiv' })
  await signIn(p, u.email)
  await openProfile(p)
  let n = 0
  p.on('dialog', (d) => { n++; d.accept() })
  await p.locator('.btn-deactivate').scrollIntoViewIfNeeded().catch(() => {})
  await p.locator('.btn-deactivate').click({ timeout: 10000 }).catch(async (e) => { await dbg(p, 'deactivate'); throw e })
  await p.waitForTimeout(2500)
  check('two confirmations asked', n === 2, n)
  check('deactivated_at stored', sql(`select deactivated_at is not null from profiles where id='${u.uid}'`) === 't')
  check('signed out after deactivation', !(await p.evaluate(() => !!JSON.parse(localStorage.getItem('ejb-auth-session') || 'null')?.access_token)))
  await signIn(p, u.email)
  const t = await bodyText(p)
  check('signing back in shows the deactivated message, not the feed', !(await p.locator('.hdr-user').isVisible().catch(() => false)) && /çaktivizuar|çaktivizua/i.test(t), t.slice(0, 300))
  await p.screenshot({ path: SHOTS + 'r2-deactivated-400.png' })
  const re = await q({ table: 'profiles', action: 'update', values: { deactivated_at: null }, filters: [{ col: 'id', op: 'eq', value: u.uid }] }, await token(u.email))
  check('user cannot reactivate by updating the profile', sql(`select deactivated_at is not null from profiles where id='${u.uid}'`) === 't', JSON.stringify(re).slice(0, 150))
  await p.context().close()
})

/* ───────────────────────── A8 screenshots ───────────────────────── */
await sec('Screenshots of the main screens (phone + desktop)', async () => {
  await needUsers()
  for (const [w, h] of [[400, 860], [1280, 800]]) {
    const tag = `${w}`
    const overflow = async (p, name) => {
      const o = await p.evaluate(() => {
        const W = document.documentElement.clientWidth
        const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.right > W + 2 && cs.position !== 'fixed' && !e.closest('.city-row,.cat-row,.chips,.scroll-x,[class*=scroll],[class*=row]') })
        return { scroll: document.documentElement.scrollWidth > W + 1, els: wide.slice(0, 4).map((e) => e.className || e.tagName) }
      })
      check(`${name} @${tag}: no horizontal overflow`, !o.scroll, JSON.stringify(o))
      const broken = await p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.slice(0, 80)))
      check(`${name} @${tag}: no broken images`, broken.length === 0, broken.join(', '))
    }
    const p = await newPage({ width: w, height: h })
    await p.screenshot({ path: SHOTS + `r2-landing-${tag}.png` }); await overflow(p, 'landing')
    await p.getByText('Hyr', { exact: true }).first().click(); await p.waitForTimeout(400)
    await p.screenshot({ path: SHOTS + `r2-signin-${tag}.png` }); await overflow(p, 'sign-in')
    await p.context().close()

    const s = await newPage({ width: w, height: h })
    await s.getByRole('button', { name: 'Eja bashkohu, falas' }).click(); await s.waitForTimeout(600)
    await s.screenshot({ path: SHOTS + `r2-signup-${tag}.png` }); await overflow(s, 'sign-up')
    await s.context().close()

    const m = await newPage({ width: w, height: h })
    m.setDefaultTimeout(10000)
    await signIn(m, HOST.email)
    await m.screenshot({ path: SHOTS + `r2-feed-${tag}.png` }); await overflow(m, 'feed')
    const modes = await m.locator('.browse-modes .browse-mode').count()
    for (let i = 0; i < Math.min(modes, 5); i++) {
      await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400)
      await m.locator('.browse-modes .browse-mode').nth(i).click(); await m.waitForTimeout(700)
      await m.screenshot({ path: SHOTS + `r2-feed-mode${i}-${tag}.png` }); await overflow(m, `feed mode ${i}`)
    }
    await m.locator('article.card').first().click().catch(() => {}); await m.waitForTimeout(900)
    await m.screenshot({ path: SHOTS + `r2-table-${tag}.png` }); await overflow(m, 'table detail')
    await m.keyboard.press('Escape'); await m.goto(SITE + '/'); await m.waitForTimeout(2000); await m.locator('.browse-modes .browse-mode').first().click().catch(() => {}); await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400); await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400)
    await m.locator('.fab:visible, .sidebar-cta:visible').first().click(); await m.waitForTimeout(700)
    await m.screenshot({ path: SHOTS + `r2-create-${tag}.png` }); await overflow(m, 'create form')
    await m.goto(SITE + '/'); await m.waitForTimeout(2000); await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400)
    await openEdit(m)
    await m.screenshot({ path: SHOTS + `r2-editprofile-${tag}.png` }); await overflow(m, 'edit profile')
    await m.goto(SITE + '/'); await m.waitForTimeout(2000); await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400)
    await m.locator('.premium-pill').click(); await m.waitForTimeout(800)
    await m.screenshot({ path: SHOTS + `r2-plans-${tag}.png` }); await overflow(m, 'plans')
    await m.goto(SITE + '/'); await m.waitForTimeout(2000); await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400)
    await m.locator('.bell').click(); await m.waitForTimeout(800)
    await m.screenshot({ path: SHOTS + `r2-notifs-${tag}.png` }); await overflow(m, 'notifications')
    await m.goto(SITE + '/'); await m.waitForTimeout(2000); await m.locator('nav.nav button:visible, .sb-btn:visible').first().click().catch(() => {}); await m.waitForTimeout(400)
    const navBtns = m.locator('.bottom-nav button, nav.tabs button, .sb-btn')
    await m.getByText(/Mësime/).last().click().catch(() => {}); await m.waitForTimeout(1500)
    await m.screenshot({ path: SHOTS + `r2-lessons-${tag}.png` }); await overflow(m, 'lessons')
    await m.getByText('Tavolinat e mia').last().click().catch(() => {}); await m.waitForTimeout(1200)
    await m.screenshot({ path: SHOTS + `r2-mytables-${tag}.png` }); await overflow(m, 'my tables')
    void navBtns
    check(`app screens @${tag}: no page errors`, m.errs.length === 0, m.errs.join(' | '))
    await m.context().close()

    const a = await newPage({ width: w, height: h })
    await signIn(a, ADMIN)
    await a.waitForTimeout(1500)
    await a.screenshot({ path: SHOTS + `r2-admin-${tag}.png` }); await overflow(a, 'admin')
    await a.context().close()
  }
})

// cleanup test tables (users stay: unique per run)
sql(`delete from tables where host_id in (select id from auth.users where email like 'r2.%.${STAMP}@gmail.com')`)
await close()
process.exit(summary() ? 1 : 0)
