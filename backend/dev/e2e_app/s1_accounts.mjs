// Accounts: email sign-up with real confirmation email, onboarding (age, photo
// upload, local/tourist), password masking, Google sign-in with onboarding,
// password reset, sign-in of an existing account.
import { API, SITE, bodyText, check, close, launch, makeJpeg, newPage, section, signIn, sql, summary, verifyLink, waitMail } from './lib.mjs'

await launch()

await section('Email sign-up + confirmation + onboarding', async () => {
  const p = await newPage()
  const email = `nora.${Date.now()}@gmail.com`
  await p.getByRole('button', { name: 'Eja bashkohu, falas' }).click(); await p.waitForTimeout(800)
  const pw = p.locator('.input-password-wrap input').first()
  check('password field is masked (type=password)', (await pw.getAttribute('type')) === 'password')
  await p.locator('input[placeholder]').nth(0).fill('Nora')
  await p.locator('input[placeholder]').nth(1).fill('Hasani')
  await p.locator('input[type=email]').fill(email)
  await pw.fill('Secret123!')
  await p.locator('.password-toggle').first().click()
  check('eye button reveals the password', (await pw.getAttribute('type')) === 'text')
  await p.locator('#terms-check').check()
  const t0 = Date.now()
  await p.locator('.step-body .btn.primary').first().click(); await p.waitForTimeout(2500)
  const txt = await bodyText(p)
  check('after sign-up the app asks to confirm the email', /konfirm|email/i.test(txt), txt.slice(0, 200))
  check('account created in auth.users, profile created', sql(`select count(*) from auth.users u join profiles p on p.id=u.id where u.email='${email}' and p.first_name='Nora'`) === '1')
  const mail = await waitMail(email, t0)
  const link = verifyLink(mail)
  check('confirmation email arrives with a link', !!link)
  await p.goto(link); await p.waitForTimeout(3000)
  check('confirmation link returns to the app signed in', await p.evaluate(() => !!JSON.parse(localStorage.getItem('ejb-auth-session') || 'null')?.access_token))
  check('email marked confirmed', sql(`select email_confirmed_at is not null from auth.users where email='${email}'`) === 't')
  // onboarding continues: age
  const ageVisible = await p.locator('.age-big').isVisible().catch(() => false)
  check('onboarding continues at the age step', ageVisible, (await bodyText(p)).slice(0, 200))
  if (ageVisible) {
    await p.locator('.age-btn.plus').click(); await p.locator('.age-btn.plus').click()
    await p.locator('.step-body .btn.primary').click(); await p.waitForTimeout(600)
    // photo: a 3000x4000 PNG must be shrunk and uploaded to Django storage
    const png = await makeJpeg(p)
    await p.locator('input[type=file]').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: png })
    await p.waitForTimeout(4000)
    check('photo accepted (continue enabled)', !(await p.locator('.step-body .btn.primary').isDisabled()))
    await p.locator('.step-body .btn.primary').click(); await p.waitForTimeout(800)
    await p.locator('.choice-grid button').first().click(); await p.waitForTimeout(3000)
    const uid = sql(`select id from auth.users where email='${email}'`)
    check('onboarding completed in the database (age 24 + 2 taps = 26)', sql(`select onboarded_at is not null and age = 26 from profiles where id='${uid}'`) === 't')
    const photo = sql(`select photo_path from profiles where id='${uid}'`)
    check('photo saved to storage and linked to the profile', photo === `${uid}/avatar.jpg`)
    const meta = sql(`select size || ' ' || content_type from backend.storage_objects where path='${uid}/avatar.jpg'`)
    check('uploaded file is a small JPEG (compressed on the phone)', /image\/jpeg$/.test(meta) && Number(meta.split(' ')[0]) < 400000, meta)
  }
  check('no failed API calls during sign-up', p.bad.length === 0, p.bad.join(', '))
  check('no page errors', p.errs.length === 0, p.errs.join(' | '))
  await p.context().close()
})

await section('Google sign-in (fake Google) + onboarding not skipped', async () => {
  const p = await newPage()
  await p.getByText('Hyr', { exact: true }).first().click().catch(() => {})
  await p.waitForTimeout(300)
  await p.locator('.social-btn.google').click(); await p.waitForTimeout(4000)
  check('returns from Google signed in', await p.evaluate(() => !!JSON.parse(localStorage.getItem('ejb-auth-session') || 'null')?.access_token))
  const t = await bodyText(p)
  check('onboarding shown (name prefilled from Google), not skipped', /Si të thërrasim/.test(t), t.slice(0, 200))
  const names = [await p.locator('.step-body input.input').nth(0).inputValue().catch(() => ''), await p.locator('.step-body input.input').nth(1).inputValue().catch(() => '')]
  check('name prefilled from Google account', names[0] === 'Arbër' && names[1] === 'Kelmendi', names.join(' '))
  await p.context().close()
})

await section('Password reset through email', async () => {
  const p = await newPage()
  await p.getByText('Hyr', { exact: true }).first().click().catch(() => {})
  await p.waitForTimeout(300)
  const email = 'jeta.rexhepi@gmail.com'
  const exists = sql(`select count(*) from auth.users where email='${email}'`) === '1'
  const target = exists ? email : sql("select email from auth.users where email like '%@gmail.com' and email not like 'g.%' order by email limit 1")
  await p.getByText('Harrova fjalëkalimin').click(); await p.waitForTimeout(400)
  await p.locator('input[type=email]').first().fill(target)
  const t0 = Date.now()
  await p.locator('form button[type=submit], .btn.primary').first().click(); await p.waitForTimeout(1500)
  const link = verifyLink(await waitMail(target, t0))
  check('reset email arrives', !!link)
  await p.goto(link); await p.waitForTimeout(2500)
  const newPw = p.locator('.input-password-wrap input').first()
  check('app opens the "new password" form', await newPw.isVisible().catch(() => false), (await bodyText(p)).slice(0, 200))
  await newPw.fill('Changed789!')
  await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(2500)
  const r = await fetch(API + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: target, password: 'Changed789!' }) })
  check('new password works', r.ok)
  sql(`update auth.users set encrypted_password = extensions.crypt('Test1234!', extensions.gen_salt('bf', 10)) where email='${target}'`)
  await p.context().close()
})

await section('Existing account signs in; wrong password message', async () => {
  const p = await newPage()
  await signIn(p, 'arta.krasniqi@gmail.com', 'nope-nope')
  check('wrong password shows an error, stays signed out', !(await p.evaluate(() => localStorage.getItem('ejb-auth-session'))))
  await p.reload(); await p.waitForTimeout(800)
  await signIn(p, 'arta.krasniqi@gmail.com')
  const t = await bodyText(p)
  check('feed loads after sign-in', /tavolina të hapura|Tavolinat/.test(t), t.slice(0, 150))
  await p.reload(); await p.waitForTimeout(2500)
  check('session survives a reload', /Tavolinat/.test(await bodyText(p)))
  await p.context().close()
})

await close()
process.exit(summary() ? 1 : 0)
